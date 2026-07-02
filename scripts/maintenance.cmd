@echo off
e:
cd \better\EmotionalAgent
node -e "require('./memory-service/gate').runMaintenance()"