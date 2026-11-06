# 核对当前 ARW 的流程驱动方式与 Engine 已有能力

Type: research
Status: resolved
Blocked by: None

##### Question

按当前 ARW HEAD 的长期规格, Skill 与实现, 哪些流程步骤已由 ARW Engine (`arw` 命令及用户级后台管理进程) 确定性执行, 哪些仍靠 Main Agent 读规则后自行推进? Engine 现在已能启动, 观察和恢复哪些 Agent 会话 (Codex, Claude Code, 本地模型), 已记录哪些耗时数据? 只记录可复核的事实与来源, 列出改为 Engine 驱动时会受影响的现有合同, 不替用户作架构决定.

## Answer

研究记录见 [当前流程驱动方式研究](../research/current-flow-driver/report.md). 当前 ARW 的流程由与用户对话的 Main Agent 推进: 它按根 `AGENTS.md` 的触发点读取约 19 万字符的 Skill 与规则, 自己决定步骤顺序; 长期规格明确 ARW 不自主发起 Agent 编码工作. Engine 只提供单项确定性操作 (Artifact 解析, Spec Readiness 的 `prepare`/`generate`/`promote`/`verify`, Commit Audit 的 `prepare`/`verify`, 文本检查), 没有流程调度命令. 与 10-25 时不同, Engine 现在已有用户级后台管理进程, 经 Codex App Server, 每回合一个 `claude -p` 进程的 Claude 后端和 Strata 本地模型驱动运行 Reviewer 与通用后台 Agent, 审核轮的 Reviewer 选择和请求已由 `prepare` 机械生成, 并对这些任务记录工作时间和 token 用量 (不覆盖 Main Agent 自己的回合). 改为 Engine 驱动会改变 7 项现行合同: 不自主发起工作, Main Agent 的身份与 Git 写入归属, 触发点读规则的方式, 暂存区的三重责任, 两平台对等, 临时工作区身份, Reviewer 单 Agent 执行. 这些只列为后续决定型 issue 的输入, 本 issue 不作取舍.
