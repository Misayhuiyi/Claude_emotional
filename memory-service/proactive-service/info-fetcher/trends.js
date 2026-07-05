/**
 * Trends - 网络热梗（国内可访问版）
 *
 * 源：知乎热榜 + 百度热搜 + 哔哩哔哩热门
 * 不涉及模拟登录、不绕过反爬
 */

/**
 * 知乎热榜
 */
async function fetchZhihuHot() {
  try {
    const res = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=5', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data || []).slice(0, 5).map(item => ({
      source: '知乎',
      title: item.target?.title || item.target?.question?.title || '',
      heat: (item.follow_count || 0) / 10 + 30,
      url: item.target?.url || `https://www.zhihu.com/question/${item.target?.id || ''}`,
      type: 'trend',
      fetchedAt: new Date().toISOString(),
    }));
  } catch { return []; }
}

/**
 * B站热门
 */
async function fetchBilibiliHot() {
  try {
    const res = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=5', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data?.list || []).map(v => ({
      source: 'B站',
      title: v.title || '',
      heat: (v.stat?.view || 0) / 1000,
      url: `https://www.bilibili.com/video/${v.bvid || ''}`,
      type: 'trend',
      fetchedAt: new Date().toISOString(),
    }));
  } catch { return []; }
}

/**
 * 百度热搜
 */
async function fetchBaiduHot() {
  try {
    const res = await fetch('https://top.baidu.com/board?tab=realtime', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const matches = html.match(/"title":"([^"]+)"/g) || [];
    const titles = matches.map(m => {
      try { return JSON.parse('{' + m + '}').title; } catch { return null; }
    }).filter(Boolean).map(t => t.replace(/\\u[\dA-Fa-f]{4}/g, m => String.fromCharCode(parseInt(m.slice(2), 16))));

    return titles.slice(0, 8).map(t => ({
      source: '百度',
      title: t,
      heat: 50,
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(t)}`,
      type: 'trend',
      fetchedAt: new Date().toISOString(),
    }));
  } catch { return []; }
}

/**
 * 综合热梗
 */
async function fetchTrends() {
  const [zhihu, bili, baidu] = await Promise.all([
    fetchZhihuHot(),
    fetchBilibiliHot(),
    fetchBaiduHot(),
  ]);
  const all = [...zhihu, ...bili, ...baidu];
  const seen = new Set();
  return all.filter(item => {
    const key = item.title.slice(0, 10);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.heat - a.heat).slice(0, 5);
}

module.exports = { fetchTrends, fetchZhihuHot, fetchBilibiliHot, fetchBaiduHot };
