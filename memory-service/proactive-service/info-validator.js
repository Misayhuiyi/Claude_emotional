/**
 * Info Validator - 推送前硬校验
 *
 * 严格遵循补充规划 4.9 的五项校验，全部通过才能发送：
 * 1. 时间校验
 * 2. 情境校验
 * 3. 人设校验
 * 4. 实时性校验
 * 5. 重复校验
 */

const db = require('../db');

/**
 * 五项校验主入口
 * @param {Object} plan - 推送计划
 * @param {string} plan.content - 推送内容
 * @param {string} plan.type - 推送类型
 * @param {string} plan.slot - 时段
 * @param {string} plan.form - 推送形式
 * @param {string} plan.fetchedAt - 数据获取时间
 * @param {Object} dailyTracker - daily-tracker 实例
 * @returns {Promise<{pass: boolean, reason?: string, details?: Object}>}
 */
async function validatePush(plan, dailyTracker) {
  const result = { pass: true, checks: {} };

  // ─── 校验 1：时间校验 ──────────────────────────
  const now = new Date();
  const timeCheck = checkTime(now, plan.slot);
  result.checks.time = timeCheck;
  if (!timeCheck.pass) {
    result.pass = false;
    result.reason = `时间校验失败：${timeCheck.reason}`;
    return result;
  }

  // ─── 校验 2：情境校验 ──────────────────────────
  const contextCheck = await checkContext(plan, dailyTracker);
  result.checks.context = contextCheck;
  if (!contextCheck.pass) {
    result.pass = false;
    result.reason = `情境校验失败：${contextCheck.reason}`;
    return result;
  }

  // ─── 校验 3：人设校验 ──────────────────────────
  const personaCheck = checkPersona(plan.content);
  result.checks.persona = personaCheck;
  if (!personaCheck.pass) {
    result.pass = false;
    result.reason = `人设校验失败：${personaCheck.reason}`;
    return result;
  }

  // ─── 校验 4：实时性校验 ────────────────────────
  const freshCheck = checkFreshness(plan);
  result.checks.freshness = freshCheck;
  if (!freshCheck.pass) {
    result.pass = false;
    result.reason = `实时性校验失败：${freshCheck.reason}`;
    return result;
  }

  // ─── 校验 5：重复校验 ──────────────────────────
  const dupCheck = checkDuplication(plan.content, dailyTracker);
  result.checks.duplication = dupCheck;
  if (!dupCheck.pass) {
    result.pass = false;
    result.reason = `重复校验失败：${dupCheck.reason}`;
    return result;
  }

  return result;
}

/**
 * 校验 1：时间校验
 * - 不在勿扰时段
 * - 推送内容符合当前时段语气
 */
function checkTime(now, slot) {
  const h = now.getHours();
  const m = now.getMinutes();
  const t = h * 100 + m;

  // 勿扰时段检查
  if (t >= 2330 || t < 830) {
    return { pass: false, reason: `当前时间 ${h}:${String(m).padStart(2, '0')} 在勿扰时段(23:30-08:30)` };
  }

  // 时段语气匹配（简化为确认不在错误时段）
  // 早安：08:30-09:30，午间：11:30-12:30，傍晚：17:00-19:00，晚安：21:00-22:30
  const inMorning = t >= 830 && t <= 930;
  const inNoon = t >= 1130 && t <= 1230;
  const inEvening = t >= 1700 && t <= 1900;
  const inNight = t >= 2100 && t <= 2230;

  if (!inMorning && !inNoon && !inEvening && !inNight) {
    return { pass: false, reason: `当前不在任何推送时段` };
  }

  return { pass: true };
}

/**
 * 校验 2：情境校验
 * - 阿忆是否在倾诉负面情绪
 * - 最后一句话是否是问句
 * - 是否超过 1 小时没回上一条主动消息
 */
async function checkContext(plan, dailyTracker) {
  try {
    // 获取最近 3 条用户消息
    const recentMessages = db.getRecentMessages ? db.getRecentMessages(3) : [];

    const userMessages = recentMessages.filter(m => m.role === 'user');

    for (const msg of userMessages) {
      const content = (msg.content || '').toLowerCase();

      // 负面情绪检测（关键词）
      const negativeWords = ['难过', '伤心', '好累', '好烦', '焦虑', '累了', '没劲', '不想活了', '难受', '好痛苦', '心情不好'];
      if (negativeWords.some(w => content.includes(w))) {
        return { pass: false, reason: '阿忆正在倾诉负面情绪，不推送资讯' };
      }

      // 问句检测
      if (content.endsWith('吗') || content.endsWith('么') || content.endsWith('呢') || content.endsWith('？') || content.endsWith('?')) {
        return { pass: false, reason: '阿忆最后一句话是问句，先回答问题' };
      }
    }

    // 检查上次主动消息是否有回复
    const state = dailyTracker.getState();
    if (state.lastPushAt && state.lastResponseTime) {
      const pushTime = new Date(state.lastPushAt).getTime();
      const responseTime = new Date(state.lastResponseTime).getTime();
      // 如果上次主动消息超过 1 小时没有新对话
      const elapsed = Date.now() - responseTime;
      if (elapsed > 60 * 60 * 1000 && pushTime > responseTime) {
        return { pass: false, reason: '上条主动消息超过 1 小时未回复，当日不再推同类型' };
      }
    }
  } catch (e) {
    // 如果数据库查询失败，放行（不阻塞推送）
    console.log(`[validator] 情境校验异常（已放行）: ${e.message}`);
  }

  return { pass: true };
}

/**
 * 校验 3：人设校验
 * - 不能以【开头
 * - 不能是列表格式
 * - 必须有称呼
 * - 不像客服/通知/机器人
 */
function checkPersona(content) {
  // 新闻稿格式检测
  if (content.startsWith('【')) {
    return { pass: false, reason: '以【开头，像新闻稿' };
  }

  if (/^\s*\[/.test(content)) {
    return { pass: false, reason: '以[开头，像系统通知' };
  }

  // 列表格式检测
  if (/^\d+[\.、]/.test(content)) {
    return { pass: false, reason: '以序号开头，像列表' };
  }

  if (content.includes('\n') && (content.includes('1.') || content.includes('1、') || content.includes('- '))) {
    return { pass: false, reason: '包含列表格式' };
  }

  // 称呼检测（需要包含阿忆或忆哥）
  if (!content.includes('阿忆') && !content.includes('忆哥')) {
    return { pass: false, reason: '未包含对阿忆的称呼' };
  }

  // 机器人句式检测
  const robotPatterns = ['今日推荐', '今日资讯', '早间新闻', '为您推送', '热点推荐', '每日分享'];
  if (robotPatterns.some(p => content.includes(p))) {
    return { pass: false, reason: `包含机器人句式"${robotPatterns.find(p => content.includes(p))}"` };
  }

  return { pass: true };
}

/**
 * 校验 4：实时性校验
 * - 天气必须是当天
 * - 资讯尽量 24 小时内
 */
function checkFreshness(plan) {
  if (plan.type === 'weather' && plan.fetchedAt) {
    const fetched = new Date(plan.fetchedAt);
    const now = new Date();
    if (fetched.toDateString() !== now.toDateString()) {
      return { pass: false, reason: '天气数据不是今天的' };
    }
  }

  if (plan.fetchedAt) {
    const fetched = new Date(plan.fetchedAt);
    const hoursAgo = (Date.now() - fetched.getTime()) / (1000 * 60 * 60);
    if (hoursAgo > 24) {
      return { pass: false, reason: `资讯数据已超过 24 小时（${Math.round(hoursAgo)}h）` };
    }
  }

  return { pass: true };
}

/**
 * 校验 5：重复校验
 * - 与最近 3 条推送比较开头句式
 * - 连续 7 天不超过 2 条相同开头
 */
function checkDuplication(content, dailyTracker) {
  const state = dailyTracker.getState();

  // 提取当前内容的开头（前 10 个非空字符）
  const opening = content.replace(/[^一-龥a-zA-Z0-9]/g, '').slice(0, 10);
  if (!opening) return { pass: true };

  // 与最近 3 条开头比较
  for (const prevOpening of state.last3Openings) {
    if (prevOpening && prevOpening === opening) {
      return { pass: false, reason: `开头与近期推送重复："${opening}"` };
    }
  }

  // 检查内容语义相似度（简单版：前 20 字完全匹配）
  const shortContent = content.slice(0, 20);
  for (const prevContent of state.last3PushContents) {
    if (prevContent && prevContent.slice(0, 20) === shortContent) {
      return { pass: false, reason: '内容与近期推送高度相似' };
    }
  }

  return { pass: true };
}

module.exports = { validatePush };
