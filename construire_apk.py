"""Fabrique ENOS.apk : l'application Android de E.N.O.S. (coque WebView, sources dans android/).

    py construire_apk.py                       construit ENOS.apk (SDK Android requis)
    py construire_apk.py --installer-sdk --accepter-licences
                                               telecharge le SDK Android minimal (outils en ligne de commande, plateforme 34,
                                               build-tools 34) dans %LOCALAPPDATA%\\Android\\Sdk puis construit.
                                               --accepter-licences = VOUS acceptez les licences du SDK Android de Google.

L'APK est signee avec une cle locale (android/signing/, a conserver : la meme cle est necessaire pour les mises a jour).
Une fois ENOS.apk cree, le serveur la propose sur la page de connexion (/nasko.apk) et dans le panneau ACCES TELEPHONE.
"""
import argparse
import glob
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(ROOT, "android")
BUILD = os.path.join(A, "build")
OUT = os.path.join(ROOT, "ENOS.apk")
CMDLINE_URL = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
PLATFORM, BUILD_TOOLS = "34", "35.0.0"   # build-tools 35 : son d8 gere le MethodParameters des classes internes compilees par JDK 21+
MIN_SDK = "29"


def find_jdk():
    """JDK 11+ (le `java` du PATH peut etre un vieux JRE 8 : les outils Android exigent Java 11 ou plus)."""
    cands = [os.environ.get("JAVA_HOME", "")]
    for base in (r"C:\Program Files\Eclipse Adoptium", r"C:\Program Files\Java", r"C:\Program Files\Microsoft", r"C:\Program Files\Android\Android Studio"):
        cands += sorted(glob.glob(os.path.join(base, "*")), reverse=True) + [os.path.join(base, "jbr")]
    for c in cands:
        if c and os.path.isfile(os.path.join(c, "bin", "javac.exe")) and os.path.isfile(os.path.join(c, "bin", "keytool.exe")):
            return c
    return None


JDK = find_jdk()
ENV = {**os.environ, **({"JAVA_HOME": JDK, "PATH": os.path.join(JDK, "bin") + os.pathsep + os.environ["PATH"]} if JDK else {})}


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV, **kw)
    if r.returncode != 0:
        sys.exit(f"Echec : {' '.join(map(str, cmd[:3]))} ...\n{r.stdout}\n{r.stderr}")
    return r


def sdk_root():
    for v in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(v) and os.path.isdir(os.environ[v]):
            return os.environ[v]
    return os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Android", "Sdk")


def find_tools(sdk):
    bts = sorted(glob.glob(os.path.join(sdk, "build-tools", "*")), reverse=True)
    plats = sorted(glob.glob(os.path.join(sdk, "platforms", "android-*", "android.jar")), reverse=True)
    if not bts or not plats:
        return None
    bt = bts[0]
    ext = lambda n: next((p for p in (os.path.join(bt, n + ".exe"), os.path.join(bt, n + ".bat"), os.path.join(bt, n)) if os.path.isfile(p)), None)
    tools = {"aapt2": ext("aapt2"), "zipalign": ext("zipalign"), "apksigner": ext("apksigner"), "d8": ext("d8"), "jar": plats[0]}
    return tools if all(tools.values()) else None


def install_sdk(sdk, licences):
    if not licences:
        sys.exit("Le SDK Android n'est pas installe. Relancez avec :  py construire_apk.py --installer-sdk --accepter-licences\n"
                 "(l'option --accepter-licences signifie que VOUS acceptez les licences du SDK Android de Google).")
    dest = os.path.join(sdk, "cmdline-tools", "latest")
    if not os.path.isfile(os.path.join(dest, "bin", "sdkmanager.bat")):
        print("Telechargement des outils en ligne de commande Android (dl.google.com)...")
        tmp = tempfile.mkdtemp()
        zpath = os.path.join(tmp, "cmdline.zip")
        urllib.request.urlretrieve(CMDLINE_URL, zpath)
        with zipfile.ZipFile(zpath) as z:
            z.extractall(tmp)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.rmtree(dest, ignore_errors=True)
        shutil.move(os.path.join(tmp, "cmdline-tools"), dest)
        shutil.rmtree(tmp, ignore_errors=True)
    sm = os.path.join(dest, "bin", "sdkmanager.bat")
    print("Acceptation des licences du SDK (a votre demande) et installation de la plateforme + build-tools...")
    run([sm, f"--sdk_root={sdk}", "--licenses"], input="y\n" * 30)
    run([sm, f"--sdk_root={sdk}", "--install", f"platforms;android-{PLATFORM}", f"build-tools;{BUILD_TOOLS}"], input="y\n" * 5)


def make_icons():
    from PIL import Image
    src = next((p for p in (os.path.join(ROOT, "logo-512.png"), os.path.join(ROOT, "logo.png")) if os.path.isfile(p)), None)
    if not src:
        sys.exit("logo-512.png introuvable : lancez setup_assets.py.")
    im = Image.open(src).convert("RGBA")
    for name, px in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        d = os.path.join(BUILD, "res", f"mipmap-{name}")
        os.makedirs(d, exist_ok=True)
        im.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))


KS_NAME, PW_NAME, KS_ALIAS = "enos-release.jks", "enos-release.pass", "enos"


def keystore():
    """Cle de signature : android/signing/ (ignore par Git). Les variables ENOS_KEYSTORE et ENOS_KEYSTORE_PASS (CI, coffre) priment sur les fichiers.
    L'ancienne cle nasko.jks (mot de passe publie dans l'historique Git) n'est JAMAIS reutilisee : une nouvelle cle est creee a la place."""
    if os.environ.get("ENOS_KEYSTORE") and os.environ.get("ENOS_KEYSTORE_PASS"):
        return os.environ["ENOS_KEYSTORE"], os.environ["ENOS_KEYSTORE_PASS"]
    folder = os.path.join(A, "signing")
    os.makedirs(folder, exist_ok=True)
    ks, pw = os.path.join(folder, KS_NAME), os.path.join(folder, PW_NAME)
    if not os.path.isfile(ks):
        if os.path.isfile(pw):
            sys.exit(f"{PW_NAME} existe mais pas {KS_NAME} : restaurez la cle de signature (sauvegarde) au lieu d'en creer une autre.")
        pwd = secrets.token_urlsafe(24)
        run(["keytool", "-genkeypair", "-keystore", ks, "-alias", KS_ALIAS, "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000",
             "-storepass", pwd, "-keypass", pwd, "-dname", "CN=E.N.O.S., O=Dual Pulse"])
        fd = os.open(pw, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(pwd)
        try:
            os.chmod(ks, 0o600)
        except OSError:
            pass
        print(f"Cle de signature creee : {ks}  (SAUVEGARDEZ-LA hors du depot, avec {PW_NAME} : sans elle, plus de mise a jour de l'APK)")
    if not os.path.isfile(pw):
        sys.exit(f"{PW_NAME} introuvable a cote de {KS_NAME}.")
    return ks, open(pw).read().strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--installer-sdk", action="store_true")
    ap.add_argument("--accepter-licences", action="store_true")
    ap.add_argument("--version-code", default="", help="par defaut : numero precedent + 1 (android/version.txt)")
    a = ap.parse_args()

    if not JDK:
        sys.exit("JDK 11+ introuvable (installez Temurin / Eclipse Adoptium).")
    print(f"JDK : {JDK}")
    sdk = sdk_root()
    tools = find_tools(sdk)
    if not tools:
        if not a.installer_sdk:
            sys.exit(f"SDK Android introuvable ({sdk}).\nInstallez-le automatiquement : py construire_apk.py --installer-sdk --accepter-licences")
        install_sdk(sdk, a.accepter_licences)
        tools = find_tools(sdk)
        if not tools:
            sys.exit("Installation du SDK incomplete.")
    jar = tools["jar"]
    vfile = os.path.join(A, "version.txt")
    code = int(a.version_code) if a.version_code else (int(open(vfile).read().strip()) + 1 if os.path.isfile(vfile) else 2)
    name = f"1.{code}"
    print(f"Version : {name} (code {code})")
    print(f"SDK : {sdk}\nandroid.jar : {jar}")

    shutil.rmtree(BUILD, ignore_errors=True)
    for d in ("gen", "classes", "dex", "res"):
        os.makedirs(os.path.join(BUILD, d))
    shutil.copytree(os.path.join(A, "res"), os.path.join(BUILD, "res"), dirs_exist_ok=True)
    make_icons()

    print("1/6 ressources (aapt2)")
    run([tools["aapt2"], "compile", "--dir", os.path.join(BUILD, "res"), "-o", os.path.join(BUILD, "res.zip")])
    base = os.path.join(BUILD, "base.apk")
    run([tools["aapt2"], "link", "-o", base, "-I", jar, "--manifest", os.path.join(A, "AndroidManifest.xml"), "--min-sdk-version", MIN_SDK,
         "--target-sdk-version", PLATFORM, "--version-code", str(code), "--version-name", name, "-R", os.path.join(BUILD, "res.zip"),
         "-A", os.path.join(A, "assets"), "--java", os.path.join(BUILD, "gen"), "--auto-add-overlay"])

    print("2/6 compilation Java")
    srcs = glob.glob(os.path.join(A, "src", "**", "*.java"), recursive=True) + glob.glob(os.path.join(BUILD, "gen", "**", "*.java"), recursive=True)
    run(["javac", "--release", "8", "-encoding", "UTF-8", "-Xlint:-options", "-cp", jar, "-d", os.path.join(BUILD, "classes"), *srcs])

    print("3/6 conversion en DEX (d8)")
    classes = glob.glob(os.path.join(BUILD, "classes", "**", "*.class"), recursive=True)
    run([tools["d8"], "--lib", jar, "--min-api", MIN_SDK, "--output", os.path.join(BUILD, "dex"), *classes])
    with zipfile.ZipFile(base, "a", zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(BUILD, "dex", "classes.dex"), "classes.dex")

    print("4/6 alignement")
    aligned = os.path.join(BUILD, "aligned.apk")
    run([tools["zipalign"], "-f", "-p", "4", base, aligned])

    print("5/6 signature")
    ks, pwd = keystore()
    if os.path.isfile(OUT):
        os.remove(OUT)
    run([tools["apksigner"], "sign", "--ks", ks, "--ks-pass", f"pass:{pwd}", "--key-pass", f"pass:{pwd}", "--out", OUT, aligned])
    run([tools["apksigner"], "verify", OUT])

    sha = hashlib.sha256(open(OUT, "rb").read()).hexdigest()
    with open(OUT + ".json", "w", encoding="utf-8") as f:
        json.dump({"versionCode": code, "versionName": name, "sha256": sha, "size": os.path.getsize(OUT)}, f)
    open(vfile, "w").write(str(code))
    print("6/6 termine")
    print(f"\nAPK prete : {OUT}  ({os.path.getsize(OUT) // 1024} Ko)")
    print("Installation : ouvrez  https://<IP du PC>:8443/nasko.apk  sur le telephone (page de connexion) et autorisez l'installation depuis cette source.")


if __name__ == "__main__":
    main()
