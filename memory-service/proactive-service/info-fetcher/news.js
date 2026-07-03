/**
 * News Source - 新闻/热点数据源
 *
 * 严格遵循补充规划 2.2：
 * - 百度热搜（公开榜单）
 * - GDELT 全球事件
 * - HackerNews（科技圈）
 * 多源聚合 → 去重 → 按热度排序
 */

const crypto = require('crypto');

/**
 * 获取百度热搜榜单
 */
async function fetchBaiduHot() {
  try {
    const res = await fetch('https://top.baidu.com/board?tab=realtime', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();

    // 从 HTML 中提取热搜标题（百度热搜页面结构）
    const matches = html.match(/"title":"([^"]+)"/g) || [];
    const titles = matches.map(m => {
      try { return JSON.parse('{' + m + '}').title; } catch { return null; }
    }).filter(Boolean);

    return titles.slice(0, 15).map((title, i) => ({
      source: 'baidu',
      title: title.replace(/\\u[\dA-Fa-f]{4}/g, (m) =>
        String.fromCharCode(parseInt(m.slice(2), 16))
      ),
      heat: 100 - i * 2,
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(title)}`,
      type: 'news',
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[news] 百度热搜抓取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取 HackerNews 热门（AI 相关过滤）
 */
async function fetchHN() {
  try {
    // 获取 top stories
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = await res.json();
    const top30 = ids.slice(0, 30);

    const stories = await Promise.all(
      top30.map(async (id) => {
        try {
          const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          return await r.json();
        } catch { return null; }
      })
    );

    return stories.filter(Boolean).map(s => ({
      source: 'hn',
      title: s.title || '',
      heat: (s.score || 0) / 10,
      url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
      type: (s.title || '').toLowerCase().includes('ai') ? 'tech_ai' : 'tech',
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[news] HackerNews 抓取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取 GDELT 全球事件（按中文关键词过滤）
 */
async function fetchGDELT() {
  try {
    const res = await fetch(
      'https://api.gdeltproject.org/api/v2/doc/doc?query=china%20technology%20AI&mode=ArtList&max=10&format=json'
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles || []).map(a => ({
      source: 'gdelt',
      title: a.title || '',
      heat: a.severity || 30,
      url: a.url || '',
      type: 'news',
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[news] GDELT 抓取失败: ${e.message}`);
    return [];
  }
}

/**
 * 按标题去重
 */
function dedupByTitle(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = crypto.createHash('md5').update(item.title).digest('hex').slice(0, 8);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 获取今日热门新闻（多源聚合）
 */
async function fetchTopNews() {
  const [baidu, hn, gdelt] = await Promise.all([
    fetchBaiduHot(),
    fetchHN(),
    fetchGDELT(),
  ]);

  const all = [...baidu, ...hn, ...gdelt];
  const deduped = dedupByTitle(all);

  // 按热度排序，取 TOP 5
  return deduped.sort((a, b) => b.heat - a.heat).slice(0, 5);
}

module.exports = { fetchTopNews, fetchBaiduHot, fetchHN, fetchGDELT };
