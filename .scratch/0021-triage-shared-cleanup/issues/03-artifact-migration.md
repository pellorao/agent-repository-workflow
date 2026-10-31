# 精简迁移模块重复逻辑

Status: completed

## What to build

本 effort 按模块处理 .tmp/triage.md 的第 4 轮已确认清单, 按 issue 编号顺序推进. 当前 issue 非测试代码净增预算: 0 行. 允许删除或合并相同实现, 不增加行为. 发现行为, 输出, 公开合同或持久状态变化, 类型收窄传播或需修改规范时跳过对应项并记录. 未发现新增已确认项时不扩展范围.

- #37: 复核 tests/artifact-migration 中 readFile 和 readdir 覆盖, 只删除生产代码未读的成员; 无死成员则跳过.
- #38: 复用 issue-documents.mjs 完全相同的 normalizeText 和 findFrontmatterEnd, 保留未闭合 YAML 消息.
- #41: ASCII slug 排序复用 compareText, 删除仅调用一次的 compareUtf8.
- #45: 仅在不引发类型检查传播时删除同源 documents 映射中不可达的缺少输入异常; 否则跳过并记录.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范.

预期验证: pnpm typecheck, pnpm test, node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, 受影响文件的 node --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0021-triage-shared-cleanup/, git diff --check. 使用现有覆盖, 只有发现独立回归风险缺口时新增最少测试. Commit Audit 使用两个内置 Reviewer.

边界情况: BOM 和换行规范化, 空文档, 未闭合前置区, 同提交 ASCII slug 顺序, 输入输出配对和原错误结果.

## Acceptance criteria

- [x] 逐项复核并完成可保持行为的精简, 跳过项记录理由.
- [x] 命令输出, 公开 Interface, 错误结果和持久状态不变, 不修改长期规范.
- [x] 完整 Source Checkout 验证及适用检查通过, 记录预算实际值和验收证据.

## Blocked by

无.

## Validation

- #37: MigrationFilesystem 的生产调用只有 lstat, rename, rm 和 writeFile. 删除 tests/artifact-migration/cli.test.mjs 中未被读取的 readFile 覆盖; 不存在 readdir 覆盖. 注入读取失败的实际入口 inventoryFilesystem.readText 保留, 原测试仍检验读取和目录枚举失败时零写入.
- #38: normalizeText 与 findFrontmatterEnd 从 issue-documents.mjs 导出并复用, 保留原扫描条件和 YAML frontmatter is not closed. 消息. BOM, CRLF, CR, 空文档, 闭合及未闭合前置区的 8 组对比结果与原实现一致.
- #41: 移除 compareUtf8, 使用已有 compareText. slug 语法限制为 ASCII, 100 组排序对比结果相同; 现有迁移测试保留按提交历史及同提交 slug 排序的最终目录断言.
- 非测试代码净增预算 0 行, 实际新增 5 行, 删除 15 行, 净减少 10 行. 另删除测试中 3 行无效注入, 未新增或语义修改测试案例. 提交前只删减与合并自查完成.
- pnpm typecheck 通过; pnpm test 通过, 812 项测试, 0 失败, 0 跳过. 日志: .tmp/codex/01a1906d-513c-7b20-b0f2-7ecef5f3382b/0021_03/validation/tests.log.
- node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check 和 node scripts/generate-install-arw.mjs --check 均通过.
- 3 个修改的 JavaScript 文件均通过 node --check; node arw.mjs text check, node arw.mjs terms check --include .scratch/0021-triage-shared-cleanup/ 和 git diff --check 均通过.

## Comments

#45 跳过: migrateIssueDocuments 的输出确实来自相同 documents, 但 Map.get 返回 IssueDocument | undefined, 当前异常同时承担类型收窄. 删除它需要改变配对构建或添加类型断言, 本次保留现有配对与收窄, 不扩大类型改动. 本 issue 满足行为保持重构例外, 不创建 Spec Readiness 记录.

- Commit Audit 第 1 轮: requirements-reviewer 和 code-standards-reviewer 均以 ready 完成, 两份绑定报告均为 No problems. 受审树为 fc2f25750f0c5271ff589494f87d135819f6d912, 报告目录为 .tmp/codex/01a1906d-513c-7b20-b0f2-7ecef5f3382b/_commit-audit/1/. Main Agent 已回归抽查迁移幂等结果, 同提交 slug 排序和读取失败零写入的既有断言, 并核对 ASCII slug 语法与共享比较器, 未发现漏检.
