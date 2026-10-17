@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
title E.N.O.S. - Envoyer mes cles au telephone
py envoyer_cles.py %*
if errorlevel 1 pause
