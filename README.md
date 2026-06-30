# 小克——单人情感陪伴 Agent

版本：v3.0（最终版）  
日期：2026-07-01

## 一句话概括

基于 **cc-connect + Claude Code CLI + 自建 Memory Service** 的单人专属情感陪伴系统。cc-connect 负责微信入口和会话调度；本项目负责人格、长期记忆、权重机制、上下文控制、遗忘与情感连续性。

## 架构

```
微信 → cc-connect → Claude Code（本项目目录）→ Memory Service → 微信
                      │
                      ├── CLAUDE.md（规则）
                      ├── Markdown 热记忆（连续感）
                      ├── SQLite memory.db（长期记忆主库）
                      ├── Memory Gate（自动沉淀权重）
                      ├── 自动上下文压缩（主流程）
                      └── /checkpoint（手动备用，仪式感）
```

## 职责分工

| 组件 | 负责 | 不负责 |
|------|------|--------|
| **cc-connect** | 微信入口、消息收发、会话管理、Agent CLI 调用、模型/Provider 切换、定时任务、多项目 | 长期记忆、权重、情感建模 |
| **本项目** | 人格、记忆、权重、上下文压缩、遗忘、情绪承接、/checkpoint | 微信协议、会话路由 |

## 项目结构

```
emotional-agent/
├── README.md                         ← 本文件
├── CLAUDE.md                         # 项目总规则
├── identity_core.md                  # 稳定人格层
├── runtime_brief.md                  # 每轮必读极简摘要
├── current_state.md                  # 用户近期状态
├── last_session.md                   # 冷备交接参考
├── checkpoint.md                     # 手动交接包
│
├── memory-service/                   # Memory Service 核心
│   ├── index.js                      # 主入口 + 测试 REPL
│   ├── config.js                     # 路径、阈值、模型、DeepSeek 配置
│   ├── context-manager.js            # 热记忆加载、上下文拼接、token 估算、/checkpoint
│   ├── claude-runner.js              # claude --bare --print 调用封装
│   ├── db.js                         # [阶段 2] SQLite 读写
│   ├── search.js                     # [阶段 2] FTS5 检索
│   ├── gate.js                       # [阶段 4] Memory Gate 权重
│   ├── summarize.js                  # [阶段 7] 自动摘要
│   └── embeddings.js                 # [阶段 6] 向量检索
│
├── memory/                           # 人类可读温记忆
│   ├── user_profile.md
│   ├── relationships.md
│   ├── boundaries.md
│   ├── topics/
│   └── summaries/
│       ├── daily/
│       └── weekly/
│
├── data/
│   ├── memory.db                     # SQLite 长期记忆主库
│   └── vectors.db                    # 向量索引
│
├── logs/
│   └── raw_messages/
│
├── .claude/
│   ├── settings.local.json           # 项目级模型配置
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
│
├── scripts/
│   ├── init-db.js
│   ├── seed-memory.js
│   └── backup-memory.js
│
└── cc-connect-config.json            # cc-connect 对接配置
```

## 记忆分层

```
热记忆（每轮必读）
├── identity_core.md      稳定人格
├── runtime_brief.md      极简摘要（500-1000 tokens）
├── current_state.md      近期状态（500-1500 tokens）
└── checkpoint.md         最后检查点

温记忆（按需读取）
├── memory/user_profile.md
├── memory/relationships.md
├── memory/boundaries.md
├── memory/topics/*.md
└── memory/summaries/**/*.md

冷记忆（默认不读）
├── logs/raw_messages/*
└── 归档记忆

结构化长期记忆（SQLite）
├── preference    boundary    relationship
├── event         emotional_pattern
├── identity_fact  current_goal   recurring_pain
```

## 记忆权重

```
状态：candidate → working → permanent → archived/forgotten

公式：weight = importance*2 + frequency*1.5 + emotion_score*2
              + explicit_score*5 + recency_score + confidence

阈值：weight < 5 → candidate
      5 ≤ weight < 12 → working
      weight ≥ 12 → permanent
```

## Token 控制

| 组件 | 预算 |
|------|------|
| 系统规则 | 500-1000 tokens |
| runtime_brief.md | 500-1000 tokens |
| current_state.md | 500-1500 tokens |
| 相关长期记忆 | 500-2000 tokens（≤10 条） |
| 最近对话 | 1000-3000 tokens |
| **目标总计** | **4000-8000 tokens** |

超过 6000 tokens 触发自动上下文压缩（保留最近 3 轮，更早压缩为摘要）。

## 执行阶段

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1 | 项目骨架 + Memory Service + 热记忆 | ✅ 完成 |
| 2 | SQLite 长期记忆库 + FTS5 | 🔜 待开始 |
| 3 | Memory Gate 权重机制 | ⏳ |
| 4 | 上下文自动压缩 + /checkpoint | ⏳ |
| 5 | 向量检索 | ⏳ |
| 6 | 自动摘要 + token 控制 | ⏳ |
| 7 | cc-connect 微信接入 | ⏳ |
| 8 | 记忆管理面板 + 旧小克迁移 | ⏳ |

## 验收标准

- 微信回复自然、短、先承接情绪
- 用户不需要重复解释自己
- "记住"的可检索，"忘掉"的不再出现
- 反复 3 次以上的事项自动升权
- permanent 记忆在相关话题中可召回
- 常规输入 4000-8000 tokens
- checkpoint 可手动保存情感位置
- 旧小克记忆可迁移
- 保留 Claude Code 的完整工程能力

## 安全边界

- 不替代心理医生 / 不做医学诊断
- 不声称自己是人类 / 不假装拥有真实经历
- 不鼓励用户只依赖 AI
- 不使用操控性话术
- 支持用户随时删除记忆
- 遇危机信号进入危机处理流程
