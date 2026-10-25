# 其余模块校验链压缩

Status: ready-for-agent

## What to build

其余模块的手写校验链改用声明式校验函数, 删除校验程序自身刚产生数据的代码和吞掉错误又不处理的 `catch`. 对外行为不变.

预估改动: 净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#code-reduction`

## Acceptance criteria

- [ ] 完整测试套件通过, 只为被删除的功能删除测试.
- [ ] `lib/` 行数净减, 变化记入 `## Comments`.

## Blocked by

- 03 共享工具函数与声明式校验
- 09 release VM 验证改为不自动触发的 Skill
- 10 Reviewer 能力一致性与 benchmark 改为不自动触发的 Skill
- 11 Upstream Sync 与 Platform Standards 改为不自动触发的 Skill
