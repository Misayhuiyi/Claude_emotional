/**
 * Sticker Service - 表情包检索与发送决策
 *
 * 严格遵循最终方案第 5 节（表情包系统）：
 * - 通过 emotion/intent/tags 检索
 * - 同一轮最多一张，10 分钟内最多 2 张
 * - 文字优先，表情包辅助
 * - cc-connect 不支持发图时只记录推荐，不影响聊天
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const STICKER_INDEX_PATH = path.join(config.PATHS.root, 'stickers', 'index.json');

let stickerIndex = null;

function loadIndex() {
  if (stickerIndex) return stickerIndex;
  try {
    const data = JSON.parse(fs.readFileSync(STICKER_INDEX_PATH, 'utf-8'));
    stickerIndex = data;
    return data;
  } catch (e) {
    console.log(`[sticker] 加载索引失败: ${e.message}`);
    return { stickers: [], suggestions: {} };
  }
}

/**
 * 按情绪检索表情包
 * @param {Object} options
 * @param {string} options.emotion - 情绪（sad/happy/tired/lonely/playful）
 * @param {string} options.intent - 意图（comfort/greet/encourage/goodnight/apologize）
 * @param {Array} options.tags - 搜索标签
 * @returns {Array} 匹配的表情包列表
 */
function searchStickers({ emotion, intent, tags } = {}) {
  const index = loadIndex();
  let results = index.stickers || [];

  if (emotion) {
    results = results.filter(s =>
      s.emotion.some(e => e === emotion)
    );
  }

  if (intent) {
    results = results.filter(s =>
      s.intent.some(i => i === intent)
    );
  }

  if (tags && tags.length > 0) {
    results = results.filter(s =>
      tags.some(t => s.tags.includes(t))
    );
  }

  return results;
}

/**
 * 根据场景建议表情包
 * @param {string} scene - 场景（早安/晚安/安慰/鼓励/想你/开心/道歉/撒娇）
 * @returns {Object|null} 建议的表情包
 */
function suggestForScene(scene) {
  const index = loadIndex();
  const suggestions = index.suggestions || {};
  const ids = suggestions[scene];
  if (!ids || ids.length === 0) return null;

  const allStickers = index.stickers || [];
  const candidates = allStickers.filter(s => ids.includes(s.id));
  if (candidates.length === 0) return null;

  // 随机选一个
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * 检查是否可以发送表情包（频率限制）
 * @param {Object} dailyTracker
 * @returns {boolean}
 */
function canSendSticker(dailyTracker) {
  const state = dailyTracker.getState();
  if (!state.lastPushAt) return true;

  const now = Date.now();
  const lastPush = new Date(state.lastPushAt).getTime();
  const minutesSince = (now - lastPush) / 60000;

  // 10 分钟内最多 2 张（由 push 频率间接控制）
  return minutesSince >= 5;
}

/**
 * 判断是否需要附带表情包
 * @param {string} content - 回复内容
 * @param {Object} context - 上下文
 * @returns {Object|null} { sticker, reason }
 */
function decideSticker(content, context) {
  // 情绪低落时优先安慰类
  if (context.mood === 'sad' || context.mood === 'down') {
    return { sticker: suggestForScene('安慰'), reason: '情绪低落，需要安慰' };
  }

  // 早晚安
  if (content.includes('早安') || context.type === 'morning') {
    return { sticker: suggestForScene('早安'), reason: '早安问候' };
  }
  if (content.includes('晚安') || context.type === 'night') {
    return { sticker: suggestForScene('晚安'), reason: '晚安问候' };
  }

  // 鼓励场景
  if (context.type === 'encourage' || context.type === 'study') {
    return { sticker: suggestForScene('鼓励'), reason: '需要鼓励' };
  }

  // 撒娇/开心
  if (context.mood === 'happy' || context.mood === 'playful') {
    const r = Math.random();
    if (r < 0.4) return { sticker: suggestForScene('开心'), reason: '氛围轻松' };
    if (r < 0.6) return { sticker: suggestForScene('撒娇'), reason: '撒娇一下' };
  }

  return null;
}

module.exports = {
  searchStickers,
  suggestForScene,
  canSendSticker,
  decideSticker,
  loadIndex,
};
