<!-- arw:managed:start -->
# Agent Repository Workflow

## Workflow Triggers

Main Agent 必须读取 `docs/agents/subagent-allocation.md`, 并始终遵循其中的工作分派和实例复用规则.

行动前使用每个匹配的条目, 然后遵循所指文档中的所有条件性交接规则.

- 构建, 修复, 修改或完成仓库交付内容前, 使用 `implement` Skill.
- Agent 写入任何文件或执行 Git 写入前, 读取 `docs/agents/agent-writes.md`.
- 更改已跟踪文件前, 读取 `docs/agents/issue-gate.md`.
- 实现前, 读取 `docs/agents/spec-readiness.md`, 按其规定安排就绪审核与最终授权检查.
- 更改行为, 测试或运行验证前, 读取 `docs/agents/validation.md`.
- 用户要求清理低价值测试时, 读取 `docs/agents/test-value-cleanup.md`, 只在当前任务授权范围内执行.
- 创建或重命名任何文件或目录, 或编写仓库文本前, 读取 `docs/agents/writing.md`.
- Agent 创建临时文件或目录前, 读取 `docs/agents/environment.md`.
- 处理 issue, map, spec 或它们的工作流字段前, 读取 `docs/agents/issue-tracker.md`.
- 报告 issue 完成前, 读取 `docs/agents/issue-tracker.md`, 记录其要求的完成证据, 并把 `Status:` 更新为适用的终态值.
- 接受或处理负责识别问题的 subagent 所提供的问题前, 读取 `docs/agents/subagent-findings.md`.
- 修改 Agent 指令或保存持久设计或治理的文档前, 读取 `docs/agents/rule-and-design-changes.md`.
- 探索不熟悉的领域, 命名持久领域概念或决定架构边界前, 读取 `docs/agents/domain.md`.
- 在用户请求 Git 提交后, 在提交验证或提交前读取 `docs/agents/commits.md`.
- 处理 ARW 命令和仓库发现时, 读取 `docs/agents/arw-operations.md`.
- 与用户沟通的 Main Agent 在工作阶段结束, 或向用户发送任何沟通前, 读取 `docs/agents/user-communication.md`.

当适用的治理文档相互冲突时, 停止受影响的写入, 验证, 状态更新, 审查或提交. 向用户说明冲突的确切内容并请求决定. 只继续独立的只读工作. 不得根据指令路径, 表面上的专用程度或推定的新旧来选择指令, 也不得默默合并冲突指令.

Code Map roots: (none)

## Work dependencies

前置工作尚未完成, 或其结果尚未取得必要确认时, 不得执行依赖该结果的步骤. 是否依赖审核结果以及需要结果的时点, 按拥有该步骤的工作流判断. 可以并行开展不依赖该结果且符合当前授权范围的工作, 但不得把临时假设或正在进行的审核当作已确认结果.

# Output Text

Agent 编写回复或仓库中的自然语言内容时, 默认遵循 `Output Text` 规则.

- 只为持久的领域概念创建项目术语, 不得为机制, 状态, 单个工单的简称或普通描述创建它.

- Agent 编写的全部自然语言必须只使用 ASCII 标点. 中文字符与英文字母或数字相邻时, 在这些边界插入 ASCII 空格.

- 如果 Agent 的某项工作需要先等待用户进行某些操作, 才能进行下一步 (比如等待用户编辑或关闭文件后, 才能开始对该文件进行处理), 那么需要先告知用户, 并结束当前回复. 用户回复了已就绪后, 才开始这个工作并等待用户操作.

# Important Decisions

在每个工作阶段, 如果未解决的替代方案可能对以下任何事项产生重大影响, 作出选择前都要先使用 `grilling` 和用户沟通:

- 产品语义或用户可见行为.
- 数据来源或格式.
- 安装或环境行为.
- 安全, 隐私或持久状态.
- 公开 Interface 或架构边界.
- 长期维护责任或难以逆转的结果.

只要有合理理由怀疑其重要性, 就必须提交给用户决定. 只有在保留已确认约束, 容易撤销且不建立持久承诺时, 才可自主决定例行细节.

Subagent 必须向 Main Agent 返回未解决的重要决定及其分析, 不得自行选择或直接询问用户. 独立 Reviewer Role 如果发现治理资料存在歧义或相互冲突, 必须把具体问题报告给 Main Agent, 不得自行决定采用哪一种解释或方案. Main Agent 负责把问题提交给用户决定, 并协调各 Agent 的写入范围和交付.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->
