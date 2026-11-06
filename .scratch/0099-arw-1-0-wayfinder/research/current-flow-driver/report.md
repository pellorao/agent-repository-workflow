# 当前 ARW 的流程驱动方式与 Engine 已有能力

## Scope

本记录回答 Wayfinder issue "核对当前 ARW 的流程驱动方式与 Engine 已有能力". 依据是 ARW 源码仓库 2026-11-07 的 HEAD (`2a8eb4a`, `package.json` 版本 `0.5.3`) 中的长期规格, ADR, Skill, 规则文档和 CLI 输出. 只记录可复核的事实和由事实直接推出的影响, 不作架构决定. 10-25 讨论留下的 "现有流程合同" 研究只作线索; 其中仍成立的结论都已按当前文件重新核对, 采用处注明 "参考 10-25 材料, 已于 11-07 核实". 该研究写作时 Engine 尚无后台 Agent 管理和 Reviewer 运行层, 它所说 "Engine 不启动 Reviewer" 已不符合当前事实.

## Who drives the flow today

当前流程由与用户对话的 Main Agent 推进, Engine 只提供被调用的确定性操作:

- 长期规格明确写着 ARW "不自主发起 Agent 编码工作", 也 "不替代用户批准" (`docs/specs/agent-repository-workflow/spec.md` 的 Application and local lifecycle 节).
- 根 `AGENTS.md` 的 Workflow Triggers 节规定 Agent 在到达触发点时才读取对应 Skill 或规则文档, 并在上下文压缩后重新读取. 也就是说, 步骤顺序, 何时读哪条规则, 都由 Main Agent 自己判断和记住.
- 需要 Main Agent 按需加载的规则正文体量大: `.agents/skills/` 下的 Markdown 约 15 万字符, `docs/agents/` 约 3.8 万字符, 根 `AGENTS.md` 约 6 千字符 (11-07 用 `wc -m` 统计). 10-25 讨论中用户指出的 "Agent 忘了某个规则导致流程执行不到位" 正发生在这一层.
- `arw --help` 列出的命令中没有流程调度或 "下一步" 命令; 现有命令都是单项操作 (Artifact 读取, Spec Readiness, Commit Audit, 文本检查, 仓库工作流, Application/JIRA, 后台 Agent). 参考 10-25 材料, 已于 11-07 核实.
- `CONTEXT.md` 的 Main Agent 定义规定工作流引擎和平台承载程序不因参与工作取得 Main Agent 身份; Git 写入只由与用户沟通的 Main Agent 执行 (`docs/agents/agent-writes.md` 的 Git and recovery 节, `docs/adr/0013-use-main-agent-single-writer-orchestration.md`).

## Step inventory

下表列出普通实施流程的主要步骤, 由谁推进, 以及其中已由 Engine 确定性完成的部分.

| 步骤 | 推进者与依据 | Engine 已做的确定性部分 |
| --- | --- | --- |
| 重要决定与 grilling | Main Agent 与用户, 根 `AGENTS.md` 的 Important Decisions 节, `grilling` Skill | 无 |
| 建立 issue, map, spec | Main Agent 写文件, `issue-tracking` Skill | `arw list`, `print`, `open` 解析与诊断, `arw migrate artifacts` |
| 实施入口 (授权 issue) | Main Agent, `implement` Skill 的 Entry 节 | `arw spec-readiness verify` |
| Spec Readiness | Main Agent 选择治理输入并启动 Reviewer, `spec-readiness` Skill | `prepare` 冻结输入并生成审核轮目录和每个 Reviewer 的机器请求, `generate`, `promote` 的字节映射, `verify` |
| 实施与验证 | Main Agent 与子 Agent, `validation` Skill | `arw text check`, `arw terms check`, `arw language inspect`, `arw code-map verify` 等检查命令, 由 Agent 选择何时运行 |
| Code Review (Gate 3) | Main Agent 准备比较并启动两轴 Reviewer, `code-review` 与 `reviewer-launch` Skill | `arw background-agent` 启动和等待 Reviewer |
| 处理 Reviewer 发现 | Main Agent 逐条核对, `docs/agents/subagent-findings.md` | 无 |
| 提交与 Commit Audit | Main Agent, `commit` Skill; Git 写入只由 Main Agent 执行 | `arw commit-audit prepare`, `verify`, `verify --non-implementation` |

`reviewer-launch` Skill 规定 Main Agent 用 `cat <轮目录>/*.jsonl | arw background-agent --wait` 一次启动并等待本轮全部 Reviewer; 审核轮目录, 请求文件, 原线程复用 (`followup_task`) 或新建 (`spawn_agent`) 的选择都已由 `prepare` 机械决定 (`docs/specs/agent-repository-workflow/spec.md` 的 Review rounds 节). 因此审核环节里 "启动谁, 交给它什么" 已基本是程序决定, 剩下由 Agent 判断的是发现处置, 修复范围和何时复审.

## Engine session capabilities

当前 Engine 已有一个用户级后台管理进程, 是 Main Agent 与后台 Agent 共用的机器入口 `arw background-agent` 的服务端 (`docs/specs/agent-repository-workflow/spec.md` 的 Background Agent control 节, `docs/adr/0030-use-user-wide-background-agent-management.md`):

- 后端: `modelProvider` 为 `anthropic` 时用每回合一个 `claude -p` stream-json 进程的 Claude 后端, 其他提供方用共享 Codex App Server; 两者实现同一 `NativeSessions` 接口, 同等提供运行中发消息, 待决原生请求和中断 (同一规格的 Platform support 节; `docs/adr/0032-run-claude-reviewers-through-headless-claude.md`, `docs/adr/0033-run-each-claude-turn-as-a-stream-json-process.md`). 实现在 `lib/background-agent/codex-app-server.mjs`, `claude-provider.mjs`, `claude-sessions.mjs`.
- 本地模型: 提供方可配置 `driver: "strata"`, 由 `lib/background-agent/strata-driver.mjs` 驱动本机 Strata 安装 (`docs/specs/agent-repository-workflow/strata.md`). 这说明 Engine 已有接入本地模型并按提供方限额调度的先例, Jev 类本地模型可以评估是否走同一提供方机制.
- 容量: 全局 `backgroundAgent.maxInstances` 默认 `16`, `openai` 与 `anthropic` 提供方默认各 `4` (`docs/specs/agent-repository-workflow-installation/spec.md` 的 Background Agent configuration 节).
- Reviewer 设置: 三个角色键 `code-standards-reviewer`, `requirements-reviewer`, `spec-readiness-reviewer`, 全局默认 `gpt-6-luna`, `openai`, `xhigh`; 由 Claude Code 中的 Main Agent 调用且未选择 `anthropic` 时整体改用 `haiku`, `anthropic`, `high` (同一规格的 Reviewer configuration 节). 仓库可按字段覆盖.
- 平台对等: 根 `AGENTS.md` 的 Project Overview 规定 ARW 必须在 Codex 和 Claude Code 中都完整可用, 包括 `arw background-agent` 系列命令.

## Existing measurements

规格已要求后台 Reviewer 任务记录工作时间 (扣除停机, 休眠和不工作区间) 和原生用量 `inputTokens`, `cachedInputTokens`, `outputTokens`, 并可估算模型输入与输出阶段速度 (`docs/specs/agent-repository-workflow/spec.md` 的 Model work time 与 Model phase measurement 节). 这些计量只覆盖经 `arw background-agent` 运行的任务, 不覆盖与用户对话的 Main Agent 自己的回合. 测量 "用户发出消息到 Agent 结束回复" 的耗时 (Wayfinder issue "测量当前 ARW 流程的耗时分布") 还需要会话历史一类的数据来源.

## Contracts affected by an Engine-driven flow

以下现行合同在 "Engine 驱动, Agent 被驱动" 后不能原样成立, 需要在后续决定型 issue 中逐项取舍. 这里只列出冲突点, 不给结论.

1. "ARW 不自主发起 Agent 编码工作" 与 "不替代用户批准" (Application and local lifecycle 节): Engine 驱动意味着 Engine 主动启动 worker 和 Reviewer; 用户批准仍须保留, 但等待用户成为 Engine 的一种流程状态.
2. Main Agent 身份与 Git 写入归属 (`CONTEXT.md`, `docs/agents/agent-writes.md`, ADR 0013): 现在由与用户对话的 Main Agent 独占 Git 写入和写入范围分配; Engine 驱动时要决定这些责任留在 Main Agent, 还是转给 Engine.
3. 触发点读规则的工作方式 (根 `AGENTS.md` 的 Workflow Triggers 节): Engine 掌握顺序后, 规则可以拆成程序检查加只给当前步骤的短指令, 现有 Skill 体系的地位需要重新决定.
4. 暂存区同时承担三种责任: 写入前的恢复基线 (`docs/agents/agent-writes.md` 的 Prepare the baseline 节), Gate 3 默认比较的已暂存候选 (`code-review` Skill), 以及 Commit Audit 冻结的已暂存候选. 如果 Engine 为 Jev 判断触发的投机写入建立回退点, 再用暂存区承担这一责任会与后两者冲突. 参考 10-25 材料, 已于 11-07 核实.
5. 平台对等与 Platform Adapter (根 `AGENTS.md`, `docs/adr/0003-use-explicit-platform-adapters.md`, `docs/adr/0014-use-operation-neutral-platform-adapters.md`): Engine 驱动后两平台各自需要的会话控制能力不同, 是否继续两平台完全对等需要用户决定.
6. 临时工作区身份 (`docs/agents/environment.md`): 现在由承载 Agent 会话的平台提供会话 ID; Engine 自己启动的会话要有同等身份来源.
7. Reviewer 的单 Agent 执行与上下文隔离 (Reviewer runtime 节): Engine 若要逐单元喂给高智能 Agent 或插入 Jev 预检, 要说明这与 "独立 Reviewer 独自完成全部适用检查" 的关系.

## Open facts

- 近期真实工作中时间实际花在哪些步骤, 现有文件无法回答, 见上文 Existing measurements 节.
- Codex 与 Claude Code 能否由外部程序可靠地驱动 worker 会话 (继续, 中断, 崩溃接回, 每会话选模型), 由 Wayfinder issue "核对 Engine 控制 Agent 会话的平台能力" 核对.
