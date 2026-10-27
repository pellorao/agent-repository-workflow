# 规则和文档改动走机械提交

Status: completed

## What to build

用户决定 (2026-10-27): 只改 Agent 规则和文档的提交, 就绪审核加两个 Reviewer 的阻碍远大于质量收益 (ticket 22 的 14 行同义替换用了就绪审核 4 轮, 提交审核 2 轮; Reviewer 意见多为流程材料, 真正的跨文档语义缺口少见), 且用户会在状态页按 ticket 复核整体 diff. 改为:

- 默认: 只改 Agent 规则 (`AGENTS.md`, `docs/agents/**`, Skill 及其投影和分发副本) 和文档时, 跑投影检查, 分发检查, `arw text check`, Main 用 grep 自查跨文档引用和副本一致性, 按非实施方式提交; 不需要就绪记录和 Reviewer.
- 例外: 改动涉及审核系统本身 (Reviewer 角色, 关卡语义) 或长期规范的合同条款时, 只跑一个要求符合 Reviewer, 最多一轮, 不跑就绪审核.
- 代码改动照常走完整流程.
- 相应修改 `commit` Skill 的非实施路径, `arw commit-audit verify --non-implementation` 的路径判定, `implement` Skill 的 Entry 和长期规范.

预估净增约 30 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#commit-audit`
- `docs/specs/agent-repository-workflow/spec.md#work-records-and-implementation-authorization`
- `docs/specs/agent-repository-workflow/spec.md#cli-interface`

## Acceptance criteria

- [x] 只改规则和文档的暂存候选可以通过 `arw commit-audit verify --non-implementation`, 含代码的仍被拒绝; 有测试覆盖.
- [x] `commit`, `implement` Skill 和长期规范写明默认路径与例外.
- [x] 全量测试, 投影与分发检查通过.

## Blocked by

- None - can start immediately

## Validation

- 提交前最终内容上的结果: `pnpm test` 707 项通过, 0 失败; `pnpm typecheck` 无错误; `node scripts/project-claude-skills.mjs --check` 退出码 0; `node scripts/check-workflow-distribution.mjs` 通过; `node arw.mjs text check` 通过 (622 个文本文件). 三个 Skill 的 `distribution/skills` 副本手工同步 (Reviewer 不运行命令, 该项由 Main Agent 确认).
- 净增: 交付文件 (代码, 测试, Skill, `AGENTS.md`, 长期规范, 手工同步的分发副本) 增 44 减 14, 净增 30 行, 预估约 30 行, 未超. `.claude/skills` 投影和就绪记录是生成产物, 不计入.

## Comments

- Spec Readiness 第 8 轮 (haiku high) 通过, 记录绑定该轮 spec 字节. 此前 2 次与独立 subagent 共同决定 spec 修改; 第 7 轮对 "超出复审范围" 的质疑 Reviewer 只重复原话. 提交审核第 1, 2 轮的修复曾改 spec 导致第 9 到 12 轮追问既有的 Text Policy 归属, 后改为代码真实复用 `inspectTextBytes` 并回退 spec 到第 8 轮字节.
