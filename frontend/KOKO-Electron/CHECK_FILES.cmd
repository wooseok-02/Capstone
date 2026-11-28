@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "package.json" goto error
if not exist "main.js" goto error
if not exist "preload.js" goto error
if not exist "renderer\pet.html" goto error
if not exist "renderer\pet.js" goto error
if not exist "renderer\auth.html" goto error
if not exist "renderer\workspace.html" goto error
if not exist "assets\koko-pet.png" goto error
echo [OK] Files are present. Run npm start from this folder.
pause
exit /b 0
:error
echo [ERROR] Project file missing. Please extract the ZIP completely.
pause
exit /b 1
