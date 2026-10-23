"""Build mobile en une commande : sauvegarde l'ancien APK, compile avec l'export CEO, range le nouvel APK dans ton cloud chiffré.

    py auto_build_mobile.py                  (la seule saisie : ta phrase secrète)
    py auto_build_mobile.py --cloud-dir D:\\Proton\\Drive     dossier de dépôt imposé (sinon détection automatique)
    py auto_build_mobile.py --sans-cloud     garde l'APK dans mobile_build/

Étapes : 1) NASKO.apk existant -> mobile_build/sauvegardes/NASKO_<version>_<date>.apk (+ .json, .idsig, version.txt)
         2) exporter_donnees_ceo.py --build  3) NASKO.apk neuf -> dossier Proton Drive / Tresorit / équivalent (déplacé, SHA-256 vérifié).
Si la compilation échoue, l'ancien APK et version.txt sont remis en place. Aucun dossier de cloud trouvé : l'APK est rangé dans
mobile_build/ sous un nom daté et le script le dit (il n'utilise jamais OneDrive à ta place : ce n'est pas un cloud chiffré).
"""
import argparse
import datetime
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
APK = os.path.join(ROOT, "NASKO.apk")
SIDE = (".json", ".idsig")
VERSION_TXT = os.path.join(ROOT, "android", "version.txt")
BACKUPS = os.path.join(ROOT, "mobile_build", "sauvegardes")
NAMES = ("proton", "tresorit", "sync.com", "pcloud", "mega", "cryptomator", "icedrive", "nextcloud")


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def version_of(apk):
    try:
        with open(apk + ".json", encoding="utf-8") as f:
            return json.load(f).get("versionName", "")
    except (OSError, ValueError):
        return ""


def unique(path):
    base, ext = os.path.splitext(path)
    n, p = 1, path
    while os.path.exists(p):
        n += 1
        p = f"{base}_{n}{ext}"
    return p


def backup_old():
    """Renomme (déplace) l'APK actuel avec sa version et la date. Retourne la liste [(sauvegarde, original)] pour une restauration."""
    moved = []
    if not os.path.isfile(APK):
        print("  Aucun NASKO.apk existant : rien à sauvegarder.")
        return moved
    os.makedirs(BACKUPS, exist_ok=True)
    stem = f"NASKO_{version_of(APK) or 'inconnue'}_{datetime.date.today().isoformat()}"
    dst = unique(os.path.join(BACKUPS, stem + ".apk"))
    stem = os.path.splitext(dst)[0]
    for src, target in [(APK, dst)] + [(APK + s, stem + ".apk" + s) for s in SIDE if os.path.isfile(APK + s)]:
        shutil.move(src, target)
        moved.append((target, src))
    if os.path.isfile(VERSION_TXT):
        shutil.copyfile(VERSION_TXT, stem + ".version.txt")
        moved.append((stem + ".version.txt", None))
    print(f"  Ancien APK sauvegardé : {os.path.relpath(dst, ROOT)}  (version {version_of(dst) or '?'})")
    return moved


def restore(moved):
    for saved, original in moved:
        if original is None:
            shutil.copyfile(saved, VERSION_TXT)             # version.txt : copie, l'original est resté en place
        else:
            if os.path.exists(original):
                os.remove(original)
            shutil.move(saved, original)
    print("  Ancien APK remis en place (la compilation a échoué).")


def cloud_candidates():
    home = os.path.expanduser("~")
    roots = [home, os.path.join(home, "Documents"), os.path.join(home, "Desktop"), os.path.join(home, "OneDrive"), os.environ.get("LOCALAPPDATA", "")]
    roots += [f"{d}:\\" for d in "CDEFGHIJKLMNOPQRSTUVWXYZ" if os.path.isdir(f"{d}:\\")]
    found = []
    for r in filter(None, roots):
        try:
            for name in os.listdir(r):
                full = os.path.join(r, name)
                if os.path.isdir(full) and any(k in name.lower() for k in NAMES):
                    found.append(full)
        except OSError:
            pass
    # Proton Drive range souvent ses fichiers dans un sous-dossier « My files » / « Mes fichiers »
    out = []
    for f in dict.fromkeys(found):
        sub = [p for p in glob.glob(os.path.join(f, "*")) if os.path.isdir(p) and os.path.basename(p).lower() in ("my files", "mes fichiers")]
        out.append(sub[0] if sub else f)
    return out


def main():
    ap = argparse.ArgumentParser(description="Build mobile automatisé")
    ap.add_argument("--cloud-dir", default=os.environ.get("ENOS_CLOUD_DIR", ""))
    ap.add_argument("--sans-cloud", action="store_true")
    a = ap.parse_args()
    started = datetime.datetime.now().timestamp()

    print("\n[1/3] Sauvegarde de l'ancien APK")
    moved = backup_old()

    print("\n[2/3] Compilation avec l'export CEO (tape ta phrase secrète)")
    try:
        subprocess.run([sys.executable, os.path.join(ROOT, "exporter_donnees_ceo.py"), "--build"], check=True, cwd=ROOT)
        if not os.path.isfile(APK) or os.path.getmtime(APK) < started:
            raise RuntimeError("NASKO.apk n'a pas été regénéré")
    except (subprocess.CalledProcessError, RuntimeError, KeyboardInterrupt) as e:
        restore(moved)
        sys.exit(f"\nÉchec : {e}")

    ver = version_of(APK) or "nouvelle"
    digest = sha(APK)
    name = f"NASKO_{ver}_{datetime.date.today().isoformat()}.apk"

    print("\n[3/3] Dépôt dans le cloud chiffré")
    dest = a.cloud_dir or ""
    if not dest and not a.sans_cloud:
        found = cloud_candidates()
        dest = found[0] if found else ""
        if len(found) > 1:
            print("  Plusieurs dossiers de cloud trouvés, le premier est utilisé :", *found, sep="\n   - ")
    if not dest or a.sans_cloud or not os.path.isdir(dest):
        keep = unique(os.path.join(ROOT, "mobile_build", name))
        os.makedirs(os.path.dirname(keep), exist_ok=True)
        shutil.move(APK, keep)
        for s in SIDE:
            if os.path.isfile(APK + s):
                os.remove(APK + s)
        print(f"  {'Dossier introuvable : ' + dest if dest else 'Aucun dossier Proton Drive / Tresorit détecté sur ce PC.'}")
        print(f"  APK rangé ici : {keep}\n  À copier dans ton cloud (ou relance avec --cloud-dir \"<dossier>\").")
        return
    target = unique(os.path.join(dest, name))
    shutil.copyfile(APK, target)
    if sha(target) != digest:
        os.remove(target)
        sys.exit("Copie corrompue : l'APK est resté dans le dossier du projet.")
    os.remove(APK)
    for s in SIDE:
        if os.path.isfile(APK + s):
            os.remove(APK + s)
    print(f"  APK déplacé dans le cloud : {target}")
    print(f"  Version {ver} · SHA-256 {digest[:16]}… · {os.path.getsize(target) // 1024} Ko")
    print("\nTerminé : attends la fin de la synchronisation du cloud, puis télécharge l'APK sur le téléphone.")


if __name__ == "__main__":
    main()
