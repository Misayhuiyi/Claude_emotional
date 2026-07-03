/**
 * Scheduler - 主动资讯调度引擎（完整版）
 *
 * 运行方式：由 proactive-main.js 启动，10 秒轮询。
 *
 * 流程：
 *   1. 检查总开关 && 各 feature 开关
 *   2. 检查勿扰时间/每日上限/最小间隔
 *   3. 检查动态触发（天气突变、重大AI新闻）
 *   4. 检查学习督促（每日总结提醒）
 *   5. 检查定时时段（早安/午间/傍晚/晚安）
 *   6. 收集数据 → 改写 → 校验 → 投递
 */

const dailyTracker = require('./daily-tracker');
const triggers = require('./triggers');
const weather = require('./info-fetcher/weather');
const news = require('./info-fetcher/news');
const summarizer = require('./info-summarizer');
const validator = require('./info-validator');
const studyPusher = require('./study-pusher');
const { features } = require('../features');
const config = require('../config');
const db = require('../db');

// 缓存的昨日天气（用于突变检测）
let yesterdayWeather = null;

/**
 * 执行一次调度检查（完整版）
 */
async function tick() {
  // 总开关
  if (!features.proactive) return;

  // ─── 1. 检查每日总结提醒 ─────────────────────
  if (features.studyPush) {
    const summaryMsg = studyPusher.checkDailySummary(dailyTracker);
    if (summaryMsg) {
      await deliverContent(summaryMsg, 'study_push', 'summary_reminder');
      return;
    }
  }

  // ─── 2. 检查定时时段推送 ─────────────────────
  const pushCheck = triggers.shouldPushNow({
    now: new Date(),
    dailyTracker,
    features,
  });

  if (!pushCheck.shouldPush) return;

  const slot = pushCheck.slot;

  // ─── 3. 数据收集 ─────────────────────────────
  const collected = {};

  if (slot.contentTypes.includes('weather') && features.infoWeather) {
    collected.weather = await weather.fetchWeather(config.CITY);
    if (collected.weather) {
      yesterdayWeather = collected.weather;
    }
  }

  if (slot.contentTypes.includes('news') && features.infoNews) {
    collected.news = await news.fetchTopNews();
  }

  if (slot.contentTypes.includes('ai') && features.infoAI) {
    try {
      const aiDaily = require('./info-fetcher/ai-daily');
      collected.aiNews = await aiDaily.fetchAIDaily();
    } catch (e) {
      console.log(`[scheduler] AI 资讯获取失败: ${e.message}`);
    }
  }

  if (slot.contentTypes.includes('trends') && features.infoTrends) {
    try {
      const trends = require('./info-fetcher/trends');
      collected.trends = await trends.fetchTrends();
    } catch (e) {
      console.log(`[scheduler] 热梗获取失败: ${e.message}`);
    }
  }

  if (slot.type === 'evening' && features.studyPush) {
    try {
      const history = dailyTracker.getState().last3PushContents.map(c => ({ type: 'unknown', content: c }));
      const studyPush = await studyPusher.generateStudyPush(history);
      if (studyPush) {
        collected.study = studyPush;
      }
    } catch (e) {
      console.log(`[scheduler] 学习内容生成失败: ${e.message}`);
    }
  }

  // ─── 4. 生成内容 ─────────────────────────────
  let content = null;

  if (slot.type === 'morning') {
    content = await summarizer.generateMorningMessage({
      weather: collected.weather,
      news: collected.news || [],
      aiNews: collected.aiNews || [],
      tone: slot.tone,
    });
  } else if (slot.type === 'noon' && collected.trends && collected.trends.length > 0) {
    content = await summarizer.generateTrendMessage(collected.trends[0]);
  } else if (slot.type === 'evening') {
    if (collected.study) {
      content = collected.study.content;
    } else if (collected.aiNews && collected.aiNews.length > 0) {
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

  // ─── 5. 选择形式 ─────────────────────────────
  const formRandomizer = require('./info-form-randomizer');
  const form = formRandomizer.selectForm({
    mood: 'normal',
    isImportant: false,
    isComforting: false,
    isNight: slot.type === 'night',
    type: slot.type,
  });

  // ─── 6. 五项校验 ─────────────────────────────
  const validation = await validator.validatePush(
    {
      content,
      type: slot.type,
      slot: slot.name,
      form: form.id,
      fetchedAt: new Date().toISOString(),
    },
    dailyTracker,
  );

  if (!validation.pass) {
    console.log(`[scheduler] ${slot.name} 校验未通过: ${validation.reason}`);
    return;
  }

  // ─── 7. 投递 ─────────────────────────────────
  await deliverContent(content, slot.type, slot.name);
}

/**
 * 投递内容到微信
 */
async function deliverContent(content, type, slotName) {
  const msgId = db.generateId('msg_');
  db.insertMessage({
    id: msgId,
    role: 'assistant',
    content: content,
    source: 'proactive',
    platform: 'proactive-service',
    conversationId: 'proactive_' + slotName,
  });

  dailyTracker.recordPush(type, 'text_only', content);
  dailyTracker.markSlotFired(slotName);

  // 写入 info_sources 表
  try {
    const database = db.getDb();
    const infoId = 'info_' + Date.now().toString(36);
    database.prepare(`
      INSERT INTO info_sources (id, source_type, title, summary, delivered, created_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `).run(infoId, type, content.slice(0, 50), content.slice(0, 200));
  } catch {}

  console.log(`[scheduler] ✅ ${slotName} 推送成功: ${content.slice(0, 60)}...`);
}

/**
 * 检查并处理动态触发
 */
async function checkDynamicTriggers() {
  // 天气突变检测
  if (features.infoWeather) {
    try {
      const todayWeather = await weather.fetchWeather(config.CITY);
      if (todayWeather && yesterdayWeather) {
        const alert = triggers.checkWeatherAlert(todayWeather, yesterdayWeather);
        if (alert) {
          const alertContent = await summarizer.generateAlertMessage(alert.data);
          if (alertContent) {
            await deliverContent(alertContent, 'weather_alert', 'weather_alert');
          }
        }
      }
      if (todayWeather) yesterdayWeather = todayWeather;
    } catch (e) {
      console.log(`[scheduler] 天气检测错误: ${e.message}`);
    }
  }
}

/**
 * 手动触发一次推送（用于 MCP 工具的 proactive_trigger）
 * @param {string} type - 推送类型 weather/news/ai/study
 */
async function manualTrigger(type) {
  const aiDaily = require('./info-fetcher/ai-daily');
  const trends = require('./info-fetcher/trends');

  let content = null;

  if (type === 'weather' && features.infoWeather) {
    const w = await weather.fetchWeather(config.CITY);
    if (w) {
      content = await summarizer.generateMorningMessage({
        weather: w,
        news: [],
        aiNews: [],
        tone: '温柔',
      });
    }
  } else if (type === 'news' && features.infoNews) {
    const n = await news.fetchTopNews();
    if (n.length > 0) {
      content = await summarizer.generateMorningMessage({
        weather: null,
        news: n,
        aiNews: [],
        tone: '轻松',
      });
    }
  } else if (type === 'ai' && features.infoAI) {
    const ai = await aiDaily.fetchAIDaily();
    if (ai.length > 0) {
      content = await summarizer.generateStudyMessage({
        type: 'AI 资讯',
        rawContent: ai[0].title + (ai[0].summary ? ': ' + ai[0].summary : ''),
      });
    }
  } else if (type === 'study' && features.studyPush) {
    const study = await studyPusher.generateStudyPush([]);
    if (study) content = study.content;
  }

  if (content) {
    await deliverContent(content, type, 'manual_' + type);
  }
}

/**
 * 启动调度器
 */
function start() {
  console.log('[proactive] 调度器已启动 (轮询间隔: ' + config.PROACTIVE.pollIntervalMs + 'ms)');
  console.log('[proactive] 当前开关:',
    Object.entries(features)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || '全部关闭'
  );

  // 首次加载昨日天气缓存
  setImmediate(async () => {
    try {
      const w = await weather.fetchWeather(config.CITY);
      if (w) yesterdayWeather = w;
    } catch {}
  });

  // 每 10 秒轮询
  setInterval(async () => {
    try {
      await checkDynamicTriggers();
      await tick();
    } catch (e) {
      console.log(`[scheduler] 错误: ${e.message}`);
    }
  }, config.PROACTIVE.pollIntervalMs);
}

module.exports = { start, tick, manualTrigger };
