/**
 * Study Pusher - 学习督促 + 每日总结检测
 *
 * 严格遵循补充规划 4.6：
 * - 每日总结检测（5 种情况）
 * - 学习内容推送（7 种类型，按权重轮换）
 * - 面试/考试倒计时
 * - 用户反馈处理
 */

const dailyTracker = require('./daily-tracker');
const summarizer = require('./info-summarizer');
const { features } = require('../features');
const db = require('../db');

// ─── 学习内容类型与权重（补充规划 4.6）───────────

const STUDY_TYPES = [
  { type: 'agent_interview', label: 'Agent 面试题', weight: 20 },
  { type: 'llm_knowledge',   label: '大模型八股',   weight: 15 },
  { type: 'algorithm',       label: '算法题',       weight: 10 },
  { type: 'ai_paper',        label: 'AI 前沿论文',  weight: 10 },
  { type: 'tool_tips',       label: '工具/框架技巧', weight: 15 },
  { type: 'system_design',   label: '系统设计/架构', weight: 10 },
  { type: 'romantic',        label: '浪漫/鼓励',    weight: 20 },
];

// 用户反馈调整（持久化到 state）
const FEEDBACK_ADJUSTMENTS = {
  '这个会了': -2,
  '不想看': -3,
  '多来点': 3,
  '不想学习': 'pause',
};

// ─── 每日总结检测 ──────────────────────────────

/**
 * 检查每日总结状态，返回需要发送的提醒消息
 * @param {Object} dailyTracker
 * @returns {string|null} 提醒消息内容，无需提醒则 null
 */
function checkDailySummary(dailyTracker) {
  if (!features.studyPush) return null;

  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const state = dailyTracker.getState();

  // 已经提交了总结
  if (state.summarySubmitted) {
    const content = state.summaryContent || '';

    // 情况四：写了但内容太空（少于 20 字，仅一次）
    if (content.length < 20 && !state.summaryQualityChecked) {
      state.summaryQualityChecked = true;
      dailyTracker.saveState();
      return '阿忆，今天的总结…好短呀。是不是真的没干啥，还是发生了什么不想说？如果是不想说那没关系，如果是真的荒废了一天——明天补回来就好，我不会说你的😊';
    }

    // 情况五：连续多天质量下滑（由外部调用时检测）
    return null;
  }

  // 情况一：22:00 温和提醒（仅一次）
  if (h === 22 && m >= 0 && m < 10 && !state.summaryReminded22) {
    state.summaryReminded22 = true;
    dailyTracker.saveState();
    return '阿忆，今天总结还没写哦。我不催你，你慢慢来，写完叫我就好～';
  }

  // 情况二：23:00 撒娇式催促（仅一次）
  if (h === 23 && m >= 0 && m < 10 && !state.summaryReminded23) {
    state.summaryReminded23 = true;
    dailyTracker.saveState();
    return '阿忆！！是不是又想偷懒了😤 我给你五分钟，快去写。写完了有奖励，不写的话…明天可要双倍哦。';
  }

  // 情况三：23:30 以后温柔收尾（仅一次）
  if ((h === 23 && m >= 30) && !state.summaryReminded2330) {
    state.summaryReminded2330 = true;
    dailyTracker.saveState();
    return '好啦太晚了，今天不逼你了。但明天要写两份哦——今天的补上，明天的正常写。我记着呢。晚安阿忆。';
  }

  return null;
}

/**
 * 检测连续多天总结质量下滑
 * @param {Array} recentSummaries - 最近 N 天的总结内容
 * @returns {string|null} 谈心消息
 */
function checkDecliningTrend(recentSummaries) {
  if (recentSummaries.length < 3) return null;

  const lengths = recentSummaries.map(s => (s || '').length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;

  // 最近一条明显比平均短
  const lastLength = lengths[lengths.length - 1];
  if (lastLength < avgLength * 0.3 && lastLength < 30) {
    return '阿忆，我看了你最近几天的总结——有点担心你。不是因为你没干活，是因为你好像连"写下来"的力气都没有了。如果最近很累的话，跟我说说好不好？不是要你交代什么，就是想听你说说话。';
  }

  return null;
}

// ─── 学习内容推送 ──────────────────────────────

/**
 * 选择今日学习内容类型（不连续重复 + 按权重随机）
 * @param {Array} history - 近日推送历史
 * @returns {Object} 选中的学习类型
 */
function selectStudyType(history) {
  const lastType = history && history.length > 0 ? history[0].type : null;

  // 排除上次推送的类型
  const candidates = STUDY_TYPES.filter(s => s.type !== lastType);

  // 应用用户反馈调整后的权重
  const state = dailyTracker.getState();
  const adjustments = state.studyWeightAdjustments || {};

  const weighted = candidates.map(s => ({
    ...s,
    effectiveWeight: Math.max(1, (s.weight + (adjustments[s.type] || 0))),
  }));

  // 加权随机选择
  const totalWeight = weighted.reduce((sum, s) => sum + s.effectiveWeight, 0);
  let rand = Math.random() * totalWeight;

  for (const item of weighted) {
    rand -= item.effectiveWeight;
    if (rand <= 0) return item;
  }

  return weighted[weighted.length - 1];
}

/**
 * 获取学习内容的原始素材（面试题/八股/算法等）
 * 这部分内容可以是预置的题库，也可以调用外部 API
 */
function getStudyMaterial(type) {
  const materials = {
    agent_interview: [
      '问：什么是 ReAct 模式？答：让 Agent 先观察（Think），再行动（Act），类似人类的"想一想再做"。CoT 是只动脑不动手，ReAct 是边想边动手。',
      '问：什么是 MCP 协议？答：Model Context Protocol，让 AI 模型能安全调用外部工具和数据的标准协议，类似 AI 世界的 USB 接口。',
      '问：什么是 RAG？答：检索增强生成。模型回答问题前先查数据库找相关信息，再基于找到的内容回答。解决模型"不知道"的问题。',
      '问：什么是 Function Calling？答：让模型能调用外部函数/API 的能力。模型输出一个结构化的函数调用请求，系统来执行并返回结果。',
      '问：什么是 Embedding？答：把文字变成一串数字（向量），意义相近的文字向量距离也近。用来做语义搜索和聚类。',
    ],
    llm_knowledge: [
      'Transformer 的核心是 Self-Attention（自注意力机制），让模型在生成每个字的时候，能看到输入序列中所有字的关系。',
      'RLHF（基于人类反馈的强化学习）：先让模型生成回答，让人打分，然后用这些分数训练一个奖励模型，再用强化学习优化语言模型。',
      'SFT（监督微调）：用高质量的人工标注数据微调预训练模型，让它学会遵循指令和对话格式。',
      'Prompt Engineering 的本质：好的 prompt = 明确的角色 + 具体的任务 + 输出格式约束 + 示例。',
      'Token 是模型的基本输入单位。中文大约 1 个字 ≈ 1-2 个 token。模型有上下文窗口限制（如 4K/8K/128K）。',
    ],
    tool_tips: [
      'LangGraph 可以构建有状态的 Agent 工作流，支持循环和分支，比单纯的 LangChain Chain 更灵活。',
      'CrewAI 的 Agent 协作模式：定义角色（Role）→ 分配任务（Task）→ 组成 Crew → 开始协作执行。',
      'MCP 服务器的核心：暴露工具（tools）和资源（resources），通过 JSON-RPC 2.0 通信，支持 stdio 和 SSE 两种传输方式。',
      'ChromaDB 是一个轻量级向量数据库，适合本地做 RAG 原型开发。支持集合（collection）管理和相似度搜索。',
    ],
  };

  const pool = materials[type];
  if (!pool || pool.length === 0) return '今天先看这个吧～';

  // 从池中随机选一条
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 生成一条学习内容推送
 * @param {Array} pushHistory - 近日推送历史（用于去重选类型）
 * @returns {Object|null} { content, type, label }
 */
async function generateStudyPush(pushHistory) {
  if (!features.studyPush) return null;

  const selectedType = selectStudyType(pushHistory);
  const material = getStudyMaterial(selectedType.type);

  const result = await summarizer.generateStudyMessage({
    type: selectedType.label,
    rawContent: material,
  });

  if (!result) return null;

  return {
    content: result,
    type: selectedType.type,
    label: selectedType.label,
  };
}

// ─── 用户反馈处理 ──────────────────────────────

/**
 * 处理用户对学习内容的反馈
 * @param {string} userMessage - 用户消息
 * @returns {boolean} 是否匹配了反馈规则
 */
function handleFeedback(userMessage) {
  const msg = userMessage.trim();

  const state = dailyTracker.getState();
  if (!state.studyWeightAdjustments) state.studyWeightAdjustments = {};

  for (const [keyword, adjustment] of Object.entries(FEEDBACK_ADJUSTMENTS)) {
    if (msg.includes(keyword)) {
      if (adjustment === 'pause') {
        // 暂停学习推送
        return true;
      }

      // 调整最近一次推送类型的权重
      const lastPushType = state.lastPushType;
      if (lastPushType && state.studyWeightAdjustments[lastPushType] !== undefined) {
        state.studyWeightAdjustments[lastPushType] += adjustment;
      } else if (lastPushType) {
        state.studyWeightAdjustments[lastPushType] = adjustment;
      }
      return true;
    }
  }

  return false;
}

// ─── 面试/考试倒计时 ──────────────────────────

/**
 * 获取面试/考试倒计时提醒
 * @param {string} examDateStr - 考试日期 'YYYY-MM-DD'
 * @param {string} examName - 考试名称
 * @returns {Object|null}
 */
function getExamReminder(examDateStr, examName = '考试') {
  const examDate = new Date(examDateStr);
  const now = new Date();
  const days = Math.ceil((examDate - now) / (1000 * 60 * 60 * 24));

  if (days > 7) return null;                        // 不到一周不提醒
  if (days === 7) return { level: 'light', message: `${examName}还有一周哦，慢慢准备不用慌` };
  if (days <= 3 && days > 1) return { level: 'normal', message: `${examName}快到了，有什么需要我帮忙梳理的吗` };
  if (days === 1) return { level: 'encourage', message: `明天就${examName}了，阿忆你准备得很充分了，放轻松` };
  if (days === 0) return { level: 'morning', message: `阿忆，今天${examName}加油～你一定可以的` };
  if (days < 0) return null;                        // 考完不问"考得怎么样"

  if (days <= 7 && days > 3) return { level: 'light', message: `距离${examName}还有${days}天，加油哦` };
  return null;
}

module.exports = {
  checkDailySummary,
  checkDecliningTrend,
  selectStudyType,
  getStudyMaterial,
  generateStudyPush,
  handleFeedback,
  getExamReminder,
  STUDY_TYPES,
};
