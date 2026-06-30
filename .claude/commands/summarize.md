## /summarize

生成每日或主题摘要。

使用方式：
```
/summarize          # 生成今日摘要
/summarize weekly   # 生成本周摘要
/summarize 项目     # 关于"项目"话题的摘要
```

此命令会：
1. 从 messages 表和 logs 中提取对应时间段的对话
2. 生成摘要写入 data/memory.db 的 summaries 表
3. 同时更新 memory/summaries/ 下对应 markdown 文件
4. 将摘要摘要回复用户
