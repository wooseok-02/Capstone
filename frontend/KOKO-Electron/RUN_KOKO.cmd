@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "renderer\pet.html" (
  echo [ERROR] Missing renderer\pet.html.
  echo Please unzip the full archive to a simple English path, for example C:\KOKO_WORK.
  pause
  exit /b 1
)
if not exist "node_modules\electron" (
  echo Installing project packages...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)
call npm start
if errorlevel 1 pause
