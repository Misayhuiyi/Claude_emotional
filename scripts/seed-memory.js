/**
 * 播种测试记忆
 *
 * 使用：node scripts/seed-memory.js
 */
const db = require('../memory-service/db');

// 清空（可选，默认不清空）
const doClear = process.argv.includes('--clear');
if (doClear) {
  const database = db.getDb();
  database.exec('DELETE FROM memories');
  database.exec('DELETE FROM memories_fts');
  console.log('已清空现有记忆');
}

console.log('播种测试记忆...\n');

const seeds = [
  {
    type: 'preference',
    content: '用户不喜欢被说教，讨厌长篇大论的道理',
    keywords: '说教 长篇大论 讨厌',
    importance: 5, explicitScore: 5, status: 'permanent',
  },
  {
    type: 'emotional_pattern',
    content: '用户对换窗口或中断造成的断裂感很敏感，会感到失落',
    keywords: '换窗口 断裂感 失落',
    importance: 5, emotionScore: 5, status: 'working',
  },
  {
    type: 'recurring_pain',
    content: '用户反复提到项目截止日期的焦虑，需要被理解和陪伴而非解决方案',
    keywords: '项目 截止 焦虑 陪伴',
    importance: 4, emotionScore: 3, status: 'working',
  },
  {
    type: 'identity_fact',
    content: '用户叫小明，是一名程序员',
    keywords: '小明 程序员',
    importance: 3, explicitScore: 5, status: 'permanent',
  },
];

for (const s of seeds) {
  const r = db.upsertMemory(s);
  const emoji = r.updated ? '📝' : '✨';
  console.log(`  ${emoji} ${r.id}: ${s.content.slice(0, 40)}...`);
}

console.log('\n播种完成');
