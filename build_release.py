"""Fabrique une version DISTRIBUABLE d'E.N.O.S. (installeur .exe sous Windows ; archive .tar.gz / AppImage sous Linux, voir docs/BUILD_LINUX.md) sans une seule donnée personnelle.
LINUX : à lancer SUR Linux (ou dans WSL) — PyInstaller ne fait pas de compilation croisée. La clé de signature se désigne avec ENOS_RELEASE_KEYS.

    py build_release.py --version 3.1.0 --base-url https://github.com/TOI/ENOS/releases/download/v3.1.0
    py build_release.py --version 3.1.0 --check          (analyse seulement : ce qui est exclu + recherche de fuites, rien n'est construit)
    py build_release.py --version 3.1.0 --skip-build     (prépare / contrôle le dossier sans compiler)
    py build_release.py --version 3.1.0 --edition dev    (édition physiquement isolée : friends (défaut) | dev | ceo — voir release_editions.py)

PRINCIPE — on ne PURGE JAMAIS ton dossier de travail : on construit une COPIE saine (liste blanche) dans release\\stage et on compile à partir d'elle.
Ton historique, tes audios, tes logs, tes clés restent intacts chez toi ; ce qui n'est pas dans la liste blanche n'entre simplement jamais dans la version de l'ami.

Étapes : 1) clé de signature OTA (créée une fois)  2) copie en liste blanche  3) nasko_config_template.json + profil vierge
         4) recherche de fuites (tes vraies clés / liens / chemins cherchés dans la copie)  5) PyInstaller, avec EXACTEMENT les options de build.bat,
         puis le Dual Pulse Launcher (Tauri : `cargo tauri build --no-bundle`, clé publique des manifestes synchronisée sur ota_pubkey.txt)
         6) Inno Setup (si installé) : l'installeur EMBARQUE le Launcher et ses raccourcis pointent vers lui  7) manifeste OTA signé (Ed25519).

Prérequis du Launcher (Windows) : Rust (rustup) + `cargo install tauri-cli --version "^2"` + WebView2. Sans eux le build s'arrête : un installeur sans Launcher serait
livré sans son point d'entrée (connexion par invitation). `--skip-launcher` permet un build de développement SANS Launcher (raccourcis vers ENOS.exe), avec avertissement.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REL = ROOT / "release"
STAGE = REL / "stage"                       # redéfinis par édition dans main() : release\stage-<édition>, release\dist-<édition> (jamais mélangés)
DIST = REL / "dist"
OUT = REL / "installer"
LAUNCHER = ROOT / "launcher"                # sources du Dual Pulse Launcher (workspace Cargo : engine/ + src-tauri/)
LAUNCHER_TARGET = REL / "launcher-target"   # dossier de compilation Cargo, hors des sources (jamais mélangé à ton dossier de travail)
LAUNCHER_OUT = REL / "launcher-bin"         # DualPulseLauncher.exe prêt à embarquer (volontairement HORS de dist-<édition> : jamais dans les manifestes « files » d'E.N.O.S.)
LAUNCHER_BIN = "dual-pulse-launcher.exe"    # nom produit par Cargo (package « dual-pulse-launcher ») — sans « .exe » sous Linux, voir launcher_bin() / launcher_file()
LAUNCHER_FILE = "DualPulseLauncher.exe"     # nom installé (voir installer/enos.iss)


def is_windows():
    return sys.platform == "win32"


def is_linux():
    return sys.platform.startswith("linux")


def launcher_bin():
    return LAUNCHER_BIN if is_windows() else LAUNCHER_BIN[:-4]


def launcher_file():
    return LAUNCHER_FILE if is_windows() else "dual-pulse-launcher"


def app_exe():
    """Nom du binaire principal produit par PyInstaller (ENOS.exe sous Windows, ENOS sous Linux)."""
    return "ENOS.exe" if is_windows() else "ENOS"


def keys_dir():
    """Dossier de la clé privée de signature OTA — HORS du dossier du projet (OneDrive/Git), à SAUVEGARDER, jamais publiée ni régénérée.
    ENOS_RELEASE_KEYS le force (ex. compiler sous WSL avec la clé de Windows : /mnt/c/Users/<toi>/AppData/Local/ENOS-release/keys). Windows : %LOCALAPPDATA%\\ENOS-release\\keys ;
    Linux : $XDG_DATA_HOME/ENOS-release/keys (défaut ~/.local/share)."""
    if os.environ.get("ENOS_RELEASE_KEYS"):
        return Path(os.environ["ENOS_RELEASE_KEYS"])
    if os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "ENOS-release" / "keys"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "ENOS-release" / "keys"


KEYS = keys_dir()
sys.path.insert(0, str(ROOT))

# ---------------------------------------------------------------- liste blanche (tout le reste est ignoré)
ROOT_FILES = ("*.py", "build.bat", "requirements.txt", "logo.png", "logo-192.png", "logo-512.png", "logo.ico", "updater_ui.html")
SKIP_ROOT_PY = {"build_release.py", "diagnostic_reveil.py", "creer_voix_eto.py", "generer_voix.py", "renommer_audio.py", "construire_apk.py",
                "creer_relais.py", "wake_relay.py", "release_editions.py", "configurer_llm.py", "creer_raccourci.py", "updater.py", "release_linux.py"}   # outils de développement, inutiles à l'ami
TREES = {                                  # dossiers livrés tels quels (assets graphiques, thème Coreboard, audio de l'OS, projets Godot de l'Œil et des échecs)
    "static": None, "voix": None, "openings": None, "cascades": None,
    "godot_eye": None, "godot_chess": None, "godot_neon": None, "godot_games": None, "godot_chess_edit": None,
}
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", "*.log", ".godot", "*.tmp", "*.part")
# Jamais copiés (données personnelles ou volumineuses) — listés par --check pour que tu voies ce qui est exclu
PERSONAL = ["data", "Audio", "Audionew", "Stockage", "Compression", "Traitement d'image", "PourClaude", "archive", "android", "dualpulse_site",
            "nasko_config.json", "enos_profiles.json", "*.log", "ENOS.apk*", "NASKO.apk*", "NASKO.exe", "ENOS.exe", "*.jpg", "GUIDE.md"]

TEMPLATE_EXTRA = {"zeus_ics_url": "", "moodle_ics_url": "", "update_manifest_url": "", "onboarding_done": False, "agent_enabled": True}
BLANK_PROFILES = {"version": 1, "active": "", "profiles": {"user": {
    "label": "", "windows_users": [], "paths": {k: "" for k in ("godot_path", "aseprite_path", "chrome_path", "ffmpeg_path", "warehouse_dir", "project_dir")}, "options": {}}}}


def say(msg=""):
    print(msg, flush=True)


def die(msg):
    say("\nERREUR : " + msg)
    sys.exit(1)


# ---------------------------------------------------------------- 1. clé de signature OTA
def ensure_signing_key():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    KEYS.mkdir(parents=True, exist_ok=True)
    priv_path, pub_path = KEYS / "ota_private.pem", ROOT / "ota_pubkey.txt"
    if priv_path.exists():
        priv = serialization.load_pem_private_key(priv_path.read_bytes(), None)
    else:
        if pub_path.exists():
            die("ota_pubkey.txt existe mais pas la clé privée correspondante (release\\keys\\ota_private.pem) : "
                "retrouve ta sauvegarde, sinon les ENOS déjà installés ne pourront plus vérifier tes mises à jour.")
        priv = Ed25519PrivateKey.generate()
        priv_path.write_bytes(priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        say(f"  Nouvelle clé de signature créée : {priv_path}\n  >>> SAUVEGARDE-LA (clé USB / coffre). Perdue, plus aucune mise à jour OTA ne sera acceptée par les ENOS installés.")
    pub = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    pub_path.write_text(base64.b64encode(pub).decode(), encoding="ascii")
    return priv


# ---------------------------------------------------------------- 2. copie en liste blanche
def make_stage(version, edition="friends"):
    import release_editions
    if STAGE.exists():
        shutil.rmtree(STAGE)                                        # uniquement release\stage : jamais ton dossier de travail
    STAGE.mkdir(parents=True)
    n = 0
    for pat in ROOT_FILES:
        for f in ROOT.glob(pat):
            if f.is_file() and f.name not in SKIP_ROOT_PY:
                shutil.copy2(f, STAGE / f.name)
                n += 1
    for d in TREES:
        if (ROOT / d).is_dir():
            shutil.copytree(ROOT / d, STAGE / d, ignore=IGNORE)
    (STAGE / "version.txt").write_text(version, encoding="utf-8")
    (STAGE / "ota_pubkey.txt").write_text((ROOT / "ota_pubkey.txt").read_text(), encoding="ascii")
    say(f"  {n} fichiers racine + {len(TREES)} dossiers copiés dans {STAGE}")
    rep = release_editions.apply(STAGE, edition)
    say(f"  Édition « {edition} » : {len(rep['stubbed'])} module(s) Python remplacés par une coquille, {len(rep['removed_static'])} fichier(s) d'interface et "
        f"{len(rep['removed_dirs'])} dossier(s) supprimés")
    bad = release_editions.verify(STAGE, edition)
    if bad:
        die("isolation de l'édition incorrecte : " + " ; ".join(bad))


# ---------------------------------------------------------------- 3. configuration vierge
def make_templates(manifest_url):
    import nasko_core
    cfg = dict(nasko_core.DEFAULT_CONFIG)                           # construit depuis les valeurs PAR DÉFAUT du code : impossible d'y retrouver tes clés
    cfg.update(TEMPLATE_EXTRA)
    cfg["update_manifest_url"] = manifest_url or ""
    text = json.dumps(cfg, indent=2, ensure_ascii=False)
    (ROOT / "nasko_config_template.json").write_text(text, encoding="utf-8")
    DIST.mkdir(parents=True, exist_ok=True)
    (DIST / "nasko_config.json").write_text(text, encoding="utf-8")
    (DIST / "enos_profiles.json").write_text(json.dumps(BLANK_PROFILES, indent=2, ensure_ascii=False), encoding="utf-8")
    say(f"  nasko_config_template.json : {len(cfg)} réglages, toutes les clés/liens vides")


# ---------------------------------------------------------------- 4. recherche de fuites
def _secrets():
    """Tes vraies valeurs sensibles (lues dans TON nasko_config.json) + motifs de clés + ton nom d'utilisateur Windows."""
    vals = set()
    try:
        cfg = json.loads((ROOT / "nasko_config.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        cfg = {}
    for k, v in cfg.items():
        public = re.match(r"https://(api\.(groq|openai|anthropic|elevenlabs)\.(com|io)|[\w.-]*googleapis\.com)(/[\w./-]*)?$", v) if isinstance(v, str) else None
        if isinstance(v, str) and len(v) >= 8 and not public and re.search(r"key|token|secret|code|url|pass|voice_id", k, re.I):
            vals.add(v)
        if k == "trusted_ips" and isinstance(v, list):
            vals.update(x for x in v if isinstance(x, str) and len(x) >= 8)
    user = os.path.basename(os.path.expanduser("~"))
    pats = [re.compile(rb"gsk_[A-Za-z0-9]{20,}"), re.compile(rb"sk_[a-f0-9]{32,}"), re.compile(rb"AIza[0-9A-Za-z_\-]{30,}"),
            re.compile(rb"authtoken=[0-9a-f]{20,}"), re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
            re.compile(rb"C:\\\\?Users\\\\?" + re.escape(user.encode()), re.I)]
    return [v.encode() for v in vals], pats


def leak_scan(folder):
    exact, pats = _secrets()
    hits = []
    for f in Path(folder).rglob("*"):
        if not f.is_file() or f.stat().st_size > 60 * 1024 * 1024:
            continue
        try:
            b = f.read_bytes()
        except OSError:
            continue
        for v in exact:
            if v in b:
                hits.append((f, "valeur de ta config (clé / lien / code)"))
        for p in pats:
            if p.search(b):
                hits.append((f, f"motif sensible ({p.pattern[:24].decode(errors='replace')}…)"))
    return hits


def report_excluded():
    say("  Exclus de la version de l'ami (restent chez toi, intacts) :")
    for pat in PERSONAL:
        for p in sorted(ROOT.glob(pat)):
            size = sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.is_dir() else p.stat().st_size
            say(f"    - {p.name:<26} {size / 1048576:8.1f} Mo")


# ---------------------------------------------------------------- 5. PyInstaller : mêmes options que build.bat (une seule source de vérité)
def pyinstaller_args():
    txt = (ROOT / "build.bat").read_text(encoding="utf-8", errors="replace")
    m = re.search(r"-m PyInstaller(.*?nasko_server\.py)", txt, re.S)
    if not m:
        die("commande PyInstaller introuvable dans build.bat")
    flat = re.sub(r"\^\s*\r?\n", " ", m.group(1)).replace("%~dp0", "@@STAGE@@" + os.sep)       # marqueur sans espace : le chemin réel en contient
    toks = shlex.split(flat, posix=False)
    out, i = [], 0
    while i < len(toks):
        t = toks[i]
        if t in ("--distpath", "--workpath", "--specpath"):          # redirigés vers release\
            i += 2
            continue
        out.append(t.replace('"', "").replace("@@STAGE@@", str(STAGE)))
        i += 1
    return out


WINDOWS_ONLY_OPTS = ("--noconsole", "--windowed", "-w")                 # sans effet (ou avertissement) hors Windows
WINDOWS_ONLY_PREFIX = ("--icon=", "--version-file=", "--manifest=", "--uac-admin", "--uac-uiaccess")


def posix_pyinstaller_args(args):
    """Options de build.bat -> options PyInstaller pour Linux : `--add-data SRC;DEST` devient `SRC:DEST` et les options propres à Windows (icône .ico, console, manifeste…) sont retirées.
    Fonction pure (testée sans Linux)."""
    out, i = [], 0
    while i < len(args):
        a = args[i]
        if a in WINDOWS_ONLY_OPTS or a.startswith(WINDOWS_ONLY_PREFIX):
            i += 1
            continue
        if a == "--icon" and i + 1 < len(args):                      # forme « --icon X »
            i += 2
            continue
        if a == "--add-data" and i + 1 < len(args):
            out += [a, args[i + 1].replace(";", ":", 1)]
            i += 2
            continue
        out.append(a)
        i += 1
    return out


def drop_missing_data(args):
    """--add-data dont la source n'existe pas dans le dossier de build (ex. « openings » retiré de l'édition Friends) : retiré de la commande au lieu de faire échouer PyInstaller."""
    out, i = [], 0
    while i < len(args):
        if args[i] == "--add-data" and i + 1 < len(args):
            src = args[i + 1].split(";", 1)[0]
            if not Path(src).exists():
                say(f"    (ignoré : {Path(src).name} absent de cette édition)")
                i += 2
                continue
        out.append(args[i])
        i += 1
    return out


def build_exe():
    args = drop_missing_data(pyinstaller_args())
    if not is_windows():
        args = posix_pyinstaller_args(args)
    sep = ";" if is_windows() else ":"
    args = [a for a in args if a != "--onefile"] + (["--onefile"] if "--onedir" not in sys.argv else ["--onedir"])
    extra = ["--add-data", f"{STAGE / 'version.txt'}{sep}.", "--add-data", f"{STAGE / 'ota_pubkey.txt'}{sep}.", "--add-data", f"{STAGE / 'enos_edition.json'}{sep}.",
             "--distpath", str(DIST), "--workpath", str(REL / "build_tmp"), "--specpath", str(REL / "build_tmp")]
    cmd = [sys.executable, "-m", "PyInstaller", *extra, *args]
    say("  PyInstaller… (plusieurs minutes)")
    r = subprocess.run(cmd, cwd=STAGE)
    if r.returncode != 0:
        die("la compilation a échoué (voir les messages ci-dessus).")
    shutil.rmtree(REL / "build_tmp", ignore_errors=True)
    for d in ("godot_eye", "godot_chess", "godot_neon", "godot_games", "godot_chess_edit"):            # projets Godot lus à côté de l'exe (Œil de bureau, échecs)
        if (STAGE / d).is_dir():
            shutil.copytree(STAGE / d, DIST / d, dirs_exist_ok=True)
    shutil.copy2(STAGE / "logo.ico", DIST / "logo.ico")


# ---------------------------------------------------------------- 5b. Dual Pulse Launcher (Tauri)
def sync_launcher_pubkey():
    """La clé publique des manifestes est COMPILÉE dans le Launcher (include_str! de src-tauri/manifest_pubkey.txt) : un manifeste non signé par elle est refusé.
    Elle doit donc être exactement ota_pubkey.txt (la clé qui signe les manifestes de cette version) ; sinon le Launcher refuserait toutes nos mises à jour."""
    src, dst = ROOT / "ota_pubkey.txt", LAUNCHER / "src-tauri" / "manifest_pubkey.txt"
    key = src.read_text(encoding="ascii").strip()
    if not dst.exists() or dst.read_text(encoding="ascii").strip() != key:
        dst.write_text(key + "\n", encoding="ascii")
        say("  Clé publique des manifestes du Launcher synchronisée sur ota_pubkey.txt (elle était différente).")
    return key


def launcher_env():
    """Environnement de compilation : dossier Cargo dédié + chemins locaux masqués dans le binaire (sinon `C:\\Users\\<toi>\\.cargo\\registry\\…` se retrouve dans les
    messages d'erreur Rust, ce que la recherche de fuites refuserait)."""
    env = dict(os.environ)
    env["CARGO_TARGET_DIR"] = str(LAUNCHER_TARGET)
    remaps = [(str(Path.home()), "~"), (str(LAUNCHER), "launcher"), (str(ROOT), "enos")]
    flags = [f"--remap-path-prefix={a}={b}" for a, b in remaps if a]
    # CARGO_ENCODED_RUSTFLAGS (séparateur \x1f) : RUSTFLAGS se découpe sur les espaces, or le dossier du projet en contient (« Logiciel ENOS »)
    base = env.pop("CARGO_ENCODED_RUSTFLAGS", "")
    if not base and env.get("RUSTFLAGS"):
        base = "\x1f".join(env["RUSTFLAGS"].split())
    env.pop("RUSTFLAGS", None)
    env["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(([base] if base else []) + flags)
    return env


def build_launcher():
    """Compile le Launcher (`cargo tauri build --no-bundle` : l'exécutable seul, l'installeur Inno se charge de l'embarquer) et retourne son chemin.
    S'arrête avec un message clair si l'outillage manque : on ne produit JAMAIS en silence un installeur sans Launcher."""
    if not (is_windows() or is_linux()):
        die("le Launcher se compile sous Windows (WebView2, coffre d'identifiants Windows) ou sous Linux (WebKitGTK, Secret Service). Utilise --skip-launcher pour un build sans Launcher.")
    if is_linux():
        import release_linux
        problems = release_linux.preflight(with_launcher=True)
        problems = [p for p in problems if "Launcher" in p or "pkg-config" in p]            # le reste (binutils, pywebview) est contrôlé avant PyInstaller
        if problems:
            die("outillage Linux incomplet pour le Launcher :\n    - " + "\n    - ".join(problems) + "\n  (ou utilise --skip-launcher)")
    if not (LAUNCHER / "src-tauri" / "tauri.conf.json").exists():
        die(f"sources du Launcher introuvables : {LAUNCHER}")
    cargo = shutil.which("cargo")
    if not cargo:
        die("Rust (cargo) est introuvable : installe-le (https://rustup.rs) puis `cargo install tauri-cli --version \"^2\"`, ou utilise --skip-launcher.")
    if subprocess.run([cargo, "tauri", "--version"], capture_output=True).returncode != 0:
        die("tauri-cli est absent : `cargo install tauri-cli --version \"^2\"`, ou utilise --skip-launcher.")
    sync_launcher_pubkey()
    say("  Launcher Dual Pulse (Tauri)… (plusieurs minutes la première fois)")
    r = subprocess.run([cargo, "tauri", "build", "--no-bundle"], cwd=LAUNCHER, env=launcher_env())
    if r.returncode != 0:
        die("la compilation du Launcher a échoué (voir les messages ci-dessus).")
    exe = LAUNCHER_TARGET / "release" / launcher_bin()
    check_launcher_exe(exe)
    LAUNCHER_OUT.mkdir(parents=True, exist_ok=True)
    out = LAUNCHER_OUT / launcher_file()
    shutil.copy2(exe, out)
    hits = leak_scan(LAUNCHER_OUT)
    if hits:
        die("fuite détectée dans le Launcher compilé : " + ", ".join(f"{h[0].name} ({h[1]})" for h in hits[:3]))
    say(f"  Launcher : {out} ({out.stat().st_size / 1048576:.1f} Mo)")
    return out


def check_launcher_exe(exe):
    """Le fichier attendu existe, est un exécutable de la plateforme (Windows : en-tête « MZ » ; Linux : « \\x7fELF ») et n'est pas une coquille vide."""
    exe = Path(exe)
    if not exe.is_file():
        die(f"le Launcher compilé est introuvable : {exe}")
    with open(exe, "rb") as f:
        head = f.read(4)
    magic, label = (b"MZ", "Windows") if is_windows() else (b"\x7fELF", "Linux")
    if not head.startswith(magic) or exe.stat().st_size < 512 * 1024:
        die(f"{exe} n'est pas un exécutable {label} valide.")


# ---------------------------------------------------------------- 6bis. paquet Linux (tar.gz avec install.sh, AppImage en option)
def build_linux_package(version, edition, launcher_exe=None, fmt="tar"):
    """Assemble ce que PyInstaller (et Cargo) ont produit en livrables Linux (voir release_linux.py). Retourne la liste des fichiers créés (+ leur .sha256)."""
    import release_linux as L
    app_root = DIST / "ENOS" if (DIST / "ENOS").is_dir() else DIST           # --onedir : PyInstaller crée dist/ENOS/
    if app_root != DIST:
        for d in ("godot_eye", "godot_chess", "godot_neon", "godot_games", "godot_chess_edit"):
            if (DIST / d).is_dir():
                shutil.copytree(DIST / d, app_root / d, dirs_exist_ok=True)
    icon = STAGE / "logo-512.png"
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    if fmt in ("tar", "both"):
        pkg = L.assemble_tree(REL / "linux-pkg" / f"ENOS-{version}-{edition}-linux-{L.arch()}", app_root, version, edition, launcher_exe, icon)
        made.append(L.make_tarball(pkg, OUT / L.package_name(version, edition)))
    if fmt in ("appimage", "both"):
        tool = L.find_appimagetool()
        if not tool:
            msg = "appimagetool introuvable (https://github.com/AppImage/appimagetool/releases) : pose-le dans le PATH ou définis APPIMAGETOOL."
            if fmt == "appimage":
                die(msg)
            say("  !! " + msg + " AppImage ignorée.")
        else:
            appdir = L.assemble_appdir(REL / "linux-appdir" / f"ENOS-{version}-{edition}.AppDir", app_root, version, edition, icon)
            out = L.build_appimage(appdir, OUT / L.package_name(version, edition, "AppImage"), tool)
            if not out:
                die("appimagetool a échoué.")
            made.append(out)
    for f in list(made):
        digest = hashlib.sha256(Path(f).read_bytes()).hexdigest()
        sha = Path(str(f) + ".sha256")
        sha.write_text(f"{digest}  {Path(f).name}\n", encoding="utf-8")
        made.append(sha)
        say(f"  {Path(f).name} : {Path(f).stat().st_size / 1048576:.1f} Mo, sha256 {digest[:16]}…")
    return made


# ---------------------------------------------------------------- 6. installeur Inno Setup
def wizard_images():
    """Bitmaps de l'assistant Inno aux couleurs Coreboard (noir, grille rouge) — générés avec Pillow."""
    from PIL import Image, ImageDraw, ImageFont
    d = REL / "installer_assets"
    d.mkdir(parents=True, exist_ok=True)

    def font(size):
        for n in ("consolab.ttf", "arialbd.ttf"):
            try:
                return ImageFont.truetype(n, size)
            except OSError:
                pass
        return ImageFont.load_default()

    def art(w, h, title, sub):
        im = Image.new("RGB", (w, h), (5, 5, 6))
        g = ImageDraw.Draw(im)
        for x in range(0, w, 16):
            g.line([(x, 0), (x, h)], fill=(52, 10, 20))
        for y in range(0, h, 16):
            g.line([(0, y), (w, y)], fill=(52, 10, 20))
        for r in range(60, 0, -4):                                  # halo rouge en haut à droite
            g.ellipse([w - r * 2, -r, w + r, r * 2], fill=(int(120 * (1 - r / 60)) + 5, 6, 20))
        g.rectangle([0, 0, 5, h], fill=(224, 36, 60))
        g.text((16, h - 70 if h > 100 else 12), title, font=font(26 if h > 100 else 15), fill=(224, 36, 60))
        if sub:
            g.text((16, h - 36), sub, font=font(11), fill=(139, 139, 148))
        return im

    art(164, 314, "E.N.O.S", "AI CORE // SETUP").save(d / "wiz_large.bmp")
    art(55, 55, "E", "").save(d / "wiz_small.bmp")
    return d


def iscc_command(iscc, version, edition, assets, launcher_exe=None):
    cmd = [iscc, f"/DAppVersion={version}", f"/DEdition=-{edition}", f"/DDistDir={DIST}", f"/DOutDir={OUT}", f"/DAssetsDir={assets}", f"/DRootDir={ROOT}"]
    if launcher_exe:
        cmd.append(f"/DLauncherExe={launcher_exe}")
    return cmd + [str(ROOT / "installer" / "enos.iss")]


def find_iscc():
    for c in (shutil.which("iscc"), r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe", r"C:\Program Files\Inno Setup 6\ISCC.exe",
              os.path.expandvars(r"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe")):
        if c and os.path.isfile(c):
            return c
    return None


def build_installer(version, edition="friends", launcher_exe=None):
    """`launcher_exe` : Launcher à embarquer (raccourcis et lancement final pointent alors vers lui). None = build sans Launcher (--skip-launcher)."""
    iscc = find_iscc()
    if not iscc:
        say("  Inno Setup introuvable : installe-le (https://jrsoftware.org/isdl.php ou `winget install JRSoftware.InnoSetup`) puis relance sans --skip-installer.")
        return None
    assets = wizard_images()
    OUT.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(iscc_command(iscc, version, edition, assets, launcher_exe))
    if r.returncode != 0:
        die("Inno Setup a échoué.")
    return OUT / f"ENOS-Setup-{version}-{edition}.exe"


# ---------------------------------------------------------------- 7. manifeste OTA signé
def write_manifest(priv, version, setup, base_url, notes, edition="friends"):
    data = setup.read_bytes()
    manifest = {"version": version, "url": f"{base_url.rstrip('/')}/{setup.name}", "sha256": hashlib.sha256(data).hexdigest(),
                "size": len(data), "notes": notes}
    raw = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
    name = "enos-update.json" if edition == "friends" else f"enos-update-{edition}.json"          # friends : nom historique (les ENOS déjà installés)
    (OUT / name).write_bytes(raw)
    (OUT / (name + ".sig")).write_bytes(base64.b64encode(priv.sign(raw)))
    say(f"  Manifeste signé : {OUT / name} (+ .sig)\n  À PUBLIER ensemble (ex. release GitHub) : {setup.name}, {name}, {name}.sig")


def write_launcher_manifest(priv, version, setup, notes, edition):
    """Manifeste du Dual Pulse Launcher (dualpulse_site : /launcher/v1) : JSON canonique signé Ed25519 avec la MÊME clé que l'OTA (ota_pubkey.txt = DP_MANIFEST_PUBKEY du serveur).
    Le fichier à téléverser dans Cloudflare R2 porte la clé de stockage indiquée ; la publication se fait avec dualpulse_site/tools/publish_release.py."""
    import release_editions
    data = setup.read_bytes()
    channel = release_editions.CHANNEL[edition]
    manifest = {"product": "enos", "channel": channel, "version": version, "released": datetime.date.today().isoformat(), "notes": notes, "min_launcher": "1.0.0",
                "launch": setup.name, "silent_args": "/SILENT",
                "files": [{"path": setup.name, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "key": f"enos/{channel}/{version}/{setup.name}"}]}
    canon = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    name = f"launcher-enos-{channel}-{version}"
    (OUT / (name + ".manifest.json")).write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    (OUT / (name + ".sig")).write_text(base64.b64encode(priv.sign(canon)).decode(), encoding="ascii")
    say(f"  Manifeste Launcher : {OUT / (name + '.manifest.json')} (+ .sig)\n  À téléverser dans R2 sous « {manifest['files'][0]['key']} », puis : py dualpulse_site/tools/publish_release.py …")


PROTECTED = ("data/", "nasko_config.json", ".update-")          # données de l'utilisateur : jamais dans un manifeste « files » (le Launcher ne les écrase ni ne les supprime)
_SAFE_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ \-]{0,120}$")


def files_manifest_entries(dist, channel, version):
    """Fichiers d'une édition construite (dossier `dist`) -> entrées de manifeste « files » : chemin relatif, SHA-256, taille, clé de stockage R2."""
    entries, bad = [], []
    for p in sorted(Path(dist).rglob("*")):
        if not p.is_file() or any(x in ("__pycache__", ".godot") for x in p.parts) or p.suffix in (".pyc", ".part", ".tmp", ".log"):
            continue
        rel = p.relative_to(dist).as_posix()
        if rel.lower().startswith(PROTECTED) or rel.lower() == "nasko_config.json":
            continue
        if not all(_SAFE_PART.match(c) for c in rel.split("/")):
            bad.append(rel)
            continue
        entries.append({"path": rel, "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "size": p.stat().st_size, "key": f"enos/{channel}/{version}/files/{rel}"})
    if bad:
        die("noms de fichiers non acceptés par le Launcher (lettres, chiffres, . _ - espace) : " + ", ".join(bad[:8]))
    return entries


def write_launcher_files_manifest(priv, version, dist, notes, edition, out=None):
    """Manifeste « files » : le Launcher télécharge en arrière-plan (staging) seulement les fichiers modifiés puis les applique quand l'application est fermée.
    Téléversement : rclone sync <dist> r2:<bucket>/enos/<canal>/<version>/files/ (puis publish_release.py)."""
    import release_editions
    channel = release_editions.CHANNEL[edition]
    entries = files_manifest_entries(dist, channel, version)
    if not any(e["path"] == app_exe() for e in entries):
        die(f"{app_exe()} absent du dossier de l'édition construite.")
    manifest = {"product": "enos", "channel": channel, "version": version, "released": datetime.date.today().isoformat(), "notes": notes, "min_launcher": "0.2.0",
                "mode": "files", "run": app_exe(), "files": entries}
    canon = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    name = f"launcher-enos-{channel}-{version}-files"
    dest = Path(out) if out else OUT
    dest.mkdir(parents=True, exist_ok=True)
    (dest / (name + ".manifest.json")).write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    (dest / (name + ".sig")).write_text(base64.b64encode(priv.sign(canon)).decode(), encoding="ascii")
    say(f"  Manifeste « files » : {dest / (name + '.manifest.json')} (+ .sig), {len(entries)} fichiers\n  À téléverser dans R2 : enos/{channel}/{version}/files/<chemin> (rclone sync), puis publish_release.py")
    return dest / (name + ".manifest.json")


def main():
    ap = argparse.ArgumentParser(description="Construit l'installeur distribuable d'E.N.O.S.")
    ap.add_argument("--edition", choices=("friends", "dev", "ceo"), default="friends",
                    help="build physiquement isolé : friends (utilitaires seulement, défaut) | dev (tout sauf API Control Panel et Notes de frais) | ceo (tout)")
    ap.add_argument("--version", required=True, help="ex. 3.1.0 (croissant : c'est ce que compare la mise à jour OTA)")
    ap.add_argument("--base-url", default="", help="dossier https où seront publiés l'installeur et le manifeste (release GitHub…)")
    ap.add_argument("--manifest-url", default="", help="adresse de enos-update.json écrite dans la config de l'ami (défaut : <base-url>/enos-update.json)")
    ap.add_argument("--notes", default="Améliorations et corrections.")
    ap.add_argument("--check", action="store_true", help="analyse seulement (exclusions + fuites), ne construit rien")
    ap.add_argument("--skip-build", action="store_true")
    ap.add_argument("--files-manifest", action="store_true", help="écrit aussi le manifeste « files » (mise à jour en arrière-plan par le Launcher : staging puis remplacement des fichiers modifiés)")
    ap.add_argument("--skip-installer", action="store_true")
    ap.add_argument("--skip-launcher", action="store_true",
                    help="build de DÉVELOPPEMENT sans Dual Pulse Launcher (raccourcis vers ENOS.exe). Ne jamais distribuer : l'accès par invitation passe par le Launcher")
    ap.add_argument("--onedir", action="store_true", help="dossier au lieu d'un exe unique : démarrage plus rapide, moins de faux positifs antivirus")
    ap.add_argument("--linux-format", choices=("tar", "appimage", "both"), default="tar",
                    help="Linux seulement : tar (archive .tar.gz avec install.sh, défaut) | appimage (nécessite appimagetool) | both")
    a = ap.parse_args()
    if not re.fullmatch(r"\d+(\.\d+){1,3}", a.version):
        die("version invalide (ex. 3.1.0)")
    global STAGE, DIST
    STAGE, DIST = REL / f"stage-{a.edition}", REL / f"dist-{a.edition}"
    manifest_url = a.manifest_url or (a.base_url.rstrip("/") + ("/enos-update.json" if a.edition == "friends" else f"/enos-update-{a.edition}.json") if a.base_url else "")
    say(f"Édition : {a.edition}")

    say("[1/6] Clé de signature OTA")
    priv = ensure_signing_key()
    say("[2/6] Copie saine (liste blanche)")
    report_excluded()
    make_stage(a.version, a.edition)
    say("[3/6] Configuration vierge")
    make_templates(manifest_url)
    say("[4/6] Recherche de fuites dans la copie")
    hits = leak_scan(STAGE) + leak_scan(DIST)
    if hits:
        for f, why in hits:
            say(f"  !! {f.relative_to(REL)} : {why}")
        die("des données personnelles sont présentes dans la version à distribuer : corrige-les (ou ajoute le fichier aux exclusions) puis relance.")
    say("  Aucune fuite détectée.")
    if a.check or a.skip_build:
        say("\nTerminé (aucune compilation).")
        return
    if not (is_windows() or is_linux()):
        die("ce script compile sous Windows (installeur Inno Setup) ou sous Linux (archive .tar.gz / AppImage). macOS n'est pas pris en charge.")
    if is_linux():
        import release_linux
        problems = release_linux.preflight(with_launcher=False)
        if problems:
            die("outillage Linux incomplet :\n    - " + "\n    - ".join(problems))
    say("[5/6] Compilation (E.N.O.S. + Launcher)")
    build_exe()
    launcher_exe = None
    if a.skip_launcher:
        say("  !! --skip-launcher : l'installeur sera produit SANS Dual Pulse Launcher (build de développement, ne pas distribuer).")
    else:
        launcher_exe = build_launcher()
    hits = leak_scan(DIST)
    if hits:
        die("fuite détectée dans le dossier compilé : " + ", ".join(str(h[0]) for h in hits[:3]))
    if a.files_manifest:
        write_launcher_files_manifest(priv, a.version, DIST, a.notes, a.edition)
    if a.skip_installer:
        say(f"\nTerminé : {DIST}")
        return
    if is_linux():
        say("[6/6] Paquet Linux")
        made = build_linux_package(a.version, a.edition, launcher_exe, a.linux_format)
        say("\nTerminé : " + ", ".join(str(m) for m in made) + "\n  Teste-le sur une machine Linux propre (./install.sh) avant de l'envoyer. Pas de manifeste Launcher/OTA : le Launcher ne sait pas encore installer un paquet Linux.")
        return
    say("[6/6] Installeur")
    setup = build_installer(a.version, a.edition, launcher_exe)
    if setup and setup.exists():
        say(f"  Installeur : {setup}")
        if a.base_url:
            write_manifest(priv, a.version, setup, a.base_url, a.notes, a.edition)
        else:
            say("  (pas de --base-url : manifeste OTA non généré)")
        write_launcher_manifest(priv, a.version, setup, a.notes, a.edition)
    say("\nTerminé. Teste l'installeur sur une VM / un autre compte Windows avant de l'envoyer.")


if __name__ == "__main__":
    main()
