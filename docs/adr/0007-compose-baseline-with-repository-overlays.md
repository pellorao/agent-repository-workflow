# 使用分层 Baseline 与同文件 Repository Overlay

## Decision

源码仓库实际使用的共享工作流文件是编写权威, 由 [ADR 0026](0026-use-source-checkout-workflow-files-as-distribution-authority.md#decision) 规定的发布前同步形成 Workflow Distribution. 每份 `docs/agents/*.md` 在负责同一主题的文件中保留 Git 仓库自有区域, 使仓库规则与适用触发条件相邻, 避免读取无关规则. 根 `AGENTS.md` 以仓库自有内容为主, 只嵌入较小的 ARW 受管区域.

Code Map 根列表放在根 `AGENTS.md` 的常读区域. 如果只放在按条件读取的 `code-maps.md`, Agent 必须先知道 Code Map 是否适用, 才能决定是否读取保存该事实的文件, 形成循环触发. Code Map 的具体启用选择仍由 Repository Profile 负责.

平台投影把同一份工作流内容送到目标平台所需位置, 并按配置转换 Skill 引用形式; 它不复制业务规则或 Repository Profile. 同文件责任边界使共享内容可被确定性更新, 同时保留仓库策略并控制 Agent 上下文成本.

原先的 `universal` 与 `conditional` 人工 Baseline 分类已由实际来源和固定目录树取代, 不再决定当前载荷成员资格.
