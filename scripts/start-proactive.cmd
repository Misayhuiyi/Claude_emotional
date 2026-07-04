@echo off
cd /d "%~dp0.."
echo [%date% %time%] Starting proactive service... >> logs\proactive.log
node --max-old-space-size=4096 memory-service/proactive-main.js >> logs\proactive.log 2>&1
