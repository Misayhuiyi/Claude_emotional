/**
 * News Source - 新闻/热点数据源
 *
 * 源：百度热搜 + HackerNews（降级）
 * 多源聚合 → 去重 → 按热度排序
 */

const crypto = require('crypto');

/**
 * 获取百度热搜
 */
async function fetchBaiduHot() {
  try {
    const res = await fetch('https://top.baidu.com/board?tab=realtime', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();
    const matches = html.match(/"word":"([^"]+)"/g) || [];
    const titles = matches.map(m => {
      try {
        let t = m.match(/"word":"([^"]+)"/)[1];
        t = t.replace(/\\u[\dA-Fa-f]{4}/g, x => String.fromCharCode(parseInt(x.slice(2), 16)));
        return t;
      } catch { return null; }
    }).filter(Boolean);

    return titles.slice(0, 15).map((title, i) => ({
      source: '百度',
      title,
      heat: 100 - i * 2,
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(title)}`,
      type: 'news',
      fetchedAt: new Date().toISOString(),
    }));
  } catch { return []; }
}

/**
 * HackerNews
 */
async function fetchHN() {
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = await res.json();
    const top30 = ids.slice(0, 30);
    const stories = await Promise.all(
      top30.map(async id => {
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
  } catch { return []; }
}

/**
 * 获取热门新闻
 */
async function fetchTopNews() {
  const [baidu, hn] = await Promise.all([fetchBaiduHot(), fetchHN()]);
  const all = [...baidu, ...hn];
  const seen = new Set();
  const deduped = all.filter(item => {
    const key = crypto.createHash('md5').update(item.title).digest('hex').slice(0, 8);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.sort((a, b) => b.heat - a.heat).slice(0, 5);
}

module.exports = { fetchTopNews, fetchBaiduHot, fetchHN };
