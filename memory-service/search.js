/**
 * 记忆检索模块
 *
 * 职责：中文 LIKE 搜索 + FTS5 英文搜索、混合召回
 *
 * 注意：SQLite FTS5 默认 unicode61 分词器无法拆分中文。
 * 对中文使用 LIKE '%keyword%' 模式，英文仍然走 FTS5。
 * 个人场景 <10000 条记忆，LIKE 性能完全够用。
 */

const Database = require('better-sqlite3');
const config = require('./config');
const embeddings = require('./embeddings');

let claudeRunner = null;
function getClaudeRunner() {
  if (!claudeRunner) claudeRunner = require('./claude-runner');
  return claudeRunner;
}

let db = null;

function getDb() {
  if (db) return db;
  db = new Database(config.PATHS.memoryDb);
  db.pragma('journal_mode = WAL');
  return db;
}

/**
 * 判断文本是否主要为中文
 */
function isChinese(text) {
  let cjk = 0;
  for (const c of text) {
    if (/[一-鿿㐀-䶿]/.test(c)) cjk++;
  }
  return cjk > text.length * 0.3;
}

/**
 * 从用户消息中提取搜索关键词
 *
 * 策略：
 *   1. 按标点切分
 *   2. 短片段直接保留
 *   3. 长片段做滑动 2-gram（中文连写时兜底）
 */
function extractKeywords(message) {
  if (!message) return [];

  // 按标点切分
  const raw = message.split(/[，。！？、\s,\.!\?，；：""''「」【】（）\(\)\[\]\/\\\-—…]+/)
    .filter(s => s.length >= 2)
    .map(s => s.trim());

  const keywords = [];

  for (const seg of raw) {
    if (seg.length <= 15) {
      keywords.push(seg);
    }

    // 对中文长片段做滑动 2-gram 兜底
    if (isChinese(seg) && seg.length >= 4) {
      for (let i = 0; i < seg.length - 1; i++) {
        keywords.push(seg.slice(i, i + 2));
      }
    }
  }

  return [...new Set(keywords)];
}

/**
 * LIKE 搜索（中文主路径）
 */
function searchByLike(keywords, options = {}) {
  const limit = options.limit || config.CONTEXT.maxMemoryInject;
  const db = getDb();

  let statusClause = '';
  if (options.status === 'active') {
    statusClause = "AND status IN ('candidate', 'working', 'permanent')";
  } else if (options.status === 'permanent') {
    statusClause = "AND status = 'permanent'";
  }

  // 为每个关键词构建 LIKE 条件
  const likeClauses = keywords.map(() => "(content LIKE ? OR keywords LIKE ?)");
  const params = keywords.flatMap(k => [`%${k}%`, `%${k}%`]);

  const sql = `
    SELECT id, type, content, keywords, weight, status, importance,
           frequency, emotion_score, explicit_score, recency_score,
           confidence, created_at, updated_at
    FROM memories
    WHERE status != 'forgotten'
      ${statusClause}
      AND (${likeClauses.join(' OR ')})
    ORDER BY weight DESC
    LIMIT ?
  `;

  return db.prepare(sql).all(...params, limit);
}

/**
 * 更宽泛的搜索：对单个字进行匹配（作为兜底）
 */
function searchByCharFallback(keywords, options = {}) {
  const limit = options.limit || 5;
  const db = getDb();

  // 取所有关键词的前 2 个字做模糊匹配
  const chars = [...new Set(
    keywords.flatMap(k => {
      const arr = [];
      for (let i = 0; i < k.length - 1; i++) {
        arr.push(k.slice(i, i + 2));
      }
      return arr;
    })
  )].slice(0, 10);

  if (chars.length === 0) return [];

  const likeClauses = chars.map(() => "(content LIKE ? OR keywords LIKE ?)");
  const params = chars.flatMap(c => [`%${c}%`, `%${c}%`]);

  const sql = `
    SELECT id, type, content, keywords, weight, status, importance,
           frequency, emotion_score, explicit_score, recency_score,
           confidence, created_at, updated_at
    FROM memories
    WHERE status != 'forgotten'
      AND (${likeClauses.join(' OR ')})
    ORDER BY weight DESC
    LIMIT ?
  `;

  return db.prepare(sql).all(...params, limit);
}

/**
 * 混合检索：中文 LIKE + 查询扩展 + n-gram 向量
 */
async function hybridSearch(userMessage, options = {}) {
  const limit = options.limit || config.CONTEXT.maxMemoryInject;
  const keywords = extractKeywords(userMessage);

  if (keywords.length === 0) {
    // 无有效关键词，返回权重最高的 active 记忆
    const db = getDb();
    return db.prepare(`
      SELECT id, type, content, keywords, weight, status, importance,
             frequency, emotion_score, explicit_score, recency_score,
             confidence, created_at, updated_at
      FROM memories
      WHERE status IN ('permanent', 'working')
      ORDER BY weight DESC
      LIMIT ?
    `).all(limit);
  }

  // 主路径：LIKE 搜索
  let keywordResults = searchByLike(keywords, { limit: limit * 2, status: options.status || 'active' });

  // 如果没结果，用 bigram 兜底
  if (keywordResults.length === 0) {
    keywordResults = searchByCharFallback(keywords, { limit, status: options.status || 'active' });
  }

  // 🔍 查询扩展：关键词没结果时让 Claude 生成同义表述
  if (keywordResults.length === 0 && !options.noExpand) {
    const expandedPhrases = await expandQuery(userMessage);
    if (expandedPhrases.length > 0) {
      // 从扩展短语中再次提取关键词
      const expandedKeywords = [...new Set(
        expandedPhrases.flatMap(p => extractKeywords(p))
      )];
      if (expandedKeywords.length > 0) {
        const expandedResults = searchByLike(expandedKeywords, { limit, status: options.status || 'active' });
        if (expandedResults.length === 0) {
          // 还是没结果，用 bigram 兜底搜索扩展关键词
          const fallbackResults = searchByCharFallback(expandedKeywords, { limit, status: options.status || 'active' });
          keywordResults = keywordResults.concat(fallbackResults);
        } else {
          keywordResults = keywordResults.concat(expandedResults);
        }
      }
    }
  }

  // 按权重排序
  keywordResults.sort((a, b) => b.weight - a.weight);

  // 去重
  const seen = new Set();
  keywordResults = keywordResults.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  return keywordResults.slice(0, limit);
}

/**
 * 查询扩展：让 Claude 把用户查询改写为可能的其他中文表述
 * 用于关键词搜索没结果时的语义兜底
 */
async function expandQuery(userMessage) {
  try {
    const runner = getClaudeRunner();
    const prompt = `把下面的用户消息改写为3种不同的中文表述（用于搜索引擎检索）。

要求：
- 每种表述用不同的措辞，但保持相同的意思
- 每条10-20字
- 只输出3条表述，一行一条，不要编号

用户消息：${userMessage}

改写：`;

    const result = await runner.run(prompt, {
      model: config.MODEL.companion,
      timeout: 10000,
      bare: true,
    });

    if (result.success && result.response) {
      return result.response
        .split('\n')
        .map(s => s.replace(/^[\d\.\-\s]+/, '').trim())
        .filter(s => s.length >= 4);
    }
  } catch { /* 扩展失败不影响主搜索 */ }
  return [];
}

module.exports = {
  searchByLike,
  searchByCharFallback,
  extractKeywords,
  expandQuery,
  hybridSearch,
};
