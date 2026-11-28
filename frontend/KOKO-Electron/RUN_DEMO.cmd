@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "renderer\pet.html" (
  echo [ERROR] renderer\pet.html not found. Extract the complete ZIP first.
  pause
  exit /b 1
)
if not exist "node_modules\electron" (
  echo [KOKO] Installing dependencies for first run...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)
echo [KOKO] Starting OFFLINE UI DEMO. No login or backend is required.
call npm run demo
if errorlevel 1 pause
