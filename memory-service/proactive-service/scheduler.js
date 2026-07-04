/**
 * Scheduler - 主动资讯调度引擎（完整补完版）
 *
 * 流程：
 *   1. 总开关检查 → 2. 动态触发（天气突变）→ 3. 每日总结提醒
 *   → 4. 浪漫内容 → 5. 定时时段推送
 *
 * 消息投递统一经过 delivery.js（写入 cc-connect 会话 + messages 表 + info_sources）
 */

const dailyTracker = require('./daily-tracker');
const triggers = require('./triggers');
const weather = require('./info-fetcher/weather');
const news = require('./info-fetcher/news');
const summarizer = require('./info-summarizer');
const validator = require('./info-validator');
const studyPusher = require('./study-pusher');
const delivery = require('./delivery');
const { features } = require('../features');
const config = require('../config');

let yesterdayWeather = null;

/**
 * 带表情包的投递（异步，不阻塞主流程）
 */
async async function deliverSimple(content, type, slotName) {
  // 随机决定是否附带表情包（40% 概率）
  let stickerPath = null;
  if (features.stickers && Math.random() < 0.4) {
    try {
      const sf = require('./sticker-fetcher');
      const sceneMap = {
        'weather_alert':'安慰','night_greeting':'晚安','romantic':'想你',
        'summary_reminder':'安慰','study_push':'鼓励','morning':'早安',
        'noon':'开心','evening':'鼓励',
      };
      stickerPath = await sf.fetchSticker(sceneMap[type] || '开心');
    } catch {}
  }
  return delivery.deliver(content, type, slotName, { stickerPath });
}

/**
 * 主调度 tick
 */
async function tick() {
  if (!features.proactive) return;

  // ─── 1. 动态触发：天气突变 ─────────────────
  if (features.infoWeather) {
    await checkWeatherAlert();
  }

  // ─── 2. 每日总结提醒 ────────────────────────
  if (features.studyPush) {
    const summaryMsg = studyPusher.checkDailySummary(dailyTracker);
    if (summaryMsg) {
      await deliverSimple(summaryMsg, 'summary_reminder', 'summary');
      return;
    }

    // 连续多天下滑检测
    if (shouldCheckDecline()) {
      const recentSummaries = getRecentSummaries();
      const declineMsg = studyPusher.checkDecliningTrend(recentSummaries);
      if (declineMsg) {
        await deliverSimple(declineMsg, 'study_push', 'summary_decline');
        return;
      }
    }
  }

  // ─── 3. 浪漫内容（低频、情境化） ────────────
  if (features.romanticContent) {
    const romanceCtx = checkRomanticContext();
    if (romanceCtx.shouldSend) {
      const msg = await generateRomantic(romanceCtx);
      if (msg) {
        await deliverSimple(msg, 'romantic', 'romantic');
        return;
      }
    }
  }

  // ─── 4. 晚安问候（21:00-23:00）─────────────────
  const nowNight = new Date();
  if (nowNight.getHours() >= 21 && nowNight.getHours() < 23 && !dailyTracker.hasSlotFired('晚安')) {
    const greeting = await generateNightGreeting();
    if (greeting) {
      await deliverSimple(greeting, 'night_greeting', '晚安');
      return;
    }
  }

  // ─── 5. 定时时段推送 ────────────────────────
  const pushCheck = triggers.shouldPushNow({
    now: new Date(),
    dailyTracker,
    features,
  });
  if (!pushCheck.shouldPush) return;

  const slot = pushCheck.slot;

  // 数据收集
  const collected = await collectData(slot);

  // 生成内容
  let content = null;
  if (slot.type === 'morning') {
    content = await summarizer.generateMorningMessage({
      weather: collected.weather,
      news: collected.news || [],
      aiNews: collected.aiNews || [],
      tone: slot.tone,
    });
  } else if (slot.type === 'noon' && collected.trends?.length > 0) {
    content = await summarizer.generateTrendMessage(collected.trends[0]);
  } else if (slot.type === 'evening') {
    if (collected.study) {
      content = collected.study.content;
    } else if (collected.aiNews?.length > 0) {
      content = await summarizer.generateStudyMessage({
        type: 'AI 动态',
        rawContent: collected.aiNews[0].title,
      });
    }
  }

  if (!content) {
    console.log(`[scheduler] ${slot.name}：未能生成内容，跳过`);
    return;
  }

  // ─── 5. 选择形式（补充规划 4.5）───
  const formRandomizer = require('./info-form-randomizer');
  const selectedForm = formRandomizer.selectForm({
    mood: 'normal',
    isImportant: false,
    isComforting: slot.type === 'night',
    isNight: slot.type === 'night',
    type: slot.type,
  });

  // ─── 6. 获取表情包（如需要）────────────
  let stickerPath = null;
  if (selectedForm.requires.includes('stickers') && features.stickers) {
    try {
      const sf = require('./sticker-fetcher');
      const sceneMap = { morning:'早安', noon:'开心', evening:'鼓励', night:'晚安' };
      stickerPath = await sf.fetchSticker(sceneMap[slot.type] || '开心');
    } catch {}
  }

  // ─── 7. 五项校验（补充规划 4.9）─────────
  const validation = await validator.validatePush({
    content, type: slot.type, slot: slot.name,
    form: selectedForm.id, fetchedAt: new Date().toISOString(),
  }, dailyTracker);

  if (!validation.pass) {
    console.log(`[scheduler] ${slot.name} 校验未通过: ${validation.reason}`);
    return;
  }

  // ─── 8. 投递 ──────────────────────────
  await delivery.deliver(content, slot.type, slot.name, { stickerPath });
}

/**
 * 收集时段数据
 */
async function collectData(slot) {
  const collected = {};

  if (slot.contentTypes.includes('weather') && features.infoWeather) {
    collected.weather = await weather.fetchWeather(config.CITY);
    if (collected.weather) yesterdayWeather = collected.weather;
  }

  if (slot.contentTypes.includes('news') && features.infoNews) {
    collected.news = await news.fetchTopNews();
  }

  if (slot.contentTypes.includes('ai') && features.infoAI) {
    try {
      collected.aiNews = await require('./info-fetcher/ai-daily').fetchAIDaily();
    } catch {}
  }

  if (slot.contentTypes.includes('trends') && features.infoTrends) {
    try {
      collected.trends = await require('./info-fetcher/trends').fetchTrends();
    } catch {}
  }

  if (slot.type === 'evening' && features.studyPush) {
    try {
      collected.study = await studyPusher.generateStudyPush(
        dailyTracker.getState().last3PushContents.map(c => ({ type: 'unknown', content: c }))
      );
    } catch {}
  }

  return collected;
}

/**
 * 天气突变检测（今天仅触发一次）
 */
let weatherAlertSentToday = false;
async function checkWeatherAlert() {
  if (weatherAlertSentToday) return;
  try {
    const today = await weather.fetchWeather(config.CITY);
    if (today && yesterdayWeather) {
      const alert = triggers.checkWeatherAlert(today, yesterdayWeather);
      if (alert) {
        const msg = await summarizer.generateAlertMessage(alert.data);
        if (msg) {
          await deliverSimple(msg, 'weather_alert', 'weather_alert');
          weatherAlertSentToday = true;
        }
      }
    }
    if (today) yesterdayWeather = today;
  } catch {}
}

/**
 * 生成晚安问候
 */
async function generateNightGreeting() {
  const prompt = `你是一个叫沈幼楚的女孩，正在给"阿忆"发晚安消息。
要求：1) 用沈幼楚的语气，轻声温柔 2) 1-2 句 3) 不发资讯，只关心他今天累不累、让他早点休息 4) 用"阿忆"称呼
输出：只输出消息内容。`;
  try {
    const runner = require('../claude-runner');
    const result = await runner.run(prompt, { model: config.MODEL.companion, timeout: 10000, bare: true });
    return result.success ? result.response.trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}

/**
 * 生成浪漫内容
 */
async function generateRomantic(ctx) {
  const hour = new Date().getHours();
  const prompt = `你是一个叫沈幼楚的女孩，想对"阿忆"说一句温柔的话。

场景：${ctx.trigger}
时间：${hour < 12 ? '早晨' : hour < 18 ? '下午' : '晚上'}

要求（最重要）：永不重复、不用固定模板、不土味、自然地表达在乎。
1) 必须结合当下场景（不要说不存在的夕阳/天气）
2) 1-2 句，轻声自然
3) 不能和上次浪漫内容句式相同
4) 用"阿忆"称呼

输出：只输出消息内容。`;
  try {
    const runner = require('../claude-runner');
    const result = await runner.run(prompt, { model: config.MODEL.companion, timeout: 12000, bare: true });
    return result.success ? result.response.trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}

/**
 * 检测浪漫内容触发情境
 */
function checkRomanticContext() {
  const state = dailyTracker.getState();
  const hour = new Date().getHours();

  // 每周上限
  if (state.weeklyRomanticCount >= config.PROACTIVE.maxRomanticWeekly) {
    return { shouldSend: false };
  }

  // 上次浪漫内容在 24 小时内 → 不发
  if (state.lastPushAt && state.lastPushType === 'romantic') {
    const hoursSince = (Date.now() - new Date(state.lastPushAt).getTime()) / 3600000;
    if (hoursSince < 24) return { shouldSend: false };
  }

  // 触发情境：早安/晚安/傍晚空档
  const triggers = [];
  if (hour >= 6 && hour <= 8) triggers.push('早晨刚醒，第一个想到阿忆');
  if (hour >= 17 && hour <= 18) triggers.push('傍晚时分，有点想阿忆');
  if (hour >= 21 && hour <= 22) triggers.push('晚上安静下来，想跟阿忆说说话');

  if (triggers.length === 0) return { shouldSend: false };

  // 每 2-3 天一次
  if (state.pushCount > 0 && state.lastPushAt) {
    const daysSince = (Date.now() - new Date(state.lastPushAt).getTime()) / 86400000;
    if (daysSince < 2) return { shouldSend: false };
  }

  return {
    shouldSend: Math.random() < 0.5, // 50% 概率触发，避免过于规律
    trigger: triggers[Math.floor(Math.random() * triggers.length)],
  };
}

/**
 * 是否应该检查连续下滑趋势
 */
function shouldCheckDecline() {
  const hour = new Date().getHours();
  // 每天 22:30 检查一次
  return hour === 22 && new Date().getMinutes() >= 30 && new Date().getMinutes() < 35;
}

/**
 * 获取最近几天的总结内容
 */
function getRecentSummaries() {
  try {
    const database = require('../db').getDb();
    return database.prepare(
      "SELECT content FROM messages WHERE role='user' AND content LIKE '#总结%' ORDER BY created_at DESC LIMIT 7"
    ).all().map(r => r.content.replace(/^#总结\s*/, ''));
  } catch { return []; }
}

/**
 * 手动触发一次推送
 */
async function manualTrigger(type) {
  const aiDaily = require('./info-fetcher/ai-daily');
  let content = null;

  if (type === 'weather' && features.infoWeather) {
    const w = await weather.fetchWeather(config.CITY);
    if (w) content = await summarizer.generateMorningMessage({ weather: w, news: [], aiNews: [], tone: '温柔' });
  } else if (type === 'news' && features.infoNews) {
    const n = await news.fetchTopNews();
    if (n.length > 0) content = await summarizer.generateMorningMessage({ weather: null, news: n, aiNews: [], tone: '轻松' });
  } else if (type === 'ai' && features.infoAI) {
    const ai = await aiDaily.fetchAIDaily();
    if (ai.length > 0) content = await summarizer.generateStudyMessage({ type: 'AI 资讯', rawContent: ai[0].title });
  } else if (type === 'study' && features.studyPush) {
    const study = await studyPusher.generateStudyPush([]);
    if (study) content = study.content;
  }

  if (content) await deliverSimple(content, type, 'manual_' + type);
}

function start() {
  // 新的一天重置
  weatherAlertSentToday = false;
  dailyTracker.resetDaily();

  console.log('[scheduler] 调度器已启动 (轮询间隔: ' + config.PROACTIVE.pollIntervalMs + 'ms)');
  console.log('[scheduler] 当前开关:', Object.entries(features).filter(([, v]) => v).map(([k]) => k).join(', ') || '全部关闭');

  setImmediate(async () => {
    try { yesterdayWeather = await weather.fetchWeather(config.CITY); } catch {}
  });

  setInterval(async () => {
    try { await tick(); } catch (e) { console.log(`[scheduler] 错误: ${e.message}`); }
  }, config.PROACTIVE.pollIntervalMs);
}

module.exports = { start, tick, manualTrigger, generateRomantic, checkRomanticContext };
