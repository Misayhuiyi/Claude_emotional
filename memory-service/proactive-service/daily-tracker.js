/**
 * Daily Tracker - 每日推送状态跟踪
 *
 * 跟踪当日推送计数、形式记录、总结状态、浪漫计数等。
 * 数据持久化到 data/proactive-state.json，跨日自动重置。
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const STATE_FILE = path.join(config.PATHS.dataDir, 'proactive-state.json');

// ─── 默认状态 ──────────────────────────────────────

function defaultState() {
  const now = new Date();
  return {
    today: dateStr(now),
    pushCount: 0,
    lastPushAt: null,
    lastPushType: null,
    lastPushForm: null,
    last3Forms: [],
    last3Openings: [],
    last3PushContents: [],
    summarySubmitted: false,
    summaryContent: '',
    summaryReminded22: false,
    summaryReminded23: false,
    summaryReminded2330: false,
    lastResponseTime: null,
    weeklyRomanticCount: 0,
    weekStart: getWeekStart(now),
    slotsFired: [],
  };
}

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekStart(d) {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1); // Monday
  copy.setDate(diff);
  return dateStr(copy);
}

// ─── 状态管理 ──────────────────────────────────────

let state = null;

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      // 跨日重置
      const today = dateStr(new Date());
      if (state.today !== today) {
        const oldState = { ...state };
        state = defaultState();
        // 保留跨天跟踪：每周浪漫计数
        const newWeekStart = getWeekStart(new Date());
        if (oldState.weekStart === newWeekStart) {
          state.weeklyRomanticCount = oldState.weeklyRomanticCount || 0;
          state.weekStart = oldState.weekStart;
        }
        saveState();
      }
      // 跨周重置浪漫计数
      const currentWeekStart = getWeekStart(new Date());
      if (state.weekStart !== currentWeekStart) {
        state.weeklyRomanticCount = 0;
        state.weekStart = currentWeekStart;
        saveState();
      }
      return state;
    }
  } catch {}
  state = defaultState();
  saveState();
  return state;
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {}
}

function getState() {
  if (!state) loadState();
  return state;
}

// ─── 公开 API ──────────────────────────────────────

/**
 * 检查当前时间是否在勿扰时段内
 * 勿扰时段：23:30 - 08:30
 */
function isQuietHours(now) {
  const h = now.getHours();
  const m = now.getMinutes();
  const t = h * 100 + m;
  return t >= 2330 || t < 830;
}

/**
 * 综合判断是否可以推送
 */
function canPushNow() {
  const now = new Date();
  const s = getState();

  // 勿扰时间检查
  if (isQuietHours(now)) return { ok: false, reason: '勿扰时段' };

  // 每日上限检查
  if (s.pushCount >= config.PROACTIVE.maxDaily) {
    return { ok: false, reason: `已达每日上限(${config.PROACTIVE.maxDaily}条)` };
  }

  // 最小间隔检查
  if (s.lastPushAt) {
    const elapsed = now.getTime() - new Date(s.lastPushAt).getTime();
    const minGap = config.PROACTIVE.minGapMinutes * 60 * 1000;
    if (elapsed < minGap) {
      const remaining = Math.ceil((minGap - elapsed) / 60000);
      return { ok: false, reason: `距上次推送仅 ${remaining} 分钟，不足 ${config.PROACTIVE.minGapMinutes} 分钟` };
    }
  }

  return { ok: true };
}

/**
 * 记录一次推送
 */
function recordPush(type, form, content) {
  const s = getState();
  s.pushCount++;
  s.lastPushAt = new Date().toISOString();
  s.lastPushType = type;
  s.lastPushForm = form;
  s.last3Forms.push(form);
  if (s.last3Forms.length > 3) s.last3Forms.shift();

  // 记录开头（前 10 个字）
  const opening = content.replace(/[^一-龥a-zA-Z0-9]/g, '').slice(0, 10);
  s.last3Openings.push(opening);
  if (s.last3Openings.length > 3) s.last3Openings.shift();

  // 记录完整内容
  s.last3PushContents.push(content);
  if (s.last3PushContents.length > 3) s.last3PushContents.shift();

  // 浪漫内容计数
  if (type === 'romantic') {
    s.weeklyRomanticCount = (s.weeklyRomanticCount || 0) + 1;
  }

  saveState();
}

/**
 * 标记某个时段已触发
 */
function markSlotFired(slotName) {
  const s = getState();
  if (!s.slotsFired.includes(slotName)) {
    s.slotsFired.push(slotName);
  }
  saveState();
}

/**
 * 检查某个时段是否已触发
 */
function hasSlotFired(slotName) {
  return getState().slotsFired.includes(slotName);
}

/**
 * 记录阿忆的回复时间
 */
function recordResponse() {
  const s = getState();
  s.lastResponseTime = new Date().toISOString();
  saveState();
}

/**
 * 标记今日总结已提交
 */
function markSummarySubmitted(content) {
  const s = getState();
  s.summarySubmitted = true;
  s.summaryContent = content || '';
  saveState();
}

/**
 * 获取本周浪漫内容计数
 */
function getWeeklyRomanticCount() {
  return getState().weeklyRomanticCount || 0;
}

/**
 * 重置每日状态（跨日时自动调用）
 */
function resetDaily() {
  const s = getState();
  s.today = dateStr(new Date());
  s.pushCount = 0;
  s.lastPushAt = null;
  s.lastPushType = null;
  s.lastPushForm = null;
  s.summarySubmitted = false;
  s.summaryContent = '';
  s.summaryReminded22 = false;
  s.summaryReminded23 = false;
  s.summaryReminded2330 = false;
  s.slotsFired = [];
  saveState();
}

module.exports = {
  getState,
  canPushNow,
  recordPush,
  markSlotFired,
  hasSlotFired,
  recordResponse,
  markSummarySubmitted,
  getWeeklyRomanticCount,
  isQuietHours,
  resetDaily,
  saveState,
};
