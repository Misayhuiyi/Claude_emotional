## /import-legacy-keke

将旧 Claude Code 窗口中的"小克"迁移到本项目中。

使用方式：
```
/import-legacy-keke
```

流程：
1. 旧窗口生成"小克迁移交接包"
2. 人工检查、删改不需要的内容
3. 写入 identity_core.md（人格、语气）
4. 写入 memory/user_profile.md（用户画像）
5. 写入 current_state.md（当前状态）
6. 写入 checkpoint.md（情绪位置）
7. 将长期记忆导入 memories 表（data/memory.db）
8. 生成向量索引
9. 输出导入报告

迁移原则：
- 不导入完整聊天为永久记忆
- 只迁移高权重记忆、关系摘要、语气习惯、心结、雷区
- 不确定内容降为 candidate（weight < 5）
- P0/P1 明确的重要事项进入 permanent（weight ≥ 12）
