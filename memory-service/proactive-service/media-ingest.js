/**
 * Media Ingest - 媒体文件接收与处理
 *
 * 负责：
 * - 保存微信传来的媒体文件
 * - 计算 hash 去重
 * - 写入 media_assets 表
 * - 按类型分发到对应的处理服务
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const mediaDb = require('./media-db');

const MEDIA_DIRS = {
  image: path.join(config.PATHS.dataDir, 'media', 'images'),
  voice: path.join(config.PATHS.dataDir, 'media', 'voices'),
  video: path.join(config.PATHS.dataDir, 'media', 'videos'),
  temp: path.join(config.PATHS.dataDir, 'media', 'temp'),
};

// 确保目录存在
for (const dir of Object.values(MEDIA_DIRS)) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 保存媒体文件到本地
 * @param {Buffer|string} data - 文件数据或临时路径
 * @param {string} type - image/voice/video
 * @param {string} ext - 文件扩展名（如 .jpg .amr .mp4）
 * @returns {Promise<{filePath: string, sha256: string}>}
 */
async function saveMediaFile(data, type, ext) {
  const dir = MEDIA_DIRS[type] || MEDIA_DIRS.temp;
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  const fileName = `${type}_${timestamp}_${random}${ext}`;
  const filePath = path.join(dir, fileName);

  if (Buffer.isBuffer(data)) {
    fs.writeFileSync(filePath, data);
  } else if (typeof data === 'string' && fs.existsSync(data)) {
    // 从临时路径复制
    fs.copyFileSync(data, filePath);
  } else {
    throw new Error('media-ingest: 无效的数据格式');
  }

  const sha256 = await mediaDb.computeSha256(filePath);
  return { filePath, sha256, fileName };
}

/**
 * 处理接收到的媒体文件
 * @param {Object} msg - 微信消息对象
 * @param {string} msg.type - 消息类型 image/voice/video
 * @param {Buffer} msg.data - 文件数据
 * @param {string} msg.ext - 扩展名
 * @param {string} msg.messageId - 关联消息 ID
 * @returns {Promise<{mediaId: string, filePath: string, sha256: string}>}
 */
async function processMedia(msg) {
  const { filePath, sha256 } = await saveMediaFile(msg.data, msg.type, msg.ext || '');

  const mediaId = mediaDb.insertMediaAsset({
    type: msg.type,
    filePath,
    sha256,
    mime: msg.mime || null,
    source: 'wechat',
    messageId: msg.messageId || null,
  });

  console.log(`[media-ingest] 已保存 ${msg.type}: ${path.basename(filePath)} (${mediaId})`);

  return { mediaId, filePath, sha256 };
}

/**
 * 清理临时文件（超过 24 小时）
 */
function cleanTemp() {
  const tempDir = MEDIA_DIRS.temp;
  if (!fs.existsSync(tempDir)) return;

  const now = Date.now();
  const files = fs.readdirSync(tempDir).map(f => path.join(tempDir, f));

  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
        fs.unlinkSync(file);
      }
    } catch {}
  }
}

module.exports = {
  saveMediaFile,
  processMedia,
  cleanTemp,
  MEDIA_DIRS,
};
