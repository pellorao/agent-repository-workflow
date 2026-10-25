# 共享工具函数与声明式校验

Status: ready-for-agent

## What to build

`isRecord`, `isJsonObject`, `sha256`, `exactKeys` 等工具函数在 `lib/` 公共模块中只保留一份, 各模块改为引用它. 提供一个声明式结构校验函数, 只用于外部输入; 本 issue 只迁移重复工具函数, 校验链压缩由后续 issue 完成.

预估改动: 净减行数.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#code-reduction`

## Acceptance criteria

- [ ] 重复定义已删除, 全部调用点改用公共实现.
- [ ] 声明式校验函数可用, 并至少替换一处手写校验链作为示范.
- [ ] 完整测试套件通过, `lib/` 行数净减.

## Blocked by

None - can start immediately
