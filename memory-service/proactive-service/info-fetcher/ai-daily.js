/**
 * AI Daily - AI 行业资讯数据源
 *
 * 严格遵循补充规划 2.4——这是阿忆的方向，需要最用心。
 *
 * 数据源：
 * - HuggingFace Daily Papers
 * - GitHub Trending (AI 相关)
 * - HackerNews AI 过滤
 * - ArXiv cs.AI / cs.CL
 * - 机器之心 / 量子位 RSS
 * - LangChain / CrewAI / MCP 官方更新
 */

const crypto = require('crypto');

// 阿忆的技术方向关键词优先级
const KEYWORDS_P0 = ['agent', 'mcp', 'rag', '大模型', 'llm'];
const KEYWORDS_P1 = ['langchain', 'crewai', 'function call', 'tool use', 'embedding', 'vector', 'copilot'];
const KEYWORDS_P2 = ['transformer', 'attention', 'fine-tune', 'rlhf', 'sft', 'prompt', 'gpt', 'claude'];

/**
 * 计算内容与阿忆方向的匹配得分
 */
function relevanceScore(item) {
  const text = (item.title + ' ' + (item.summary || '')).toLowerCase();
  let score = 0;

  KEYWORDS_P0.forEach(kw => { if (text.includes(kw)) score += 10; });
  KEYWORDS_P1.forEach(kw => { if (text.includes(kw)) score += 5; });
  KEYWORDS_P2.forEach(kw => { if (text.includes(kw)) score += 2; });

  return score;
}

/**
 * 获取 HuggingFace Daily Papers
 */
async function fetchHFDaily() {
  try {
    const res = await fetch('https://huggingface.co/api/daily_papers?limit=10');
    if (!res.ok) return [];
    const papers = await res.json();

    return papers.map(p => ({
      source: 'huggingface',
      title: p.title || p.paper?.title || '',
      summary: p.summary || p.paper?.summary || '',
      url: `https://huggingface.co/papers/${p.id || ''}`,
      type: 'ai_paper',
      heat: p.score || 50,
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[ai-daily] HF Papers 获取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取 GitHub Trending (AI 相关)
 */
async function fetchGitHubTrending() {
  try {
    const res = await fetch(
      'https://api.github.com/search/repositories?q=ai+agent+mcp+llm+langchain&sort=stars&order=desc&per_page=10',
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'shen-yuchu-companion/1.0',
        },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();

    return (data.items || []).map(repo => ({
      source: 'github',
      title: repo.full_name + ': ' + (repo.description || ''),
      summary: repo.description || '',
      url: repo.html_url,
      type: 'ai_tool',
      heat: repo.stargazers_count || 0,
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[ai-daily] GitHub Trending 获取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取 HackerNews AI 相关讨论
 */
async function fetchHNAI() {
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = await res.json();
    const top50 = ids.slice(0, 50);

    const stories = await Promise.all(
      top50.map(async id => {
        try {
          const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          return await r.json();
        } catch { return null; }
      })
    );

    return stories.filter(Boolean).filter(s => {
      const text = (s.title || '').toLowerCase();
      return KEYWORDS_P0.some(kw => text.includes(kw)) ||
             KEYWORDS_P1.some(kw => text.includes(kw));
    }).map(s => ({
      source: 'hn_ai',
      title: s.title || '',
      summary: s.text || '',
      url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
      type: 'ai_news',
      heat: (s.score || 0) / 5,
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[ai-daily] HN AI 获取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取 ArXiv cs.AI / cs.CL 最新论文
 */
async function fetchArXiv() {
  try {
    const url = 'http://export.arxiv.org/api/query?' +
      'search_query=cat:cs.AI+AND+cat:cs.CL' +
      '&sortBy=submittedDate&sortOrder=descending&max_results=5';
    const res = await fetch(url);
    const xml = await res.text();

    // 简易 XML 解析提取标题
    const titles = xml.match(/<title>([^<]+)<\/title>/g) || [];
    const summaries = xml.match(/<summary>([^<]+)<\/summary>/g) || [];

    return titles.slice(1).map((t, i) => ({
      source: 'arxiv',
      title: t.replace(/<\/?title>/g, '').trim(),
      summary: summaries[i + 1] ? summaries[i + 1].replace(/<\/?summary>/g, '').trim().slice(0, 200) : '',
      url: url,
      type: 'ai_paper',
      heat: 40,
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.log(`[ai-daily] ArXiv 获取失败: ${e.message}`);
    return [];
  }
}

/**
 * 获取中文 AI 媒体资讯（机器之心、量子位等）
 * 通过 RSS feed 获取
 */
async function fetchChineseAI() {
  const rssFeeds = [
    { name: '机器之心', url: 'https://www.jiqizhixin.com/rss' },
    { name: '量子位', url: 'https://www.qbitai.com/feed' },
  ];

  const results = [];
  for (const feed of rssFeeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const xml = await res.text();

      // 简易 RSS 解析
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      const parsed = items.slice(0, 5).map(item => {
        const titleMatch = item.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/);
        const linkMatch = item.match(/<link>([^<]+)<\/link>/);
        return {
          source: feed.name,
          title: titleMatch ? titleMatch[1] : '',
          summary: '',
          url: linkMatch ? linkMatch[1] : '',
          type: 'ai_news',
          heat: 30,
          fetchedAt: new Date().toISOString(),
        };
      });
      results.push(...parsed);
    } catch (e) {
      console.log(`[ai-daily] ${feed.name} RSS 获取失败: ${e.message}`);
    }
  }

  return results;
}

/**
 * 获取 AI 行业资讯（全部数据源聚合）
 */
async function fetchAIDaily() {
  const [hf, github, hn, arxiv, cnAI] = await Promise.all([
    fetchHFDaily(),
    fetchGitHubTrending(),
    fetchHNAI(),
    fetchArXiv(),
    fetchChineseAI(),
  ]);

  const all = [...hf, ...github, ...hn, ...arxiv, ...cnAI];

  // 按相关性排序
  const scored = all.map(item => ({
    ...item,
    relevance: relevanceScore(item),
  }));

  // 过滤无关内容（相关性 > 0）
  const relevant = scored.filter(s => s.relevance > 0 || s.heat > 30);

  // 按相关度+热度综合排序，取 TOP 5
  return relevant
    .sort((a, b) => (b.relevance + b.heat / 10) - (a.relevance + a.heat / 10))
    .slice(0, 5);
}

module.exports = { fetchAIDaily, relevanceScore };
