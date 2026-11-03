# 提交审计与发布配置清理

Status: completed

## What to build

本 issue 属于 effort 0022, 已重新核对 `.tmp/triage.md` 的 H28-H32 及源码调用方, 按既有授权实施 H28-H31. H32 需要新增跨模块导出, 移至 issue:0022:19 独立设计和 Spec Readiness, 本轮保留原实现.

- H28: 删除文件内 StagedIssue 类型和对象中未使用的 effortNumber 字段, 保留 path.effortNumber 的分组和重复身份检查.
- H29: 用文件内 roundNames 合并两处相同的数字轮目录筛选, 保留创建时计数和读取时倒序排序.
- H30: 用文件内 readVersion 合并相同的 HEAD 与暂存树读取, 保留 Git 命令顺序, 失败处理和其他独立 write-tree 调用.
- H31: 删除 validHttpsUrl 中恒真的 hostname 非空判断, 保留 HTTPS, userinfo, query, fragment 和 .git 限制.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不运行 Spec Readiness, 提交审核照常运行.

体积预算: 非测试源码净增不超过 10 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/commit-audit/*.test.mjs tests/release/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 审计轮排序, Git 失败, https URL, userinfo, query, fragment 和 .git 限制.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

- None - can start immediately
## Validation

- H28: StagedIssue 只在本文件内使用, 删除的对象字段无读取方; 分组, 重复 effort 身份检查及 canonical ID 均继续使用 path.effortNumber.
- H29-H30: 数字目录筛选表达式不变, 创建轮计数和最新轮倒序排序不变; HEAD 与暂存树读取仍顺序执行原 Git 命令, 保留 git 的失败消息. 既有提交审计测试覆盖首轮, 复审, HEAD/暂存树漂移和 Codex/Claude Code 两平台会话定位.
- H31: URL.canParse 成功且 protocol 为 https: 时 host 必定非空. 通过公开 validateReleaseValidationConfiguration 核对 8 个输入, 包括有效 HTTPS .git, 缺失 host, HTTP, userinfo, query, fragment 和缺少 .git, 结果与原限制一致.
- `node --test tests/commit-audit/*.test.mjs tests/release/*.test.mjs` 通过, 共 2 个测试文件. `pnpm test` 通过, 共 814 个测试, 0 个失败. 未新增或语义修改测试.
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 和两个修改源码的 `node --check` 均通过.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check` 通过.
- 非测试源码新增 14 行, 删除 9 行, 净增 5 行, 满足预算.

## Comments

- 2026-11-01: H28-H31 经重新核对后完成, 无跳过项. H32 按既有授权移至 issue:0022:19, 当前 needs-triage, 未实施. 没有更改 Reviewer 规则或审核语义, 无需能力测试.
- 第 1 轮 Code Standards 和要求符合 Reviewer 均正常完成, 报告均为 No problems. Main Agent 抽查数字轮目录筛选及倒序排序未变, 并回归核对公开 URL 的 userinfo/query/fragment 拒绝边界和 HTTPS host 前提, 未发现漏检. 本轮之后只补充本章记录.
