# 合并其他模块相同逻辑

Status: completed

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

- [x] 逐项复核并完成可保持行为的精简, 跳过项记录理由.
- [x] 命令输出, 公开 Interface, 错误结果和持久状态不变, 不修改长期规范.
- [x] 完整 Source Checkout 验证及适用检查通过, 记录预算实际值和验收证据.

## Blocked by

无.

## Validation

- #16: 候选响应错误共用一个局部函数, 保留诊断, 阶段和结果; 6 个响应案例与 HEAD 实现逐项对照一致.
- #272: 两处重通知共用 notifyAgain, 各自条件和调用时机不变; 现有 Reviewer Runtime 停止, 通知重入和期限覆盖全部通过.
- #278: 删除从同一规范路径片段推导的包含检查, 保留 resolveTemporaryWorkspace 验证与错误映射; 现有恢复路径与临时工作区失败覆盖通过.
- #246: 将已有 probe 传给 rootIgnoreState, 删除重复计算, 净减 1 行.
- pnpm test: 812 项通过, 无失败或跳过. pnpm typecheck 通过.
- node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check 全部通过.
- 4 个受影响 ESM 文件的 node --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0021-triage-shared-cleanup/, git diff --check 全部通过.
- 非测试代码净增预算 0 行, 实际净减 3 行. 未增加或修改测试案例, 未修改长期规范或 lib/background-agent/**.

## Comments

- 跳过 #31: 两个 Map.get 返回值仍为包含 undefined 的联合类型, 删除异常分支会使读取最终状态的调用方失去类型收窄. 按本 issue 要求保留, 不引入断言或类型收窄传播.
- 差异对照首次在沙盒内因 Node 子进程 spawnSync git EPERM 失败, 提权重跑后全部通过.
- 跳过 #302: 首轮要求符合审核确认新增 safeRelativePath 导出会扩大 Module Interface, 不符合本 issue 的行为保持重构约束; 已恢复两个模块的原始实现与导出面. 先前 42 个路径组合对照仅验证已撤回候选, 不作为最终交付证据.
- 首轮 Code Standards 报告 No problems.; 要求符合审核指出 #302 的导出变化. 修正后重新准备两个 Reviewer 审核, 最终结果另记.
- 第二轮两个内置 Reviewer 均正常结束为 ready, 报告均为 No problems. 报告路径: .tmp/codex/01a19072-415c-7e02-ba1c-f1a22c6a93ad/_commit-audit/2/code-standards-reviewer/review.txt 和 .tmp/codex/01a19072-415c-7e02-ba1c-f1a22c6a93ad/_commit-audit/2/requirements-reviewer/review.txt.
- Main Agent 抽查: requireReviewerRecoveryLocation 保留仓库 .tmp 边界, 平台与会话片段验证及原错误映射; notifyAgain 的两个原始调用条件未改变; rootIgnoreState 收到的探针仍来自相同 root. 修正后的完整验证再次通过.
