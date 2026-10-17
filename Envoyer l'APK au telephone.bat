@echo off
cd /d "%~dp0"
title E.N.O.S. - Envoyer l'APK au telephone
py envoyer_apk.py %*
if errorlevel 1 pause
timeout /t 4 >nul
