## /remember

明确写入长期记忆。

使用方式：
```
/remember 用户不喜欢被说教
```

此命令会：
1. 将指定内容写入 data/memory.db 的 memories 表
2. explicit_score 设为最大值
3. status 设为 permanent
4. 确认回复用户"已记住 ✓"
