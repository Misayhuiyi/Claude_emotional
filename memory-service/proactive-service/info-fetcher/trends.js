/**
 * Trends - 网络热梗
 *
 * 源：百度热搜 + 哔哩哔哩热门
 * 不涉及模拟登录、不绕过反爬
 */

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
    const matches = html.match(/"word":"([^"]+)"/g) || [];
    const titles = matches.map(m => {
      try {
        let t = m.match(/"word":"([^"]+)"/)[1];
        t = t.replace(/\\u[\dA-Fa-f]{4}/g, x => String.fromCharCode(parseInt(x.slice(2), 16)));
        return t;
      } catch { return null; }
    }).filter(Boolean);

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
  const [bili, baidu] = await Promise.all([
    fetchBilibiliHot(),
    fetchBaiduHot(),
  ]);
  // 混合：取前3条B站 + 前3条百度，去重后取5条
  const all = [...bili.slice(0, 3), ...baidu.slice(0, 3)];
  const seen = new Set();
  return all.filter(item => {
    const key = item.title.slice(0, 10);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

module.exports = { fetchTrends, fetchBilibiliHot, fetchBaiduHot };
