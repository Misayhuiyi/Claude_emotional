const path = require('path');

// 项目根目录
const ROOT = path.resolve(__dirname, '..');

module.exports = {
  // 项目路径
  PATHS: {
    root: ROOT,
    identityCore: path.join(ROOT, 'identity_core.md'),
    runtimeBrief: path.join(ROOT, 'runtime_brief.md'),
    currentState: path.join(ROOT, 'current_state.md'),
    lastSession: path.join(ROOT, 'last_session.md'),
    checkpoint: path.join(ROOT, 'checkpoint.md'),
    claudeMd: path.join(ROOT, 'CLAUDE.md'),
    dataDir: path.join(ROOT, 'data'),
    memoryDb: path.join(ROOT, 'data', 'memory.db'),
    vectorsDb: path.join(ROOT, 'data', 'vectors.db'),
    logsDir: path.join(ROOT, 'logs', 'raw_messages'),
    memoryMarkdown: path.join(ROOT, 'memory'),
    memorySummaries: path.join(ROOT, 'memory', 'summaries'),
    memoryTopics: path.join(ROOT, 'memory', 'topics'),
  },

  // 上下文控制
  CONTEXT: {
    maxTokens: 6000,              // 超过此阈值触发自动压缩
    maxRecentMessages: 30,        // 保留最近 N 轮对话
    minRecentMessages: 3,         // 压缩后至少保留最近 N 轮完整对话
    maxMemoryInject: 10,          // 最多从 SQLite 注入的记忆条数
    targetInputTokens: [4000, 8000], // 目标输入 token 范围
  },

  // Token 估算系数
  TOKEN_ESTIMATE: {
    chinesePerToken: 0.5,
    englishPerToken: 0.25,
  },

  // 模型选择（cc-connect 通过 /model /provider 也可覆盖）
  MODEL: {
    companion: 'deepseek-v4-flash',   // 陪伴模式（快速）
    professional: 'deepseek-v4-pro',  // 专业模式（强推理）
  },

  // Claude CLI
  CLAUDE: {
    bareMode: true,                   // --bare 模式，跳过 hooks/插件
    timeout: 30000,                   // 单次调用超时（ms）
    note: 'cc-connect 通过 Agent CLI 调用本项目的 Claude Code（沈幼楚人格）',
  },

  // DeepSeek 适配（非 Claude 原生模型时的加强约束）
  DEEPSEEK: {
    enabled: true,                    // 当前底层是 DeepSeek
    rules: {
      shortReply: true,               // 回复少解释、少总结
      emotionFirst: true,             // 先接情绪
      memoryOutputJSON: true,         // 记忆抽取必须输出 JSON
      noTechnicalReport: true,        // 不把情绪问题技术化
      criticalLogicByCode: true,      // 消息写入/权重计算/遗忘标记由代码保证
    },
  },

  // 记忆状态阈值
  MEMORY: {
    candidateWeightMax: 10,
    workingWeightMax: 20,
    permanentWeightMin: 20,
    candidateExpireDays: 14,
    workingExpireDays: 30,
  },

  // 主动资讯推送
  PROACTIVE: {
    enabled: true,                   // 总开关（已开启）
    quietHours: ['23:30', '08:30'], // 勿扰时段 HH:MM
    maxDaily: 3,                     // 每日推送上限
    minGapMinutes: 180,              // 两次推送间最小间隔（分钟）
    summaryReminderStart: '22:00',   // 每日总结提醒开始时间
    maxStudyWeekly: 7,               // 每周学习推送上限
    maxRomanticWeekly: 3,            // 每周浪漫内容上限
    noRepeatForms: 3,                // 连续 N 次推送不重复同一种形式
    noRepeatOpenings: 7,             // N 天内不出现相同句式开头
    pollIntervalMs: 10000,           // 调度器轮询间隔（毫秒）
    cooldownMinutes: 30,           // 推送冷却时间（分钟），防连续推送
  },

  // 默认城市（用于天气推送，可通过 .env 文件或环境变量 CITY 覆盖）
  CITY: process.env.CITY || '广州',
  CITY_LAT: parseFloat(process.env.CITY_LAT) || 23.13,
  CITY_LON: parseFloat(process.env.CITY_LON) || 113.26,
};
