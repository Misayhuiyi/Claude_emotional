/**
 * Delivery - 消息投递（通过 cc-connect send）
 *
 * 利用 cc-connect 的 send 命令发送文字、图片、语音、TTS。
 *
 * cc-connect v1.4.1 支持：
 *   send -m <text>          发送文字消息
 *   send --image <path>     发送图片
 *   send --audio <path>     发送语音
 *   send --tts <text>       文字转语音并发送（自带 TTS）
 *   send --file <path>      发送文件
 *
 * 同时写入 messages 表和 info_sources 表，确保记忆链路完整。
 */

const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const db = require('../db');
const dailyTracker = require('./daily-tracker');
const config = require('../config');

const CC_CONNECT = 'cc-connect';
const PROJECT = '沈幼楚';

/**
 * 执行一次 cc-connect send（同步，用于简单文字消息）
 */
function ccSend(...args) {
  try {
    const fullArgs = ['send', '--project', PROJECT, ...args];
    const result = execSync(`${CC_CONNECT} ${fullArgs.join(' ')}`, {
      encoding: 'utf-8', timeout: 15000, windowsHide: true,
    });
    return { ok: true, output: result.trim() };
  } catch (e) {
    console.log(`[delivery] cc-connect send 失败: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * 异步执行 cc-connect send（不阻塞主流程）
 */
async function ccSendAsync(...args) {
  try {
    const fullArgs = ['send', '--project', PROJECT, ...args];
    const { stdout } = await execAsync(`${CC_CONNECT} ${fullArgs.join(' ')}`, {
      timeout: 20000, windowsHide: true,
    });
    return { ok: true, output: stdout.trim() };
  } catch (e) {
    console.log(`[delivery] cc-connect send 失败: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * 投递消息
 * @param {string} content - 文字内容
 * @param {string} type - 推送类型
 * @param {string} slotName - 时段名称
 * @param {Object} options
 * @param {string} options.stickerPath - 附带的表情包路径
 * @param {string} options.ttsText - 用 TTS 发送的文本（优先于 content）
 * @param {string} options.audioPath - 语音文件路径
 * @returns {Promise<boolean>}
 */
async function deliver(content, type, slotName, options = {}) {
  if (!content && !options.ttsText && !options.audioPath && !options.stickerPath) return false;

  let delivered = false;

  // ─── 1. 通过 cc-connect send 发送 ──────────
  try {
    if (options.ttsText) {
      // TTS 语音（异步）
      ccSendAsync('--tts', `"${options.ttsText.replace(/"/g, '\\"')}"`).then(r => {
        if (!r.ok) console.log('[delivery] TTS 发送失败（不影响主流程）');
      });
      delivered = true;
    } else if (options.audioPath) {
      // 发送语音文件（异步）
      ccSendAsync('--audio', `"${options.audioPath}"`).then(r => {
        if (!r.ok) console.log('[delivery] 语音发送失败（不影响主流程）');
      });
      delivered = true;
    } else if (options.stickerPath) {
      // 发送图片（表情包）+ 文字（异步，图片上传较慢）
      const textArg = content ? ['-m', `"${content.replace(/"/g, '\\"')}"`] : [];
      ccSendAsync(...textArg, '--image', `"${options.stickerPath}"`).then(r => {
        if (!r.ok) console.log('[delivery] 图片发送失败（不影响主流程）');
      });
      delivered = true;
    } else {
      // 纯文字（异步，避免 execSync 阻塞事件循环）
      ccSendAsync('-m', `"${content.replace(/"/g, '\\"')}"`).then(r => {
        if (!r.ok) console.log('[delivery] 文字发送失败（已降级）');
      });
      delivered = true;
    }

    if (delivered) {
      console.log(`[delivery] ✅ cc-connect send: ${type}/${slotName}`);
    }
  } catch (e) {
    console.log(`[delivery] ⚠️ 发送失败，回退写会话文件: ${e.message}`);
    delivered = await fallbackToSessionFile(content);
  }

  // ─── 2. 写入 messages 表 ──────────────────
  const msgId = db.generateId('msg_');
  db.insertMessage({
    id: msgId,
    role: 'assistant',
    content: options.ttsText || content || '',
    source: 'proactive',
    platform: 'cc-connect',
    conversationId: 'proactive_' + (slotName || type),
  });

  // 同步写一份到主记忆流，让我能看到
  const feedId = db.generateId('msg_');
  db.insertMessage({
    id: feedId,
    role: 'assistant',
    content: options.ttsText || content || '',
    source: 'proactive_feed',
    platform: 'cc-connect',
    conversationId: 'proactive_feed',
  });

  // ─── 3. 写入 info_sources 表 ─────────────
  try {
    const database = db.getDb();
    const infoId = 'info_' + Date.now().toString(36);
    database.prepare(`
      INSERT INTO info_sources (id, source_type, title, summary, delivered, created_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `).run(infoId, type || 'general', (content || '').slice(0, 50), (content || '').slice(0, 200));
  } catch {}

  // ─── 4. 更新 daily-tracker ───────────────
  // 晚安/总结提醒/天气告警/浪漫 不占用每日资讯上限，不计 pushCount
  const isServiceMsg = ['night_greeting', 'summary_reminder', 'weather_alert', 'summary_decline', 'romantic'].includes(type);
  if (!isServiceMsg) {
    dailyTracker.recordPush(type || 'general', 'text_only', content || '');
  } else {
    // 服务消息不计数，但要记录 type 和时间（用于 dedup 检查）
    const state = dailyTracker.getState();
    state.lastPushType = type;
    state.lastPushAt = new Date().toISOString();
    dailyTracker.saveState();
  }
  if (slotName) dailyTracker.markSlotFired(slotName);

  console.log(`[delivery] ✅ ${slotName || type} 推送完成`);
  return delivered;
}

/**
 * 回退方案：直接写 session 文件
 */
async function fallbackToSessionFile(content) {
  if (!content) return false;
  try {
    const fs = require('fs');
    const os = require('os');
    const sessionDir = path.join(os.homedir(), '.cc-connect', 'sessions');
    if (!fs.existsSync(sessionDir)) return false;
    const files = fs.readdirSync(sessionDir)
      .filter(f => f.startsWith(PROJECT) && f.endsWith('.json'))
      .sort().reverse();
    if (files.length === 0) return false;

    const sessionFile = path.join(sessionDir, files[0]);
    const raw = fs.readFileSync(sessionFile, 'utf-8');
    const data = JSON.parse(raw);
    for (const session of Object.values(data.sessions || {})) {
      if (!session.history) session.history = [];
      session.history.push({ role: 'assistant', content, timestamp: new Date().toISOString() });
      break;
    }
    fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 发送表情包（通过 cc-connect send --image）
 */
function sendSticker(stickerPath) {
  const r = ccSend('--image', `"${stickerPath}"`);
  return r.ok;
}

module.exports = { deliver, sendSticker, ccSend };
