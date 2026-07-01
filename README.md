# 沈幼楚——单人情感陪伴 Agent

版本：v3.0（最终版）  
日期：2026-07-01  
人格核心：沈幼楚（外柔内韧、干净温柔、克制稳定）

---

## 项目定位

基于 **cc-connect + Claude Code CLI + 自建 Memory Service** 的单人专属情感陪伴系统。

通过微信日常聊天，具备长期记忆、情绪感知、自动权重、上下文管理、遗忘机制等完整记忆系统。

**一句话：把 Claude Code 变成一个有记忆的、能通过微信聊天的沈幼楚。**

---

## 架构

```
微信 → cc-connect → claude（MCP 记忆工具）→ 回微信
                         ↓
                session-watcher（10秒同步）
                         ↓
                ┌─────────────────────┐
                │  SQLite 长期记忆库    │
                │  Memory Gate 权重    │
                │  自动摘要 / 遗忘维护  │
                │  Web 管理面板        │
                └─────────────────────┘
```

### 职责分工

| 组件 | 负责 |
|------|------|
| **cc-connect** | 微信入口、消息收发、会话管理、Claude Code 调用、模型切换 |
| **memory-service** | 人格、长期记忆（SQLite）、权重计算、自动摘要、遗忘、记忆检索（MCP） |
| **session-watcher** | 监控 cc-connect 会话，自动同步消息到记忆库，触发 Memory Gate |

---

## 核心能力

| 能力 | 说明 |
|------|------|
| 🧠 **长期记忆** | SQLite + FTS5 存储，永久保留对话和提取的记忆 |
| 🔍 **智能检索** | MCP 工具 + 中文 LIKE + 查询扩展语义搜索，Claude 回复前自动查记忆 |
| ⚖️ **权重机制** | 反复提到的事自动升权（candidate → working → permanent） |
| 🗑 **可控遗忘** | 凌晨 4 点自动清理过期记忆，随时可手动遗忘 |
| 📊 **记忆面板** | Web 界面 http://localhost:8765，搜索/编辑/遗忘/统计 |
| 📅 **每日摘要** | 凌晨 3 点自动生成，记录当日对话精华 |
| 📱 **微信聊天** | cc-connect 桥接，日常陪伴入口 |
| 🔄 **自动同步** | 新消息 10 秒内进入记忆库 |

---

## 记忆系统

### 记忆分层

```
热记忆（每轮必读）
├── identity_core.md      稳定人格
├── runtime_brief.md      运行摘要
├── current_state.md      近期状态
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
├── identity_fact current_goal  recurring_pain
```

### 权重公式

```
weight = importance × 2 + frequency × 1.5 + emotion_score × 2
       + explicit_score × 5 + recency_score + confidence
```

| 阈值 | 状态 |
|------|------|
| < 5 | candidate（暂存） |
| 5 ~ 12 | working（活跃） |
| ≥ 12 | permanent（永久） |

---

## 项目结构

```
emotional-agent/
├── CLAUDE.md                        # 沈幼楚人格规则 + 记忆指令
├── identity_core.md                 # 稳定人格定义
├── runtime_brief.md                 # 每轮必读摘要
├── current_state.md                 # 当前用户状态
├── checkpoint.md                    # 手动交接包
├── config.toml                      # cc-connect 配置
│
├── memory-service/                  # 核心记忆引擎
│   ├── index.js                     # 终端测试 REPL
│   ├── config.js                    # 配置（路径、模型、阈值）
│   ├── context-manager.js           # 上下文拼接 + 热记忆
│   ├── claude-runner.js             # claude CLI 调用封装
│   ├── db.js                        # SQLite 读写
│   ├── search.js                    # 混合检索（LIKE + 查询扩展）
│   ├── gate.js                      # Memory Gate 权重 + 遗忘
│   ├── summarize.js                 # 自动摘要生成
│   ├── embeddings.js                # n-gram 向量指纹
│   ├── mcp-server.js                # MCP 协议（memory_search / memory_write）
│   ├── session-watcher.js           # cc-connect 会话同步器
│   └── admin-server.js              # Web 管理面板后端
│   └── admin.html                   # Web 管理面板前端
│
├── data/
│   ├── memory.db                    # SQLite 记忆主库
│   └── backups/                     # 自动备份
│
├── .claude/
│   ├── settings.local.json          # 项目模型配置
│   └── commands/                    # 自定义命令
│       ├── remember.md / forget.md
│       ├── checkpoint.md / summarize.md
│       ├── memory-audit.md
│       └── import-legacy-keke.md
│
├── scripts/
│   ├── init-db.js                   # 数据库初始化
│   ├── seed-memory.js               # 测试记忆播种
│   ├── backup-memory.js             # 备份工具
│   └── import-legacy-keke.js        # 旧小克迁移
│
└── 完整安装说明 → INSTALL.md
```

---

## 安全边界

- 不替代心理医生 / 不做医学诊断
- 不声称自己是人类 / 不假装拥有真实经历
- 不鼓励用户只依赖 AI
- 不使用操控性话术
- 支持用户随时删除记忆
- 遇危机信号进入危机处理流程
