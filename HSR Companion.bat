@echo off
rem ============================================================
rem  HSR Companion : double-clique ici pour lancer l'application.
rem  Garde cette fenetre ouverte pendant l'utilisation ;
rem  ferme-la pour arreter l'application.
rem ============================================================
title HSR Companion (laisser ouvert)
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python est introuvable. Installe-le depuis https://www.python.org/downloads/
  echo en cochant "Add python.exe to PATH", puis relance ce fichier.
  pause
  exit /b 1
)
python tools\serve.py
pause
