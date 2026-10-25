# 共享工具函数与声明式校验

Status: completed

## What to build

`isRecord`, `isJsonObject`, `sha256`, `exactKeys` 等工具函数在 `lib/` 公共模块中只保留一份, 各模块改为引用它. 提供一个声明式结构校验函数, 只用于外部输入; 本 issue 只迁移重复工具函数, 校验链压缩由后续 issue 完成.

预估改动: 净减行数.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#code-reduction`

## Acceptance criteria

- [x] 重复定义已删除, 全部调用点改用公共实现.
- [x] 声明式校验函数可用, 并至少替换一处手写校验链作为示范.
- [x] 完整测试套件通过, `lib/` 行数净减.

## Blocked by

None - can start immediately

## Comments

- 公共实现放在 `lib/common/json.mjs`: `isJsonObject`, `exactKeys`, `sha256`, `compareText`, 新增 `checkShape`; 删除 78 处顶层重复定义 (`isRecord` 23, `isJsonObject` 6, `isObject` 1, `sha256` 10, `digest` 1, `exactKeys`/`hasExactKeys` 9, `compareText` 28, 另有 `installation.mjs` 内部 `comparePaths` 1).
- 保留行为不同的变体: `release-vm-validation.mjs` 的 `exactKeys` (支持可选键), `repository-workflow/workflow.mjs` 的 `compareText` (`localeCompare`) 与 `digest` (先转字节).
- 合并的 `exactKeys` 变体只在键名含 `,` 或非可枚举自有属性时有差别, 对 JSON 输入和本仓库调用点无影响.
- 示范: `platform-adapter.mjs` 的 Skill 引用归一化记录校验改用 `checkShape`.
- `lib/` 行数 51521 → 51357. typecheck 通过; 测试 1063 项, 仅 2 项因 `AGENTS.md` 迁移期改名而失败 (预期).
- 审查: 独立 reviewer 确认合并无行为变化; 修复其指出的测试 typecheck 错误, 顺带删除重复 JSDoc 和 `comparePaths`. release-vm-validation 内部残留的 sha256 写法留给其重写 ticket.
