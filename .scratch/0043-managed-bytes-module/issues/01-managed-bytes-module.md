# readManagedBytes 移到独立模块

Status: completed

## What to build

`readManagedBytes` (Repository Workflow 读取文件字节时的换行规则) 现在定义在 `lib/repository-workflow/code-map.mjs` 并被 `workflow.mjs` 从那里导入, 与 code map 无关 (D2 第 3 轮审核建议). 把它移到 `lib/repository-workflow/managed-bytes.mjs`, `code-map.mjs` 和 `workflow.mjs` 都从新模块导入, `code-map.mjs` 不再导出它也不再导入 `normalizeLineEndingBytes`. 行为保持不变, 不改函数体与注释语义.

属行为保持重构例外: 不改变行为, 不新增测试 (现有测试经 `workflow.test.mjs` 和 `code-map.test.mjs` 已覆盖). 不适用 Spec Readiness 设计审核, 按 `spec-readiness` Skill 的 Exception workflow 记 `not-applicable`.

体积预算: 非测试代码净增约 +2 行 (新文件头与导入).

预期验证: `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check`, `git diff --check`.

## Acceptance criteria

- [x] `readManagedBytes` 定义在 `lib/repository-workflow/managed-bytes.mjs`, `code-map.mjs` 不再导出它, 两个使用方从新模块导入, 行为不变.
- [x] 上述验证命令通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm typecheck`, `pnpm test` (845 通过 / 0 失败), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过.

## Comments

- 净增: 非测试代码 +7 / -5 (净 +2: `managed-bytes.mjs` +4, `code-map.mjs` +1 / -4, `workflow.mjs` +2 / -1), 另 `release-manifest.json` +1 行登记新模块 (安装 payload 需要, 首次测试时漏登记导致 4 个安装测试失败, 已补).
