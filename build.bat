@echo off
cd /d "%~dp0"
if not "%1"=="auto" py -m pip install -r requirements.txt

rem --- le logo est obligatoire : icone de ENOS.exe
if not exist logo.ico py setup_assets.py
if not exist logo.ico (
  echo ERREUR : logo.ico introuvable. Lancez "py setup_assets.py" puis relancez build.bat.
  if not "%1"=="auto" pause
  exit /b 1
)

py -m PyInstaller --onefile --noconsole --name ENOS --icon="%~dp0logo.ico" --distpath "." --workpath "build_tmp" --specpath "build_tmp" ^
  --add-data "%~dp0static;static" --add-data "%~dp0voix;voix" --add-data "%~dp0openings;openings" --add-data "%~dp0cascades;cascades" --add-data "%~dp0logo.png;." --add-data "%~dp0logo-192.png;." --add-data "%~dp0logo-512.png;." --add-data "%~dp0logo.ico;." ^
  --collect-submodules uvicorn --collect-all webview --collect-submodules cryptography --collect-all sounddevice --collect-all _sounddevice_data ^
  --hidden-import nasko_core --hidden-import nasko_eleven --hidden-import nasko_llm --hidden-import nasko_tasks ^
  --hidden-import nasko_actions --hidden-import nasko_cert --hidden-import nasko_memory --hidden-import nasko_stt --hidden-import nasko_voice --hidden-import nasko_trust --hidden-import nasko_screen --hidden-import nasko_power --hidden-import truststore --hidden-import nasko_imagefactory --hidden-import nasko_webauto --hidden-import nasko_anim --hidden-import nasko_compress --hidden-import nasko_pdf --hidden-import nasko_studio --hidden-import nasko_syllabus --hidden-import nasko_receipts --hidden-import nasko_tray --hidden-import nasko_toast --hidden-import nasko_autostart --hidden-import pystray --collect-submodules pystray --hidden-import pillow_heif --collect-all pillow_heif --hidden-import cv2 --collect-all pymupdf --hidden-import openpyxl --hidden-import pptx --collect-submodules pdf2docx --hidden-import nasko_audio --hidden-import nasko_env --hidden-import nasko_sync --hidden-import nasko_security --hidden-import nasko_tabs --hidden-import nasko_team --hidden-import nasko_chat --hidden-import nasko_git --hidden-import nasko_godotsync --hidden-import nasko_tools --hidden-import nasko_mobile --hidden-import nasko_chess --hidden-import nasko_embed --hidden-import nasko_chessbridge --hidden-import nasko_boss --hidden-import nasko_notify --hidden-import nasko_pet --hidden-import nasko_jeux --hidden-import nasko_persona --hidden-import nasko_coach --hidden-import nasko_cache --hidden-import nasko_ext --hidden-import nasko_youtube --hidden-import nasko_cleaner --hidden-import nasko_organizer --hidden-import nasko_paths --hidden-import plyer --collect-submodules plyer --hidden-import plyer.platforms.win.notification --hidden-import chess --collect-submodules chess --hidden-import websockets --collect-submodules websockets --hidden-import python_multipart --collect-submodules python_multipart --collect-submodules screeninfo --hidden-import pydub --hidden-import audioop --collect-all imageio_ffmpeg --hidden-import PIL --hidden-import nasko_safe --hidden-import nasko_loopback --hidden-import nasko_apimon --hidden-import nasko_sysctl --hidden-import nasko_mobchess --hidden-import nasko_pairing --hidden-import nasko_ota --hidden-import nasko_onboarding --hidden-import nasko_agenda --hidden-import nasko_agent --hidden-import nasko_epita --hidden-import nasko_sysmon --hidden-import nasko_diag --hidden-import nasko_godotdiag --hidden-import psutil --hidden-import soundcard --collect-submodules soundcard --collect-all playwright ^
  --exclude-module faster_whisper --exclude-module ctranslate2 --exclude-module onnxruntime --exclude-module av --exclude-module tokenizers --exclude-module huggingface_hub nasko_server.py
if errorlevel 1 (
  echo ERREUR de compilation. Si ENOS.exe est ouvert, fermez-le ^(bouton QUITTER^) puis relancez.
  if not "%1"=="auto" pause
  exit /b 1
)
rmdir /s /q build_tmp
rem l'explorateur Windows garde les anciennes icones en cache : on le rafraichit
ie4uinit.exe -show >nul 2>&1
echo Termine : ENOS.exe (logiciel de bureau, icone logo.ico) est dans ce dossier.
echo Pour un raccourci sur le Bureau : py creer_raccourci.py
echo Installeur de distribution ^(E.N.O.S. + Dual Pulse Launcher^) : py build_release.py --version X.Y.Z
if not "%1"=="auto" pause
