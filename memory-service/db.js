/**
 * 数据库操作模块
 *
 * 职责：messages 写入、memories CRUD、mentions 追踪
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

let db = null;

// 生成 ID
function generateId(prefix = '') {
  return prefix + crypto.randomUUID().slice(0, 8);
}

// 获取数据库实例（懒初始化，单例）
function getDb() {
  if (db) return db;

  const dbPath = config.PATHS.memoryDb;
  const fs = require('fs');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// ─── Messages ────────────────────────────────────

/**
 * 写入一条消息
 */
function insertMessage({ id, role, content, source = 'wechat', platform = 'cc-connect', conversationId }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO messages (id, role, content, source, platform, conversation_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(id || generateId('msg_'), role, content, source, platform, conversationId || null);
}

/**
 * 获取最近 N 条消息
 */
function getRecentMessages(limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT id, role, content, created_at FROM messages
    ORDER BY created_at DESC LIMIT ?
  `).all(limit).reverse();
}

// ─── Memories ────────────────────────────────────

/**
 * 查找相似记忆（多策略模糊匹配）
 *
 * 策略：
 *   1. 取内容前 30 字做 LIKE
 *   2. 取关键词做 LIKE（更稳定）
 *   3. 兜底：搜索 FTS（英文）或 keyword overlap
 */
function findSimilar(content, keywords = '') {
  const db = getDb();

  // 策略1: 前 30 字模糊匹配
  let result = db.prepare(`
    SELECT * FROM memories
    WHERE content LIKE ? AND status != 'forgotten'
    ORDER BY weight DESC
    LIMIT 1
  `).get(`%${content.slice(0, 30)}%`);

  if (result) return result;

  // 策略2: 关键词匹配（每个关键词独立 LIKE）
  const kwList = (keywords || content).split(/[\s,，。！？、]+/).filter(s => s.length >= 2);
  if (kwList.length > 0) {
    const likeClause = kwList.map(() => 'content LIKE ?').join(' AND ');
    const params = kwList.map(k => `%${k}%`);

    result = db.prepare(`
      SELECT * FROM memories
      WHERE ${likeClause} AND status != 'forgotten'
      ORDER BY weight DESC
      LIMIT 1
    `).get(...params);

    if (result) return result;
  }

  // 策略3: 单字 bigram 匹配（中文兜底）
  const bigrams = [];
  for (let i = 0; i < content.length - 1; i++) {
    const bg = content.slice(i, i + 2);
    if (/[一-鿿]/.test(bg)) bigrams.push(bg);
  }
  if (bigrams.length > 0) {
    const topBigrams = bigrams.slice(0, 5);
    const likeClause = topBigrams.map(() => 'content LIKE ?').join(' OR ');
    const params = topBigrams.map(bg => `%${bg}%`);

    result = db.prepare(`
      SELECT * FROM memories
      WHERE (${likeClause}) AND status != 'forgotten'
      ORDER BY weight DESC
      LIMIT 1
    `).get(...params);

    if (result) return result;
  }

  return null;
}

/**
 * 插入新记忆
 */
function insertMemory({ id, type, content, keywords = '', importance = 1, frequency = 1,
  emotionScore = 0, explicitScore = 0, recencyScore = 1, confidence = 0.7,
  weight, status = 'candidate', priority = 'P3' }) {
  const db = getDb();
  const memId = id || generateId('mem_');

  db.prepare(`
    INSERT INTO memories (id, type, content, keywords, importance, frequency,
      emotion_score, explicit_score, recency_score, confidence, weight,
      status, priority, created_at, updated_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
  `).run(memId, type, content, keywords, importance, frequency,
    emotionScore, explicitScore, recencyScore, confidence, weight, status, priority);

  return { id: memId, updated: false };
}

/**
 * 更新已有记忆
 */
function updateMemory(id, { type, content, keywords, importance, frequency,
  emotionScore, explicitScore, recencyScore, confidence, weight, status, priority = 'P3' }) {
  const db = getDb();

  db.prepare(`
    UPDATE memories SET
      type = COALESCE(?, type),
      content = COALESCE(?, content),
      keywords = COALESCE(?, keywords),
      importance = COALESCE(?, importance),
      frequency = COALESCE(?, frequency),
      emotion_score = COALESCE(?, emotion_score),
      explicit_score = COALESCE(?, explicit_score),
      recency_score = COALESCE(?, recency_score),
      confidence = COALESCE(?, confidence),
      weight = COALESCE(?, weight),
      status = COALESCE(?, status),
      priority = COALESCE(?, priority),
      updated_at = datetime('now'),
      last_seen_at = datetime('now')
    WHERE id = ?
  `).run(type, content, keywords, importance, frequency,
    emotionScore, explicitScore, recencyScore, confidence, weight, status, priority, id);

  return { id, updated: true };
}

/**
 * 插入或更新记忆（只做 I/O，权重计算在 gate.js）
 */
function upsertMemory({ id, type, content, keywords = '', importance = 1, frequency = 1,
  emotionScore = 0, explicitScore = 0, recencyScore = 1, confidence = 0.7,
  weight, status = 'candidate', priority = 'P3' }) {

  const existing = findSimilar(content);

  if (existing) {
    const newFreq = existing.frequency + 1;
    return updateMemory(existing.id, {
      type, content, keywords, importance, frequency: newFreq,
      emotionScore, explicitScore, recencyScore, confidence,
      weight, status, priority,
    });
  }

  return insertMemory({
    id, type, content, keywords, importance, frequency,
    emotionScore, explicitScore, recencyScore, confidence,
    weight, status, priority,
  });
}

/**
 * 根据 ID 获取记忆
 */
function getMemoryById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
}

/**
 * 更新记忆状态（/forget, /remember 等）
 */
function updateMemoryStatus(id, status) {
  const db = getDb();
  db.prepare(`
    UPDATE memories SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, id);
}

/**
 * 获取所有活跃记忆（排除 archived/forgotten）
 */
function getActiveMemories(limit = 100) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM memories
    WHERE status IN ('candidate', 'working', 'permanent')
    ORDER BY weight DESC
    LIMIT ?
  `).all(limit);
}

/**
 * 获取 permanent 记忆
 */
function getPermanentMemories() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM memories WHERE status = 'permanent' ORDER BY weight DESC
  `).all();
}

// ─── Memory Mentions ──────────────────────────────

/**
 * 记录 memory 被某条消息提及
 */
function insertMention(memoryId, messageId, matchedText = '', emotionScore = 0) {
  const db = getDb();
  db.prepare(`
    INSERT INTO memory_mentions (id, memory_id, message_id, matched_text, emotion_score, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(generateId('mnt_'), memoryId, messageId, matchedText, emotionScore);
}

/**
 * 获取某条记忆的所有来源消息
 */
function getMentionsForMemory(memoryId) {
  const db = getDb();
  return db.prepare(`
    SELECT mm.*, m.content as message_content
    FROM memory_mentions mm
    JOIN messages m ON mm.message_id = m.id
    WHERE mm.memory_id = ?
    ORDER BY mm.created_at DESC
  `).all(memoryId);
}

module.exports = {
  getDb,
  generateId,
  insertMessage,
  getRecentMessages,
  findSimilar,
  insertMemory,
  updateMemory,
  upsertMemory,
  getMemoryById,
  updateMemoryStatus,
  getActiveMemories,
  getPermanentMemories,
  insertMention,
  getMentionsForMemory,
};
