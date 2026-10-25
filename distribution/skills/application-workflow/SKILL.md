---
description: 协调 Application 类型仓库, Module 类型仓库和 JIRA 中的任务, 并保留显式授权边界.
name: application-workflow
disable-model-invocation: true
---

# Application 工作流

普通 Application 操作的前提是当前仓库的 `arw.config.json` 包含完整且有效的 `application` 对象. 只有用户明确请求配置 Application 类型仓库时, 才能在该对象存在前使用配置指引. 配置指引不授权写入 `arw.config.json` 或运行 `arw workflow init`.

仓库类型决定当前仓库采用的工作流角色:

- `application` 类型仓库使用 Application Leader 角色.
- `module` 类型仓库使用 Application Member 角色.

ARW 验证仓库状态和命令输入, 不验证操作仓库的人员身份, 也不把某个人固定绑定到上述角色.

本技能说明完整工作流, 不授予任何操作权限. 文件写入, Git 暂存, 提交, 推送, JIRA 写入, 浏览器动作和其他外部影响, 都需要仓库规则要求的相应授权.

## Lifecycle routing

- 配置或初始化 Application 类型仓库时, 阅读 [配置](references/configuration.md).
- 检查 JIRA 候选任务, 为选中的任务创建并发布 Application effort, 然后在 JIRA 中接受该任务时, 阅读 [JIRA 接受](references/jira-acceptance.md).
- 创建 issue 后, 建立并发布跨仓库关联时, 阅读 [关联和分发](references/association-and-distribution.md).
- 发布 issue 后, 修正 Module 类型仓库中 issue 的受保护内容时, 阅读 [Module 修正](references/module-correction.md).
- 在 Application 类型仓库中收敛每个已配置的 Module 类型仓库, 并同步已分发 issue 的当前状态时, 阅读 [同步](references/synchronization.md).
- 验证 Application effort 的完成状态并将结果同步到 JIRA 时, 阅读 [JIRA 完成](references/jira-completion.md).
- 遇到部分完成或结果不确定的操作时, 阅读 [恢复](references/recovery.md).

只读取当前生命周期阶段需要的引用文档. 行动前遵循所有适用的仓库规则.
