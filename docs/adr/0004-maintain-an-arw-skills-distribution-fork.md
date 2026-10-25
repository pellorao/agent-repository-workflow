# 维护 Matt Pocock 技能集合分支

当前决定部分由 [ADR 0026](0026-use-source-checkout-workflow-files-as-distribution-authority.md#decision) 取代. ARW 仍维护由用户审核的上游 Skill 分支和语义差异.

现在, Ours 是源码仓库实际使用的 `.agents/skills/`. Workflow Distribution 是后续发布前同步的派生载荷, 不再是 Upstream Sync 的编写权威.

ARW 为 `mattpocock/skills` 上游 `engineering/` 与 `productivity/` 中的 Skill Package 维护定制分支. Source Scope 决定纳入哪些 Skill Package; ARW 保存固定的上游提交, MIT 许可证和来源信息, 并允许为 ARW 工作流与平台投影做必要的小幅修改.

ARW 不直接安装上游内容. 它既不只复制依赖闭包, 也不完全重写技能. Source Scope 永久排除 `ask-matt` 和 `setup-matt-pocock-skills`: 前者与现有 Skill 选择和工作流入口重复, 后者与 ARW Repository Workflow 命令重复. 其他 Skill 不再交接给设置 Skill.

需要检查 Repository Workflow 时, 直接运行只读 `arw workflow verify`. 未初始化时, 指向 `arw workflow init`.

ARW 源码仓库同步上游时进行三方迁移. Base 是旧上游, Ours 是源码仓库实际使用的 `.agents/skills/`, Theirs 是新上游; Agent 可以辅助处理语义冲突.

普通 Git 仓库的 Workflow Distribution 更新不执行这类合并.
