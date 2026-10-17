"""Paquet LINUX d'E.N.O.S. (utilisé par build_release.py sous Linux) : arborescence d'installation, scripts, AppDir/AppImage. Outil de développement : jamais livré dans l'application.

PyInstaller ne fait PAS de compilation croisée : le binaire Linux se fabrique SUR Linux (ou dans WSL). Ce module ne compile rien ; il assemble ce que build_release.py a produit.

Livrables :
  * ENOS-<version>-<édition>-linux-<arch>.tar.gz  (toujours) : app/ (binaire PyInstaller + ressources), launcher/ (si compilé), install.sh / uninstall.sh (installation PAR UTILISATEUR, sans root)
  * ENOS-<version>-<édition>-<arch>.AppImage      (si demandé ET appimagetool disponible) : l'application étant en lecture seule dans une AppImage, AppRun place les données dans
    $XDG_DATA_HOME/ENOS via ENOS_HOME (voir nasko_core.app_dir)."""
import os
import platform
import re
import shutil
import stat
import subprocess
import tarfile
from pathlib import Path

USER_FILES = ("data", "nasko_config.json", "enos_profiles.json")        # données de l'utilisateur : jamais écrasées ni supprimées par une mise à jour
APP_BIN = "ENOS"
LAUNCHER_BIN = "dual-pulse-launcher"
ICON = "enos.png"


def arch():
    m = platform.machine().lower()
    return {"amd64": "x86_64", "x86_64": "x86_64", "arm64": "aarch64", "aarch64": "aarch64"}.get(m, m or "x86_64")


def package_name(version, edition, ext="tar.gz", architecture=None):
    """ENOS-1.0.1-friends-linux-x86_64.tar.gz ; l'AppImage suit la convention AppImage (pas de « linux »)."""
    a = architecture or arch()
    return f"ENOS-{version}-{edition}-{a}.AppImage" if ext == "AppImage" else f"ENOS-{version}-{edition}-linux-{a}.{ext}"


def desktop_entry(name, exec_line, icon, comment, categories="Utility;Development;", extra=""):
    for v in (name, exec_line, icon, comment):
        if "\n" in v or "\r" in v:
            raise ValueError("valeur de fichier .desktop invalide")
    return ("[Desktop Entry]\nType=Application\nVersion=1.0\n"
            f"Name={name}\nComment={comment}\nExec={exec_line}\nIcon={icon}\nTerminal=false\nCategories={categories}\nStartupNotify=true\n{extra}")


def install_script(version, edition, has_launcher):
    """install.sh (POSIX sh) : installation par utilisateur dans $ENOS_PREFIX (défaut ~/.local). Garde data/, nasko_config.json et enos_profiles.json lors d'une mise à jour."""
    keep = " ".join(f'! -name "{n}"' for n in USER_FILES)
    launcher = f"""
# --- Dual Pulse Launcher
mkdir -p "$LAUNCHER"
cp -f "$HERE/launcher/{LAUNCHER_BIN}" "$LAUNCHER/{LAUNCHER_BIN}"
chmod 755 "$LAUNCHER/{LAUNCHER_BIN}"
write_desktop "$APPS/dual-pulse-launcher.desktop" "Dual Pulse Launcher" "$LAUNCHER/{LAUNCHER_BIN}" "Dual Pulse Launcher : connexion, catalogue et mises à jour"
""" if has_launcher else ""
    return f"""#!/bin/sh
# Installation PAR UTILISATEUR d'E.N.O.S. {version} ({edition}) — aucun droit administrateur requis.
# Variables : ENOS_PREFIX (défaut ~/.local). Relancer ce script met à jour l'application en gardant tes données.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PREFIX="${{ENOS_PREFIX:-$HOME/.local}}"
APP="$PREFIX/opt/enos"
LAUNCHER="$PREFIX/opt/dual-pulse-launcher"
BIN="$PREFIX/bin"
APPS="$PREFIX/share/applications"
ICONS="$PREFIX/share/icons/hicolor/512x512/apps"

[ -x "$HERE/app/{APP_BIN}" ] || {{ echo "ERREUR : $HERE/app/{APP_BIN} est introuvable (archive incomplète)." >&2; exit 1; }}

write_desktop() {{
  # $1 fichier, $2 nom, $3 commande (chemin absolu), $4 commentaire
  printf '[Desktop Entry]\\nType=Application\\nVersion=1.0\\nName=%s\\nComment=%s\\nExec="%s"\\nIcon=enos\\nTerminal=false\\nCategories=Utility;Development;\\nStartupNotify=true\\n' "$2" "$4" "$3" > "$1"
}}

mkdir -p "$APP" "$BIN" "$APPS" "$ICONS"
# 1) retire l'ancienne version SAUF les données de l'utilisateur
if [ -d "$APP" ]; then
  find "$APP" -mindepth 1 -maxdepth 1 {keep} -exec rm -rf {{}} +
fi
# 2) copie la nouvelle ; les fichiers de l'utilisateur déjà présents ne sont jamais remplacés par les modèles vierges
for src in "$HERE"/app/* "$HERE"/app/.[!.]*; do
  [ -e "$src" ] || continue
  name=$(basename "$src")
  case "$name" in data|nasko_config.json|enos_profiles.json) [ -e "$APP/$name" ] && continue ;; esac
  cp -a "$src" "$APP/$name"
done
chmod 755 "$APP/{APP_BIN}"
ln -sf "$APP/{APP_BIN}" "$BIN/enos"
[ -f "$HERE/{ICON}" ] && cp -f "$HERE/{ICON}" "$ICONS/enos.png"
write_desktop "$APPS/enos.desktop" "E.N.O.S." "$APP/{APP_BIN}" "Assistant, agenda, outils et dépôt Git"
{launcher}
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "E.N.O.S. {version} installé dans $APP"
echo "Lancement : enos   (ou le menu des applications)"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "NB : ajoute $BIN à ton PATH pour taper « enos » dans un terminal." ;; esac
"""


def uninstall_script():
    return f"""#!/bin/sh
# Désinstalle E.N.O.S. (installation par utilisateur). Tes données (data/, réglages) sont GARDÉES, sauf avec --purge.
set -eu
PREFIX="${{ENOS_PREFIX:-$HOME/.local}}"
APP="$PREFIX/opt/enos"
PURGE=0; [ "${{1:-}}" = "--purge" ] && PURGE=1
if [ "$PURGE" = 1 ]; then
  rm -rf "$APP"
elif [ -d "$APP" ]; then
  find "$APP" -mindepth 1 -maxdepth 1 {" ".join(f'! -name "{n}"' for n in USER_FILES)} -exec rm -rf {{}} +
fi
rm -rf "$PREFIX/opt/dual-pulse-launcher"
rm -f "$PREFIX/bin/enos" "$PREFIX/share/applications/enos.desktop" "$PREFIX/share/applications/dual-pulse-launcher.desktop" "$PREFIX/share/icons/hicolor/512x512/apps/enos.png"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
echo "E.N.O.S. désinstallé."; [ "$PURGE" = 1 ] || echo "Tes données sont conservées dans $APP (lance avec --purge pour tout supprimer)."
"""


def readme(version, edition, has_launcher):
    return f"""E.N.O.S. {version} — édition {edition} — Linux

INSTALLATION (sans root) :   ./install.sh        désinstallation : ./uninstall.sh   (--purge pour supprimer aussi tes données)

Prérequis système (Debian / Ubuntu) :
  sudo apt install libwebkit2gtk-4.1-0 gir1.2-webkit2-4.1 python3-gi libportaudio2 zenity git clang-format
  - fenêtre native : WebKitGTK + PyGObject (sans eux, ouvre l'adresse affichée dans un navigateur) ;
  - « Choisir le dossier d'espace de travail » : zenity (ou kdialog) ;
  - Dépôt Intranet : git ; clang-format pour les outils EPITA (le style est déjà intégré à l'application).
Aucune surcouche WSL : sous Linux, git, clang-format et le terminal s'exécutent directement dans ton shell.
{"Le Dual Pulse Launcher est inclus (launcher/) ; sous Linux il ne détecte pas encore une installation existante d'E.N.O.S." if has_launcher else "Cette archive ne contient pas le Dual Pulse Launcher."}
Au premier lancement, ouvre Dépôt Intranet › « ESPACE DE TRAVAIL » et choisis le dossier qui contient tes dépôts.
"""


def _chmod_x(path):
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def assemble_tree(pkg_dir, dist, version, edition, launcher_bin=None, icon=None):
    """Arborescence du paquet : app/ (copie de `dist`), launcher/, scripts, icône, README. Retourne `pkg_dir`."""
    pkg_dir, dist = Path(pkg_dir), Path(dist)
    if not (dist / APP_BIN).is_file():
        raise FileNotFoundError(f"{APP_BIN} est absent de {dist} : le binaire PyInstaller Linux n'a pas été produit.")
    if pkg_dir.exists():
        shutil.rmtree(pkg_dir)
    shutil.copytree(dist, pkg_dir / "app", symlinks=True)
    _chmod_x(pkg_dir / "app" / APP_BIN)
    has_launcher = bool(launcher_bin)
    if has_launcher:
        (pkg_dir / "launcher").mkdir()
        shutil.copy2(launcher_bin, pkg_dir / "launcher" / LAUNCHER_BIN)
        _chmod_x(pkg_dir / "launcher" / LAUNCHER_BIN)
    if icon and Path(icon).is_file():
        shutil.copy2(icon, pkg_dir / ICON)
    (pkg_dir / "install.sh").write_text(install_script(version, edition, has_launcher), encoding="utf-8", newline="\n")
    (pkg_dir / "uninstall.sh").write_text(uninstall_script(), encoding="utf-8", newline="\n")
    (pkg_dir / "README.txt").write_text(readme(version, edition, has_launcher), encoding="utf-8", newline="\n")
    for s in ("install.sh", "uninstall.sh"):
        _chmod_x(pkg_dir / s)
    return pkg_dir


def make_tarball(pkg_dir, out):
    """tar.gz dont la racine est le dossier du paquet ; bits d'exécution forcés (ils se perdraient depuis un système de fichiers Windows)."""
    pkg_dir, out = Path(pkg_dir), Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    execs = {APP_BIN, LAUNCHER_BIN, "install.sh", "uninstall.sh"}

    def fix(ti):
        ti.uid = ti.gid = 0
        ti.uname = ti.gname = ""
        if ti.isdir():
            ti.mode = 0o755
        elif ti.isfile():
            ti.mode = 0o755 if (ti.name.rsplit("/", 1)[-1] in execs or ti.mode & 0o111) else 0o644
        return ti
    with tarfile.open(out, "w:gz") as tf:
        tf.add(pkg_dir, arcname=pkg_dir.name, filter=fix)
    return out


def apprun():
    return f"""#!/bin/sh
# AppImage : le contenu est en LECTURE SEULE -> les données de l'utilisateur vont dans $XDG_DATA_HOME/ENOS (nasko_core.app_dir lit ENOS_HOME).
HERE="$(dirname "$(readlink -f "$0")")"
export ENOS_HOME="${{ENOS_HOME:-${{XDG_DATA_HOME:-$HOME/.local/share}}/ENOS}}"
mkdir -p "$ENOS_HOME"
exec "$HERE/usr/bin/{APP_BIN}" "$@"
"""


def assemble_appdir(appdir, dist, version, edition, icon=None):
    """AppDir prêt pour appimagetool : AppRun, enos.desktop, icône, usr/bin/ (binaire + ressources)."""
    appdir, dist = Path(appdir), Path(dist)
    if not (dist / APP_BIN).is_file():
        raise FileNotFoundError(f"{APP_BIN} est absent de {dist}")
    if appdir.exists():
        shutil.rmtree(appdir)
    shutil.copytree(dist, appdir / "usr" / "bin", symlinks=True)
    _chmod_x(appdir / "usr" / "bin" / APP_BIN)
    (appdir / "AppRun").write_text(apprun(), encoding="utf-8", newline="\n")
    _chmod_x(appdir / "AppRun")
    (appdir / "enos.desktop").write_text(desktop_entry("E.N.O.S.", APP_BIN, "enos", f"E.N.O.S. {version} ({edition})"), encoding="utf-8", newline="\n")
    if icon and Path(icon).is_file():
        shutil.copy2(icon, appdir / "enos.png")
    return appdir


def find_appimagetool():
    p = os.environ.get("APPIMAGETOOL") or shutil.which("appimagetool") or shutil.which("appimagetool-x86_64.AppImage")
    return p if p and os.path.isfile(p) else None


def build_appimage(appdir, out, tool=None):
    tool = tool or find_appimagetool()
    if not tool:
        return None
    env = dict(os.environ, ARCH=arch(), APPIMAGE_EXTRACT_AND_RUN="1")        # sans FUSE (WSL, conteneurs)
    r = subprocess.run([tool, str(appdir), str(out)], env=env)
    return Path(out) if r.returncode == 0 and Path(out).is_file() else None


_SAFE = re.compile(r"^[A-Za-z0-9._-]+$")


def preflight(import_check=None, which=shutil.which, run=subprocess.run, with_launcher=True):
    """Problèmes bloquants pour compiler sous Linux (liste de messages, vide = prêt). `import_check(module) -> bool` et `which` sont injectables (tests)."""
    def can_import(mod):
        if import_check:
            return import_check(mod)
        return subprocess.run(["python3", "-c", f"import {mod}"], capture_output=True).returncode == 0 if which("python3") else False
    bad = []
    if not which("objdump"):
        bad.append("binutils manquant (PyInstaller en a besoin) : sudo apt install binutils")
    if not (can_import("gi") or can_import("PyQt5") or can_import("PyQt6") or can_import("PySide6")):
        bad.append("aucun moteur de fenêtre pour pywebview (PyGObject « gi » ou Qt) : sudo apt install python3-gi gir1.2-webkit2-4.1 puis crée le venv avec --system-site-packages")
    if with_launcher:
        if not which("pkg-config"):
            bad.append("pkg-config manquant : sudo apt install pkg-config")
        else:
            for lib in ("webkit2gtk-4.1", "gtk+-3.0"):
                if run(["pkg-config", "--exists", lib], capture_output=True).returncode != 0:
                    bad.append(f"bibliothèque de développement {lib} introuvable (Launcher Tauri) : sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf")
                    break
    return bad
