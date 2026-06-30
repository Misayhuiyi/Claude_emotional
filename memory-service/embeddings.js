const db = require('./db');
const config = require('./config');

/**
 * N-gram 指纹相似度
 *
 * 用于语义相近的场景——对同一概念用不同措辞时，
 * n-gram 能捕获字符级重叠。但对完全不同的表达方式效果有限。
 *
 * 补救策略：查询扩展（query expansion），让 Claude 帮忙
 * 把用户查询重写为可能的其他说法，综合搜索。
 */

// ─── N-gram 提取 ─────────────────────────────────

/**
 * 提取中文 n-gram
 */
function extractNgrams(text, n = 2) {
  const grams = new Set();
  // 去掉标点和空白
  const cleaned = text.replace(/[，。！？、\s,\.!\?，；：""''「」【】（）\(\)\[\]\/\\\-—…]+/g, '');

  for (let i = 0; i <= cleaned.length - n; i++) {
    grams.add(cleaned.slice(i, i + n));
  }

  return [...grams];
}

/**
 * 提取混合 n-gram 指纹（2-gram + 3-gram）
 */
function extractFingerprint(text) {
  const bigrams = extractNgrams(text, 2);
  const trigrams = extractNgrams(text, 3);
  // bigrams 权重 0.6, trigrams 权重 0.4
  return { bigrams, trigrams };
}

// ─── 相似度计算 ──────────────────────────────────

/**
 * Jaccard 相似度（两个集合的交集/并集）
 */
function jaccardSimilarity(setA, setB) {
  if (setA.length === 0 || setB.length === 0) return 0;

  const a = new Set(setA);
  const b = new Set(setB);

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 加权 n-gram 相似度
 *
 * bigram: 捕捉局部语义（权重 0.6）
 * trigram: 捕捉短语级语义（权重 0.4）
 */
function ngramSimilarity(textA, textB) {
  const fpA = extractFingerprint(textA);
  const fpB = extractFingerprint(textB);

  const bigramSim = jaccardSimilarity(fpA.bigrams, fpB.bigrams);
  const trigramSim = jaccardSimilarity(fpA.trigrams, fpB.trigrams);

  return bigramSim * 0.6 + trigramSim * 0.4;
}

// ─── 向量存储（指纹压缩）──────────────────────────

/**
 * 生成记忆的向量指纹（JSON 格式，存入 memory_vectors）
 */
function buildVectorFingerprint(content) {
  const fp = extractFingerprint(content);

  // 只保留前 100 个 n-gram（控制大小）
  return JSON.stringify({
    bigrams: fp.bigrams.slice(0, 100),
    trigrams: fp.trigrams.slice(0, 100),
  });
}

/**
 * 为一条记忆生成并存储向量指纹
 */
function indexMemory(memoryId, content) {
  const fingerprint = buildVectorFingerprint(content);
  const store = db.getDb();

  store.prepare(`
    INSERT OR REPLACE INTO memory_vectors (memory_id, embedding_model, embedding, updated_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(memoryId, 'ngram-v1', fingerprint);

  return fingerprint;
}

/**
 * 为所有未索引的记忆生成指纹
 */
function indexAllMemories() {
  const store = db.getDb();
  const unindexed = store.prepare(`
    SELECT m.id, m.content FROM memories m
    LEFT JOIN memory_vectors v ON m.id = v.memory_id
    WHERE v.memory_id IS NULL AND m.status != 'forgotten'
  `).all();

  let count = 0;
  for (const m of unindexed) {
    indexMemory(m.id, m.content);
    count++;
  }

  return { indexed: count, total: unindexed.length };
}

// ─── 语义搜索 ────────────────────────────────────

/**
 * 向量相似度搜索
 *
 * @param {string} query - 用户查询
 * @param {Array} candidateIds - 候选记忆 ID 列表（如过，则搜索全部 active）
 * @param {number} limit - 返回条数
 * @returns {Array} 按相似度排序的记忆
 */
function vectorSearch(query, candidateIds = null, limit = 10) {
  const store = db.getDb();

  // 获取候选记忆及其指纹
  let rows;
  if (candidateIds && candidateIds.length > 0) {
    const placeholders = candidateIds.map(() => '?').join(',');
    rows = store.prepare(`
      SELECT m.id, m.content, m.type, m.weight, m.status,
             v.embedding as fingerprint
      FROM memories m
      LEFT JOIN memory_vectors v ON m.id = v.memory_id
      WHERE m.id IN (${placeholders}) AND m.status != 'forgotten'
    `).all(...candidateIds);
  } else {
    rows = store.prepare(`
      SELECT m.id, m.content, m.type, m.weight, m.status,
             v.embedding as fingerprint
      FROM memories m
      LEFT JOIN memory_vectors v ON m.id = v.memory_id
      WHERE m.status IN ('permanent', 'working')
      ORDER BY m.weight DESC
      LIMIT 100
    `).all();
  }

  // 计算每条记忆与查询的相似度
  const scored = rows.map(row => {
    let score = 0;

    if (row.fingerprint) {
      try {
        const fp = JSON.parse(row.fingerprint);
        const queryFp = extractFingerprint(query);

        const bigramSim = jaccardSimilarity(fp.bigrams || [], queryFp.bigrams);
        const trigramSim = jaccardSimilarity(fp.trigrams || [], queryFp.trigrams);
        score = bigramSim * 0.6 + trigramSim * 0.4;
      } catch {
        // 指纹解析失败，回退到原始文本 n-gram 比较
        score = ngramSimilarity(query, row.content);
      }
    } else {
      // 无指纹，实时计算
      score = ngramSimilarity(query, row.content);
    }

    return { ...row, score };
  });

  // 排序 + 截断
  scored.sort((a, b) => b.score - a.score);

  // 过滤相似度极低的（<0.05 基本无关）
  return scored.filter(r => r.score > 0.02).slice(0, limit);
}

module.exports = {
  extractNgrams,
  extractFingerprint,
  jaccardSimilarity,
  ngramSimilarity,
  buildVectorFingerprint,
  indexMemory,
  indexAllMemories,
  vectorSearch,
};
