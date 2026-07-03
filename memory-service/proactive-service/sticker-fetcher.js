/**
 * Sticker Fetcher - 网络表情包搜索与缓存
 *
 * 从公开的斗图网站/图片搜索获取热门表情包，
 * 下载到本地缓存，通过 cc-connect send --image 发送。
 *
 * 数据源（含降级）：
 *   1. 斗图啦 API（doutula.com）
 *   2. 百度图片搜索（公开页面）
 *   3. 本地备选表情包
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../config');
const { features } = require('../features');

const CACHE_DIR = path.join(config.PATHS.dataDir, 'media', 'stickers');
fs.mkdirSync(CACHE_DIR, { recursive: true });

// 最近使用的表情包缓存（避免重复下载）
const recentCache = new Map();

/**
 * 从 URL 下载图片到本地缓存
 */
function downloadImage(url, fileName) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(url).split('?')[0] || '.jpg';
    const safeName = fileName + ext;
    const filePath = path.join(CACHE_DIR, safeName);

    // 如果已缓存，直接返回
    if (fs.existsSync(filePath)) {
      resolve(filePath);
      return;
    }

    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        fs.writeFileSync(filePath, Buffer.concat(chunks));
        resolve(filePath);
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * 从斗图啦搜索表情包
 * @param {string} keyword - 搜索关键词
 */
async function searchDoutula(keyword) {
  try {
    const url = `https://www.doutula.com/api/search?keyword=${encodeURIComponent(keyword)}&m=0&page=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.doutula.com/' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.data || [];
    return items.filter(i => i.image_url).map(i => ({
      url: i.image_url,
      title: i.title || keyword,
      width: i.width,
      height: i.height,
    }));
  } catch (e) {
    console.log(`[sticker-fetcher] 斗图啦搜索失败: ${e.message}`);
    return [];
  }
}

/**
 * 通过百度图片搜索表情包
 */
async function searchBaiduImage(keyword) {
  try {
    const url = `https://image.baidu.com/search/acjson?tn=resultjson_com&word=${encodeURIComponent(keyword + ' 表情包')}&pn=0&rn=10`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const data = JSON.parse(text);
    const items = data?.data || [];
    return items.filter(i => i?.thumbURL).map(i => ({
      url: i.thumbURL,
      title: i.fromPageTitle || keyword,
    }));
  } catch (e) {
    console.log(`[sticker-fetcher] 百度图片搜索失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取本地备选表情包
 */
function getLocalFallback(scene) {
  try {
    const stickerService = require('./sticker-service');
    const index = stickerService.loadIndex();
    const suggestions = index.suggestions || {};
    const ids = suggestions[scene] || [];
    const all = index.stickers || [];
    const candidates = all.filter(s => ids.includes(s.id) && s.path);
    if (candidates.length === 0) return null;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    return path.join(config.PATHS.root, chosen.path);
  } catch { return null; }
}

/**
 * 搜索并获取一张表情包
 * @param {string} scene - 场景（早安/晚安/安慰/鼓励/开心/撒娇/无语）
 * @param {string} customKeyword - 自定义搜索词（可选）
 * @returns {Promise<string|null>} 图片本地路径
 */
async function fetchSticker(scene, customKeyword) {
  // 场景 → 搜索关键词映射
  const keywordMap = {
    '早安': '早安 可爱 表情包',
    '晚安': '晚安 温柔 表情包',
    '安慰': '抱抱 安慰 表情包',
    '鼓励': '加油 打气 表情包',
    '开心': '哈哈哈 搞笑 表情包',
    '撒娇': '撒娇 可爱 表情包',
    '想你': '想你 表情包 可爱',
    '道歉': '对不起 表情包 可爱',
    '无语': '无语 表情包 搞笑',
    '震惊': '震惊 表情包 搞笑',
    '难过': '抱抱 表情包 暖心',
  };

  const keyword = customKeyword || keywordMap[scene] || '表情包 热门';

  // 先查缓存（最近 10 条不重复的）
  const cacheKey = keyword + '_' + Math.floor(Date.now() / 3600000); // 每小时换一次
  if (recentCache.has(cacheKey)) {
    return recentCache.get(cacheKey);
  }

  // 尝试多个源
  let results = [];

  // 源1：斗图啦
  results = await searchDoutula(keyword);

  // 源2：百度图片（斗图啦没结果时）
  if (results.length === 0) {
    results = await searchBaiduImage(keyword);
  }

  // 下载并缓存
  for (const item of results) {
    try {
      const fileName = 'sticker_' + Date.now();
      const filePath = await downloadImage(item.url, fileName);
      recentCache.set(cacheKey, filePath);
      // 限制缓存大小
      if (recentCache.size > 20) {
        const firstKey = recentCache.keys().next().value;
        recentCache.delete(firstKey);
      }
      console.log(`[sticker-fetcher] ✅ 已获取: ${keyword} → ${path.basename(filePath)}`);
      return filePath;
    } catch (e) {
      continue; // 试下一个结果
    }
  }

  // 全部失败，回退本地
  console.log(`[sticker-fetcher] 网络获取失败，回退本地: ${scene}`);
  return getLocalFallback(scene);
}

module.exports = { fetchSticker, searchDoutula, searchBaiduImage };
