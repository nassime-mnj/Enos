@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -m pip install -q -r requirements.txt
rem copie ENOS.exe (s'il est plus recent) dans private/ : dossier JAMAIS public, servi uniquement aux IP autorisees
if not exist private mkdir private
if exist "..\ENOS.exe" xcopy /d /y /q "..\ENOS.exe" "private\" >nul
rem lit .env : lignes "CLE=valeur", commentaires (#) et lignes vides ignores
if exist .env for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do if not "%%b"=="" set "%%a=%%b"
echo Site Dual Pulse sur http://127.0.0.1:8000
py -m uvicorn app.main:app --host 127.0.0.1 --port 8000
if errorlevel 1 pause
