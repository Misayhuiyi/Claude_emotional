/**
 * cc-connect 会话监控器
 *
 * 监控 ~/.cc-connect/sessions/ 目录，将新消息同步到 memory 数据库
 * 批量传递给 Memory Gate 以便自动抽取记忆
 * 作为独立后台进程运行
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const gate = require('./gate');

// 图片识别器
let visionService = null;
function getVisionService() {
  if (!visionService) {
    try { visionService = require('./proactive-service/vision-service'); } catch {}
  }
  return visionService;
}

// 跟踪已处理的图片
let processedImages = new Set();

const SESSION_DIR = path.join(require('os').homedir(), '.cc-connect', 'sessions');
const PROJECT_NAME = '沈幼楚';

// 记录已处理的消息 ID
let processedMessages = new Set();

function loadProcessedIds() {
  try {
    const dbInstance = db.getDb();
    const ids = dbInstance.prepare('SELECT id FROM messages').all();
    ids.forEach(r => processedMessages.add(r.id));
  } catch { /* 首次运行 */ }
}

function messageId(msg) {
  return 'cc_' + require('crypto').createHash('md5')
    .update(msg.role + '|' + msg.content + '|' + msg.timestamp)
    .digest('hex').slice(0, 12);
}

/**
 * 扫描会话文件中的新消息
 * 返回 { imported: number, recentChunk: Array }
 */
function scanSessionFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const sessions = data.sessions || {};
    let imported = 0;
    const newMessages = [];

    for (const [sessionId, session] of Object.entries(sessions)) {
      const history = session.history || [];

      for (const msg of history) {
        if (!msg.content || msg.content.trim() === '') continue;

        const id = messageId(msg);
        if (processedMessages.has(id)) continue;

        db.insertMessage({
          id,
          role: msg.role,
          content: msg.content,
          source: 'weixin',
          platform: 'cc-connect',
          conversationId: PROJECT_NAME + '_' + sessionId,
        });

        // 每日总结检测
        if (msg.role === 'user' && (msg.content.startsWith('#总结') || msg.content.startsWith('#今日总结') || msg.content.startsWith('今日总结'))) {
          try {
            const dailyTracker = require('./proactive-service/daily-tracker');
            const content = msg.content.replace(/^#?(今日)?总结\s*/, '').trim();
            dailyTracker.markSummarySubmitted(content);
            console.log('[session-watcher] 已标记今日总结');
          } catch {}
        }
        // 学习反馈检测
        if (msg.role === 'user') {
          try { require('./proactive-service/study-pusher').handleFeedback(msg.content); } catch {}
          try { require('./proactive-service/daily-tracker').recordResponse(); } catch {}
        }

        processedMessages.add(id);
        newMessages.push({ role: msg.role, content: msg.content, messageId: id });
        imported++;
      }
    }

    return { imported, newMessages };
  } catch (e) {
    return { imported: 0, newMessages: [] };
  }
}

/**
 * 运行 Memory Gate——把最近一批消息组合成完整对话上下文
 */
async function runMemoryGate(newMessages) {
  if (newMessages.length < 2) return;

  // 取最近 6 条（约 3 轮对话）作为上下文，让 Claude 能看清来龙去脉
  const chunk = newMessages.slice(-6);

  // 组合成 {role, content} 格式
  const conversation = chunk.map(m => ({
    role: m.role,
    content: m.content,
  }));

  // 取最后一条消息的 ID 作为 mention source
  const lastMsgId = chunk[chunk.length - 1].messageId;

  try {
    const result = await gate.processGate(conversation, lastMsgId);
    if (result.extracted > 0) {
      console.log(`  🧠 Memory Gate: 抽取 ${result.extracted} 条记忆`);
      result.updated.forEach(u => {
        console.log(`     [${u.status}] w=${u.weight} ${u.content.slice(0, 50)}`);
      });
    }
  } catch (e) {
    // Gate 失败不影响主流程
  }
}

/**
 * 扫描所有会话文件
 */
async function scanAll() {
  const sessionDir = SESSION_DIR;
  if (!fs.existsSync(sessionDir)) return;

  const files = fs.readdirSync(sessionDir)
    .filter(f => f.startsWith(PROJECT_NAME) && f.endsWith('.json'));

  let totalImported = 0;
  let allNewMessages = [];

  for (const file of files) {
    const { imported, newMessages } = scanSessionFile(path.join(sessionDir, file));
    totalImported += imported;
    allNewMessages = allNewMessages.concat(newMessages);
  }

  if (totalImported > 0) {
    console.log(`[session-watcher] 导入 ${totalImported} 条新消息`);
    // 检查是否有新图片到达
    await checkNewImages(allNewMessages);
    // 新消息到达 → 运行 Memory Gate（完整对话上下文）
    await runMemoryGate(allNewMessages);
  }
}

/**
 * 检查新消息中是否有图片，自动调用视觉分析
 */
async function checkNewImages(newMessages) {
  const vision = getVisionService();
  if (!vision || !vision.isVisionAvailable()) return;

  const attachDir = path.join(SESSION_DIR, '..', 'attachments');
  // 实际目录在项目下的 .cc-connect/attachments/
  const projectAttachDir = path.join(require('./config').PATHS.root, '.cc-connect', 'attachments');

  for (const dir of [projectAttachDir, attachDir]) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg'));
      for (const file of files) {
        const filePath = path.join(dir, file);
        if (processedImages.has(filePath)) continue;
        processedImages.add(filePath);

        console.log(`[session-watcher] 📷 检测到新图片: ${file}`);
        try {
          const result = await vision.analyzeImage(filePath);
          if (!result.fallback && result.summary) {
            // 将图片分析结果写入 messages 表
            const analysisId = 'vis_' + Date.now().toString(36);
            db.insertMessage({
              id: analysisId,
              role: 'system',
              content: `[图片分析] ${result.summary}`,
              source: 'vision-service',
              platform: 'auto',
              conversationId: 'proactive_img_analysis',
            });
            console.log(`[session-watcher] ✅ 图片分析完成: ${result.summary.slice(0, 60)}`);
          }
        } catch (e) {
          console.log(`[session-watcher] 图片分析失败: ${e.message}`);
        }
      }
    } catch (e) { /* 目录可能不存在 */ }
  }
}

// ─── 主循环 ────────────────────────────────────────

loadProcessedIds();

// 立即扫描一次
console.log(`[session-watcher] 启动中...`);
scanAll().then(() => {
  console.log(`[session-watcher] 总消息: ${db.getDb().prepare('SELECT COUNT(*) as c FROM messages').get().c} 条`);
});

// 每 10 秒轮询
setInterval(() => {
  scanAll();
}, 10000);
