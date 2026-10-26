# 审核流程的机械步骤交给程序

Status: ready-for-agent

## What to build

独立审计估算一张典型 ticket 要 5 到 8 次 Reviewer 会话, 15 到 30 分钟, Main 还要做 30 到 50 次机械工具调用 (拼完整 `instructions` 的 JSONL, 复制带 SHA-256 的规则副本, 等待, generate/promote/verify). 把这些机械步骤交给程序:

- `arw commit-audit prepare` 和 Spec Readiness 的准备步骤一次完成规则副本, 哈希和空报告, 并输出可直接发给 `arw background-agent` 的 spawn 请求; Main 只提供路径.
- 非实施提交的 6 步手工机械检查改为一条命令.
- 规则和 Skill 中对应的手工步骤删除.

ticket 15 中等规模冒烟 (约 330 行 CLI, 同一 issue) 的基线: Codex 约 19 分钟, Spec Readiness 2 轮, 提交审核 2+2 轮; Claude Code 约 62 分钟, Spec Readiness 5 轮 (worker 自己的提交 9 轮), 提交审核 4+3 轮, Main 66 次工具调用. 冒烟中的流程摩擦一并处理:

- 复审收敛: 复审只看上一轮问题是否解决和本轮改动引入的新问题, 不重新审整份文档 (haiku Spec Readiness 每轮对新补的文字提新问题, 不收敛).
- Claude 后端 Reviewer 的组合 Bash (`cd … && git …`) 被只读放行规则拒绝, 导致 `incomplete`: Reviewer 指令要求每次只跑一条命令并用 `git -C`, 或让放行规则覆盖.
- `implement` Skill 的 Entry 加硬检查: 没有就绪记录不开始实施 (Claude Main 曾先写代码后做 Spec Readiness).
- `workflow init` 给出默认的测试单回调耗时阈值, 默认不开启语言检查 (两边都在此停下问用户).
- `wait_agent` 增加等到完成的选项; `stateDirectory`, `resultPath` 的位置写进 `reviewer-launch`; followup 后 `turnId` 仍为 `turn-1` 的问题排查.
- Codex 沙盒内启动的管理进程无法拉起 App Server: 文档写明在沙盒外预启动, 或让管理进程自行脱离沙盒.

- 用户决定 (2026-10-26): Claude 后端 Reviewer 只用 `haiku`, 不用其他 Claude 模型, 推理强度可调; 只写进规则, 不加程序强制.

各项的预期行为见治理 spec 的 `Program-prepared review rounds`.

- Reviewer 提出修改 spec 的意见时, Main Agent 和一个智力与推理强度都不低于 Main Agent 的独立 subagent 共同决定是否修改及怎样修改, 双方有分歧再交用户决定; 同一审核轮全部报告中的多项意见合并为一次决定, 不逐条启动 subagent (用户 2026-10-26). 写进 `spec-readiness` 和 `rule-and-design-changes` Skill, 取代逐次向用户确认.

目标 (用户 2026-10-26): Reviewer 每个关卡约 3 轮属于正常; 一个 issue 的完整流程墙钟必须在 60 分钟以内, 30 分钟以内为优, 达到即停止优化. 最终以 ticket 18 移植的 benchmark v2 场景计时; 本 ticket 先在 15 的同一冒烟上确认 Claude Code 不超过 60 分钟.

预估改动: 运行时代码约 +200 行, 测试约 +150 行, 规则和 Skill 约 -150 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#program-prepared-review-rounds`

## Acceptance criteria

- [x] Main 不再手工拼 spawn 请求和规则副本.
- [x] 非实施提交检查是一条命令.
- [ ] 同一中等规模 issue 上, Main 工具调用数相对 15 的冒烟明显下降, Claude Code 和 Codex 墙钟都不超过 60 分钟, 数据记入 `## Comments`.
- [x] Reviewer 的 spec 修改意见由 Main 与独立 subagent 共同决定, 分歧才交用户.
- [x] 长期规格与规则, Skill 同步更新上述公开合同和手工步骤.
- [x] 全量测试和分发检查通过.

## Blocked by

- issue:0001:15

## Comments

冒烟 (2026-10-26, 中间提交 `409d138` 的源码 arw, 目标和做法同 ticket 15 冒烟: tasklog CLI, issue "Due dates and agenda", 隔离仓库和临时 HOME). 墙钟只算 Agent 运行, 不含等用户回复的时间.

| 平台 | Main | Reviewer | 墙钟 | Main 工具调用 | Spec Readiness 轮数 | 提交审核轮数 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Codex 基线 (ticket 15) | `gpt-6.1-sol` high | `gpt-6-luna` xhigh | 19 分钟 | 82 次命令 + 12 次文件修改 | 2 | 要求符合 2, Code Standards 2 | 350 行 |
| Codex | `gpt-6.1-sol` high, `codex exec` | `gpt-6-luna` xhigh | 30 分钟 (468 s + 248 s + 1102 s) | 61 次命令 (文件修改都在命令中) | 4 | 要求符合 2, Code Standards 2 | 提交 `6be4930`, +309/-32 |
| Claude Code 基线 (ticket 15) | `sonnet` high, `claude -p` | `haiku` high | 62 分钟 | 66 | 5 | 要求符合 4, Code Standards 3 | 提交 `f4a6dc3`, Main 约 4.2 美元 |
| Claude Code | `sonnet` high, `claude -p` | `haiku` high | 54 分钟 (1648 s + 138 s + 1456 s) | 93 (Bash 77, Agent 7, SendMessage 4, 其他 5) | 12 (3 个关卡: 7, 1, 4) | 6 轮, 每轮两个 Reviewer (有效: 要求符合 3, Code Standards 5) | 提交 `021215c`, Main 约 3.8 美元 (含共同决定 subagent) |

- Codex: Main 工具调用下降约 35%, 不再手工拼请求, 复制规则或轮询; 每轮审核是一条 `cat <round>/*.jsonl | arw background-agent --wait`. 墙钟上升来自 Spec Readiness 多出的 2 轮: 每轮 gap 都要改 spec, `rule-and-design-changes` 要求先取得用户确认, Main 因此停下 2 次 (模拟用户都回复批准). 基线中的测试阈值和语言检查停顿没有再出现.
- Codex: 管理进程仍须在沙盒外预启动 (本次由冒烟脚本用一条探测请求启动); 沙盒内的 `arw background-agent` 通过本机 TCP 连接它, Reviewer 正常完成.
- Codex 摩擦: 提交审核的 Input 文件名必须是 `input.json`, Main 第一次用了别的名字, 多一次调用; Main 在要求符合报告返回前多准备了一轮 (第 2 轮目录未使用), 下一轮 prepare 仍正确生成 `followup_task`.
- Claude Code (2026-10-27, 本 ticket 工作树的源码 arw, 冒烟仓库放在 ARW 目录树外, 避免读到上层 `CLAUDE.md`): 墙钟 54 分钟, 不超过 60 分钟; 但 Main 工具调用 93 次, 比基线 66 次多, 这一条验收未达到. 多出的调用来自轮数: Spec Readiness 12 轮 (基线 5), 其中提交审核后两次因修改 spec 回到就绪审核; 第 2 次运行的 11 次调用全部用于下面第 3 项故障后的恢复. 每轮审核的机械操作是一次 `prepare` 加一次 `cat <round>/*.jsonl | arw background-agent --wait`, 没有手工拼请求, 复制规则或轮询.
- Claude Code 共同决定: Main 对每轮 Spec Readiness 和提交审核问题都启动或续用一个 `sonnet` 独立 subagent (Agent 7 次, SendMessage 4 次), 全部达成一致, 没有停下来问用户. Main 也把非 spec 的 Code Standards 问题交给 subagent, 超出规则要求, 多用了 2 次调用.
- Claude Code 失败与修正 (前两次尝试不计入上表): 尝试 1 冒烟脚本把 `CODEX_HOME` 指向不存在的目录, Claude Reviewer 也报 `Codex home is unavailable` 后停止; 尝试 2 在 Spec Readiness 后停下, 理由是 `subagent-allocation.md` 的仓库映射为空, 共同决定的 subagent 需要用户批准, 已在规则中写明它是与 Main 同模型的预定义角色配置. 上表第 1 次运行中要求符合 Reviewer 两轮因 `git -C <repo> show` 被放行规则拒绝而 `incomplete`, 已改为后端额外放行 `git -C <cwd>` 只读命令, `reviewer.md` 写明不加 `-C`; 为加载新代码手动结束了管理进程, 第 2 次运行随即被下面的冷启动缺陷阻断, 清空冒烟 HOME 的管理状态后第 3 次运行完成.
- 管理进程冷启动缺陷 (未修复, 待决定): 只用 Claude 后端时, 管理进程非正常退出 (被结束, WSL 重启) 后如果库中还有空闲 Agent, 重启后每次提交都失败: "Earlier App Server exit could not be confirmed." 和 "Original native environment cannot be safely restored.". 原因是 `manager.mjs` 只在旧进程状态为 `ended` 时认可旧进程已退出, 而没有 App Server 身份的 Claude 环境总是 `absent`.
- 报告路径命名: 本 ticket 最终提交审核指出 `resultPath` 与 `reportPath` 是同一路径的两个名称, 已统一为请求字段名 `reportPath` (`code-review` Skill, Code Standards 角色规则, 长期规格); 上文 "`resultPath` 的位置" 即 `reviewer-launch` 中的 `reportPath`.
- Spec Readiness 收敛: haiku 每个关卡平均 4 轮, 超过 "约 3 轮" 的预期; 各轮问题多针对上一轮新补的 spec 理由文字 (ADR 结论, Module Design 理由).
