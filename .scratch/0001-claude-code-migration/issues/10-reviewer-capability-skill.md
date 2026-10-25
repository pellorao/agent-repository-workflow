# Reviewer 能力一致性与 benchmark 改为不自动触发的 Skill

Status: ready-for-agent

## What to build

Reviewer 能力一致性和 reviewer-benchmark 改为源码仓库专用, 不自动触发的 Skill, 仍由 Agent 执行, 目标是证明 Reviewer 角色能发现已知问题, 两种后端都可用. 实现压缩到达成目标所需的最小程度. 用它比较 08 的轻格式下 luna xhigh 和 haiku high 的检出率, 检出率下降的模型恢复必要的复述要求.

预估改动: 大幅净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget`
- `.scratch/0001-claude-code-migration/spec.md#code-reduction`

## Acceptance criteria

- [ ] Skill 不自动触发, 两个平台的元数据都已设置.
- [ ] 按 Skill 执行能在两种后端各完成一次检查.
- [ ] 轻格式下两个默认模型的检出率已测出, 结论和格式调整记入 `## Comments`.
- [ ] 相关代码, 测试和文档大幅净减, 测试通过.

## Blocked by

- 03 共享工具函数与声明式校验
- 04 Claude 后端跑通 Reviewer
- 07 流程文档改为自动触发的 Skill
- 08 合并审核流程
