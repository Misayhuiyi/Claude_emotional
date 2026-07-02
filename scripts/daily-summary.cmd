@echo off
chcp 65001 >nul
e:
cd \better\EmotionalAgent
node -e "const s=require('./memory-service/summarize');s.generateSummary('daily').then(r=>console.log(r?'ok':'skip')).catch(e=>console.log('err:',e.message))"
