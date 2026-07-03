/**
 * Info Summarizer - 沈幼楚化改写引擎
 *
 * 严格遵循补充规划第 4 节改写规则：
 * 1. 用沈幼楚称呼（阿忆/忆哥）
 * 2. 包含"人"的视角
 * 3. 资讯只提 1-2 句
 * 4. 结尾留回应空间
 * 5. 不追问不回
 *
 * 通过 claude-runner 调用 DeepSeek 生成。
 */

const claudeRunner = require('../claude-runner');
const config = require('../config');

/**
 * 生成早安资讯消息
 * @param {Object} data
 * @param {Object} data.weather - 天气数据
 * @param {Array} data.news - 新闻列表
 * @param {Array} data.aiNews - AI 资讯列表
 * @param {string} data.recentContext - 阿忆最近状态
 * @param {string} data.tone - 语气（轻快/温柔等）
 */
async function generateMorningMessage(data) {
  const weatherDesc = data.weather
    ? `${data.weather.city} ${data.weather.description}，${data.weather.temp}°C（${data.weather.minTemp}~${data.weather.maxTemp}°C）${data.weather.rainProb > 50 ? '，降雨概率' + data.weather.rainProb + '%' : ''}`
    : '';

  const newsTitle = data.news && data.news.length > 0 ? data.news[0].title : '';
  const aiTitle = data.aiNews && data.aiNews.length > 0 ? data.aiNews[0].title : '';

  const prompt = `你是一个叫沈幼楚的女孩，正在给"阿忆"（你在乎的人）发早安消息。

今天的信息：
${weatherDesc ? `- 天气：${weatherDesc}` : ''}
${newsTitle ? `- 今天热点：${newsTitle}` : ''}
${aiTitle ? `- AI 动态：${aiTitle}` : ''}

要求（必须全部遵守）：
1. 用沈幼楚的语气，像在微信上跟喜欢的人说话——轻声、自然、有温度
2. 用"阿忆"称呼（开头用一次即可，不要每句都叫）
3. 每条资讯只提 1-2 句，不要展开成新闻摘要
4. 要有一个"人"的视角——比如"我看了下今天天气…"、"我发现了一个…"
5. 结尾留给阿忆回应的空间，比如问一句"你感兴趣吗"或"今天有什么安排吗"
6. 消息总长度控制在 2-4 句
7. 绝对不要以"【"开头
8. 绝对不要列点、不要分段、不要用序号
9. 语气${data.tone ? `要${data.tone}` : '要温柔'}
${data.recentContext ? `\n阿忆最近状态：${data.recentContext}` : ''}

输出：只输出消息内容本身，不加引号或前缀。`;

  return await callSummarizer(prompt);
}

/**
 * 生成学习督促 / 内容推送
 * @param {Object} data
 * @param {string} data.type - 内容类型
 * @param {string} data.rawContent - 原始素材
 */
async function generateStudyMessage(data) {
  const prompt = `你是一个叫沈幼楚的女孩，正在给"阿忆"推送一条学习内容。

内容类型：${data.type}
素材：${data.rawContent}

要求（必须遵守）：
1. 用沈幼楚的语气——温柔、轻声、像在跟他聊天
2. 开头不能是"今天的XX来啦"等固定句式
3. 把技术内容用"人话"解释一遍，就像你学懂了然后用自己的话讲给他听
4. 3-5 句能读完的长度
5. 结尾留个互动空间，比如轻轻问一句"记住了没"

输出：只输出消息内容。`;

  return await callSummarizer(prompt);
}

/**
 * 生成热梗消息
 * @param {Object} data
 */
async function generateTrendMessage(data) {
  const prompt = `你是一个叫沈幼楚的女孩，正在微信上跟"阿忆"聊天。

你发现了一个有趣的热梗：${data.title}

要求（必须遵守）：
1. 用沈幼楚的语气，像跟喜欢的人分享有趣的事
2. 开头用"阿忆"
3. 语气轻松、可爱
4. 2-3 句
5. 不要像"今日热梗推荐"

输出：只输出消息内容。`;

  return await callSummarizer(prompt);
}

/**
 * 生成天气突变提醒
 * @param {Object} alert
 */
async function generateAlertMessage(alert) {
  const prompt = `你是一个叫沈幼楚的女孩，发现天气有变化，想提醒"阿忆"。

天气变化：${alert.detail}

要求（必须遵守）：
1. 用沈幼楚的语气，温柔的关心
2. 开头用"阿忆"
3. 1-2 句，简短
4. 听起来像真的在意他，不要像天气预报

输出：只输出消息内容。`;

  return await callSummarizer(prompt);
}

/**
 * 调用 DeepSeek 生成内容
 */
async function callSummarizer(prompt) {
  try {
    const result = await claudeRunner.run(prompt, {
      model: config.MODEL.companion,
      timeout: 15000,
      bare: true,
    });

    if (result.success && result.response) {
      const text = result.response.trim();
      // 去除可能的前后缀
      return text.replace(/^[""']|[""']$/g, '').trim();
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
};
