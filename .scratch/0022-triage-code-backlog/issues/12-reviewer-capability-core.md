# 审查能力核心重复清理

Status: completed

## What to build

本 issue 属于 effort 0022, 处理已重新确认的 H60-H64. 按本轮用户要求保留约 4 到 6 项的模块分组, 不采用旧清单中的 1000 行合并方案. H65 跳过, 因原建议删除现有 sha256 导出, 违反本轮公开 Interface 不变的限制.

- H60: 复用 lineCounts 统计报告行数.
- H61: 复用 normalizeReviewerCapabilityPath.
- H62-H63: 删除 scoring.mjs 别名并每项只计算一次分组键.
- H64: 缓存 templates.mjs 的候选键计算.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. H60-H61 复用模块内已有相同实现, H62 删除别名, H63-H64 合并相同输入的重复键计算, 保持分组及候选顺序.

体积预算: 非测试源码净增不超过 10 行. 预计变更行数: 代码 55 行, 测试 0 行, issue 文字 20 行; 使用现有边界测试, 不添加重复测试. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/reviewer-capability/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 空报告, 行数, 路径分隔符, 分组顺序, 重复候选和散列字节.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

- None - can start immediately

## Validation

- H60-H64 已完成. 既有 reviewer-capability 测试覆盖报告证据行数, 场景叠加路径, 合并计分和模板候选归组; 定向 4 个测试文件通过. 未新增或语义修改测试.
- 完整 Source Checkout 验证通过: `pnpm test` 818/818, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, 四个改动源码的 `node --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/`, `git diff --check`.
- 预计变更行数: 代码 55, 测试 0, issue 文字 20. 实际代码 49 行 (净增 1), 测试 0 行; issue 文字 24 行 (新增 18, 删除 6). 净增未超过 10 行预算.

## Comments

- H65 跳过: 保留 format-penalty.mjs 的现有 sha256 导出. 下一轮从 issue:0022:13 继续, 本轮不实施下一 issue.
- 提交审核第 1 轮: requirements-reviewer 报告 No problems.; code-standards-reviewer 误判规则副本缺失而返回 incomplete. 已核实副本路径和 SHA256SUMS 正确. 第 2 轮保持相同暂存树并沿原线程完成审核, 返回单次调用 keyOf 应内联的问题, 已修正. 第 3 轮两个 Reviewer 均 ready 且报告 No problems.; 抽查模板候选顺序和分组键计算, 未发现回归或漏检. 审核记录位于 `.tmp/codex/01a19991-f0ab-7991-9bf3-af6148b3d6f5/_commit-audit/3/`.

- 2026-11-02: 本 issue 的实现与提交早于本轮约 1000 变更行的重分组, 保留原提交. 后续记录以本轮重分组为准.
