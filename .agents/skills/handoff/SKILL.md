---
description: 把当前对话压缩成交接文档, 供另一个 agent 接手继续.
name: handoff
disable-model-invocation: true
---

编写一份交接文档, 总结当前对话, 使全新的 agent 能够继续这项工作. 保存到会话工作区 (见 [Agent 环境](../../../docs/agents/environment.md)), 不要保存到仓库的受跟踪路径.

文档中包含一个 "建议的 Skill" 章节, 建议该 agent 应当调用哪些 Skill.

不要重复其他产物 (spec, 计划, ADR, issue, 提交, diff) 中已有的内容, 改为通过路径或 URL 引用它们.

对任何敏感信息 (如 API 密钥, 密码, 个人身份信息) 做脱敏处理.

如果用户传入了参数, 把它视为对下一个会话重点的描述, 并据此调整文档.
