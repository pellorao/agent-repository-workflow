# JIRA 结果共享与 Codex 配置表达式清理

Status: needs-triage

## What to build

本 issue 属于 effort 0022, 承接从 issue:0022:02 拆出的 H6 和 H10. 用户已确认另建 issue 并运行 Spec Readiness; 当前为待筛查规划, 不授权生产修改. 实施前核对源码和调用方, 明确共享导出及模块依赖的边界, 完成设计和 Spec Readiness 后才更新为可实施状态.

- H6: 合并 `lib/application-jira/jira-client.mjs` 与 `lib/application-jira/jira-convergence-adapter.mjs` 中重复的 `jira-response-invalid` 失败结果构造, 保留各调用处的消息, 阶段和状态. 不改变 CLI 或既有调用合同.
- H10: 将 `lib/arw-common/codex-configuration.mjs` 中计算 `bytes` 的嵌套条件改为直白的条件分支, 保留配置已有设置, 默认配置及 BOM 字节拼接结果.

体积预算: 非测试源码净增不超过 20 行. 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 既有公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更时跳过并记录.

预期验证: JIRA 客户端和收敛 Adapter 测试, Codex 配置测试, 完整 Source Checkout 验证. 关注无效响应的完整诊断, 默认配置, 已有布尔设置, BOM 和换行字节保持.

## Acceptance criteria

- [ ] 确认 H6 和 H10 的范围及设计, 取得有效 Spec Readiness 后实施.
- [ ] 清理完成, 可观察结果保持不变, 取得定向和完整验证证据.

## Blocked by

无.

## Comments

- 2026-11-01: 用户选择将 H6 和 H10 从 issue:0022:02 分出, 单独走 Spec Readiness. 不在 issue:0022:02 会话实施.
