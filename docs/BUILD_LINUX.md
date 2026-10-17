# Compiler E.N.O.S. pour Linux

PyInstaller et Cargo **ne font pas de compilation croisée** : le binaire Linux se fabrique **sur Linux**. Depuis un PC Windows, on le fait **dans WSL** (Ubuntu).
`build_release.py` détecte seul le système (`sys.platform`) : sous Linux il produit une archive `.tar.gz` (et une AppImage en option) au lieu de l'installeur Inno Setup.

## 1. Préparer WSL (une seule fois)

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip python3-gi gir1.2-webkit2-4.1 binutils build-essential git curl pkg-config libportaudio2
# seulement si tu compiles aussi le Dual Pulse Launcher (Tauri) :
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh        # puis : cargo install tauri-cli --version "^2"
```

## 2. Récupérer le code **dans le disque Linux** (pas dans `/mnt/c`)

```bash
cd ~ && git clone https://github.com/nassime-mnj/Enos.git && cd Enos
python3 -m venv --system-site-packages .venv      # --system-site-packages : pywebview a besoin de PyGObject (python3-gi), installé par apt
. .venv/bin/activate && pip install -r requirements.txt
```

## 3. La clé de signature (indispensable)

`ota_pubkey.txt` est embarquée dans l'application : la clé **privée** correspondante doit être celle que tu utilises déjà sous Windows, sinon les ENOS installés refusent tes mises à jour.
Sans elle le script **refuse de continuer** (il ne régénère jamais une clé). Depuis WSL, pointe celle de Windows (sans la copier) :

```bash
export ENOS_RELEASE_KEYS=/mnt/c/Users/<toi>/AppData/Local/ENOS-release/keys
```

## 4. Compiler

```bash
python build_release.py --edition friends --version 1.0.1 --skip-launcher      # E.N.O.S. seul
python build_release.py --edition friends --version 1.0.1                      # + Launcher (Tauri), s'il est installé
python build_release.py --edition friends --version 1.0.1 --linux-format both  # + AppImage (appimagetool requis : variable APPIMAGETOOL)
```

Résultat dans `release/installer/` : `ENOS-1.0.1-friends-linux-x86_64.tar.gz` (+ `.sha256`). Chez l'utilisateur :

```bash
tar xzf ENOS-1.0.1-friends-linux-x86_64.tar.gz && cd ENOS-1.0.1-friends-linux-x86_64 && ./install.sh     # sans root, dans ~/.local
```

`install.sh` relancé = mise à jour (il garde `data/`, `nasko_config.json`, `enos_profiles.json`). `uninstall.sh --purge` supprime aussi les données.

## Ce qui est vérifié, ce qui ne l'est pas

* Vérifié sur un vrai Linux (WSL) : détection de plateforme, exécution directe sans surcouche WSL (git, bash, pty, clang-format), `install.sh` / `uninstall.sh`, assemblage du paquet, refus sans clé de signature.
* **Non exécuté** : PyInstaller et Cargo sous Linux (dépendances système lourdes). Le premier build réel peut demander d'ajouter des `--hidden-import` / `--collect-all`, surtout pour PyGObject.
* Le binaire dépend de la glibc de la machine qui l'a compilé : compile sur la plus ancienne distribution que tu veux supporter.
* Le Launcher compile sous Linux (code conditionné par `cfg(windows)`) mais **ne retrouve pas encore une installation existante** et ne sait pas installer un paquet Linux : aucun manifeste Launcher/OTA n'est produit.
* AppImage : l'image est en lecture seule, `AppRun` place donc les données dans `$XDG_DATA_HOME/ENOS` (variable `ENOS_HOME`). Non testée ici (appimagetool absent).
