/**
 * Delivery - 消息投递到 cc-connect 会话
 *
 * 将主动消息写入 cc-connect 的 session JSON 文件，
 * cc-connect 会自动读取并发送到微信。
 *
 * 同时写入 messages 表和 info_sources 表，确保记忆链路完整。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../db');
const dailyTracker = require('./daily-tracker');

const SESSION_DIR = path.join(os.homedir(), '.cc-connect', 'sessions');
const PROJECT_NAME = '沈幼楚';

/**
 * 查找最新的会话文件
 */
function findSessionFile() {
  try {
    if (!fs.existsSync(SESSION_DIR)) return null;
    const files = fs.readdirSync(SESSION_DIR)
      .filter(f => f.startsWith(PROJECT_NAME) && f.endsWith('.json'))
      .sort()
      .reverse();
    return files.length > 0 ? path.join(SESSION_DIR, files[0]) : null;
  } catch {
    return null;
  }
}

/**
 * 投递一条主动消息
 * 1. 写入 cc-connect session 文件（微信才能收到）
 * 2. 写入 messages 表（记忆链路）
 * 3. 写入 info_sources 表（去重）
 * 4. 更新 daily-tracker 状态
 *
 * @param {string} content - 消息内容
 * @param {string} type - 推送类型
 * @param {string} slotName - 时段名称
 * @returns {Promise<boolean>} 是否成功
 */
async function deliver(content, type, slotName) {
  if (!content) return false;

  let delivered = false;

  // ─── 1. 写入 cc-connect session 文件 ───────────
  const sessionFile = findSessionFile();
  if (sessionFile) {
    try {
      const raw = fs.readFileSync(sessionFile, 'utf-8');
      const data = JSON.parse(raw);

      // 找到第一个活跃会话
      for (const [sid, session] of Object.entries(data.sessions || {})) {
        if (!session.history) session.history = [];
        session.history.push({
          role: 'assistant',
          content: content,
          timestamp: new Date().toISOString(),
        });
        break; // 只写入第一个会话
      }

      fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2), 'utf-8');
      delivered = true;
      console.log(`[delivery] ✅ 写入 cc-connect 会话: ${path.basename(sessionFile)}`);
    } catch (e) {
      console.log(`[delivery] ⚠️ 写入会话文件失败: ${e.message}`);
    }
  } else {
    console.log(`[delivery] ⚠️ 未找到会话文件，消息仅写入数据库`);
  }

  // ─── 2. 写入 messages 表 ──────────────────────
  const msgId = db.generateId('msg_');
  db.insertMessage({
    id: msgId,
    role: 'assistant',
    content: content,
    source: 'proactive',
    platform: 'cc-connect',
    conversationId: 'proactive_' + (slotName || type),
  });

  // ─── 3. 写入 info_sources 表 ───────────────────
  try {
    const database = db.getDb();
    const infoId = 'info_' + Date.now().toString(36);
    database.prepare(`
      INSERT INTO info_sources (id, source_type, title, summary, delivered, created_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `).run(infoId, type || 'general', content.slice(0, 50), content.slice(0, 200));
  } catch {}

  // ─── 4. 更新 daily-tracker ─────────────────────
  dailyTracker.recordPush(type || 'general', 'text_only', content);
  if (slotName) dailyTracker.markSlotFired(slotName);

  console.log(`[delivery] ✅ ${slotName || type} 推送完成: ${content.slice(0, 50)}...`);
  return delivered;
}

module.exports = { deliver, findSessionFile };
