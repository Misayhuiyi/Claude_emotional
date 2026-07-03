/**
 * Feature Flags - 所有新能力默认关闭
 *
 * 上线某一模块时，只打开对应开关。
 * 新模块失败时只影响自己，不影响现有 memory_search / memory_write / 文字聊天。
 */
const features = {
  // ─── 多模态 ───────────────────────────────────
  vision: false,         // 图片理解
  voice: false,          // 语音输入（ASR）
  voiceReply: false,     // 语音回复（TTS）
  stickers: false,       // 表情包检索与发送

  // ─── 主动资讯 ─────────────────────────────────
  proactive: true,       // 主动推送总开关
  infoWeather: true,     // 天气推送
  infoNews: true,        // 新闻/热点
  infoTrends: true,      // 网络热梗
  infoAI: true,          // AI 行业资讯
  studyPush: true,       // 学习督促
  romanticContent: true, // 浪漫内容

  // ─── 学习与外部内容 ───────────────────────────
  webLearning: false,    // 主动上网学习
  douyinDigest: false,   // 抖音摘要
};

/**
 * 检查某个 feature 是否启用
 */
function isEnabled(name) {
  return features[name] === true;
}

/**
 * 启用一个 feature（运行时）
 */
function enable(name) {
  if (name in features) features[name] = true;
}

/**
 * 禁用一个 feature（运行时）
 */
function disable(name) {
  if (name in features) features[name] = false;
}

module.exports = { features, isEnabled, enable, disable };
