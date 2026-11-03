# 精简 common 模块

Status: completed

## What to build

本 effort 按模块分三项依次处理 `.tmp/triage.md` 中已确认的行为保持重构. 本项处理 #182, #183, #179, #190, 范围为 lib/common/file-transaction.mjs, lib/common/configuration-conversion.mjs, lib/common/git-content.mjs. 逐处核对当前代码, 只删除死代码或不可达分支, 合并完全相同的重复实现. 非测试源码预计净删 4 行, 净增量预算上限为 0 行, 不新增行为或测试框架.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 因此不运行 Spec Readiness, 保留 Commit Audit.

预期验证: 相关现有测试, 完整 `pnpm test`, `pnpm typecheck`, 三项 Source Checkout 分发和生成检查, 受影响文件的 `node --check`, 文本和术语检查, `git diff --check`. 边界情况: 事务路径解析, 失败阶段和回滚; 转换后的 null 与缺失值; Git 批量响应的缺失对象, 身份不符和格式错误. 不增加仅复述实现的测试.

## Acceptance criteria

- [x] 已核对并精简 #182, #183, #179, #190, 行为保持不变.
- [x] 必要验证通过, 净增量在预算内.

## Blocked by

- None - can start immediately

## Validation

完整 `pnpm test` 通过, 810 项测试全部通过. `pnpm typecheck` 通过. `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 全部通过. 三个受影响文件的 `node --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0019-triage-module-cleanup/`, `git diff --check` 通过. 三份 issue 的语言检查符合中文正文约定.

已核对事务失败结果的必有 stage, 转换值克隆和 JSON 路径读取的校验前提, Git 缺失对象与正常对象的身份匹配和错误顺序. 没有修改测试, 复用现有事务回滚, 配置转换和 Git 批量读取覆盖. 非测试源码实际净删 4 行, 少于预估删除量, 无净增量. 提交前已自查删除与合并范围.

## Comments

本 effort 跳过 #178: 提取重复默认值检查不能减少行数. 跳过 #303 和 #220: 建议方案改变导出或参数接口. 跳过 #245: 删除 PathObservation 的可选字段会改变文件系统适配器接口与可接受输入. 不增选台账中的其他项.

首轮审核指出原预算误把预计删除量写成必须满足的删除区间. 现更正预算为净增量上限 0 行, 实际净删 4 行; 实施范围与代码保持不变. Git 批量读取另以 10 组输入与 HEAD 原实现比较, 覆盖空批次, 正常和缺失对象, 混合响应, 身份不符, 无效头, 无效长度, 不完整与额外响应, 结果和错误消息完全一致.
