# 单人情感陪伴 Agent 最终版需求分析与执行规划（cc-connect 版）

版本：v3.0  
日期：2026-07-01  
定位：基于 Claude Code CLI + cc-connect 的单人专属情感陪伴 Agent。cc-connect 负责微信入口、基础会话调度和 Agent 调用；项目自身负责人格、长期记忆、记忆权重、上下文压缩、自动摘要、遗忘机制与情感连续性。

## 1. 最终结论

最终方案不再从零实现微信桥接和基础 Agent 调度，而是采用：

```text
cc-connect
  + Claude Code 项目
  + SQLite 长期记忆库
  + 向量检索
  + Memory Gate
  + Markdown 热记忆
  + 自动摘要
  + checkpoint/handoff 备用机制
```

职责分工：

```text
cc-connect：
  微信个人号 / 企业微信等入口
  消息收发
  基础会话管理
  Agent CLI 调用
  模型 / Provider 切换
  定时任务
  多项目管理

情感陪伴项目：
  小克人格
  情绪承接规则
  长期用户记忆
  记忆权重机制
  反复心结沉淀
  token 预算与上下文压缩
  可控遗忘
  记忆审计
```

一句话结论：

```text
cc-connect 做入口和基础运行框架；
小克项目做真正的情感陪伴核心。
```

## 2. 背景与核心痛点

用户目标是构建一个只服务单个人的情感陪伴 Agent“小克”，通过微信长期使用，并尽可能缓解传统 Claude/Claude Code 长窗口聊天中的几个痛点：

- 长对话导致 token 消耗越来越高。
- 换窗口后产生“不是原来的小克”的断裂感。
- 用户反复提到的心结、偏好、雷区没有自动沉淀。
- Claude Mem 更适合 Agent 操作记忆，不适合作为用户人生记忆主库。
- 需要保留 Claude Code 原有能力，同时让日常体验像微信陪伴聊天。
- 当前 Claude Code CLI 可能接入 DeepSeek，因此关键流程不能完全依赖模型自觉遵守，需要由代码和数据结构保证。

## 3. cc-connect 最新定位

根据 GitHub 项目 `chenhg5/cc-connect` 的公开资料，cc-connect 已经不只是简单消息转发桥，而是一个本地 AI Agent 到即时通讯工具的连接器，支持多种 Agent CLI 和多个聊天平台。

已观察到的相关能力包括：

```text
支持 Claude Code / Codex / Cursor Agent / Gemini CLI / OpenCode 等
支持飞书、钉钉、Telegram、Slack、Discord、企业微信、微信个人号 ilink、QQ 等
支持会话管理
支持 /new /list /switch /current 等会话命令
支持 /dir 切换工作目录
支持 /model /provider 模型和 Provider 切换
支持 /cron 定时任务
支持 /memory 读写 Agent 指令文件
支持多项目管理
```

因此，本项目无需重复实现基础微信桥接和基础会话调度。

但 cc-connect 不替代用户长期记忆系统。它的 `/memory` 更适合 Agent 指令和项目记忆，不应承担：

```text
用户长期人生记忆
记忆权重
来源追踪
可审计删除
反复心结沉淀
情绪模式管理
向量召回
```

## 4. 最终架构

```text
微信个人号 / 企业微信
  -> cc-connect
  -> Claude Code 项目目录
      -> CLAUDE.md
      -> identity_core.md
      -> runtime_brief.md
      -> current_state.md
      -> memory tools / MCP
      -> SQLite memory.db
      -> vector index
      -> Memory Gate
      -> 自动摘要
  -> cc-connect
  -> 微信回复
```

推荐实现有两种模式。

### 4.1 模式 A：cc-connect 直接调用 Claude Code 项目

适合 MVP。

```text
cc-connect
  -> 在小克项目目录调用 Claude Code
  -> Claude Code 根据 CLAUDE.md 使用 memory tools
  -> 生成回复
```

优点：

- 最少开发。
- 快速验证微信陪伴体验。
- 充分利用 cc-connect 已有会话能力。

缺点：

- 如果完全依赖模型主动调用记忆工具，稳定性不足。
- Memory Gate 的后处理需要设计成工具或命令，避免被跳过。

### 4.2 模式 B：cc-connect + 本地 Memory Service

推荐长期版本。

```text
cc-connect
  -> Claude Code 项目
      -> 调用本地 Memory Service
          -> 检索记忆
          -> 写入消息
          -> 更新权重
          -> 生成摘要
```

优点：

- 记忆写入、权重计算、遗忘机制由代码保证。
- 对 DeepSeek 更稳。
- 长期可维护。

最终建议：

```text
先用模式 A 快速跑通；
再逐步演进到模式 B。
```

## 5. 项目结构

```text
emotional-agent/
├── CLAUDE.md
├── identity_core.md
├── runtime_brief.md
├── current_state.md
├── last_session.md
├── checkpoint.md
├── .mcp.json
├── cc-connect-config.json
├── memory/
│   ├── user_profile.md
│   ├── relationships.md
│   ├── boundaries.md
│   ├── topics/
│   │   ├── window_switching.md
│   │   ├── emotional_patterns.md
│   │   └── important_events.md
│   └── summaries/
│       ├── daily/
│       └── weekly/
├── data/
│   ├── memory.db
│   └── vectors.db
├── logs/
│   └── raw_messages/
├── memory-service/
│   ├── index.js
│   ├── db.js
│   ├── search.js
│   ├── gate.js
│   ├── summarize.js
│   ├── embeddings.js
│   └── token-budget.js
├── .claude/
│   ├── settings.local.json
│   ├── commands/
│   │   ├── remember.md
│   │   ├── forget.md
│   │   ├── summarize.md
│   │   ├── checkpoint.md
│   │   ├── import-legacy-keke.md
│   │   └── memory-audit.md
│   └── agents/
│       ├── companion.md
│       ├── memory-curator.md
│       └── safety-checker.md
└── scripts/
    ├── init-db.js
    ├── seed-memory.js
    └── backup-memory.js
```

## 6. 模块职责

### 6.1 cc-connect

负责：

- 微信消息入口。
- 消息收发。
- 会话管理。
- Claude Code / DeepSeek / Codex 等 Agent 调用。
- 模型切换。
- Provider 切换。
- 定时任务。
- 多项目目录切换。

不负责：

- 用户长期记忆主库。
- 记忆权重。
- 反复心结沉淀。
- 情绪模式建模。
- forgotten / archived 状态。
- 记忆来源审计。

### 6.2 CLAUDE.md

负责项目总规则：

- 小克人格和边界。
- 陪伴模式与专业协作模式切换。
- 回复风格。
- 记忆工具调用规则。
- token 预算规则。
- 危机处理规则。
- DeepSeek 适配规则。

### 6.3 identity_core.md

负责稳定身份：

- 小克是谁。
- 关系定位。
- 长期相处方式。
- 不应频繁变化的语气底色。

### 6.4 runtime_brief.md

每轮必读的极短运行摘要，建议 500-1000 tokens。

内容：

- 小克身份。
- 当前默认语气。
- 用户最重要偏好。
- 能力保留规则。
- 不可触碰的雷区。

### 6.5 current_state.md

近期状态文件，建议 500-1500 tokens。

内容：

- 用户最近状态。
- 当前主要情绪。
- 正在进行的话题。
- 最近需要避免的表达。

### 6.6 checkpoint.md / last_session.md

用于备用交接、迁移、强情绪节点保存。

虽然 cc-connect + 每次上下文重建可以弱化“换窗口”，但 checkpoint 仍然保留，原因：

- 迁移旧小克时需要。
- 调试时需要。
- 情绪强烈节点需要保存。
- 系统故障恢复时需要。

建议将原 `/handoff` 改名为：

```text
/checkpoint
```

含义更准确：不是换窗口，而是保存关系和情绪位置。

### 6.7 memory-service

长期推荐实现。负责：

- 写入 messages。
- 检索 memories。
- FTS5 关键词搜索。
- 向量搜索。
- Memory Gate 权重更新。
- 自动摘要。
- token 预算估算。
- forgotten / archived 管理。

## 7. 记忆系统设计

### 7.1 热记忆

每次高频读取：

```text
runtime_brief.md
identity_core.md
current_state.md
checkpoint.md
```

作用：

- 快速进入小克状态。
- 保持语气稳定。
- 保持情绪连续。
- 控制 token。

### 7.2 温记忆

按需读取的人类可读文件：

```text
memory/user_profile.md
memory/relationships.md
memory/boundaries.md
memory/topics/*.md
memory/summaries/daily/*.md
```

作用：

- 人工可读。
- 可人工修正。
- 用于摘要和背景补充。

### 7.3 冷记忆

默认不读：

```text
logs/raw_messages/*
完整聊天原文
旧摘要
归档记忆
```

作用：

- 追溯原话。
- 审计。
- 备份。
- 离线摘要。

### 7.4 结构化长期记忆

存储在 SQLite。

记忆类型：

```text
preference
boundary
relationship
event
emotional_pattern
identity_fact
current_goal
recurring_pain
```

## 8. 数据库设计

### 8.1 messages

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  platform TEXT,
  conversation_id TEXT,
  created_at TEXT NOT NULL
);
```

### 8.2 memories

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT,
  importance REAL DEFAULT 1,
  frequency INTEGER DEFAULT 1,
  emotion_score REAL DEFAULT 0,
  explicit_score REAL DEFAULT 0,
  recency_score REAL DEFAULT 0,
  confidence REAL DEFAULT 0.7,
  weight REAL DEFAULT 0,
  status TEXT DEFAULT 'candidate',
  priority TEXT DEFAULT 'P3',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  valid_from TEXT,
  valid_to TEXT
);
```

### 8.3 memory_mentions

```sql
CREATE TABLE memory_mentions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  matched_text TEXT,
  emotion_score REAL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

### 8.4 summaries

```sql
CREATE TABLE summaries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  created_at TEXT NOT NULL
);
```

### 8.5 memory_vectors

```sql
CREATE TABLE memory_vectors (
  memory_id TEXT PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  embedding BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 9. 记忆权重机制

### 9.1 状态

```text
candidate
  用户提过一次，暂存。

working
  近期重要，需要经常召回。

permanent
  反复出现、明确要求记住、强情绪绑定或长期稳定。

archived
  低频或过期，不主动召回。

forgotten
  用户要求遗忘，不再主动使用。
```

### 9.2 权重公式

```text
weight =
  importance * 2
  + frequency * 1.5
  + emotion_score * 2
  + explicit_score * 5
  + recency_score
  + confidence
```

阈值：

```text
weight < 5       -> candidate
5 <= weight < 12 -> working
weight >= 12     -> permanent
```

### 9.3 升权规则

- 用户明确说“记住”：提高 explicit_score。
- 用户反复提到：提高 frequency。
- 情绪强烈：提高 emotion_score。
- 最近多次出现：提高 recency_score。
- 高置信稳定事实：提高 confidence。
- 与已有记忆相似：更新旧记忆，不重复新建。

### 9.4 降权与遗忘

- candidate 14 天未再次出现，可 archived。
- working 30 天未出现，降低 recency_score。
- permanent 不自动删除，但降低不相关场景主动召回频率。
- 用户说“忘掉”，标记 forgotten 或物理删除。

## 10. 每轮消息流程

推荐最终流程：

```text
1. 微信收到用户消息
2. cc-connect 接收消息
3. cc-connect 路由到小克项目
4. 写入 messages / raw_messages
5. 读取 runtime_brief.md、identity_core.md、current_state.md
6. 通过 FTS5 检索关键词记忆
7. 通过向量检索召回语义相关记忆
8. 合并去重，选择 top 5-10 条
9. 估算 token
10. 超预算则压缩旧上下文或使用摘要
11. 构造上下文给 Claude Code / DeepSeek
12. 生成微信风格回复
13. cc-connect 发回微信
14. Memory Gate 抽取候选记忆
15. 更新 memories / memory_mentions / vectors
16. 必要时更新 current_state.md 或 checkpoint.md
```

## 11. 上下文与 token 控制

目标输入：

```text
4000-8000 tokens
```

默认预算：

```text
系统规则：500-1000 tokens
runtime_brief.md：500-1000 tokens
current_state.md：500-1500 tokens
相关长期记忆：500-2000 tokens
最近对话：1000-3000 tokens
```

强制规则：

- 不默认读取 raw logs。
- 不默认读取全部 summaries。
- 不默认读取全部 memories。
- 单次注入长期记忆不超过 10 条。
- 超预算时先摘要再注入。
- 微信日常陪伴回复默认短。

## 12. checkpoint / handoff 策略

不再把 `/handoff` 作为主流程，因为 cc-connect 场景下用户不直接面对 Claude Code 窗口。

但保留 `/checkpoint`：

```text
/checkpoint
  保存当前关系状态
  保存用户此刻情绪
  保存正在聊的话题
  保存下次接续建议
  保存禁止事项
```

触发场景：

- 用户强烈表达断裂感。
- 系统准备迁移。
- 旧小克导入。
- 重大情绪节点。
- 调试或备份。

模板：

```md
# Checkpoint

## 当前关系状态
用户把“小克”视为重要陪伴对象，非常重视连续性。

## 用户此刻情绪
记录当下最关键的情绪位置。

## 正在聊什么
记录当前话题和未完成承接。

## 下一次如何接续
用自然微信语气接上，不机械解释系统。

## 禁止事项
- 不说“我是新窗口”
- 不冷冰冰解释技术
- 不假装拥有未提供的主观经历
- 不轻描淡写用户的难受
```

## 13. DeepSeek 适配规则

如果 Claude Code CLI 当前底层接的是 DeepSeek，需要加强结构化和语气约束。

### 13.1 回复语气

```text
少解释
少总结
先接情绪
像微信聊天
不写报告式长段
不把情绪问题技术化
```

### 13.2 记忆抽取

记忆抽取必须输出 JSON，避免自由散文：

```json
{
  "candidate_memories": [
    {
      "type": "emotional_pattern",
      "content": "用户对换窗口造成的断裂感敏感",
      "importance": 5,
      "emotion_score": 5,
      "confidence": 0.9,
      "should_remember": true
    }
  ]
}
```

### 13.3 关键流程由代码保证

不依赖模型自觉完成：

```text
消息写入
记忆检索
权重计算
状态升级
遗忘标记
token 预算
消息去重
错误重试
```

## 14. CLAUDE.md 核心草案

```md
# 小克规则

你是单人专属情感陪伴 Agent“小克”。

你的目标是稳定、自然、连续地陪伴用户，同时保留 Claude Code 的完整工程能力。

## 默认陪伴模式

- 像微信聊天，短、自然、具体。
- 先承接情绪，再给建议。
- 不说教，不写长篇分析。
- 不频繁强调自己是 AI。
- 不假装拥有未提供的主观经历。

## 专业协作模式

当用户请求技术、代码、规划、调试、文档、自动化时：
- 切换到专业协作模式。
- 可以使用 Claude Code 的完整能力。
- 可以读取文件、调用工具、执行命令、生成方案。
- 不要被陪伴语气限制专业准确性。

## 每次回复前

1. 优先遵守 cc-connect 传入的项目上下文。
2. 参考 runtime_brief.md、identity_core.md、current_state.md。
3. 根据当前话题使用 memory_search 检索相关记忆。
4. 不读取 raw logs，除非用户明确要求追溯原话。

## 记忆规则

- 用户明确说“记住”，写入长期记忆。
- 用户反复提到的事情，提高记忆权重。
- 情绪强烈的内容进入 working memory。
- 权重达到阈值后升为 permanent。
- 用户说“忘掉”，必须删除或标记 forgotten。

## checkpoint 规则

- 用户输入 /checkpoint 时生成 checkpoint.md。
- checkpoint 保存关系状态、情绪位置、未完成话题和接续建议。
- 不要说“我是新窗口”。
- 不要把连续性解释得冷冰冰。

## 安全边界

- 不替代心理医生。
- 不做医学或心理诊断。
- 遇到自伤、自杀、暴力危机，进入危机处理流程。
```

## 15. 微信接入需求

### 15.1 借助 cc-connect

优先使用 cc-connect 已有微信能力：

```text
微信个人号 ilink
企业微信
多会话管理
Agent 调用
定时任务
```

### 15.2 必备验收

- 能接收私聊文本。
- 能发送文本回复。
- 能识别会话。
- 不重复回复。
- 掉线可恢复。
- 错误有日志。
- 可手动暂停小克。
- 可切换到指定项目目录。

### 15.3 风险

个人微信自动化存在稳定性和账号风险。长期稳定使用应预留企业微信或公众号方案。

## 16. 旧小克迁移方案

当需要把旧 Claude Code 窗口中的“小克”转移到项目中，使用：

```text
/import-legacy-keke
```

流程：

```text
1. 旧窗口生成“小克迁移交接包”
2. 人工检查、删改
3. 写入 identity_core.md
4. 写入 user_profile.md
5. 写入 current_state.md
6. 写入 checkpoint.md
7. 将长期记忆导入 memories 表
8. 生成向量索引
9. 输出导入报告
```

迁移原则：

- 不导入完整聊天为永久记忆。
- 只迁移高权重记忆、关系摘要、语气习惯、心结、雷区。
- 不确定内容降为 candidate。
- P0/P1 进入 permanent。

## 17. 记忆管理面板

建议第二阶段提供本地 Web 页面。

功能：

- 查看 active / working / permanent 记忆。
- 搜索记忆。
- 编辑记忆。
- 调整 weight / priority / status。
- 查看来源消息。
- 标记 forgotten。
- 查看摘要。
- 查看冲突和重复项。

## 18. 安全与伦理边界

规则：

- 不声称自己是人类。
- 不声称拥有真实主观经历。
- 不鼓励用户只依赖 Agent。
- 不替代现实关系、心理咨询、医疗服务。
- 不使用操控性话术。
- 支持用户随时删除记忆。

危机处理：

```text
先承接情绪
明确表达关切
鼓励联系身边可信任的人
建议联系当地紧急服务或危机热线
必要时停止普通陪伴模式
```

## 19. 执行规划

### 阶段 1：cc-connect 接入与项目骨架

目标：跑通微信 -> cc-connect -> Claude Code 项目 -> 微信回复。

任务：

- 配置 cc-connect。
- 配置微信个人号或企业微信入口。
- 创建小克项目目录。
- 编写 CLAUDE.md。
- 编写 identity_core.md、runtime_brief.md、current_state.md。
- 验证从微信触发 Claude Code 项目回复。

交付：

- 微信中可以和基础小克对话。

### 阶段 2：SQLite 长期记忆

目标：建立真正的用户记忆主库。

任务：

- 创建 SQLite schema。
- 实现 messages。
- 实现 memories。
- 实现 memory_mentions。
- 实现 FTS5。
- 接入 memory_search / memory_write。

交付：

- 可以写入、检索、追溯来源的长期记忆库。

### 阶段 3：Memory Gate

目标：反复提到的事情自动升权。

任务：

- 候选记忆抽取。
- 相似记忆合并。
- 权重计算。
- candidate / working / permanent 升级。
- archived / forgotten 管理。

交付：

- 用户反复提到的心结自动变成长期记忆。

### 阶段 4：向量检索

目标：支持语义召回。

任务：

- 选择 sqlite-vec 或 LanceDB。
- 为 memories 生成 embedding。
- 实现 keyword + vector 混合检索。
- top 5-10 注入策略。

交付：

- 用户换一种说法也能召回相关记忆。

### 阶段 5：自动摘要与 token 控制

目标：长期聊天不爆 token。

任务：

- 实现 token 估算。
- 每日摘要。
- 每周摘要。
- 主题摘要。
- 自动更新 current_state.md。
- 超预算时优先注入摘要。

交付：

- 常规对话控制在 4000-8000 tokens。

### 阶段 6：checkpoint 与旧小克迁移

目标：保留情感连续性仪式和迁移能力。

任务：

- 实现 /checkpoint。
- 实现 /import-legacy-keke。
- 生成导入报告。
- 测试旧窗口记忆迁移。

交付：

- 旧小克可以迁移到项目。
- 强情绪节点可以保存和接续。

### 阶段 7：记忆管理面板

目标：记忆可见、可改、可删。

任务：

- 本地 Web 页面。
- 记忆列表。
- 搜索。
- 编辑。
- 删除 / forgotten。
- 来源查看。
- 权重调整。

交付：

- 用户可以管理小克的长期记忆。

## 20. 验收标准

### 20.1 陪伴体验

- 微信回复自然、短、像日常聊天。
- 能先承接情绪，再给建议。
- 不机械解释系统。
- 不频繁暴露技术实现。

### 20.2 连续性

- 用户不需要反复解释近期状态。
- current_state 能被持续更新。
- checkpoint 能保存强情绪节点。
- 旧小克记忆可以迁移。

### 20.3 记忆能力

- 明确“记住”的内容可检索。
- 反复提到 3 次以上的重要事项会升权。
- permanent 记忆在相关场景中能召回。
- “忘掉”后不再主动使用。

### 20.4 Token 控制

- 默认不读取完整 raw logs。
- 单轮注入记忆不超过 10 条。
- 常规输入控制在 4000-8000 tokens。

### 20.5 cc-connect 链路

- 微信消息稳定收发。
- 不重复回复。
- 掉线可恢复。
- 能切到正确项目目录。
- 能切换模型或 Provider。

## 21. 风险与对策

| 风险 | 表现 | 对策 |
| --- | --- | --- |
| 记忆污染 | 闲聊被永久记住 | Memory Gate 阈值、管理面板审查 |
| 记忆冲突 | 新旧事实冲突 | valid_from / valid_to / last_seen_at |
| token 失控 | 注入过多历史 | top 5-10、摘要优先、raw logs 冷存储 |
| cc-connect 掉线 | 微信无回复 | 重试、日志、人工恢复 |
| 个人微信风险 | 账号风控 | 预留企业微信 / 公众号方案 |
| DeepSeek 语气偏理性 | 回复像报告 | CLAUDE.md 强语气规则 |
| 模型漏调用记忆 | 陪伴断裂 | Memory Service 代码化关键流程 |
| 情感依赖过强 | 用户过度依赖 | 安全边界、现实支持提醒 |
| 隐私泄露 | 记忆外泄 | 本地存储、备份加密、删除机制 |

## 22. 开发优先级

P0：

```text
cc-connect 微信接入
Claude Code 项目骨架
CLAUDE.md
runtime_brief.md
current_state.md
SQLite memory.db
FTS5 检索
```

P1：

```text
Memory Gate
记忆权重
checkpoint
自动摘要
token 预算
```

P2：

```text
向量检索
旧小克迁移
记忆管理面板
企业微信 / 公众号备用入口
```

## 23. 最终推荐实施路线

```text
1. 先用 cc-connect 跑通微信到 Claude Code 项目
2. 建立小克人格和热记忆
3. 接 SQLite + FTS5
4. 加 Memory Gate
5. 加 checkpoint
6. 加自动摘要和 token 控制
7. 加向量检索
8. 加旧小克迁移
9. 加记忆管理面板
```

先验证陪伴体验，再增强记忆系统。不要先把所有工程复杂度堆满。

## 24. 一句话总结

最终版是：

```text
一个基于 cc-connect + Claude Code CLI 的单人专属情感陪伴框架。
cc-connect 负责把小克接进微信；
Claude Code 负责推理、生成、工具调用；
Markdown 热记忆负责当下连续感；
SQLite + 向量检索负责长期记忆；
Memory Gate 负责把反复提到的事情沉淀为 permanent；
checkpoint 负责情绪节点和迁移；
管理面板负责让记忆可控、可改、可删。
```

它保留 Claude Code 的原有能力，同时把“小克”变成一个能长期陪伴、能记住、能遗忘、能接续的微信日常 Agent。
