# 精简术语, 分发和审核运行时

Status: completed

## What to build

本 effort 按模块分三项依次处理 `.tmp/triage.md` 中已确认的行为保持重构. 本项处理 #205, #208, #209, #311, #271, #291, 范围为 lib/document-terms/document-terms.mjs, lib/workflow-distribution/workflow-distribution-sync.mjs, lib/reviewer-runtime/reviewer-runtime.mjs, lib/spec-readiness/spec-readiness.mjs. 逐处核对当前代码, 只删除死代码或不可达分支, 合并完全相同的重复实现. 非测试源码预计净删 10 行, 净增量预算上限为 0 行, 不新增行为或测试框架.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 因此不运行 Spec Readiness, 保留 Commit Audit.

预期验证: 相关现有测试, 完整 `pnpm test`, `pnpm typecheck`, 三项 Source Checkout 分发和生成检查, 受影响文件的 `node --check`, 文本和术语检查, `git diff --check`. 边界情况: 全局与局部术语冲突, 空节和围栏内标题; 分发读取失败; 审核终端清理失败与持久化顺序; 就绪活动请求的无效草稿路径. 不增加仅复述实现的测试.

## Acceptance criteria

- [x] 已核对并精简 #205, #208, #209, #311, #271, #291, 行为保持不变.
- [x] 必要验证通过, 净增量在预算内.

## Blocked by

- None - can start immediately

## Validation

完整 `pnpm test` 通过, 810 项全部通过, 耗时约 3 秒. `pnpm typecheck` 通过. 三项 Source Checkout 分发与生成检查, 四个受影响文件的 `node --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0019-triage-module-cleanup/`, `git diff --check` 全部通过.

已核对术语 scope 的封闭取值, 两处全局错误诊断的字段与位置完全相同, 局部术语解析复用相同的可见标题边界, 不改变空节或围栏处理. 分发读取成功类型必带 bytes. 活动请求在 resolve 前已校验 draftPath 为字符串. 四处审核终端清理错误处理保留相同错误码, completion, return 和 persist 顺序; 不合并不同的 completion 错误处理. 现有术语, 分发, 就绪和审核运行时测试继续覆盖成功与错误路径, 无测试变更. 非测试源码实际净删 4 行, 满足净增量上限 0 行, 自查只保留必要的删除与重复合并.

## Comments

本 effort 共处理 14 项, 跳过 #178, #303, #220, #245, 原因见 issue:0019:01 的记录. 未扩展筛选其他台账项. 前两项提交为 bd90bba 和 36b9546, 均取得要求符合与 Code Standards 的有效通过结果, Commit Audit 核验错误列表为空.

首轮 Code Standards 指出成功解析全局条目时会提前分配诊断对象. 已改为模块内辅助函数, 仅在两个错误分支调用, 保留字段与定位. 修正后重新运行完整验证.
