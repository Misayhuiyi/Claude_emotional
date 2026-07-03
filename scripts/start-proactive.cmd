@echo off
cd /d "%~dp0.."
echo [%date% %time%] Starting proactive service... >> logs\proactive.log
node memory-service/proactive-main.js >> logs\proactive.log 2>&1
