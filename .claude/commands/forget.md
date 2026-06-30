## /forget

删除或标记为 forgotten。

使用方式：
```
/forget 用户不喜欢被说教
```

此命令会：
1. 在 data/memory.db 中搜索匹配的记忆
2. 列出匹配项让用户确认
3. 确认后标记 status 为 forgotten 或物理删除
4. 确认回复"已忘掉 ✓"
