# Codex Main 的等待截断与标题缺失

Status: completed

## What to build

ticket 21 冒烟 (2026-10-27) 发现两处 Codex Main 侧与规范不符:

- `codex exec` 作 Main 时, `arw background-agent --wait` 在 Reviewer 完成前就返回, 运行本身照常完成. 规范 `--wait` 要求持续 `wait_agent` 到 Reviewer `completion` 非空. 本 ticket 复查: 直接运行 `--wait` 持续到审核结束 (约 5 分钟); Codex 命令工具在沙盒内等待 11 分钟无输出的命令也不截断. 截断因此来自 Codex 工具在其他条件下的提前返回 (如提权运行的超时), 不在 ARW 的 `--wait` 循环. 交付: 在 规范 Machine entry 与 `reviewer-launch` Skill 写明 `--wait` 命令在 `<id>:done` 前返回不表示审核结束, 用回执中的 `runId` 经 `list_agents` 取 `cursor` 后 `wait_agent` 续等 (已有的可续等入口). 另外 `--wait` 循环只在调用方自己中止了等待时才把 `cancelled` 当作结束; 其他 `cancelled` 结果 (第 4 次真实审核中出现过一次, 审核仍在运行时 `--wait` 提前输出了没有 `completion` 和 `state` 的结束行) 继续等待, 有测试覆盖.
- Codex Main 配 Claude 后台 Agent 时, App Server 未运行 (Claude 后端没有 Codex App Server 可询问), `arw list background-agents` 的标题显示 N/A. Main 标题应与 App Server 是否运行无关: 按线程 ID 在 Codex 主目录 `sessions` 下找到该 Main 的会话记录, 取首条用户消息; 同时补充规范该标题来源及其对 "查询不读取原生会话文件" 的例外.

预估净增约 60 行 (用户 2026-10-28: 仅供参考, 审核证明需要时按正确做法扩展).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#machine-entry`
- `docs/specs/agent-repository-workflow/spec.md#background-agent-communication`
- `docs/specs/agent-repository-workflow/spec.md#background-agent-listing`

## Acceptance criteria

- [x] `--wait` 的等待在审核结束 (`<id>:done`) 后才返回, 用真实审核验证; 规范记录命令被工具提前返回时经 `list_agents` 与 `wait_agent` 续等, 以及 `--wait` 只在调用方自己取消时按取消结束, `reviewer-launch` Skill 与之一致.
- [x] App Server 未运行时, Codex Main 配 Claude Agent 的列表标题正确 (由会话记录取得), 有测试覆盖 (含多个匹配与身份不符), 规范记录该标题来源, 读取责任, 权威来源, 取舍和 ADR 结论.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 708 通过, `pnpm typecheck`, `arw text check`, `node scripts/project-claude-skills.mjs --check`, `node scripts/check-workflow-distribution.mjs` 均通过.
- 新增测试: `tests/background-agent/codex-consumption.test.mjs` (无 App Server 时按线程 ID 找会话记录, 多个匹配取路径排序最后一个, 身份不符为空), `tests/background-agent/machine.test.mjs` (没有调用方取消的 `cancelled` 结果不结束 `--wait`).
- 真实运行: 直接运行 `arw background-agent --wait` 共 8 轮真实审核 (Claude haiku), 各轮在审核结束后才输出 `<id>:done`; 第 4 轮出现过一次没有 `completion` 和 `state` 的提前结束行, 即本 ticket 修复的 `cancelled` 分支, 之后未再复现. `codex exec` 作 Main 在沙盒内等待 12 分钟 (有输出) 和 11 分钟 (无输出) 的命令都等到结束; 真实 Codex Main 运行 ARW 命令需要提权, `codex exec` 不能提权, 因此没有端到端复现 Codex 侧截断.
- Spec Readiness: 13 轮, 末轮 `No problems.`, `arw spec-readiness verify` 返回 0.
