---
description: 依据高可信的一手资料调查问题, 并把发现保存为仓库中的 Markdown 文件. 当用户要求研究主题, 收集文档或 API 事实, 或把阅读工作委派给后台 Agent 时使用.
name: research
---

由 Main Agent 把研究任务分配给合适的 subagent, 使 Main Agent 可以继续处理协调工作. 写入前遵循 [Subagent 分配](../../../docs/agents/subagent-allocation.md) 和 [Agent 文件写入](../../../docs/agents/agent-writes.md).

研究者在已分配范围内:

1. 依据一手资料调查问题, 包括官方文档, 源码, 规范和第一方 API, 不以二手文章替代原始资料. 每项主张都追溯到直接提供该事实的来源.
2. 直接把发现写入一份 Markdown 文件, 并为每项主张提供来源引用.
3. 使用仓库已有的研究记录位置. 没有既有约定时, 选择与当前 effort 相符的位置, 并在交接中说明路径.
4. 向 Main Agent 返回发现, 证据和未解决的重要决定. 重要决定由 Main Agent 提交用户确认.
