/**
 * Memory Gate - 记忆权重机制
 *
 * 职责：
 *   1. 从对话中抽取候选记忆（调用 Claude 输出 JSON）
 *   2. 权重计算（代码保证，不依赖模型）
 *   3. candidate → working → permanent 升级
 *   4. 相似记忆合并
 *   5. 过期降权与遗忘
 */

const config = require('./config');
const db = require('./db');
const claudeRunner = require('./claude-runner');
const embeddings = require('./embeddings');

// ─── 权重计算（纯代码，不依赖模型）─────────────────

/**
 * 使用权公式计算记忆权重
 *
 * weight = importance*2 + frequency*1.5 + emotion_score*2
 *        + explicit_score*5 + recency_score + confidence
 */
function calculateWeight(memory) {
  const w =
    (memory.importance || 1) * 2 +
    (memory.frequency || 1) * 1.5 +
    (memory.emotion_score || 0) * 2 +
    (memory.explicit_score || 0) * 5 +
    (memory.recency_score || 0) +
    (memory.confidence || 0.7);
  return Math.round(w * 10) / 10;
}

/**
 * 根据权重决定状态
 */
function determineStatus(weight) {
  if (weight >= config.MEMORY.permanentWeightMin) return 'permanent';
  if (weight >= config.MEMORY.candidateWeightMax) return 'working';
  return 'candidate';
}

/**
 * recency 衰减：上次出现距今越久，recency_score 越低
 */
function decayRecency(lastSeenAt) {
  if (!lastSeenAt) return 0;

  const daysSince = (Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince <= 1) return 5;       // 今天 → 满分
  if (daysSince <= 3) return 4;
  if (daysSince <= 7) return 3;
  if (daysSince <= 14) return 2;
  if (daysSince <= 30) return 1;
  return 0;                            // 超过 30 天 → recency=0
}

/**
 * 计算记忆的初始 recency
 * 首次出现 = 1，重复出现按频率递增
 */
function initialRecency(existingFrequency = 1) {
  if (existingFrequency >= 5) return 5;
  if (existingFrequency >= 3) return 3;
  if (existingFrequency >= 2) return 2;
  return 0;  // 首次出现，recency = 0
}

// ─── 记忆抽取（调用 Claude 输出结构化 JSON）─────────

/**
 * 让 Claude 从最近对话中抽取候选记忆
 *
 * 输出必须是 JSON，避免自由散文（DeepSeek 适配）
 */
async function extractCandidates(recentMessages) {
  if (recentMessages.length < 2) return [];

  const conversationText = recentMessages
    .slice(-6) // 只分析最近 3 轮
    .map(m => `${m.role === 'user' ? '用户' : '小克'}：${m.content}`)
    .join('\n');

  const prompt = `分析以下对话，抽取值得长期记住的候选记忆。你是沈幼楚，需要记住用户的重要信息、情绪和偏好。

输出必须是 JSON 数组，不要输出其他内容：

\`\`\`json
[
  {
    "type": "preference|boundary|relationship|event|emotional_pattern|identity_fact|current_goal|recurring_pain|general",
    "content": "一句话概括要记住的内容",
    "importance": 1-5,
    "emotion_score": 0-5,
    "explicit_score": 0-5,
    "confidence": 0.0-1.0,
    "should_remember": true/false
  }
]
\`\`\`

应该记住的场景（should_remember=true）：
- 用户表达了情感需求（"你要一直陪着我"、"想你了"之类的）
- 用户透露了个人偏好或雷区
- 用户说了自己的近况、目标、压力来源
- 情绪明显的表达（开心、难过、焦虑、孤独）
- 用户对沈幼楚的反馈（喜欢什么、不喜欢什么）
- 任何可能对长期陪伴有用的信息

不应该记住的场景（should_remember=false）：
- 纯粹的技术操作 / 系统调试
- 用户已经明确说"忘掉"
- 完全不涉及任何信息的日常寒暄（"在吗"、"早安"等单句）

最多输出 3 条。

对话：
${conversationText}`;

  try {
    const result = await claudeRunner.run(prompt, {
      model: config.MODEL.companion,
      timeout: 20000,
      bare: true,
    });

    if (!result.success) return [];

    // 提取 JSON
    const jsonMatch = result.response.match(/```json\s*([\s\S]*?)\s*```/) ||
                      result.response.match(/\[[\s\S]*\]/);

    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Memory Gate 抽取失败:', err.message);
    return [];
  }
}

// ─── 主流程：处理一轮对话后的记忆更新 ──────────────

/**
 * 在每轮对话后调用：
 *   1. 从对话中抽取候选记忆
 *   2. 计算权重
 *   3. 去重合并
 *   4. 写入/更新 memories 表
 *
 * @param {Array} recentMessages - 最近几轮对话
 * @param {string} lastMessageId  - 上一条用户消息的 ID（用于 memory_mentions）
 */
async function processGate(recentMessages, lastMessageId = null) {
  const candidates = await extractCandidates(recentMessages);

  if (candidates.length === 0) return { extracted: 0, updated: [] };

  const results = [];

  for (const c of candidates) {
    if (!c.should_remember) continue;

    const type = c.type || 'general';
    const keywords = c.content.split(/[，。！？\s,\.!\?]+/).filter(s => s.length >= 2).join(' ');

    // 查找相似记忆，决定 frequency 和 recency
    const existing = db.findSimilar(c.content);
    const frequency = existing ? existing.frequency + 1 : 1;
    const recencyScore = initialRecency(frequency);

    // 权重计算（gate.js 是唯一入口）
    const weight = calculateWeight({
      importance: c.importance || 1,
      frequency,
      emotion_score: c.emotion_score || 0,
      explicit_score: c.explicit_score || 0,
      recency_score: recencyScore,
      confidence: c.confidence || 0.7,
    });

    const status = determineStatus(weight);

    // 写入（自动去重合并）
    const saved = db.upsertMemory({
      id: existing?.id,
      type,
      content: c.content,
      keywords,
      importance: c.importance || 1,
      frequency,
      emotionScore: c.emotion_score || 0,
      explicitScore: c.explicit_score || 0,
      recencyScore,
      confidence: c.confidence || 0.7,
      weight,
      status,
    });

    // 记录 mention
    if (lastMessageId) {
      db.insertMention(saved.id, lastMessageId, c.content, c.emotion_score || 0);
    }

    // 🔍 为新/更新记忆生成向量指纹
    embeddings.indexMemory(saved.id, c.content);

    results.push({
      id: saved.id,
      content: c.content.slice(0, 50),
      weight,
      status,
      updated: saved.updated,
    });
  }

  return { extracted: results.length, updated: results };
}

// ─── 定期维护：降权与归档 ──────────────────────────

/**
 * 对过期记忆降权或归档
 * 建议通过定时任务调用（cc-connect /cron 或调度器定期触发）
 */
function runMaintenance() {
  const database = db.getDb();
  const now = Date.now();

  // 过期的 candidate（14 天未出现）→ archived
  database.prepare(`
    UPDATE memories SET status = 'archived', updated_at = datetime('now')
    WHERE status = 'candidate'
      AND last_seen_at IS NOT NULL
      AND julianday('now') - julianday(last_seen_at) > ?
  `).run(config.MEMORY.candidateExpireDays);

  // 过期的 working（30 天未出现）→ 降 recency
  database.prepare(`
    UPDATE memories SET recency_score = MAX(0, recency_score - 3), updated_at = datetime('now')
    WHERE status = 'working'
      AND last_seen_at IS NOT NULL
      AND julianday('now') - julianday(last_seen_at) > ?
  `).run(config.MEMORY.workingExpireDays);

  // 重新计算 working 中可能有降到 candidate 阈值的
  const staleWorking = database.prepare(`
    SELECT id, importance, frequency, emotion_score, explicit_score, recency_score, confidence
    FROM memories WHERE status = 'working'
  `).all();

  for (const m of staleWorking) {
    const weight = calculateWeight(m);
    const newStatus = determineStatus(weight);
    if (newStatus !== 'working') {
      database.prepare(`
        UPDATE memories SET status = ?, weight = ?, updated_at = datetime('now') WHERE id = ?
      `).run(newStatus, weight, m.id);
    }
  }

  const archived = database.prepare("SELECT changes() as c FROM memories WHERE 1=1").get();
  return { maintenance: true };
}

module.exports = {
  calculateWeight,
  determineStatus,
  decayRecency,
  initialRecency,
  extractCandidates,
  processGate,
  runMaintenance,
};
