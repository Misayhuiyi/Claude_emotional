/**
 * Vision Service - 图片理解服务
 *
 * 严格遵循最终方案第 3 节（图片理解：DeepSeek 项目的正确做法）：
 * - 旁路视觉模型（Qwen-VL / GLM-4V / 豆包视觉 / Kimi 视觉）
 * - 生成结构化图片摘要
 * - 图片摘要以普通 message 形式进入 Memory Gate
 * - 视觉模型失败时降级为文字兜底
 *
 * 注意：需要视觉 API Key，未配置时自动降级。
 */

const config = require('../config');

// 视觉 API 配置（用户需自行填入）
let VISION_CONFIG = {
  provider: null,      // 'qwen' | 'glm' | 'doubao' | 'kimi' | null
  apiKey: null,
  endpoint: null,
};

/**
 * 配置视觉 API
 */
function configureVision(provider, apiKey, endpoint) {
  VISION_CONFIG.provider = provider;
  VISION_CONFIG.apiKey = apiKey;
  VISION_CONFIG.endpoint = endpoint;
}

/**
 * 检查视觉能力是否可用
 */
function isVisionAvailable() {
  return !!(VISION_CONFIG.provider && VISION_CONFIG.apiKey);
}

/**
 * 分析图片并生成结构化摘要
 * @param {string} imagePath - 图片本地路径
 * @param {string} imageUrl - 图片 URL（可选，优先使用）
 * @returns {Promise<Object>} 结构化摘要
 */
async function analyzeImage(imagePath, imageUrl) {
  if (!isVisionAvailable()) {
    return {
      summary: null,
      error: 'vision_not_configured',
      fallback: true,
      message: '图片已保存，暂时无法自动识别。你跟我说说图里是什么吧？',
    };
  }

  try {
    // 根据 provider 调用对应 API
    switch (VISION_CONFIG.provider) {
      case 'qwen':
        return await analyzeQwenVL(imagePath, imageUrl);
      case 'glm':
        return await analyzeGLM4V(imagePath, imageUrl);
      case 'doubao':
        return await analyzeDoubao(imagePath, imageUrl);
      case 'kimi':
        return await analyzeKimi(imagePath, imageUrl);
      default:
        return { summary: null, error: 'unknown_provider', fallback: true };
    }
  } catch (e) {
    console.log(`[vision] 分析失败: ${e.message}`);
    return {
      summary: null,
      error: e.message,
      fallback: true,
      message: '我这边刚刚没能看清，你跟我说说图里是什么，我照样接着你。',
    };
  }
}

/**
 * 通过 Qwen-VL API 分析图片
 */
async function analyzeQwenVL(imagePath, imageUrl) {
  const url = VISION_CONFIG.endpoint || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VISION_CONFIG.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen-vl-plus',
      input: {
        messages: [
          {
            role: 'user',
            content: [
              { image: imageUrl || `file://${imagePath}` },
              { text: '请用简洁的中文描述这张图片的内容、氛围和可能的情感，不超过 50 字。' },
            ],
          },
        ],
      },
    }),
  });

  if (!res.ok) throw new Error(`Qwen-VL ${res.status}`);
  const data = await res.json();
  const description = data?.output?.choices?.[0]?.message?.content?.[0]?.text || '';

  return {
    summary: description,
    objects: extractObjects(description),
    emotion: detectEmotion(description),
    fallback: false,
  };
}

/**
 * 通过 GLM-4V API 分析图片（预留）
 */
async function analyzeGLM4V(imagePath, imageUrl) {
  // GLM-4V API 接入（用户配置后生效）
  throw new Error('GLM-4V 未配置');
}

/**
 * 通过豆包视觉 API 分析图片（预留）
 */
async function analyzeDoubao(imagePath, imageUrl) {
  throw new Error('豆包视觉 未配置');
}

/**
 * 通过 Kimi 视觉 API 分析图片（预留）
 */
async function analyzeKimi(imagePath, imageUrl) {
  throw new Error('Kimi 视觉 未配置');
}

/**
 * 简易物体提取
 */
function extractObjects(text) {
  const common = ['电脑', '手机', '书', '水杯', '桌子', '窗户', '人', '猫', '狗', '食物', '风景', '天空', '建筑'];
  return common.filter(o => text.includes(o));
}

/**
 * 简易情绪检测
 */
function detectEmotion(text) {
  if (text.includes('开心') || text.includes('笑') || text.includes('快乐')) return 'happy';
  if (text.includes('累') || text.includes('疲惫') || text.includes('困')) return 'tired';
  if (text.includes('安静') || text.includes('平静') || text.includes('深夜')) return 'peaceful';
  if (text.includes('难过') || text.includes('哭') || text.includes('悲伤')) return 'sad';
  return 'neutral';
}

module.exports = { analyzeImage, configureVision, isVisionAvailable };
