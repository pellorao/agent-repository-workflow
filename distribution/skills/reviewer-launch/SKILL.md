---
description: Main Agent 启动, 跟进, 等待, 中断或恢复独立 Reviewer (Code Standards, 要求符合审核, Spec Readiness) 时使用: 固定审核版本, 准备报告路径, 调用 `arw background-agent` 机器接口, 处理长时间运行和暂停通知. Reviewer 自身不使用.
name: reviewer-launch
---

# Reviewer 启动与控制

Reviewer 的审核行为由 [Reviewer 责任](../../../docs/agents/reviewer.md) 和各 Canonical Role 规定. 本 Skill 只规定与用户沟通的 Main Agent 怎样准备和控制审核.

平台差异:

- Codex: 通过命令工具启动无附加参数的 `arw background-agent`, 保留该进程的工具会话, 逐行写入 JSONL 请求并读取响应和通知. 管理进程在共享 Codex App Server 中为每个 Reviewer 创建独立根线程, 不占用 Main Agent 的原生子 Agent 槽位, 不用原生子 Agent 工具代替该入口.
- Claude Code: Claude 后端完成前, `arw background-agent` 报告当前只支持 Codex. 不绕过审核关卡, 不用 Claude Code 原生 subagent 代替独立 Reviewer; 需要审核时告知用户, 由用户决定在 Codex 中运行审核或等待.

## Fix the review version

- 启动前固定本轮完整候选与所需代码上下文, 治理输入和全部适用 Agent 指令. Code Standards 使用 `code-review` 规定的不可变 Git 对象; 要求符合审核和 Spec Readiness 使用 Engine Request 绑定的版本. 适用 Agent 指令在本轮会话临时范围保存完整副本, 记录每份来源路径和 SHA-256, 把映射和完整执行指令交给 Reviewer. 同一提交的两个 Reviewer 共用同一版本.
- 源工作树可以继续修改. 不改写运行中的输入, 不把未完成审核当作通过. 新版本按所属工作流准备输入; 复审按 [复审规则](../../../docs/agents/reviewer.md#re-review) 交付变化及影响范围和该 Reviewer 的前轮报告路径.
- 提交审核期间另外保持索引, HEAD 和绑定输入固定, 见 `commit` Skill.
- 各角色只收到它需要的审查输入, 不复制作者对话, 隐藏推理或其他角色的旧结论.

## Machine operations

`arw background-agent` 是共享后台进程的 JSONL 客户端, 使用 UTF-8 JSONL 请求, 响应和通知 ([后台 Agent 控制](../../../docs/specs/agent-repository-workflow/spec.md#background-agent-control)). 连接断开或标准输入结束后, 已启动的审核继续执行, 保留期内的消息可在重新连接后取得.

1. 按 [Reviewer 运行规则](../../../docs/specs/agent-repository-workflow/spec.md#reviewer-runtime) 为报告分配独立临时目录并创建空报告文件. 审核输入, 冻结请求, 执行规则副本和恢复记录放在该目录之外.
2. 调用 `spawn_agent`, `input` 提供:
   - `role`: Canonical Role ID.
   - `identity`: 普通审核为 `{kind: "ordinary", issueIds: [...]}`, `issueIds` 完整排序.
   - `instructions`: 完整 Canonical Role 与 `docs/agents/reviewer.md` 内容; 不能只凭角色名称认定规则已应用.
   - `handoff`: 所属审核工作流要求的全部审查输入.
   - `cwd`: 当前 Git 仓库根目录. 省略 `readPaths`; 如果传入, 只能包含该仓库内的路径.
   - `writePaths`: 只含实际存在的报告目录. `reportPath`: 准确报告文件, 必须属于 `writePaths`. 不放入 `~/.codex` 等仓库外路径.
   - `stateDirectory`. 只在需要原生附加配置或隔离实例覆盖时提供 `settings`.

   所有路径都是绝对路径. 普通审核的 `model`, `modelProvider`, `reasoningEffort` 和 `serviceTier` 由用户配置 `config.json` 和仓库 `arw.config.json` 中该角色的字段逐项覆盖形成, Main Agent 不选择或覆盖; 只有 Reviewer Capability 和基准的隔离实例可以在 `settings` 中覆盖. `settings.config` 不保存明文凭据. Agent 协作由运行入口强制禁用.
3. 回执只证明管理进程已经登记本轮. 保存 `runId`, `recoveryPath`, 首次交接的 `messageId` 和 `accepted`, 再用 `list_agents` 或 `wait_agent` 取得 `threadId`, `turnId` 和运行状态; 不重复发送首次工作指示.
4. 复审时准备复审输入和新的空报告, 使用同一角色, 同一 issue 身份集合和 `stateDirectory` 调用 `followup_task`, 管理进程按需恢复原线程. 只有 issue 身份集合改变, 原线程不可用或不可恢复, 或用户明确要求时, 才使用 `newThread` 创建替代线程; 字节, 哈希或结论变化不构成理由. 首次启动不继承发起者的对话.

| 操作 | 用法 |
| --- | --- |
| `list_agents` | 按 `runId` 观察状态, 原生线程与回合身份, 保留期内的通知, 待处理请求, `cursor`, `completion` 和 `measurement`; 查询不启动审核 |
| `wait_agent` | `runId`, 已取得的 `cursor` 和可选 `timeout_ms`; 有更新即返回, 超时不代表 Reviewer 失败, 取消等待不停止审核 |
| `followup_task` | 向可靠原线程交付新一轮完整任务, 更新输入与报告绑定; 原线程已卸载时由管理进程内部恢复后开始新回合 |
| `send_message` | 向 `runId` 排入消息, 活动回合提供准确 `turnId`; 不唤醒空闲 Reviewer, 回合已变化时处理错误, 不改投替代线程 |
| `messages` | `runId` 和可选的 `direction`, `limit`, `beforeMessageId`; 回复不确定时据此决定等待, 重发或报告不确定 |
| `interrupt_agent` | `runId` 与当前 `turnId`; 中断活动工作或结束等待用户的暂停任务, 保留运行环境与原线程 |

- 回执超时或连接失败时, 按 [消息交付规则](../../../docs/specs/agent-repository-workflow/spec.md#background-agent-communication) 查询最近消息, 不自动重发.
- 工具会话丢失后重新连接, 用 `list_agents` 和 `cursor` 观察, 再按需 `wait_agent`. 原线程或原有路径与设置无法恢复时明确失败, 不静默新建线程.
- 从 `completion` 取得结果后读取绑定报告. 空报告或残留草稿不是有效结果; 收尾失败时按具体原因处理.

## Long-running and paused reviews

- 普通审核从开始等待达到 30 分钟且 Reviewer 仍在运行时, 向用户报告当前状态及尚未核实的事实, 询问继续等待还是结束, 然后结束当前回复; 此后每 15 分钟再次询问. 用户决定前保持 Reviewer 运行, 不自行停止或替换.
- 收到累计主动早退暂停通知时, 向用户说明累计次数和暂停状态, 询问继续还是结束, 然后结束当前回复. 用户同意继续时用 `send_message` 向原任务发送工作指示; 要求结束时用 `interrupt_agent`. 等待决定期间只查询状态.
