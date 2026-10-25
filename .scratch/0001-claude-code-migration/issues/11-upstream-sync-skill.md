# Upstream Sync 与 Platform Standards 改为不自动触发的 Skill

Status: ready-for-agent

## What to build

Upstream Sync 和 Platform Standards 改为源码仓库专用, 不自动触发的 Skill, 仍由 Agent 执行, 目标是人工审核后采用上游 Skill 新版本. 实现压缩到达成目标所需的最小程度.

预估改动: 大幅净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget`
- `.scratch/0001-claude-code-migration/spec.md#code-reduction`

## Acceptance criteria

- [ ] Skill 不自动触发, 两个平台的元数据都已设置.
- [ ] 按 Skill 执行能完成一次同步审核.
- [ ] 相关代码, 测试和文档大幅净减, 测试通过.

## Blocked by

- 03 共享工具函数与声明式校验
- 07 流程文档改为自动触发的 Skill
