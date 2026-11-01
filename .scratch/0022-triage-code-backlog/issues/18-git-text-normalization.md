# Git 文本执行与换行标准化共享

Status: needs-triage

## What to build

本 issue 属于 effort 0022, 承接从 issue:0022:03 拆出的 H12 和 H16. 用户已确认另建 issue 并运行 Spec Readiness; 当前为待筛查规划, 不授权生产修改. 实施前核对源码和调用方, 明确共享导出及模块依赖边界, 完成设计和 Spec Readiness 后才更新为可实施状态.

- H12: 筛查 `lib/arw-common/effort-start.mjs` 与 `lib/commit-audit/commit-audit.mjs` 的 Git 文本执行重复实现. 合并时保留错误前缀, stderr trim 和各调用方不同的 stdout trim 行为. 其他包装器只在完全保持原错误与输出合同时采用.
- H16: 筛查 `lib/common/text-policy.mjs`, `lib/application-jira/application-completion.mjs`, `lib/arw-common/artifacts.mjs`, `lib/arw-common/issue-documents.mjs` 的换行标准化重复实现. 明确共享函数及原有导出的兼容责任, 保留 CRLF, CR, LF 和 BOM 的处理边界.

体积预算: 非测试源码净增不超过 20 行. 不修改 `lib/background-agent/**`, 不安装, 不 push. 既有命令输出, 调用合同, 错误结果和持久状态保持不变; 需要新诊断码或规范变更时跳过并记录.

预期验证: Git 进程, effort 起点, Commit Audit, 文本策略, 制品, issue 文档和 Application 完成相关测试, 完整 Source Checkout 验证. 关注 Git 失败诊断, stdout 空白保持, CRLF, CR, LF 和 BOM.

## Acceptance criteria

- [ ] 确认 H12 和 H16 的范围及设计, 取得有效 Spec Readiness 后实施.
- [ ] 清理完成, 可观察结果保持不变, 取得定向和完整验证证据.

## Blocked by

无.

## Comments

- 2026-11-01: 用户选择将 H12 和 H16 从 issue:0022:03 分出, 单独走 Spec Readiness. 不在 issue:0022:03 会话实施.
