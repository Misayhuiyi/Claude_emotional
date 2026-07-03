/**
 * Trends - 网络热梗数据源
 *
 * 严格遵循补充规划 2.3：
 * - 微博热搜（公开榜单）
 * - 百度贴吧热门（公开页面）
 * - 抖音热榜（公开摘要）
 *
 * 安全边界：不模拟登录、不绕过反爬、不采集用户隐私数据。
 * 源不可用时静默跳过，不影响其他推送。
 */

/**
 * 获取微博热搜（公开 API）
 */
async function fetchWeiboHot() {
  try {
    const res = await fetch('https://weibo.com/ajax/side/hotSearch', {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();

    const realtime = data?.data?.realtime || [];
    return realtime.slice(0, 10).map(item => ({
      source: 'weibo',
      title: item.word || '',
      heat: item.raw_hot || 50,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(item.word || '')}`,
      type: 'trend',
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[trends] 微博热搜抓取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取百度贴吧热门话题
 */
async function fetchTiebaHot() {
  try {
    const res = await fetch('https://tieba.baidu.com/hottopic/browse/topicList', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const topics = data?.data?.bangTopics || [];

    return topics.slice(0, 5).map(t => ({
      source: 'tieba',
      title: (t.topic_name || t.name || '').replace(/<[^>]+>/g, ''),
      heat: t.discuss_num || t.hot || 30,
      url: t.topic_url || '',
      type: 'trend',
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[trends] 贴吧热门抓取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取抖音热榜（公开摘要）
 */
async function fetchDouyinHot() {
  try {
    const res = await fetch('https://www.douyin.com/aweme/v1/web/hot/search/list/', {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list = data?.data?.word_list || [];

    return list.slice(0, 5).map(item => ({
      source: 'douyin',
      title: item.word || item.hot_value || '',
      heat: item.hot_value || 40,
      url: `https://www.douyin.com/search/${encodeURIComponent(item.word || '')}`,
      type: 'trend',
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[trends] 抖音热榜获取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取小红书热门（公开搜索热词）
 */
async function fetchXiaohongshuHot() {
  try {
    const res = await fetch('https://www.xiaohongshu.com/api/sns/web/v1/search/trend', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.data?.trends || [];
    return items.slice(0, 5).map(item => ({
      source: 'xiaohongshu',
      title: item.word || item.name || '',
      heat: item.hot || 30,
      url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(item.word || '')}`,
      type: 'trend',
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[trends] 小红书热门获取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取搜狗/微信热搜
 */
async function fetchSogouHot() {
  try {
    const res = await fetch('https://top.sogou.com/api/hot/rank', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.data?.list || [];
    return items.slice(0, 5).map((item, i) => ({
      source: 'sogou',
      title: item.title || item.word || '',
      heat: item.hot || item.score || 30,
      url: item.url || '',
      type: 'trend',
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[trends] 搜狗热搜获取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取当前网络热梗（多源聚合）
 */
async function fetchTrends() {
  const [weibo, tieba, douyin, xhs, sogou] = await Promise.all([
    fetchWeiboHot(),
    fetchTiebaHot(),
    fetchDouyinHot(),
    fetchXiaohongshuHot(),
    fetchSogouHot(),
  ]);

  const all = [...weibo, ...tieba, ...douyin, ...xhs, ...sogou];

  // 去重 + 按热度排序
  const seen = new Set();
  const unique = all.filter(item => {
    const key = item.title.slice(0, 10);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort((a, b) => b.heat - a.heat).slice(0, 5);
}

module.exports = { fetchTrends, fetchWeiboHot, fetchTiebaHot, fetchDouyinHot };
