/**
 * AI Daily - AI 行业资讯数据源（国内可用版）
 *
 * 国内可稳定访问的源：
 * - GitHub Trending（多关键词搜索）
 * - 框架官方更新（GitHub Releases）
 * - B站热门（科技区）
 */

const KEYWORDS_P0 = ['agent', 'mcp', 'rag', '大模型', 'llm'];
const KEYWORDS_P1 = ['langchain', 'crewai', 'function call', 'tool use', 'embedding', 'vector', 'copilot'];
const KEYWORDS_P2 = ['transformer', 'attention', 'fine-tune', 'rlhf', 'sft', 'prompt', 'gpt', 'claude'];

function relevanceScore(item) {
  const text = (item.title + ' ' + (item.summary || '')).toLowerCase();
  let score = 0;
  KEYWORDS_P0.forEach(kw => { if (text.includes(kw)) score += 10; });
  KEYWORDS_P1.forEach(kw => { if (text.includes(kw)) score += 5; });
  KEYWORDS_P2.forEach(kw => { if (text.includes(kw)) score += 2; });
  return score;
}

/**
 * GitHub 多角度搜索 AI 项目
 */
async function fetchGitHubTrending() {
  const queries = [
    'ai+agent+mcp+llm',
    'ai+framework+tools+2024',
    '大模型+agent+rag',
    'awesome+llm+agents',
  ];

  const allItems = [];
  const seen = new Set();

  for (const q of queries) {
    try {
      const res = await fetch(
        `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=5`,
        { headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'shen-yuchu-companion/1.0' } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const repo of (data.items || [])) {
        const key = repo.full_name;
        if (seen.has(key)) continue;
        seen.add(key);
        allItems.push({
          source: 'github',
          title: repo.full_name + ': ' + (repo.description || ''),
          summary: repo.description || '',
          url: repo.html_url,
          type: 'ai_tool',
          heat: repo.stargazers_count || 0,
          fetchedAt: new Date().toISOString(),
        });
      }
    } catch {}
  }

  return allItems.sort((a, b) => b.heat - a.heat).slice(0, 10);
}

/**
 * 框架官方更新
 */
async function fetchFrameworkUpdates() {
  const repos = [
    { name: 'LangChain', url: 'https://api.github.com/repos/langchain-ai/langchain/releases?per_page=3' },
    { name: 'CrewAI', url: 'https://api.github.com/repos/joaomdmoura/crewai/releases?per_page=3' },
    { name: 'MCP SDK', url: 'https://api.github.com/repos/modelcontextprotocol/typescript-sdk/releases?per_page=3' },
  ];
  const results = [];
  for (const repo of repos) {
    try {
      const res = await fetch(repo.url, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'shen-yuchu-companion/1.0' },
      });
      if (!res.ok) continue;
      const releases = await res.json();
      for (const r of (releases || []).slice(0, 2)) {
        results.push({
          source: repo.name,
          title: `${repo.name} ${r.tag_name || r.name}: ${(r.body || '').split('\n')[0].slice(0, 100)}`,
          summary: (r.body || '').slice(0, 200),
          url: r.html_url,
          type: 'ai_tool',
          heat: 60,
          fetchedAt: new Date().toISOString(),
        });
      }
    } catch {}
  }
  return results;
}

/**
 * B站科技区热门
 */
async function fetchBilibiliTech() {
  try {
    const res = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=20', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const videos = data?.data?.list || [];
    const techKeywords = ['AI', '人工智能', '编程', '代码', '大模型', 'GPT', 'ChatGPT', '计算机', '算法', '数学', '科技', '苹果', '华为', 'OpenAI', 'Claude', 'Agent', 'Python', '前端', '后端'];
    return videos.filter(v => techKeywords.some(kw => (v.title || '').includes(kw) || (v.desc || '').includes(kw)))
      .slice(0, 5).map(v => ({
        source: 'B站',
        title: v.title || '',
        summary: (v.desc || '').slice(0, 100),
        url: `https://www.bilibili.com/video/${v.bvid || ''}`,
        type: 'ai_news',
        heat: (v.stat?.view || 0) / 1000,
        fetchedAt: new Date().toISOString(),
      }));
  } catch { return []; }
}

/**
 * 综合 AI 资讯
 */
async function fetchAIDaily() {
  const [github, frameworks, bili] = await Promise.all([
    fetchGitHubTrending(),
    fetchFrameworkUpdates(),
    fetchBilibiliTech(),
  ]);

  const all = [...github, ...frameworks, ...bili];
  const scored = all.map(item => ({ ...item, relevance: relevanceScore(item) }));
  const relevant = scored.filter(s => s.relevance > 0 || s.heat > 30);
  return relevant.sort((a, b) => (b.relevance + b.heat / 10) - (a.relevance + a.heat / 10)).slice(0, 8);
}

module.exports = { fetchAIDaily, relevanceScore, fetchGitHubTrending, fetchFrameworkUpdates };
