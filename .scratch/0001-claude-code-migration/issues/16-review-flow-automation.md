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

目标: 在 15 的同一中等规模冒烟上重测, Claude Code 墙钟和 Main 工具调用都减半以上, Reviewer 总轮数明显下降.

预估改动: 运行时代码约 +200 行, 测试约 +150 行, 规则和 Skill 约 -150 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#program-prepared-review-rounds`

## Acceptance criteria

- [x] Main 不再手工拼 spawn 请求和规则副本.
- [x] 非实施提交检查是一条命令.
- [ ] 同一中等规模 issue 上, Main 工具调用数和耗时相对 15 的冒烟明显下降, 数据记入 `## Comments`.
- [x] 长期规格与规则, Skill 同步更新上述公开合同和手工步骤.
- [x] 全量测试和分发检查通过.

## Blocked by

- 15 冒烟发现的日常使用问题
