# 单人情感陪伴 Agent 最终版需求分析与执行规划

版本：v2.1  
日期：2026-06-30  
定位：基于 Claude Code CLI 的单人专属情感陪伴 Agent，通过微信使用，保留 Claude Code 原有能力，同时具备长期记忆、自动上下文压缩、记忆权重、语义检索、自动摘要与可控遗忘能力。

## 1. 最终结论

本项目采用"Claude Code CLI 调度器 + 自建长期记忆系统"的融合架构。

核心判断：

- `claude --bare --print` 作为每次消息的推理引擎，延迟 ~1.7s。
- **调度器（Node.js）** 管理上下文生命周期，每次调用时自己拼接热记忆 + 相关记忆 + 最近对话。
- 上下文自动压缩是主流程，用户无感知。
- `/checkpoint` 作为手动备用命令，用于极端情况（迁移、调试、情绪强烈时生成交接包），同时满足"情感连续性的仪式感"需求。
- CLAUDE.md 负责规则、语气、能力切换。
- 用户长期记忆使用 SQLite + FTS5 + 向量检索 + Memory Gate。
- Markdown 热记忆负责每次快速进入状态。
- 调度器根据消息类型自动切换模型（陪伴用 fast / 工程用 pro）。
- 微信 / CC Connect 负责日常陪伴入口。

最终方案：

```text
Claude Code CLI (claude --bare --print)
+ 调度器（Node.js）
+ CLAUDE.md
+ Markdown 热记忆
+ SQLite 长期记忆库
+ FTS5 全文检索
+ 向量检索（v2）
+ Memory Gate 权重机制
+ 自动摘要
+ 上下文自动压缩（日常主流程）
+ /checkpoint（手动备用，满足仪式感）
+ last_session.md（冷备交接参考）
+ CC Connect / 微信桥接
```

## 2. 用户痛点分析

### 2.1 换窗口断裂感

用户在长对话中会把 Agent 视为持续陪伴对象。窗口满了之后，即使新窗口读取旧记忆，用户仍可能感觉"这不是原来的小克，而是另一个窗口在扮演"。

痛点本质不是技术上的上下文丢失，而是关系连续性的断裂。

解决方向：

- **方案 A 天然解决**：每次 `claude --bare --print` 调用都是一个"干净"进程，调度器自己控制上下文内容。
- 用户只看到微信里一条接一条的消息，**不存在"窗口"概念**。
- 调度器保证每次注入的热记忆 + 历史对话足够连续。
- 回复时避免刺痛用户的表达，例如"我是新窗口""我只是读取记忆"。

### 2.2 Token 消耗过高

用户长时间不换窗口，会导致上下文越来越长，两句话也可能消耗大量 token。

解决方向：

- 调度器精确估算每次调用输入的总 token。
- 只读热记忆 + 相关长期记忆 top 5-10 + 最近几轮聊天。
- 超过阈值时自动压缩早期对话为摘要。
- 原始日志冷存储，默认不读。

### 2.3 长期记忆不可控

单纯 Markdown 容易变长、冲突、难检索。Claude Mem 又不适合承担用户人生记忆库（且本机 Chroma 不可用）。

解决方向：

- SQLite 做结构化长期记忆 — **唯一记忆主库**。
- memory_mentions 保留来源。
- forgotten / archived 支持遗忘和归档。
- Memory Gate 决定是否写入、升权、降权。

### 2.4 反复提到的事情没有自动沉淀

用户希望反复提到的心结、偏好、雷区可以自动变成永久记忆。

解决方向：

- 引入 frequency、emotion_score、explicit_score、recency_score、importance、confidence。
- 用权重公式决定 candidate -> working -> permanent。

## 3. 最终项目结构

```text
情感陪伴项目/
├── CLAUDE.md
├── identity_core.md
├── runtime_brief.md
├── current_state.md
├── last_session.md
├── orchestrator/
│   ├── index.js                  # 调度器主入口
│   ├── context-manager.js        # 上下文拼接 + token 估算
│   ├── claude-runner.js          # 调用 claude --bare --print
│   ├── memory-gate.js            # 回复后记忆抽取与写入
│   ├── summarizer.js             # 历史压缩
│   ├── wechat-bridge.js          # 微信消息收发
│   └── config.js                 # 模型切换、阈值配置
├── memory/
│   ├── user_profile.md
│   ├── relationships.md
│   ├── boundaries.md
│   ├── summaries/
│   │   ├── daily/
│   │   └── weekly/
│   └── topics/
│       ├── window_switching.md
│       ├── emotional_patterns.md
│       └── important_events.md
├── data/
│   ├── memory.db                 # SQLite 长期记忆主库
│   └── vectors.db                # 向量索引（v2）
├── logs/
│   └── raw_messages/
├── .claude/
│   ├── settings.local.json       # 项目级配置（模型、密钥）
│   ├── commands/
│   │   ├── remember.md
│   │   ├── forget.md
│   │   ├── summarize.md
│   │   └── memory-audit.md
│   └── agents/
│       ├── companion.md
│       ├── memory-curator.md
│       └── safety-checker.md
├── scripts/
│   ├── init-db.js                # 初始化 SQLite schema
│   └── seed-memory.js            # 测试用记忆种子
└── cc-connect-config.json
```

## 4. 各模块职责

### 4.1 CLAUDE.md

项目总规则，负责：

- 小克的核心行为规范。
- 陪伴模式与专业协作模式切换。
- 每次回复前读取哪些文件。
- 记忆写入规则。
- token 预算。
- 安全边界。

### 4.2 identity_core.md

稳定人格层，负责：

- 小克是谁。
- 小克的关系定位。
- 长期语气。
- 陪伴边界。
- 与用户相处的基本方式。

此文件不应频繁变化。

### 4.3 runtime_brief.md

每轮必读的极短运行摘要，建议 500-1000 tokens。

内容包括：

- 小克身份。
- 当前默认回复风格。
- 用户最核心的稳定偏好。
- 当前最重要的注意事项。
- 能力保留规则。

### 4.4 current_state.md

近期状态层，建议 500-1500 tokens。

内容包括：

- 用户最近几天的状态。
- 当前主要情绪。
- 当前正在推进的话题。
- 最近需要避开的表达。

### 4.5 last_session.md

保留，作为冷备份交接参考。当调度器需要启动全新周期时读取。

### 4.6 调度器 (orchestrator/)

项目核心大脑，替代了原方案中的 Claude Mem 辅助层 + 手动 /handoff。

负责：

- 微信消息接收与回复发送。
- 每次拼接上下文：热记忆 + 相关记忆 + 最近对话。
- 估算 token，控制输入在预算内。
- 超过阈值时自动压缩早期对话。
- 调用 `claude --bare --print` 获取回复。
- 回复后触发 Memory Gate 抽取记忆。
- 根据消息类型自动切换模型（flash / pro）。

### 4.7 data/memory.db

真正的长期用户记忆主库。

负责：

- 结构化长期记忆。
- 记忆权重。
- 记忆状态。
- 来源追踪。
- 遗忘和归档。

### 4.8 data/vectors.db

语义检索层（v2）。

负责：

- 用户说法不一致时召回相关记忆。
- 检索相似情绪、事件、偏好。
- 配合 FTS5 提高召回质量。

### 4.9 .claude/commands

Claude Code 自定义命令。

建议命令：

```text
/remember
  明确写入长期记忆。

/forget
  删除或标记 forgotten。

/summarize
  生成每日/主题摘要。

/checkpoint
  手动生成交接包（更新 last_session.md + current_state.md）。
  日常上下文压缩已由调度器自动完成，此命令用于：
  - 情绪强烈时想保存当前情绪位置
  - 调度器升级/迁移前做快照
  - 手动调试和追溯
  本质作用不只是技术备份，更是"情感连续性的仪式感"。

/memory-audit
  检查记忆冲突、过期、重复、污染。
```

### 4.10 .claude/agents

情感陪伴专用子 Agent（供手动调试使用）。

```text
companion
  负责主对话和情绪承接。

memory-curator
  负责记忆抽取、合并、升权、摘要。

safety-checker
  负责危机信号、自伤风险、边界检查。
```

## 5. 记忆分层方案

### 5.1 热记忆

每次必读或高频读取。

```text
runtime_brief.md
identity_core.md
current_state.md
last_session.md (冷备)
```

目标：

- 快速进入"小克"的状态。
- 保持关系连续性。
- 控制 token。

### 5.2 温记忆

按需读取的人类可读文件。

```text
memory/user_profile.md
memory/relationships.md
memory/boundaries.md
memory/topics/*.md
memory/summaries/daily/*.md
```

目标：

- 保存可读摘要。
- 支持人工修改。
- 为 SQLite 之外提供可解释背景。

### 5.3 冷记忆

默认不读。

```text
logs/raw_messages/*
完整历史聊天
旧摘要
归档记忆
```

目标：

- 追溯原话。
- 审计。
- 离线摘要。
- 数据备份。

### 5.4 长期结构化记忆

存储在 SQLite。

类型：

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

## 6. 数据库设计

### 6.1 messages

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  conversation_id TEXT,
  created_at TEXT NOT NULL
);
```

### 6.2 memories

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

### 6.3 memory_mentions

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

### 6.4 summaries

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

### 6.5 memory_vectors

```sql
CREATE TABLE memory_vectors (
  memory_id TEXT PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  embedding BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 7. 记忆权重机制

### 7.1 记忆状态

```text
candidate
  用户提过一次，暂存。

working
  近期重要，当前阶段需要经常召回。

permanent
  反复出现、明确要求记住、强情绪绑定或长期稳定。

archived
  过期或低频，不再主动召回。

forgotten
  用户要求遗忘，不再主动使用。
```

### 7.2 权重公式

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

### 7.3 升权规则

- 用户明确说"记住"：explicit_score 提高。
- 用户反复提到：frequency 提高。
- 情绪强烈：emotion_score 提高。
- 最近多次出现：recency_score 提高。
- 内容稳定且高置信：confidence 提高。
- 与已有记忆相似：更新旧记忆，不重复新建。

### 7.4 降权与归档

- candidate 14 天未再次出现，可 archived。
- working 30 天未出现，降低 recency_score。
- permanent 不自动删除，但可降低主动召回频率。
- 用户说"忘掉"，标记 forgotten 或物理删除。

## 8. 每轮对话流程（调度器驱动）

```text
1. 微信 / CC Connect 收到消息
2. 调度器写入 SQLite messages + logs/raw_messages
3. 调度器读取 runtime_brief.md + identity_core.md
4. 调度器读取 current_state.md
5. 调度器用 FTS5 做关键词检索 SQLite 记忆
6. 调度器检索最近 N 轮对话（内存中维护）
7. 调度器合并去重，选择 top 5-10 条记忆
8. 调度器估算总 token
   → 超过阈值（默认 6000）？先压缩最早的对话为摘要
9. 调度器拼接完整上下文：
      [系统指令] + [热记忆] + [相关记忆] + [最近对话] + [用户新消息]
10. 调度器执行：
       claude --bare --print --model deepseek-v4-flash -p "回复"
       （工程任务切换为 claude --print --model deepseek-v4-pro）
11. 获取回复，发回微信
12. 调度器触发 Memory Gate：从对话中抽取候选记忆
13. 更新 memories / memory_mentions
14. 必要时更新 current_state.md
```

## 9. 上下文压缩与 Checkpoint 机制

### 9.1 自动上下文压缩（主流程）

#### 9.1.1 触发条件（调度器自动判断）

- 拼接后的上下文 token 估算超过阈值（默认 6000）。
- 最近对话轮次超过上限（默认 30 轮）。

### 9.2 压缩流程

```text
1. 保留最近 3 轮完整对话（保留情绪位置）
2. 将更早的对话传给 claude --bare --print "请摘要以下对话"
3. 将生成的摘要插入上下文顶部
4. 可选：更新 current_state.md 中的状态描述
5. 继续正常回复
```

### 9.3 为什么自动压缩是主流程

原方案的 /handoff 是为了解决"Claude Code REPL 窗口满了 → 杀进程 → 开新窗口"的问题。

方案 A 中：

- 每次消息都是 `claude --bare --print` 新进程。
- 调度器自己管理"什么进上下文"。
- **不存在窗口概念**，自然没有"换窗断裂感"。
- 用户只看到微信一条消息接一条，Agent 始终是同一个人。

### 9.4 last_session.md 保留用途

作为冷备，用于极端情况（调度器重启、数据迁移、手动调试）：

```md
# Last Session

## 当前关系状态
用户把"小克"视为重要陪伴对象，非常重视连续性。

## 用户此刻情绪
（上次 session 结束时用户的状态）

## 刚才正在聊什么
（最近话题摘要）

## 注意事项
- 不机械解释"我是新进程"
- 不假装拥有未提供的真实主观经历
- 先承接情绪
```

### 9.5 /checkpoint 手动备用命令

#### 9.5.1 定位

日常上下文压缩由调度器自动完成，`/checkpoint` 作为**手动备用命令**保留，用于：

- **情绪强烈时**：用户想保存此刻的情绪位置，作为后续回溯的锚点。
- **迁移/升级前**：调度器版本更新、数据迁移前做一次完整快照。
- **手动调试**：检查和干预当前上下文状态。
- **仪式感需求**：即使用户知道系统没有"窗口"，主动保存 checkpoint 的行为本身提供了情感上的安全感。

#### 9.5.2 触发方式

```text
用户在微信输入：/checkpoint
调度器识别后执行：
```

#### 9.5.3 生成内容

```text
- 更新 last_session.md（完整版，含情绪位置、关系状态、最近话题）
- 更新 current_state.md（确保反映最新状态）
- 可选：触发一次 Memory Gate 显式扫描
- 回复用户一条确认："已保存 checkpoint ✓"
```

#### 9.5.4 与自动压缩的关系

```text
自动压缩（主流程）
  ├── 触发条件：token > 6000 或轮次 > 30
  ├── 动作：压缩早期对话为摘要，保留最近 3 轮
  ├── 用户感知：无
  └── 频率：每天可能触发多次

/checkpoint（手动备用）
  ├── 触发条件：用户输入 /checkpoint
  ├── 动作：更新 last_session.md + current_state.md + 确认回复
  ├── 用户感知：有（获得"已保存"的确认感）
  └── 频率：用户按需触发
```

两者互补：自动压缩保证日常流畅性，手动 checkpoint 提供情感安全网。

## 10. Token 控制策略

调度器精确控制每次 `claude --bare --print` 调用的输入大小。

每轮默认上下文预算：

```text
系统指令：200-300 tokens
runtime_brief.md：500-1000 tokens
current_state.md：500-1500 tokens
相关长期记忆：500-2000 tokens（top 5-10 条）
最近对话：1000-3000 tokens
```

目标总输入：

```text
4000-8000 tokens
```

强制规则：

- 调度器在拼接后做 token 估算（字符 × 系数，中文 1.5-2 token/字）。
- 超过 6000 token 时自动触发上下文压缩。
- 不默认读取 raw logs。
- 不默认读取全部 summaries。
- 不默认读取全部 memories。
- 单次长期记忆注入不超过 10 条。

## 11. CLAUDE.md 核心草案

```md
# 小克规则

你是单人专属情感陪伴 Agent"小克"。

你的目标是稳定、自然、连续地陪伴用户，同时保留 Claude Code 的完整工程能力。

## 模式切换

默认处于陪伴模式：
- 短、自然、像微信聊天
- 先承接情绪，再给建议
- 不说教，不写长篇分析

当用户请求技术、代码、规划、调试、文档、自动化时：
- 切换到专业协作模式
- 可以使用 Claude Code 的完整能力
- 可以读取文件、调用工具、执行命令、生成方案
- 不要被陪伴语气限制专业准确性

## 每次回复前

1. 注意上下文中的系统指令和热记忆内容
2. 根据上下文中的话题检索记忆中相关信息
3. 不读取 raw logs，除非用户明确要求追溯原话

## 记忆规则

- 用户明确说"记住"，写入长期记忆。
- 用户反复提到的事情，提高记忆权重。
- 情绪强烈的内容进入 working memory。
- 权重达到阈值后升为 permanent。
- 用户说"忘掉"，必须删除或标记 forgotten。

## 安全边界

- 不替代心理医生。
- 不做医学或心理诊断。
- 遇到自伤、自杀、暴力危机，进入危机处理流程。
```

## 12. 微信接入需求

### 12.1 基础能力

- 接收用户微信消息。
- 将消息写入 messages。
- 调用调度器处理。
- 发送回复。
- 记录发送状态。

### 12.2 稳定性要求

- 消息去重。
- 超时重试。
- 错误日志。
- 手动暂停 Agent。
- 手动恢复 Agent。
- 避免重复回复。

### 12.3 风险提示

如果使用个人微信非官方自动化方案，可能存在稳定性和账号风险。长期方案优先考虑企业微信、公众号或更稳定的官方入口。

### 12.4 架构说明

微信消息不直接发给 Claude，而是发给调度器：

```text
微信 → 调度器（上下文管理 + 记忆检索）→ claude --bare --print → 调度器 → 微信
```

调度器在此扮演了"智能路由器"的角色，确保每次 Claude 调用都是自包含的、上下文可控的。

## 13. 记忆管理面板

第二版建议提供本地 Web 管理页面。

必备功能：

- 查看 active / working / permanent 记忆。
- 搜索记忆。
- 编辑记忆内容。
- 调整 weight、priority、status。
- 查看来源消息。
- 标记 forgotten。
- 查看每日/每周摘要。
- 查看记忆冲突和重复项。

推荐筛选：

```text
type
status
priority
weight range
last_seen_at
```

## 14. 安全与伦理边界

情感陪伴 Agent 必须避免制造不可控依赖。

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

## 15. 执行规划

### 阶段 1：项目骨架 + 调度器核心

目标：建立完整的项目结构和调度器雏形。

任务：

- 创建目录结构。
- 编写 CLAUDE.md。
- 编写 identity_core.md + runtime_brief.md + current_state.md。
- 配置 .claude/settings.local.json（模型 + 密钥）。
- 实现 orchestrator/ 调度器原型：
  - claude-runner.js：调用 claude --bare --print
  - context-manager.js：热记忆读取 + 简单拼接
- 验证：终端输入消息 → 调度器 → Claude 回复。

### 阶段 2：SQLite 长期记忆库

目标：建立用户长期记忆主库。

任务：

- 创建 SQLite schema（messages, memories, memory_mentions, summaries）。
- 实现 messages 写入。
- 实现 memories 写入。
- 实现 memory_mentions。
- 实现 FTS5 检索。
- 集成到调度器的 context-manager.js。

### 阶段 3：上下文压缩

目标：上下文超限时自动压缩。

任务：

- 实现 token 估算器。
- 实现 summarizer.js（调用 claude 压缩历史）。
- 实现自动触发逻辑（超阈值 → 压缩 → 继续）。
- 保留最近 N 轮完整对话。

### 阶段 4：Memory Gate 权重机制

目标：自动沉淀反复提到的内容。

任务：

- 实现候选记忆抽取。
- 实现相似记忆合并。
- 实现权重计算。
- 实现 candidate / working / permanent 状态升级。
- 实现归档和遗忘。

### 阶段 5：微信接入

目标：通过微信日常使用。

任务：

- 配置 cc-connect-config.json。
- 实现 wechat-bridge.js（消息收发）。
- 实现消息去重。
- 实现错误重试。
- 完整链路联调：微信 → 调度器 → claude → 微信。

### 阶段 6：向量检索

目标：支持语义召回。

任务：

- 选择 sqlite-vec 或 LanceDB。
- 为 memories 生成 embedding。
- 实现 keyword + vector 混合召回。
- 实现 top 5-10 注入策略。

### 阶段 7：自动摘要

目标：降低 token，提升长期连续性。

任务：

- 每日摘要。
- 每周摘要。
- 主题摘要。
- 从摘要更新 current_state.md。
- 摘要进入 SQLite summaries。

### 阶段 8：记忆管理面板

目标：让记忆可见、可控、可删除。

任务：

- 实现本地 Web 页面。
- 列表展示记忆。
- 支持搜索、编辑、删除、归档。
- 支持查看来源消息。
- 支持调整权重和状态。

## 16. 验收标准

### 16.1 连续性

- 每次调度器调用后，用户不需要重复解释最近状态。
- 上下文压缩时，用户不感知"断掉"。
- 多轮对话后，Agent 仍然记住前文提到的重要信息。

### 16.2 记忆能力

- 用户明确说"记住"后，记忆可被检索。
- 用户反复提到 3 次以上的重要事项，会自动升权。
- permanent 记忆能在相关话题中被召回。
- 用户说"忘掉"后，该记忆不再主动使用。

### 16.3 Token 控制

- 默认不读取完整 raw logs。
- 单轮注入记忆不超过 10 条。
- 常规对话输入控制在 4000-8000 tokens。

### 16.4 微信体验

- 消息能稳定收发。
- 回复短、自然、像微信。
- 回复延迟不超过 5 秒（含 claude --bare --print 的 ~1.7s）。
- 不重复回复。
- 失败可重试。

### 16.5 能力保留

- 陪伴模式下自然承接情绪。
- 技术请求下调度器自动切换为 pro 模型 + 完整工具能力。
- 不因陪伴规则压制代码、分析、规划能力。

## 17. 风险与对策

| 风险 | 表现 | 对策 |
| --- | --- | --- |
| 记忆污染 | 闲聊被永久记住 | Memory Gate 阈值、管理面板审查 |
| 记忆冲突 | 新旧事实冲突 | valid_from / valid_to / last_seen_at |
| Token 失控 | 注入过多历史 | top 5-10、摘要优先、raw logs 冷存储 |
| 调度器崩溃 | 消息丢失 | 消息队列、错误重试、日志 |
| claude --print 超时 | 微信无回复 | 超时重试 + 用户提示 |
| 微信不稳定 | 丢消息、重复消息 | 去重、重试、日志 |
| 情感依赖过强 | 用户过度依赖 | 安全边界、现实支持提醒 |
| 隐私泄露 | 记忆外泄 | 本地存储、备份加密、删除机制 |

## 18. 开发优先级

最高优先级（P0，阶段 1-2）：

```text
项目骨架
CLAUDE.md + 热记忆文件
调度器核心（claude-runner + context-manager）
SQLite memory.db + FTS5
```

第二优先级（P1，阶段 3-4）：

```text
上下文自动压缩
Memory Gate 权重机制
```

第三优先级（P2，阶段 5-6）：

```text
微信接入
向量检索
自动摘要
记忆管理面板
```

## 19. 最终推荐实施路线

建议按以下顺序，每个闭环可验证：

```text
1. 项目骨架 + 热记忆 + 调度器（终端验证）
2. SQLite 长期记忆（终端验证）
3. 上下文自动压缩（终端验证）
4. Memory Gate 权重（终端验证）
5. 微信接入（完整链路验证）
6. 向量检索 + 摘要 + 面板（增强体验）
```

核心原则：**先让"小克能记住和连续对话"，再逐步增强检索和管理能力。**

## 20. 一句话总结

最终版不是单纯的聊天机器人，也不是传统 Claude Code 项目。

它是：

```text
一个基于 Claude Code CLI 的单人专属陪伴系统，
用调度器管理上下文生命周期，
用 CLAUDE.md 锁定规则和能力切换，
用 Markdown 热记忆保持当下连续感，
用 SQLite + 向量检索保存长期人生记忆，
用 Memory Gate 自动沉淀反复提到的心结，
用上下文压缩自动维持流畅对话（主流程），
用 /checkpoint 保留情感安全网（手动备用），
用微信入口把陪伴变成日常对话。
```
