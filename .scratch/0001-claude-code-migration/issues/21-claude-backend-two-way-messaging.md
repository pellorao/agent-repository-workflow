# Claude 后端支持与 Main 双向通信

Status: completed

## What to build

长期规范要求 Main 能用 `send_message` 给运行中的后台 Agent 发工作指示, 后台 Agent 也能主动通知 Main. Claude 后端 (ADR 0032, ticket 04) 每轮运行一次性的 `claude -p`, 作业从 stdin 一次写完即关闭, 运行中的指示一律拒绝 (`lib/background-agent/claude-sessions.mjs` 的 `steer`); Reviewer 只有读写文件工具, 也发不出通知. 进程 id 没有记录, 所以管理进程异常退出后冷启动无法核对旧进程, 库中有空闲 Agent 时每次请求都失败 ("Earlier App Server exit could not be confirmed").

用户决定 (2026-10-27) 选 A. 总要求: Claude 后台 Agent 必须实现规范 `Background Agent control` 下全部功能 (Machine entry, Communication, State, Capacity and recovery, listing), 与 Codex 后端对等, 不打折扣; 现有 Claude 后端因 ADR 0032 而缺失或降级的行为都要补齐, 不只限于下列各项. Claude 后端同样提供模型阶段计量事实 (规范 `Model phase measurement`).


- 已实测 `claude -p --input-format stream-json --output-format stream-json` 回合进行中收到 stdin 新消息时的处理. 结论: 在下一次模型请求边界插入当前回合, 模型已在生成最终回复时排到下一个 Claude 回合, `--replay-user-messages` 的回显为取用事实; `send_message` 在活动回合上的语义按此写入 ADR 0033, 实测记录见 `## Comments`.
- 每个 Claude 后台 Agent 回合改为一个保持 stdin 打开的进程 (不按 Agent 常驻, 空闲 Agent 不占进程; 取舍见 ADR 0033). 规范 `Background Agent Communication` 中的各种消息都要覆盖, stdin 只解决其中一个方向:
  - Main 到 Agent 的工作指示 (`send_message`), 以及 Reviewer 运行程序和提供方程序自动产生的工作指示: 由管理进程从 stdin 送入活动回合; 空闲时 `followup_task` 开启新回合.
  - Agent 到 Main 的进度, 问题, 阻塞, 完成通知: Agent 自己调用 `arw background-agent send_message`. Claude Reviewer 现在只有读写文件工具, 需要只放行这一条命令 (`--allowedTools` 限定命令前缀), 进程环境提供 `ARW_BACKGROUND_AGENT_RUN_ID` 和根线程身份, 管理进程按身份核对来源.
  - 程序产生的暂停通知和管理状态通知 (开始, 结束, 故障, 中断, 待答复请求): 由管理进程从 stream-json 输出观察原生事实后发给 Main, 不依赖 Agent 发送; `list_agents` 和 `wait_agent` 仍须呈现回合结束或故障.
- 记录每个进程 id, 冷启动时按 id 核对旧进程是否已退出, 修复上述冷启动缺陷; 管理进程收到 SIGTERM 时正常退出.
- Codex 沙盒内首次调用 `arw background-agent` 无法启动管理进程时, 客户端以稳定诊断明确失败; Main 按 `reviewer-launch` Skill 申请提权, 在沙盒外重跑同一命令, 由此启动管理进程, 不需人工预启动 (用户 2026-10-27).
- 设计定稿前交一个不低于 Main 的独立 Agent 复核; ADR 0032 中 "运行中指示被拒绝" 的决定由新 ADR 取代.
- ticket 18 测量中 Claude 后端在 `dontAsk` 模式下偶发拒绝 Read/Bash, 导致 Reviewer `incomplete` (2026-10-27, 三次); 一并查明原因并修复.
- 本 ticket 提交时一并把 issue 10 (先修好 `## Spec Requirement` 格式) 和 issue 16 设为 `completed`, 不补跑就绪审核 (用户 2026-10-27).

预估改动: 运行时代码约 +150/-60 行, 测试约 +100 行, 规范与 ADR 约 +40 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#background-agent-control`
- `docs/specs/agent-repository-workflow/spec.md#platform-support`
- `docs/specs/agent-repository-workflow/spec.md#model-phase-measurement`
- `docs/specs/agent-repository-workflow/spec.md#seams-and-adapters`
- `docs/specs/agent-repository-workflow-installation/spec.md#background-agent-management`

## Acceptance criteria

- [x] 逐节对照 `Background Agent control` 列出 Claude 后端的每项缺失或降级, 全部补齐, 对照表记入 `## Comments`.
- [x] stream-json 回合中插入消息的实测行为记入 `## Comments`.
- [x] Claude 后端为每个模型响应提供计量事实 (响应身份, 请求, 首末生成与结束时间, 输入, 缓存与输出 token), 与 Codex 后端一样标出请求覆盖不完整, 有测试覆盖.
- [x] Claude 后端覆盖规范列出的全部消息形式 (Main 指示, 程序指示, Agent 主动通知, 程序暂停与管理状态通知), 有测试覆盖.
- [x] 管理进程被结束后冷启动, 空闲的 Claude Agent 不再导致请求失败; 有测试覆盖.
- [x] Codex 沙盒内首次调用得到沙盒诊断, Main 提权重跑同一命令后在沙盒外启动管理进程, 不需人工预启动.
- [x] Claude Code 和 Codex 各跑一次真实审核, 行为正常.
- [x] 新 ADR 取代 ADR 0032 的相关决定; issue 10 和 16 为 `completed`.

## Validation

- `pnpm test` (706 通过, 1 跳过), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `arw text check` 通过; `arw terms check --include .scratch/0001-claude-code-migration/` 只有提交前已存在的语言比例失败.
- 测试: `tests/background-agent/claude-sessions.test.mjs` (回合内插入, 取用回显, 排队到下一 Claude 回合, `can_use_tool` 与 `respond`, 中断和停止等待退出, 进程身份记录失败, 宿主端到端), `tests/background-agent/manager.test.mjs` (冷启动时 Claude 行按记录进程核对), `tests/background-agent/client.test.mjs` (沙盒诊断).
- 实测 (临时 HOME): 管理进程 `SIGTERM` 后以 0 退出且不留 `claude-process-*`; `codex sandbox` 内无管理进程和有管理进程时都得到沙盒诊断; 管理进程重启后后续任务以 `--resume` 继续同一 Claude 会话; 向运行中的 Claude Reviewer `send_message` 被取用且回合正常完成.
- 消息形式的测试: Main 指示经宿主端到端测试 (`claude-sessions.test.mjs` 的 "a Claude Code Main starts, waits for, follows up and messages a Claude Reviewer through the host") 写入运行中的 Claude 回合; 程序指示与程序暂停通知由管理 Module 经同一原生 `steer` 和消息存储交付, 与后端无关, 由 `manager.test.mjs` 的 `provider-program` 测试覆盖, Claude 侧的 `steer` 写入与取用回显由 "a running Claude turn takes instructions ..." 覆盖; Agent 主动通知所需的 Claude 侧条件 (`ARW_BACKGROUND_AGENT_RUN_ID` 与 `Bash(arw background-agent:*)` 放行) 由第一个 Claude 测试断言, 根线程身份核对与后端无关, 由 `machine.test.mjs` 与 `manager.test.mjs` 覆盖.
- 真实审核: Claude Code 上本 issue 的 Spec Readiness 共 7 轮 (haiku), 末轮 `No problems.`; Codex Main (`codex exec`, 工作区沙盒) 在沙盒外已启动的管理进程上为本 issue 运行一次 Codex Spec Readiness Reviewer.

## Blocked by

- None - can start immediately

## Comments

- 实测 (2026-10-27, claude 2.1.310, haiku, `claude -p --input-format stream-json --output-format stream-json --verbose`):
  - 回合中模型还会继续调用工具时, stdin 新消息在下一次模型请求边界插入当前回合, 只有一个 `result` 事件, 回复同时处理原任务和新消息.
  - 新消息到达时模型已在生成最终回复 (不再调用工具), 消息按先进先出排队, 当前 `result` 之后作为下一个 Claude 回合处理, 各有自己的 `result`. 空闲时写入的消息直接开启新回合. 加 `--replay-user-messages` 后, 每条 stdin 用户消息在被模型实际取用时原样回显, 可作为取用事实.
  - 结论: `send_message` 写入 stdin 成功即为 `delivered` (规范的通道分发事实); ARW 回合在 "已写入的消息都已回显且随后出现 `result`" 时结束, 排队到下一个 Claude 回合的消息仍属于同一 ARW 回合, 不会丢失.
  - `--permission-mode dontAsk --allowedTools 'Bash(arw background-agent:*)'`: `echo '<json>' | arw background-agent` 放行; heredoc 写法和 `arw list background-agents` 被拒. Bash 工具环境中 `CLAUDE_CODE_SESSION_ID` 是该 Claude 会话 id (覆盖父进程同名变量), `ARW_BACKGROUND_AGENT_RUN_ID` 和 `CLAUDECODE=1` 原样继承, 因此根线程身份核对可直接使用.
  - `--permission-mode default --permission-prompt-tool stdio`: 需要人工决定的工具请求以 `control_request` (`subtype: can_use_tool`, 含 `tool_name`, `input`, `decision_reason`) 发给宿主; 宿主回 `control_response` (`behavior: deny` 加 `message`) 后模型看到准确原因并继续当前回合; `behavior: allow` 则执行.
  - 中断: stdin 写 `control_request` (`subtype: interrupt`) 得到成功回复, 当前回合以 `error_during_execution` 结束, 进程保持存活. `SIGTERM` 使进行中的工具子进程立即结束, `claude` 约 0.65 秒后以 143 退出, 无残留进程.
  - `run_in_background` 的后台 Bash 在中断后仍存活并在结束时自动触发新回合; 环境变量 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` 去掉该能力.
- ticket 18 中 `dontAsk` "偶发" 拒绝的原因: 不是随机故障. 会话记录显示模型拼错仓库外绝对路径 (把较长的场景路径截成上级仓库), 或使用不在放行列表中的命令 (`git ls-tree`, `git status`, `cd ... &&`, `python3 -c`, `for` 循环); `dontAsk` 只给出通用的 "denied because don't ask mode" 提示, Haiku 无从纠正而返回 `incomplete`. 修复方向: 用 `--permission-prompt-tool stdio` 让 Reviewer 策略以具体原因拒绝, 模型据此改用允许的工具.

Claude 后端对照 `Background Agent control` 的缺失与降级 (2026-10-27, 全部补齐):

| 规范条目 | 原状 | 现状 |
| --- | --- | --- |
| `send_message` 发往活动回合 (Main 指示和程序指示) | 缺失, `steer` 抛错 | 写入回合进程 stdin, 写入成功即 `delivered`, 回显为取用事实 |
| Agent 主动通知 Main | 缺失, 无 Bash 放行, 无运行标识 | 环境提供 `ARW_BACKGROUND_AGENT_RUN_ID`, 放行 `Bash(arw background-agent:*)` |
| `list_agents` 待决原生请求, `respond` | 缺失, `dontAsk` 静默拒绝 | `can_use_tool` 控制请求成为 `clientRequests`, `respond` 回 `control_response` |
| Reviewer 拒绝人工交互并让模型看到原因 | 降级, 只有通用提示 | 以工具名, 原因和可用替代拒绝, 当前回合继续 |
| `interrupt_agent`, `stop` | 不等进程退出 | `SIGTERM` 并等待实际退出后报告 |
| 普通角色 | 套用 Reviewer 工具白名单和最终状态格式 | 默认工具集, 无格式约束, 未放行请求交给 Main |
| 进程身份与冷启动 | 不记录, 冷启动阻断全部请求 | 每个回合进程记录 `claude-process-<threadId>`, 按 Agent 核对 |
| 管理进程 `SIGTERM` | 无处理 (两个后端) | 停止全部 Agent, 确认退出后以 0 退出 |
| 回合结束后的后台命令 | 可能存活并开启新回合 | `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, 回合在进程退出后才结束 |
| Claude Code Main 的会话标题 | 只读 Codex 会话 | 读 Claude 会话的自定义标题, 生成标题或首条提示 |
| Codex 沙盒内首次调用 | 需人工预启动 | 返回明确的提权重跑提示, 不在沙盒内启动管理进程; 启动时不传递调用方会话身份 |

设计复核 (2026-10-27): 对照表与方案定稿前交一个 opus 独立 Agent 复核. 结论为方向可行, 指出管理进程启动时调用方会话身份会传给 Agent, 普通角色权限模型与 Codex 不对等等问题; 前者已改为启动时去掉 `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` 与 `CODEX_THREAD_ID`, 后者作为待用户决定的事项返回 Main: Codex 普通 Agent 在工作区沙盒内自行执行命令, Claude 普通角色只预先放行 `arw background-agent` 和获准写入目录的编辑, 其余工具请求都作为待决请求交给所属 Main 回应. 两者都实现规范的待决请求与回应功能, 差别只在需要 Main 回应的请求数量, 不影响本 ticket 的验收; 是否为 Claude 普通角色放宽放行规则或启用 Claude Code 的 Bash 沙盒由用户决定.

规范 `Background Agent control` 之外的对等缺口: Claude 后端原先没有模型阶段计量事实 (`measurementFacts`). 现加 `--include-partial-messages`, 以会话启动, 恢复和停止提供工作状态, 以 `system` 的 `requesting` 状态, `message_start`, 非空生成增量和 `message_delta` 的读取时间与用量提供每个响应的计量事实 (实测 claude 2.1.310 输出这些事件).

提交审核记录 (2026-10-27):

- 规模: 原预估 "运行时代码约 +150/-60 行, 测试约 +100 行" 只覆盖最初三项缺口. 补齐对等后范围增加 (按回合进程, 进程身份与冷启动, 沙盒诊断, 计量事实, Main 标题), 用户同意按净增约 1020 行为上限. 提交时 `lib/` 与测试净增 420 行 (+604/-184), 全部改动净增 552 行.
- 拆分 `startTurn`: 自成一体的计量与用量计算提为 `observeModelPhases` 和 `usageCounts`, stdout 事件处理命名为回合闭包内的 `readEvent`, 退出收尾为 `finish`; 不再把参数组装与环境构造拆成只用一次的函数 (根规则 `Efficiency First` 第 4 条).
- 不采纳 "删去规范 Rationale 与 ADR 0033 中的回合进程描述": 经与独立 subagent 共同决定, Rationale 一段是 Module 边界的取舍理由, ADR 0033 记录的是决定本身, 合同文字只在规范的 Claude Adapter 段与安装规范的身份文件段; 平台支持一节已改为引用.
- 不采纳 "ADR 0033 只保留理由并引用安装规范": 经共同决定, 该段陈述的是决定本身 (回合进程自行记录身份, 新管理进程只凭记录核对而不检查共享 App Server, `SIGTERM` 时确认退出后再退出), 文件名, 格式, 核对时机与离线维护等合同细节只在安装规范中.
- 不采纳 "进程意外退出时把工作状态记为 `unavailable`": Claude 后端没有共享服务进程, 回合进程退出 (包括失败) 后 Agent 仍可用下一个回合继续, 与 Codex 中 App Server 连接退出不同; 只有 `stop` 使 Agent 不可用.

