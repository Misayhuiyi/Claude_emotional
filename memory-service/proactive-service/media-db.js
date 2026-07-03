/**
 * Media DB - 媒体资源数据库操作
 *
 * 管理 media_assets 表的 CRUD。
 * 图片/语音/视频文件的元数据存储。
 */

const crypto = require('crypto');
const db = require('../db');

/**
 * 生成媒体资源 ID
 */
function generateMediaId(prefix = 'med') {
  return prefix + '_' + crypto.randomUUID().slice(0, 8);
}

/**
 * 计算文件 SHA256
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function computeSha256(filePath) {
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 插入媒体资源记录
 */
function insertMediaAsset({ type, filePath, sha256, mime, source = 'wechat', messageId, summary, transcript, metadata }) {
  const database = db.getDb();
  const id = generateMediaId();

  database.prepare(`
    INSERT INTO media_assets (id, type, path, sha256, mime, source, message_id, summary, transcript, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, type, filePath, sha256 || null, mime || null, source, messageId || null,
    summary || null, transcript || null, metadata ? JSON.stringify(metadata) : null);

  return id;
}

/**
 * 获取媒体资源
 */
function getMediaAsset(id) {
  const database = db.getDb();
  return database.prepare('SELECT * FROM media_assets WHERE id = ?').get(id);
}

/**
 * 按消息 ID 获取媒体资源
 */
function getMediaByMessage(messageId) {
  const database = db.getDb();
  return database.prepare('SELECT * FROM media_assets WHERE message_id = ? ORDER BY created_at DESC').all(messageId);
}

/**
 * 更新媒体摘要
 */
function updateMediaSummary(id, summary) {
  const database = db.getDb();
  database.prepare('UPDATE media_assets SET summary = ?, updated_at = datetime("now") WHERE id = ?').run(summary, id);
}

/**
 * 更新媒体转写文本
 */
function updateMediaTranscript(id, transcript) {
  const database = db.getDb();
  database.prepare('UPDATE media_assets SET transcript = ?, updated_at = datetime("now") WHERE id = ?').run(transcript, id);
}

module.exports = {
  generateMediaId,
  computeSha256,
  insertMediaAsset,
  getMediaAsset,
  getMediaByMessage,
  updateMediaSummary,
  updateMediaTranscript,
};
