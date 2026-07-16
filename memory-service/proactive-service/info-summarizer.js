/**
 * Info Summarizer - 沈幼楚化改写引擎（随机化增强版）
 *
 * 核心改进：每次生成随机选择语气风格，杜绝重复模板感
 */

const claudeRunner = require('../claude-runner');
const config = require('../config');
const dailyTracker = require('./daily-tracker');

// ─── 随机风格池 ─────────────────────────────────

const STYLES = [
  '温柔关心型：轻声细语，像在你耳边说话',
  '活泼元气型：语气轻快，带点可爱的小激动',
  '慵懒撒娇型：懒懒的、黏黏的，像刚睡醒在跟你说话',
  '认真在意型：语气认真但不沉重，像真的在想你',
  '随意聊天型：像随手发的一条消息，不刻意不正式',
  '小小傲娇型：带一点点傲娇，说完又软下来的那种',
];

const OPENINGS = [
  '自然的打招呼式开头',
  '带着一点小发现的开头，比如"诶"、"你猜我今天看到什么"',
  '直接说天气/资讯，像是顺着之前的话题',
  '先问一句再说的方式',
  '用表情或语气词轻轻开头，比如"唔"、"嗯"、"啊对了"',
];

function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/**
 * 读最近几条推送的摘要，用作去重参考
 */
function getRecentContext() {
  try {
    const state = dailyTracker.getState();
    const recent = state.last3PushContents || [];
    if (recent.length > 0) {
      return `你最近发的几条消息是：\n${recent.map((c, i) => `${i + 1}. ${c.slice(0, 60)}`).join('\n')}\n\n注意：这次的消息不能和上面任何一条雷同，开头、句式、语气都要有明显区别。`;
    }
  } catch {}
  return '';
}

// ─── 各类消息生成 ─────────────────────────────

async function generateMorningMessage(data) {
  const style = randomPick(STYLES);
  const opening = randomPick(OPENINGS);
  const recentCtx = getRecentContext();

  const weatherDesc = data.weather
    ? `${data.weather.city} ${data.weather.description}，${data.weather.temp}°C（高${data.weather.maxTemp}°C/低${data.weather.minTemp}°C）`
    : '';
  const newsTitle = data.news?.[0]?.title || '';
  const aiTitle = data.aiNews?.[0]?.title || '';

  const prompt = `你叫沈幼楚，正在给"阿忆"发早安消息。

${weatherDesc ? `天气：${weatherDesc}` : ''}
${newsTitle ? `热点：${newsTitle}` : ''}
${aiTitle ? `AI动态：${aiTitle}` : ''}

你的语气风格：${style}
开头方式：${opening}
${recentCtx}
核心规则：
- 像真实的人在微信上说话，不要像新闻播报、不要像系统通知
- 资讯只提1-2句就够，重点是"你在跟他说"不是"你在播报"
- 必须有人的视角——你的感受、你的关心、你的好奇
- 2-4句，留个自然的互动空间
- 和最近几条消息的开头方式、句式彻底不同
- 不要列点、不要【】、不要"今日xx"模板

输出：只输出消息文本。`;

  return await callSummarizer(prompt);
}

async function generateStudyMessage(data) {
  const style = randomPick(STYLES);
  const recentCtx = getRecentContext();

  const prompt = `你叫沈幼楚，在微信上跟"阿忆"聊天。你想分享一个学到的知识点给他。

类型：${data.type}
内容：${data.rawContent}

你的语气：${style}
${recentCtx}
规则：
- 用你自己的话（人话）解释技术内容，像"诶你知道吗"这样
- 不要"今天的学习内容来啦"、"每日一题"、"知识点来咯"之类的固定句式
- 每条开头和表达方式都要不一样
- 3-5句，轻轻结尾
- 不要列点、不要【】、不要序号

输出：只输出消息文本。`;

  // 去重检查：如果生成的内容跟最近推送的相似，跳过
  if (content) {
    const isDuplicate = recentPushCache.some(cached => 
      content.slice(0, 30) === cached.slice(0, 30)
    );
    if (isDuplicate) {
      console.log('[summarizer] 内容与近期推送重复，跳过' + content.slice(0, 40));
      return null;
    }
    recentPushCache.push(content);
    if (recentPushCache.length > 5) recentPushCache.shift();
  }
  return await callSummarizer(prompt);
}

async function generateTrendMessage(data) {
  const style = randomPick(STYLES);
  const recentCtx = getRecentContext();

  const prompt = `你叫沈幼楚，在微信上跟"阿忆"聊天。你发现了一个有趣的事想分享给他。

热梗：${data.title}

你的语气：${style}
${recentCtx}
规则：
- 像真的发现了一个好玩的东西想告诉他
- 口语化、自然、不用太夸张
- 2-3句
- 不要"今日热梗"、"今天的热搜"等模板

输出：只输出消息文本。`;

  return await callSummarizer(prompt);
}

async function generateAlertMessage(alert) {
  const style = randomPick(STYLES.filter(s => s.includes('温柔') || s.includes('随意') || s.includes('认真')));
  const recentCtx = getRecentContext();
  const hour = new Date().getHours();
  const timeHint = hour < 10 ? '早上' : hour < 14 ? '中午' : hour < 19 ? '下午' : '晚上';

  const prompt = `你叫沈幼楚，${timeHint}了，在微信上跟"阿忆"聊天。你发现天气有变化，想随口提一下。

天气：${alert.detail}

你的语气：${style}
${recentCtx}
规则：
- 像随手发的一条微信，不要像天气预报通知
- "诶"、"话说"、"我看着外面"——自然开头
- 带关心但不夸张
- 1-2句
- 和最近几条消息的表达方式不能雷同

好的例子：
  "阿忆，我看着窗外好像要下雨了诶，你今天出门带伞了吗？"
  "忆哥，你那边有没有下雨呀，我这边天阴下来了——带伞了吗？"

输出：只输出消息文本。`;

  return await callSummarizer(prompt);
}

/**
 * 生成晚安问候
 */
async function generateNightGreeting() {
  const style = randomPick(STYLES.filter(s => s.includes('温柔') || s.includes('慵懒') || s.includes('随意')));
  const recentCtx = getRecentContext();

  const prompt = `你叫沈幼楚，夜深了，想跟"阿忆"说晚安。

你的语气：${style}
${recentCtx}

规则：
- 轻声、简短、温柔
- 1-2句
- 不要每天同样的"晚安阿忆"——每次换一种方式
- 可以是问他今天累不累，可以是直接说晚安
- 和最近几条消息的感觉不能一样

输出：只输出消息文本。`;

  return await callSummarizer(prompt);
}

// ─── 调用 DeepSeek ────────────────────────────

async function callSummarizer(prompt) {
  try {
    const result = await claudeRunner.run(prompt, {
      model: config.MODEL.companion,
      timeout: 15000,
      bare: true,
    });
    if (result.success && result.response) {
      return result.response.trim().replace(/^[""']|[""']$/g, '').trim();
    }
    return null;
  } catch (e) {
    console.log(`[summarizer] 改写失败: ${e.message}`);
    return null;
  }
}

module.exports = {
  generateMorningMessage,
  generateStudyMessage,
  generateTrendMessage,
  generateAlertMessage,
  generateNightGreeting,
};
