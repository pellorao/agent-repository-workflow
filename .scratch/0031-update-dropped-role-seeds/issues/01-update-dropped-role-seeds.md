# workflow update 提示被丢弃的 agent-role seed 文件

Status: completed

## What to build

问题: 0.4.0 之前初始化的仓库, 旧 lock 记录了 `agent-role` 类型的 repository-owned seed (如 `.codex/agents/*.toml`). `workflow update` 生成新 lock 时不再记录它们 (`buildWorkflowLock` 只写当前 seed), 文件本身保留, 但之后 `workflow remove` 不再列出这些文件 (`seedPathsFromLock`), 用户没有任何提示, 文件成为孤儿.

改动: `buildInitOrUpdatePlan` 在新 lock 将被写入时, 取旧 lock 的 agent-role seed 路径 (`seedPathsFromLock`) 减去本次 seed 中非 regular-file 的路径, 结果作为计划字段 `droppedRoleSeeds`; `runRepositoryWorkflow` 在成功结果中返回它 (非空时); `lib/arw.mjs` 在 `Workflow update completed.` 之后打印一段空行, "These agent role files are no longer used by the workflow and can be deleted:" 和每个路径一行. 只是提示, 不删除文件, 不影响退出码, 与 `migratedRuleDocuments` 的提示方式一致.

体积预算 (非测试代码行): 净增约 +13; 上限 +20.

预期验证: CLI 测试在已初始化仓库的 lock 中加入一条旧 agent-role seed, 非交互 update 后断言输出含提示和路径; 既有 update 测试不变通过. 边界情况: 无被丢弃的 seed 时不打印.

## Acceptance criteria

- [x] update 丢弃旧 lock 中的 agent-role seed 记录时, 输出列出这些文件并说明可删除.
- [x] 没有被丢弃的记录时输出不变 (既有测试通过).

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1: `tests/repository-workflow/cli.test.mjs` 新测试 "workflow update lists agent role seed files that the new lock no longer records" 通过 (旧 lock 加一条 `.codex/agents/reviewer.toml` 的 agent-role 记录, update 输出提示与路径).
- 验收条件 2: 其余既有 update 测试不变通过 (`pnpm test` 830 通过).
- 体积: 非测试代码 `git diff --numstat` `lib/arw.mjs` +7 -1, `lib/repository-workflow/workflow.mjs` +7, 净增 +13, 在上限内.
- 全量: `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw terms check --include .scratch/0031-update-dropped-role-seeds/` 通过. 新测试耗时不到 100 ms. 就绪记录为 `not-applicable` 例外 (用户 2026-11-02 确认).

## Comments

- 就绪记录 (`not-applicable` 例外) 在实现改动之后才生成, 与 "首次修改实现文件前取得就绪结果" 的顺序不符. 维护者 2026-11-02 已追认这一偏离.
- 第 1 轮提交审核: 路径列表输出与相邻的 `migratedRuleDocuments` 重复, 合并为 `printPaths`; 写锁条件抽成 `writesLock` 一处计算, 三处共用; 规格 `workflow update` 非交互输出段补上本提示块. 暂存树 `pnpm typecheck` 与 `tests/repository-workflow` 及顶层测试通过 (`source-layout` 一项只在导出目录失败, 与改动无关).
- 第 2 轮提交审核: 规格段补上提示的原因 (否则角色文件变成遗留) 与 "只建议删除, 不影响退出状态". 另一条 "修改长期规格需逐处取得用户确认" 不采纳: 总层 `AGENTS.md` 的 ARW 自主工作方式规定设计文档修改不逐处预先确认, 由维护者按实施 issue 复核整体 diff.
