# 合并其他模块相同逻辑

Status: ready-for-agent

## What to build

本 effort 按模块处理 .tmp/triage.md 的第 4 轮已确认清单, 按 issue 编号顺序推进. 当前 issue 非测试代码净增预算: 0 行. 允许删除或合并相同实现, 不增加行为. 发现行为, 输出, 公开合同或持久状态变化, 类型收窄传播或需修改规范时跳过对应项并记录. 未发现新增已确认项时不扩展范围.

- #16: 合并 jira-client.mjs 中两个完全相同的候选响应错误.
- #272: 合并 reviewer-runtime.mjs 的相同重通知片段, 保留各自条件.
- #278: 删除 requireReviewerRecoveryLocation 中由相同路径片段推导而不可达的 sessionRoot 包含检查, 保留临时工作区失败映射.
- #302: 合并 workflow-distribution.mjs 的 safePath 与 platform-adapter.mjs 相同实现, 确认哨兵不影响公开错误结果.
- #246: 仅在线数减少时复用 code-map.mjs 的相同探针路径.
- #31: 仅在不引发类型检查传播时删除 submodule-coordination.mjs 同源映射的两个不可达异常; 否则跳过并记录.

禁止修改 lib/background-agent/**.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范.

预期验证: pnpm typecheck, pnpm test, node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, 受影响文件的 node --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0021-triage-shared-cleanup/, git diff --check. 使用现有覆盖, 只有发现独立回归风险缺口时新增最少测试. Commit Audit 使用两个内置 Reviewer.

边界情况: 无效 JIRA 响应, 通知重入与停止, 不安全恢复路径和临时工作区失败, 路径拒绝, 空模块及最终同步, Codex 与 Claude Code 现有确定性覆盖.

## Acceptance criteria

- [ ] 逐项复核并完成可保持行为的精简, 跳过项记录理由.
- [ ] 命令输出, 公开 Interface, 错误结果和持久状态不变, 不修改长期规范.
- [ ] 完整 Source Checkout 验证及适用检查通过, 记录预算实际值和验收证据.

## Blocked by

无.
