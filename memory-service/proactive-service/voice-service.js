/**
 * Voice Service - 语音互发服务
 *
 * ASR（语音转文字）：本地 faster-whisper，免费离线运行
 * TTS（文字转语音）：阿里云 CosyVoice API
 *
 * 配置方式：在 .env 文件中设置（参见 .env.example）
 *   ASR_PROVIDER=local           # 本地 Whisper，无需 API Key
 *   TTS_API_KEY=sk-xxx           # CosyVoice / Dashscope API Key
 */

require('../env-loader').loadEnv();

const fs = require('fs');
const path = require('path');
const config = require('../config');

const VOICE_REPLIES_DIR = path.join(config.PATHS.dataDir, 'media', 'voices', 'replies');
fs.mkdirSync(VOICE_REPLIES_DIR, { recursive: true });

// ─── 配置 ──────────────────────────────────────────

const ASR_PROVIDER = process.env.ASR_PROVIDER || 'local';
const TTS_API_KEY = process.env.TTS_API_KEY || process.env.VISION_API_KEY || null;
const TTS_BASE_URL = process.env.TTS_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/cosyvoice';

// ─── ASR：语音转文字 ──────────────────────────────

function isASRAvailable() {
  return ASR_PROVIDER === 'local';
}

async function transcribe(audioPath) {
  if (!isASRAvailable()) {
    return { transcript: null, error: 'asr_not_configured', fallback: true,
      message: '收到你的语音了，但我这边暂时听不了，你发文字给我好不好？' };
  }
  try {
    const { execSync } = require('child_process');
    const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'asr.py');
    const result = execSync(
      `set HF_ENDPOINT=https://hf-mirror.com && python "${scriptPath}" "${audioPath}"`,
      { encoding: 'utf-8', timeout: 60000, windowsHide: true, shell: true }
    );
    const data = JSON.parse(result.trim());
    if (data.error) throw new Error(data.error);
    return { transcript: data.transcript, error: null, fallback: false };
  } catch (e) {
    console.log(`[voice] ASR 失败: ${e.message}`);
    return { transcript: null, error: e.message, fallback: true,
      message: '语音没听清，你再说一遍或者打字给我好吗？' };
  }
}

// ─── TTS：文字转语音（CosyVoice）─────────────────

function isTTSAvailable() {
  return !!TTS_API_KEY;
}

/**
 * 文字转语音
 * @param {string} text - 不超过 100 字
 * @returns {Promise<{audioPath: string|null, error: string|null, fallback: boolean}>}
 */
async function speak(text) {
  if (!isTTSAvailable()) {
    return { audioPath: null, error: 'tts_not_configured', fallback: true };
  }

  const shortText = text.slice(0, 100);

  try {
    const res = await fetch(TTS_BASE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TTS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'cosyvoice-v1',
        input: { text: shortText },
        parameters: { voice: 'longxiaochun', format: 'mp3', sample_rate: 16000 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`CosyVoice ${res.status}: ${errText.slice(0, 200)}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      // Dashscope 返回 JSON，其中 output.audio 可能是 base64
      const data = await res.json();
      if (data.output?.audio) {
        const audioBuffer = Buffer.from(data.output.audio, 'base64');
        const filePath = path.join(VOICE_REPLIES_DIR, `tts_${Date.now()}.mp3`);
        fs.writeFileSync(filePath, audioBuffer);
        return { audioPath: filePath, error: null, fallback: false };
      }
      throw new Error('CosyVoice 返回格式不匹配');
    } else {
      // 直接返回音频二进制
      const audioBuffer = Buffer.from(await res.arrayBuffer());
      const filePath = path.join(VOICE_REPLIES_DIR, `tts_${Date.now()}.mp3`);
      fs.writeFileSync(filePath, audioBuffer);
      return { audioPath: filePath, error: null, fallback: false };
    }
  } catch (e) {
    console.log(`[voice] TTS 失败: ${e.message}`);
    return { audioPath: null, error: e.message, fallback: true };
  }
}

/**
 * 判断是否需要语音回复
 */
function shouldUseVoice(context) {
  if (!isTTSAvailable()) return false;
  if (context?.userRequestedVoice) return true;
  if (context?.mood === 'down' || context?.mood === 'tired') return true;
  const hour = new Date().getHours();
  if (hour >= 22 && context?.type === 'night') return true;
  return false;
}

module.exports = { transcribe, speak, isASRAvailable, isTTSAvailable, shouldUseVoice };
