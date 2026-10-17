@echo off
cd /d "%~dp0"
title E.N.O.S. - Mise a jour
echo.
echo  E.N.O.S. se met a jour (fermeture, reconstruction, relance)...
echo  Ne fermez pas cette fenetre : elle se ferme toute seule.
echo.
timeout /t 2 /nobreak >nul
taskkill /f /im ENOS.exe >nul 2>&1
timeout /t 2 /nobreak >nul
call build.bat auto
if errorlevel 1 (
  echo.
  echo  ERREUR pendant la reconstruction : voir les messages ci-dessus. E.N.O.S. n'a pas ete relance.
  pause
  exit /b 1
)
start "" "%~dp0ENOS.exe"
exit /b 0
