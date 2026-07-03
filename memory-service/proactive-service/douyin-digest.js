/**
 * Douyin Digest - 抖音内容摘要
 *
 * 严格遵循最终方案第 9 节（抖音能力）：
 * - 只做合规路径：用户主动分享链接/截图/视频后理解内容
 * - 不做：未授权自动刷抖音、模拟登录抓数据、绕过反爬
 * - 用户偏好仅作为候选记忆
 */

const crypto = require('crypto');
const db = require('../db');

/**
 * 处理用户分享的抖音链接
 * @param {string} url - 抖音分享链接
 * @param {string} userDescription - 用户自述（如果有）
 * @returns {Promise<Object>}
 */
async function processDouyinLink(url, userDescription) {
  const id = 'dy_' + crypto.randomUUID().slice(0, 8);

  // 从 URL 提取视频 ID
  const videoId = extractVideoId(url);

  // 不做自动爬取，只记录用户提供的信息
  const item = {
    id,
    url,
    videoId,
    title: '',
    author: '',
    summary: userDescription || '用户分享了一个抖音视频（内容摘要需用户描述）',
    userReaction: '',
    mediaAssetId: null,
    createdAt: new Date().toISOString(),
  };

  // 写入 douyin_items 表（如果表存在）
  try {
    const database = db.getDb();
    database.prepare(`
      INSERT OR IGNORE INTO douyin_items (id, url, title, author, summary, user_reaction, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(item.id, item.url, item.title, item.author, item.summary, item.userReaction);
  } catch (e) {
    // douyin_items 表可能尚未创建，静默处理
    console.log(`[douyin] 记录失败（表可能不存在）: ${e.message}`);
  }

  return item;
}

/**
 * 处理用户分享的抖音截图
 * @param {string} imagePath - 截图路径
 * @param {string} ocrText - OCR 识别文本（如果有）
 * @returns {Promise<Object>}
 */
async function processDouyinScreenshot(imagePath, ocrText) {
  const id = 'dy_img_' + crypto.randomUUID().slice(0, 8);

  const item = {
    id,
    url: '',
    videoId: null,
    title: '',
    author: '',
    summary: ocrText || '用户分享了一张抖音截图',
    userReaction: '',
    mediaAssetId: null,
    createdAt: new Date().toISOString(),
  };

  try {
    const database = db.getDb();
    database.prepare(`
      INSERT OR IGNORE INTO douyin_items (id, url, title, author, summary, user_reaction, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(item.id, item.url, item.title, item.author, item.summary, item.userReaction);
  } catch {}

  return item;
}

/**
 * 从 URL 提取抖音视频 ID
 */
function extractVideoId(url) {
  // 支持格式：
  // https://www.douyin.com/video/123456789
  // https://v.douyin.com/xxxxxx/
  const match = url.match(/video\/(\d+)/) || url.match(/v\.douyin\.com\/([^\/]+)/);
  return match ? match[1] : null;
}

/**
 * 从用户最近分享的抖音内容分析偏好
 * @returns {Promise<Array>} 偏好标签
 */
async function analyzePreferences() {
  try {
    const database = db.getDb();
    const items = database.prepare(
      'SELECT summary, user_reaction FROM douyin_items ORDER BY created_at DESC LIMIT 20'
    ).all();

    if (items.length === 0) return [];

    // 简易关键词统计
    const keywords = {};
    const categoryKeywords = {
      'AI': ['ai', '人工智能', '大模型', 'gpt', 'chatgpt', 'agent'],
      '编程': ['代码', '编程', '程序', '前端', '后端', 'python', 'js'],
      '搞笑': ['搞笑', '好笑', '哈哈', '段子', '梗'],
      '科技': ['科技', '数码', '手机', '电脑', '测评'],
      '学习': ['学习', '教程', '课程', '知识', '干货'],
      '生活': ['生活', '日常', 'vlog', '记录'],
    };

    for (const item of items) {
      const text = ((item.summary || '') + ' ' + (item.user_reaction || '')).toLowerCase();
      for (const [category, kws] of Object.entries(categoryKeywords)) {
        if (kws.some(kw => text.includes(kw))) {
          keywords[category] = (keywords[category] || 0) + 1;
        }
      }
    }

    // 返回排序后的偏好
    return Object.entries(keywords)
      .sort((a, b) => b[1] - a[1])
      .filter(([, count]) => count >= 2)
      .map(([category]) => category);
  } catch {
    return [];
  }
}

module.exports = {
  processDouyinLink,
  processDouyinScreenshot,
  analyzePreferences,
};
