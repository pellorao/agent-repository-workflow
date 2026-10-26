# 规则和文档改动走机械提交

Status: ready-for-agent

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

## Acceptance criteria

- [ ] 只改规则和文档的暂存候选可以通过 `arw commit-audit verify --non-implementation`, 含代码的仍被拒绝; 有测试覆盖.
- [ ] `commit`, `implement` Skill 和长期规范写明默认路径与例外.
- [ ] 全量测试, 投影与分发检查通过.

## Blocked by

- None - can start immediately
