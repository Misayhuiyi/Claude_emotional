/**
 * Vision Service - 图片理解服务
 *
 * 接入通义千问 Qwen3-VL-Plus（OpenAI 兼容接口）。
 * 配置方式见 .env.example：
 *   VISION_PROVIDER=qwen
 *   VISION_API_KEY=sk-xxx
 */

require('../env-loader').loadEnv();

const config = require('../config');

const VISION_CONFIG = {
  provider: process.env.VISION_PROVIDER || null,
  apiKey: process.env.VISION_API_KEY || null,
  baseUrl: 'https://ws-za1rwaa7la6ab7n6.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
};

function isVisionAvailable() {
  return !!(VISION_CONFIG.provider && VISION_CONFIG.apiKey);
}

/**
 * 分析图片
 * @param {string} imagePath - 本地图片路径
 * @param {string} imageUrl - 图片 URL（优先）
 * @returns {Promise<Object>}
 */
async function analyzeImage(imagePath, imageUrl) {
  if (!isVisionAvailable()) {
    return {
      summary: null, error: 'vision_not_configured', fallback: true,
      message: '图片已保存，暂时无法自动识别。你跟我说说图里是什么吧？',
    };
  }

  try {
    const result = await analyzeQwenVL(imageUrl || imagePath);
    return result;
  } catch (e) {
    console.log(`[vision] 分析失败: ${e.message}`);
    return {
      summary: null, error: e.message, fallback: true,
      message: '我这边刚刚没能看清，你跟我说说图里是什么，我照样接着你。',
    };
  }
}

/**
 * 通过 Qwen3-VL-Plus OpenAI 兼容接口分析图片
 */
async function analyzeQwenVL(imageSource) {
  // 本地文件转 base64 data URL
  let imageUrl = imageSource;
  if (!imageSource.startsWith('http') && !imageSource.startsWith('data:')) {
    try {
      const fs = require('fs');
      const path = require('path');
      const fullPath = path.resolve(__dirname, '..', '..', imageSource);
      const ext = path.extname(fullPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/webp';
      const base64 = fs.readFileSync(fullPath).toString('base64');
      imageUrl = `data:${mime};base64,${base64}`;
    } catch (e) {
      // 如果读不到本地文件，直接用原路径（可能远程URL）
      console.log(`[vision] 本地文件读取失败: ${e.message}`);
    }
  }

  const url = `${VISION_CONFIG.baseUrl}/chat/completions`;

  const body = {
    model: 'qwen3-vl-plus',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageUrl },
          },
          {
            type: 'text',
            text: '请用简洁的中文描述这张图片的内容、氛围和可能表达的情感，不超过50字。如果图片中有文字，请提取出来。',
          },
        ],
      },
    ],
    stream: false,
    max_tokens: 300,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VISION_CONFIG.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Qwen-VL ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const description = data?.choices?.[0]?.message?.content || '';

  return {
    summary: description,
    objects: extractObjects(description),
    emotion: detectEmotion(description),
    fallback: false,
  };
}

function extractObjects(text) {
  const common = ['电脑', '手机', '书', '水杯', '桌子', '窗户', '人', '猫', '狗', '食物', '风景', '天空', '建筑', '屏幕', '键盘'];
  return common.filter(o => text.includes(o));
}

function detectEmotion(text) {
  if (text.includes('开心') || text.includes('笑') || text.includes('快乐') || text.includes('温馨')) return 'happy';
  if (text.includes('累') || text.includes('疲惫') || text.includes('困')) return 'tired';
  if (text.includes('安静') || text.includes('平静') || text.includes('深夜') || text.includes('宁静')) return 'peaceful';
  if (text.includes('难过') || text.includes('哭') || text.includes('悲伤') || text.includes('忧郁')) return 'sad';
  if (text.includes('严肃') || text.includes('专注') || text.includes('认真')) return 'focused';
  return 'neutral';
}

module.exports = { analyzeImage, isVisionAvailable };
