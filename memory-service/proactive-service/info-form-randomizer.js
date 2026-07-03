/**
 * Form Randomizer - 推送形式随机选择
 *
 * 严格遵循补充规划 4.5：
 * - 形式池与比例：纯文字 40%、文字+表情包 30%、文字+语音 15%、
 *   表情包+短文字 10%、纯表情包 5%
 * - 连续 3 次不重复同一种形式
 * - 情境适配：安抚/重要提醒/晚安等优先特定形式
 *
 * 依赖 sticker-service 和 voice-service 就绪后启用。
 */

const { features } = require('../features');
const dailyTracker = require('./daily-tracker');

// ─── 形式池（补充规划 4.5）────────────────────

const FORMS = [
  { id: 'text_only',     label: '纯文字',        weight: 40, requires: [] },
  { id: 'text_sticker',  label: '文字+表情包',    weight: 30, requires: ['stickers'] },
  { id: 'text_voice',    label: '文字+语音',      weight: 15, requires: ['voice'] },
  { id: 'sticker_short', label: '表情包+短文字',  weight: 10, requires: ['stickers'] },
  { id: 'sticker_only',  label: '纯表情包',       weight: 5,  requires: ['stickers'] },
];

/**
 * 加权随机选择
 */
function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let rand = Math.random() * totalWeight;

  for (const item of items) {
    rand -= item.weight;
    if (rand <= 0) return item;
  }

  return items[items.length - 1];
}

/**
 * 选择推送形式
 * @param {Object} context - 当前上下文
 * @param {string} context.mood - 情绪（normal/happy/down/anxious）
 * @param {boolean} context.isImportant - 是否重要提醒
 * @param {boolean} context.isComforting - 是否安抚场景
 * @param {boolean} context.isNight - 是否夜间
 * @param {string} context.type - 推送类型（morning/noon/evening/night/weather_alert/study）
 * @returns {Object} 选中的形式
 */
function selectForm(context) {
  const state = dailyTracker.getState();

  // 可用能力检查
  const available = FORMS.filter(f =>
    f.requires.every(r => features[r] === true)
  );

  // 如果没有任何多模态能力，直接返回纯文字
  if (available.length === 0) return FORMS[0];

  // ─── 情境优先逻辑（补充规划 4.5 选择逻辑）───

  // 安抚场景 → 优先表情包+短文字或语音
  if (context.isComforting) {
    if (features.voice && Math.random() < 0.5) {
      return available.find(f => f.id === 'text_voice') || available[0];
    }
    return available.find(f => f.id === 'sticker_short') ||
           available.find(f => f.id === 'sticker_only') ||
           available[0];
  }

  // 重要提醒（考试、面试）→ 文字+表情包
  if (context.isImportant) {
    return available.find(f => f.id === 'text_sticker') || available[0];
  }

  // 晚安（22:00 后）→ 语音优先
  if (context.isNight && context.type === 'night') {
    if (features.voice) {
      return available.find(f => f.id === 'text_voice') || available[0];
    }
  }

  // ─── 连续 3 次不重复同一种形式 ─────────────
  const last3Forms = state.last3Forms || [];

  // 检查是否连续 3 次都是同一形式
  const allSame = last3Forms.length >= 3 &&
    last3Forms.every(f => f === last3Forms[0]);

  let candidates = available;
  if (allSame) {
    // 排除最近一次的形式
    const lastForm = last3Forms[last3Forms.length - 1];
    candidates = available.filter(f => f.id !== lastForm);
    if (candidates.length === 0) candidates = available;
  }

  // ─── 按权重随机选择 ─────────────────────────
  return weightedRandom(candidates);
}

/**
 * 获取可用的多模态形式列表（用于调试/状态查询）
 */
function getAvailableForms() {
  return FORMS.filter(f =>
    f.requires.every(r => features[r] === true)
  ).map(f => f.id);
}

module.exports = { selectForm, getAvailableForms, FORMS };
