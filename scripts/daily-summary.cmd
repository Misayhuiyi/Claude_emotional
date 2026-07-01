@echo off
chcp 65001 >nul
cd /d e:\better\EmotionalAgent
node -e "const s=require('./memory-service/summarize');s.generateSummary('daily').then(r=>console.log(r?'每日摘要已生成':'消息不足')).catch(e=>console.log('摘要失败:',e.message))"
