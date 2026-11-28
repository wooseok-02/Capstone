@echo off
cd /d "%~dp0"
echo [KOKO] Live API mode - https://capstone.nsu-coco.online
if not exist node_modules\electron\dist\electron.exe (
 echo Install dependencies first: npm install
 pause
 exit /b 1
)
npm start
if errorlevel 1 pause
