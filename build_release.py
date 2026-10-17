"""Fabrique une version DISTRIBUABLE d'E.N.O.S. (installeur .exe) sans une seule donnée personnelle.

    py build_release.py --version 3.1.0 --base-url https://github.com/TOI/ENOS/releases/download/v3.1.0
    py build_release.py --version 3.1.0 --check          (analyse seulement : ce qui est exclu + recherche de fuites, rien n'est construit)
    py build_release.py --version 3.1.0 --skip-build     (prépare / contrôle le dossier sans compiler)
    py build_release.py --version 3.1.0 --edition dev    (édition physiquement isolée : friends (défaut) | dev | ceo — voir release_editions.py)

PRINCIPE — on ne PURGE JAMAIS ton dossier de travail : on construit une COPIE saine (liste blanche) dans release\\stage et on compile à partir d'elle.
Ton historique, tes audios, tes logs, tes clés restent intacts chez toi ; ce qui n'est pas dans la liste blanche n'entre simplement jamais dans la version de l'ami.

Étapes : 1) clé de signature OTA (créée une fois)  2) copie en liste blanche  3) nasko_config_template.json + profil vierge
         4) recherche de fuites (tes vraies clés / liens / chemins cherchés dans la copie)  5) PyInstaller, avec EXACTEMENT les options de build.bat
         6) Inno Setup (si installé)  7) manifeste OTA signé (Ed25519) pour la mise à jour en un clic.
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
KEYS = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ENOS-release" / "keys"    # HORS du dossier du projet (OneDrive/Git) : clé privée de signature, à SAUVEGARDER, jamais publiée ni régénérée
sys.path.insert(0, str(ROOT))

# ---------------------------------------------------------------- liste blanche (tout le reste est ignoré)
ROOT_FILES = ("*.py", "build.bat", "requirements.txt", "logo.png", "logo-192.png", "logo-512.png", "logo.ico", "updater_ui.html")
SKIP_ROOT_PY = {"build_release.py", "diagnostic_reveil.py", "creer_voix_eto.py", "generer_voix.py", "renommer_audio.py", "construire_apk.py",
                "creer_relais.py", "wake_relay.py", "release_editions.py", "configurer_llm.py", "creer_raccourci.py", "updater.py"}   # outils de développement, inutiles à l'ami
TREES = {                                  # dossiers livrés tels quels (assets graphiques, thème Coreboard, audio de l'OS, projets Godot de l'Œil et des échecs)
    "static": None, "voix": None, "openings": None, "cascades": None,
    "godot_eye": None, "godot_chess": None, "godot_neon": None,
}
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", "*.log", ".godot", "*.tmp", "*.part")
# Jamais copiés (données personnelles ou volumineuses) — listés par --check pour que tu voies ce qui est exclu
PERSONAL = ["data", "Audio", "Audionew", "Stockage", "Compression", "Traitement d'image", "PourClaude", "archive", "android", "dualpulse_site",
            "nasko_config.json", "enos_profiles.json", "*.log", "NASKO.apk*", "NASKO.exe", "ENOS.exe", "*.jpg", "GUIDE.md"]

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
    sep = ";"
    args = [a for a in args if a != "--onefile"] + (["--onefile"] if "--onedir" not in sys.argv else ["--onedir"])
    extra = ["--add-data", f"{STAGE / 'version.txt'}{sep}.", "--add-data", f"{STAGE / 'ota_pubkey.txt'}{sep}.", "--add-data", f"{STAGE / 'enos_edition.json'}{sep}.",
             "--distpath", str(DIST), "--workpath", str(REL / "build_tmp"), "--specpath", str(REL / "build_tmp")]
    cmd = [sys.executable, "-m", "PyInstaller", *extra, *args]
    say("  PyInstaller… (plusieurs minutes)")
    r = subprocess.run(cmd, cwd=STAGE)
    if r.returncode != 0:
        die("la compilation a échoué (voir les messages ci-dessus).")
    shutil.rmtree(REL / "build_tmp", ignore_errors=True)
    for d in ("godot_eye", "godot_chess", "godot_neon"):            # projets Godot lus à côté de l'exe (Œil de bureau, échecs)
        if (STAGE / d).is_dir():
            shutil.copytree(STAGE / d, DIST / d, dirs_exist_ok=True)
    shutil.copy2(STAGE / "logo.ico", DIST / "logo.ico")


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


def find_iscc():
    for c in (shutil.which("iscc"), r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe", r"C:\Program Files\Inno Setup 6\ISCC.exe",
              os.path.expandvars(r"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe")):
        if c and os.path.isfile(c):
            return c
    return None


def build_installer(version, edition="friends"):
    iscc = find_iscc()
    if not iscc:
        say("  Inno Setup introuvable : installe-le (https://jrsoftware.org/isdl.php ou `winget install JRSoftware.InnoSetup`) puis relance sans --skip-installer.")
        return None
    assets = wizard_images()
    OUT.mkdir(parents=True, exist_ok=True)
    r = subprocess.run([iscc, f"/DAppVersion={version}", f"/DEdition=-{edition}", f"/DDistDir={DIST}", f"/DOutDir={OUT}", f"/DAssetsDir={assets}", f"/DRootDir={ROOT}",
                        str(ROOT / "installer" / "enos.iss")])
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
    if not any(e["path"] == "ENOS.exe" for e in entries):
        die("ENOS.exe absent du dossier de l'édition construite.")
    manifest = {"product": "enos", "channel": channel, "version": version, "released": datetime.date.today().isoformat(), "notes": notes, "min_launcher": "0.2.0",
                "mode": "files", "run": "ENOS.exe", "files": entries}
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
    ap.add_argument("--onedir", action="store_true", help="dossier au lieu d'un exe unique : démarrage plus rapide, moins de faux positifs antivirus")
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
    say("[5/6] Compilation")
    build_exe()
    hits = leak_scan(DIST)
    if hits:
        die("fuite détectée dans le dossier compilé : " + ", ".join(str(h[0]) for h in hits[:3]))
    if a.files_manifest:
        write_launcher_files_manifest(priv, a.version, DIST, a.notes, a.edition)
    if a.skip_installer:
        say(f"\nTerminé : {DIST}")
        return
    say("[6/6] Installeur")
    setup = build_installer(a.version, a.edition)
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
