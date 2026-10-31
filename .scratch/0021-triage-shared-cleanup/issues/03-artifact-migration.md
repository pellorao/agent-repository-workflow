# 精简迁移模块重复逻辑

Status: ready-for-agent

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

- [ ] 逐项复核并完成可保持行为的精简, 跳过项记录理由.
- [ ] 命令输出, 公开 Interface, 错误结果和持久状态不变, 不修改长期规范.
- [ ] 完整 Source Checkout 验证及适用检查通过, 记录预算实际值和验收证据.

## Blocked by

无.
