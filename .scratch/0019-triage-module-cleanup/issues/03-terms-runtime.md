# 精简术语, 分发和审核运行时

Status: ready-for-agent

## What to build

本 effort 按模块分三项依次处理 `.tmp/triage.md` 中已确认的行为保持重构. 本项处理 #205, #208, #209, #311, #271, #291, 范围为 lib/document-terms/document-terms.mjs, lib/workflow-distribution/workflow-distribution-sync.mjs, lib/reviewer-runtime/reviewer-runtime.mjs, lib/spec-readiness/spec-readiness.mjs. 逐处核对当前代码, 只删除死代码或不可达分支, 合并完全相同的重复实现. 非测试源码净增量预算为 -10 至 -25 行, 不新增行为或测试框架.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 因此不运行 Spec Readiness, 保留 Commit Audit.

预期验证: 相关现有测试, 完整 `pnpm test`, `pnpm typecheck`, 三项 Source Checkout 分发和生成检查, 受影响文件的 `node --check`, 文本和术语检查, `git diff --check`. 边界情况: 全局与局部术语冲突, 空节和围栏内标题; 分发读取失败; 审核终端清理失败与持久化顺序; 就绪活动请求的无效草稿路径. 不增加仅复述实现的测试.

## Acceptance criteria

- [ ] 已核对并精简 #205, #208, #209, #311, #271, #291, 行为保持不变.
- [ ] 必要验证通过, 净增量在预算内.

## Blocked by

无.
