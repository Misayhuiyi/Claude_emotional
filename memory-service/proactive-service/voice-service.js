/**
 * Voice Service - 语音互发服务
 *
 * 严格遵循最终方案第 4 节（语音互发）：
 * - 语音输入：ASR 转文字
 * - 语音回复：TTS 合成语音
 * - 默认不发长语音，每条不超过 20 秒
 * - 发送失败时自动降级为文字
 *
 * 配置方式：在项目根目录创建 .env 文件（参见 .env.example）
 *   ASR_PROVIDER=whisper / azure / aliyun
 *   ASR_API_KEY=sk-xxx
 *   TTS_PROVIDER=azure / aliyun / elevenlabs
 *   TTS_API_KEY=xxx
 *   TTS_REGION=eastasia
 */

require('../env-loader').loadEnv();

const fs = require('fs');
const path = require('path');
const config = require('../config');

const VOICE_REPLIES_DIR = path.join(config.PATHS.dataDir, 'media', 'voices', 'replies');
fs.mkdirSync(VOICE_REPLIES_DIR, { recursive: true });

// 从环境变量读取配置
const VOICE_CONFIG = {
  asrProvider: process.env.ASR_PROVIDER || null,
  ttsProvider: process.env.TTS_PROVIDER || null,
  apiKey: process.env.ASR_API_KEY || process.env.TTS_API_KEY || null,
  region: process.env.ASR_REGION || process.env.TTS_REGION || null,
};

/**
 * 检查 ASR 是否可用
 */
function isASRAvailable() {
  return !!(VOICE_CONFIG.asrProvider && VOICE_CONFIG.apiKey);
}

/**
 * 检查 TTS 是否可用
 */
function isTTSAvailable() {
  return !!(VOICE_CONFIG.ttsProvider && VOICE_CONFIG.apiKey);
}

/**
 * 语音转文字（ASR）
 * @param {string} audioPath - 语音文件路径
 * @returns {Promise<{transcript: string|null, error: string|null, fallback: boolean}>}
 */
async function transcribe(audioPath) {
  if (!isASRAvailable()) {
    return {
      transcript: null,
      error: 'asr_not_configured',
      fallback: true,
      message: '收到你的语音了，但我这边暂时听不了，你发文字给我好不好？',
    };
  }

  try {
    switch (VOICE_CONFIG.asrProvider) {
      case 'whisper':
        return await transcribeWhisper(audioPath);
      case 'azure':
        return await transcribeAzure(audioPath);
      case 'aliyun':
        return await transcribeAliyun(audioPath);
      default:
        return { transcript: null, error: 'unknown_asr', fallback: true };
    }
  } catch (e) {
    console.log(`[voice] ASR 失败: ${e.message}`);
    return {
      transcript: null,
      error: e.message,
      fallback: true,
      message: '语音没听清，你再说一遍或者打字给我好吗？',
    };
  }
}

/**
 * 文字转语音（TTS）
 * @param {string} text - 要转为语音的文字（不超过 100 字）
 * @returns {Promise<{audioPath: string|null, error: string|null, fallback: boolean}>}
 */
async function speak(text) {
  if (!isTTSAvailable()) {
    return { audioPath: null, error: 'tts_not_configured', fallback: true };
  }

  // 限制长度（不超过 20 秒 ≈ 80-100 字）
  const shortText = text.slice(0, 100);

  try {
    switch (VOICE_CONFIG.ttsProvider) {
      case 'azure':
        return await speakAzure(shortText);
      case 'aliyun':
        return await speakAliyun(shortText);
      case 'elevenlabs':
        return await speakElevenLabs(shortText);
      default:
        return { audioPath: null, error: 'unknown_tts', fallback: true };
    }
  } catch (e) {
    console.log(`[voice] TTS 失败: ${e.message}`);
    return { audioPath: null, error: e.message, fallback: true };
  }
}

/**
 * OpenAI Whisper ASR
 */
async function transcribeWhisper(audioPath) {
  const audioFile = fs.readFileSync(audioPath);
  const formData = new FormData();
  formData.append('file', new Blob([audioFile]), 'audio.amr');
  formData.append('model', 'whisper-1');
  formData.append('language', 'zh');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VOICE_CONFIG.apiKey}` },
    body: formData,
  });

  if (!res.ok) throw new Error(`Whisper ${res.status}`);
  const data = await res.json();

  return { transcript: data.text, error: null, fallback: false };
}

/**
 * Azure Speech-to-Text（预留）
 */
async function transcribeAzure(audioPath) {
  throw new Error('Azure ASR 未配置');
}

/**
 * 阿里云语音识别（预留）
 */
async function transcribeAliyun(audioPath) {
  throw new Error('阿里云 ASR 未配置');
}

/**
 * Azure TTS（预留）
 */
async function speakAzure(text) {
  const endpoint = `https://${VOICE_CONFIG.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = `<speak version='1.0' xml:lang='zh-CN'><voice xml:lang='zh-CN' xml:gender='Female' name='zh-CN-XiaoxiaoNeural'>${text}</voice></speak>`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': VOICE_CONFIG.apiKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3',
    },
    body: ssml,
  });

  if (!res.ok) throw new Error(`Azure TTS ${res.status}`);
  const audioBuffer = Buffer.from(await res.arrayBuffer());
  const fileName = `reply_${Date.now()}.mp3`;
  const filePath = path.join(VOICE_REPLIES_DIR, fileName);
  fs.writeFileSync(filePath, audioBuffer);

  return { audioPath: filePath, error: null, fallback: false };
}

/**
 * 阿里云 TTS（预留）
 */
async function speakAliyun(text) {
  throw new Error('阿里云 TTS 未配置');
}

/**
 * ElevenLabs TTS（预留）
 */
async function speakElevenLabs(text) {
  throw new Error('ElevenLabs TTS 未配置');
}

/**
 * 判断是否需要使用语音回复
 * @param {Object} context
 * @returns {boolean}
 */
function shouldUseVoice(context) {
  if (!isTTSAvailable()) return false;

  // 用户明确要求
  if (context.userRequestedVoice) return true;

  // 低落/疲惫时
  if (context.mood === 'down' || context.mood === 'tired') return true;

  // 22:00 以后的晚安
  const hour = new Date().getHours();
  if (hour >= 22 && context.type === 'night') return true;

  return false;
}

module.exports = {
  transcribe,
  speak,
  configureVoice,
  isASRAvailable,
  isTTSAvailable,
  shouldUseVoice,
};
