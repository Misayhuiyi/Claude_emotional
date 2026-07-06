/**
 * Triggers - 推送触发条件判断
 *
 * 严格遵循补充规划 3.1（定时）+ 3.2（动态触发）：
 * - 定时时段检查（早安/午间/傍晚/晚安）
 * - 动态触发（天气突变、重大AI新闻、用户话题跟进）
 */

const config = require('../config');

// 时段随机目标时间缓存（避免每次tick重新计算）
let randomTargets = {};

/**
 * 为某个时段生成随机推送时间（窗口内随机分钟）
 * 例如早安 08:30-09:30 → 可能返回 8:47 或 9:12
 */
function getRandomFireTime(slot) {
  if (randomTargets[slot.name]) return randomTargets[slot.name];

  const [startStr, endStr] = slot.window;
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  // 窗口中间往前 1/3 到后 2/3 范围内随机，避免总在边界
  const range = endMin - startMin;
  const earlyBound = startMin + Math.floor(range * 0.15);
  const lateBound = startMin + Math.floor(range * 0.75);
  const randomMin = Math.floor(Math.random() * (lateBound - earlyBound + 1)) + earlyBound;

  randomTargets[slot.name] = randomMin;
  console.log(`[triggers] ${slot.name} 随机推送时间: ${Math.floor(randomMin/60)}:${String(randomMin%60).padStart(2,'0')} (窗口 ${startStr}-${endStr})`);
  return randomMin;
}

/**
 * 重置随机目标（新的一天）
 */
function resetRandomTargets() {
  randomTargets = {};
}

// ─── 定时时段定义 ──────────────────────────────────

const SLOTS = [
  {
    name: '早安',
    window: ['08:30', '09:30'],
    type: 'morning',
    contentTypes: ['weather', 'news', 'ai'],
    maxItems: 2,
    tone: '轻快、元气',
    desc: '早安资讯包：天气 + 热点 1-2 条 + AI 动态 1 条',
  },
  {
    name: '午间',
    window: ['11:30', '12:30'],
    type: 'noon',
    contentTypes: ['trends'],
    maxItems: 1,
    tone: '轻松、简短',
    desc: '午间轻松：热梗/有趣新闻 1 条',
  },
  {
    name: '傍晚',
    window: ['17:00', '19:00'],
    type: 'evening',
    contentTypes: ['ai', 'study'],
    maxItems: 1,
    tone: '温柔、沉淀',
    desc: '傍晚分享：AI 学习资源/开源项目/技术文章 1 条',
  },
  {
    name: '晚安',
    window: ['21:00', '22:30'],
    type: 'night',
    contentTypes: [],
    maxItems: 0,
    tone: '轻声、安抚',
    desc: '可选晚安：不发资讯，只轻问候',
  },
];

/**
 * 检查当前时间是否在某个时段内
 * @param {Date} now
 * @param {Object} slot - 时段定义
 */
function isInSlot(now, slot) {
  const [startStr, endStr] = slot.window;
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  const h = now.getHours();
  const m = now.getMinutes();
  const current = h * 60 + m;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return current >= start && current <= end;
}

/**
 * 获取当前命中的时段列表
 * @param {Date} now
 */
function getCurrentSlots(now) {
  return SLOTS.filter(slot => isInSlot(now, slot));
}

/**
 * 根据时段选择合适的语气
 */
function getToneForSlot(slotType) {
  const slot = SLOTS.find(s => s.type === slotType);
  return slot ? slot.tone : '温柔';
}

/**
 * 动态触发：检查天气突变
 * @param {Object} todayWeather
 * @param {Object|null} yesterdayWeather
 * @returns {Object|null}
 */
function checkWeatherAlert(todayWeather, yesterdayWeather) {
  if (!todayWeather || !yesterdayWeather) return null;
  if (todayWeather.fallback || yesterdayWeather.fallback) return null;

  if (todayWeather.maxTemp != null && yesterdayWeather.maxTemp != null) {
    const drop = yesterdayWeather.maxTemp - todayWeather.maxTemp;
    if (drop > 5) {
      return {
        type: 'weather_alert',
        priority: 'high',
        data: { alertType: 'cold', detail: `比昨天降了${drop.toFixed(1)}°C` },
      };
    }
  }

  if (todayWeather.rainProb != null && todayWeather.rainProb > 70) {
    return {
      type: 'weather_alert',
      priority: 'high',
      data: { alertType: 'rain', detail: `降雨概率 ${todayWeather.rainProb}%` },
    };
  }

  return null;
}

/**
 * 检查是否应该在当前时机推送（含随机化）
 * @param {Object} options
 * @param {Date} options.now
 * @param {Object} options.dailyTracker - daily-tracker 实例
 * @param {Object} options.features - features 对象
 * @returns {Object} { shouldPush, slot, reason }
 */
function shouldPushNow({ now = new Date(), dailyTracker, features }) {
  // 总开关
  if (!features.proactive) {
    return { shouldPush: false, reason: '总开关未开启' };
  }

  // 综合状态检查
  const canPush = dailyTracker.canPushNow();
  if (!canPush.ok) {
    return { shouldPush: false, reason: canPush.reason };
  }

  const currentMin = now.getHours() * 60 + now.getMinutes();

  // 检查各时段
  const slots = getCurrentSlots(now);
  for (const slot of slots) {
    // 晚安时段不发资讯
    if (slot.type === 'night') continue;

    // 检查该时段是否已推送
    if (dailyTracker.hasSlotFired(slot.name)) continue;

    // 检查对应 feature 是否开启
    const hasContent = slot.contentTypes.some(ct => {
      const featureMap = {
        weather: 'infoWeather',
        news: 'infoNews',
        trends: 'infoTrends',
        ai: 'infoAI',
        study: 'studyPush',
      };
      return features[featureMap[ct]];
    });
    if (!hasContent) continue;

    // 随机化：只在这个时段的随机目标时间之后才推送
    const targetMin = getRandomFireTime(slot);
    if (currentMin < targetMin) {
      const wait = targetMin - currentMin;
      if (wait % 5 === 0 || wait < 3) { // 每5分钟或最后3分钟才日志
        console.log(`[triggers] ${slot.name} 等待随机推送时间（还剩 ${wait} 分钟）`);
      }
      continue;
    }

    return { shouldPush: true, slot, reason: `时段：${slot.name}` };
  }

  return { shouldPush: false, reason: '无待推送时段' };
}

module.exports = {
  SLOTS,
  isInSlot,
  getCurrentSlots,
  getToneForSlot,
  checkWeatherAlert,
  shouldPushNow,
  resetRandomTargets,
};
