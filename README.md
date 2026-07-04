# 沈幼楚——单人情感陪伴 Agent

版本：v3.1  
日期：2026-07-04  
人格核心：沈幼楚（外柔内韧、干净温柔、克制稳定）

---

## 项目定位

基于 **cc-connect + Claude Code CLI + 自建 Memory Service** 的单人专属情感陪伴系统。

通过微信日常聊天，具备长期记忆、情绪感知、自动权重、上下文管理、遗忘机制等完整记忆系统。

**一句话：把 Claude Code 变成一个有记忆的、能通过微信聊天的沈幼楚。**

---

## 架构

```
微信 → cc-connect → claude（MCP 工具链）→ 回微信
           │              │
           │    ┌─────────┼──────────┐
           │    │ vision  │  sticker │  ← 图片/表情包
           │    │ voice   │  weather │  ← 语音/天气
           │    └─────────┼──────────┘
           │              ↓
           ├── session-watcher（10秒同步）
           │              ↓
           │    ┌─────────────────────┐
           │    │  SQLite 长期记忆库    │
           │    │  Memory Gate 权重    │
           │    │  自动摘要 / 遗忘维护  │
           │    │  Web 管理面板        │
           │    └─────────────────────┘
           │
           └── proactive-main（主动推送）

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
| 🔍 **智能检索** | MCP 工具 + 中文 LIKE + 查询扩展，Claude 回复前自动查记忆 |
| ⚖️ **权重机制** | 反复提到的事自动升权（candidate → working → permanent） |
| 📱 **微信聊天** | cc-connect 桥接，日常陪伴入口 |
| 📷 **图片理解** | Qwen3-VL-Plus 视觉分析，看懂你发的图 |
| 🎤 **语音转文字** | 本地 faster-whisper，免费离线 |
| 🖼️ **表情包** | 联网搜索热门表情包，聊天时自动发 |
| 📡 **主动推送** | 早安/午间/傍晚/晚安定时推送，天气新闻AI资讯 |
| 📝 **学习督促** | 每日总结提醒 + Agent/大模型面试题推送 |
| 💌 **浪漫内容** | 情境化浪漫消息，即兴生成不重复 |

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
| < 10 | candidate（暂存） |
| 10 ~ 20 | working（活跃） |
| ≥ 20 | permanent（永久） |

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
├── proactive-service/               # 主动推送引擎（v3.1新增）
│   ├── scheduler.js                 # 调度主循环（10秒轮询）
│   ├── triggers.js                  # 时段+动态触发
│   ├── daily-tracker.js             # 每日状态跟踪
│   ├── info-summarizer.js           # 沈幼楚化改写引擎
│   ├── info-validator.js            # 推送前五项校验
│   ├── info-form-randomizer.js      # 形式随机选择
│   ├── study-pusher.js              # 学习督促+总结提醒
│   ├── sticker-service.js           # 表情包检索
│   ├── sticker-fetcher.js           # 联网表情包搜索
│   ├── vision-service.js            # 图片理解（Qwen3-VL）
│   ├── voice-service.js             # 语音ASR（faster-whisper）
│   ├── delivery.js                  # cc-connect 消息投递
│   └── info-fetcher/
│       ├── weather.js               # 天气（Open-Meteo）
│       ├── news.js                  # 新闻热点
│       ├── trends.js                # 网络热梗
│       └── ai-daily.js              # AI行业资讯
│
├── scripts/
│   ├── init-db.js                   # 数据库初始化
│   ├── migrate-multimodal.js        # 升级迁移（新增）
│   ├── backup-memory.js             # 备份工具
│   ├── asr.py                       # 本地语音转文字（新增）
│   ├── start-proactive.cmd          # 主动推送启动脚本（新增）
│   └── install-proactive.ps1        # 开机自启注册（新增）
│
├── stickers/
│   └── index.json                   # 表情包索引
│
└── 完整安装说明 → INSTALL.md
```

---

## 环境配置

复制 `.env.example` 为 `.env` 并填入密钥：

```bash
cp .env.example .env
```

| 变量 | 说明 | 状态 |
|------|------|:----:|
| `VISION_PROVIDER=qwen` / `VISION_API_KEY` | 图片理解（Qwen3-VL） | ✅ 已配 |
| `ASR_PROVIDER=local` | 本地语音转文字 | ✅ 免费离线 |
| `TTS_API_KEY` | 文字转语音（CosyVoice） | ⚪ 待配 |
| `CITY` / `CITY_LAT` / `CITY_LON` | 天气城市 | 默认广州 |

---

## MCP 工具

| 工具 | 说明 |
|------|------|
| `memory_search` | 检索长期记忆 |
| `memory_write` | 写入永久记忆 |
| `vision_analyze` | 分析图片内容 |
| `voice_transcribe` | 语音转文字 |
| `sticker_search` | 搜索表情包（联网） |
| `sticker_send` | 发送表情包 |
| `sticker_save` | 收藏表情包 |
| `proactive_status` | 查看主动推送状态 |
| `proactive_pause` | 暂停/恢复推送 |
| `proactive_trigger` | 手动触发推送 |
| `douyin_digest` | 抖音内容记录 |

---

## Feature Flags

所有新能力通过 `features.js` 控制，默认关闭，按需打开：

```js
infoWeather: true,   // 天气推送
infoNews: true,      // 新闻/热点
infoAI: true,        // AI 行业资讯
infoTrends: true,    // 网络热梗
studyPush: true,     // 学习督促
stickers: true,      // 表情包
romanticContent: true, // 浪漫内容
```

---

## 安全边界

- 不替代心理医生 / 不做医学诊断
- 不声称自己是人类 / 不假装拥有真实经历
- 不鼓励用户只依赖 AI
- 不使用操控性话术
- 支持用户随时删除记忆
- 遇危机信号进入危机处理流程
