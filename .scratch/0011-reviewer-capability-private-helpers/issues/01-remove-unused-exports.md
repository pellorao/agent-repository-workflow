# 移除 Reviewer Capability 的未使用导出

Status: completed

## What to build

按用户批准的小范围代码清理, 全仓库检索 SEED, poolItem 和 reviewerCapabilityLocatorKey 的使用, 包括 tests 和 scripts. 确认没有外部使用者后, 移除 lib/reviewer-capability/pool.mjs 中 SEED 和 poolItem 的 export, 以及 lib/reviewer-capability/evidence.mjs 中 reviewerCapabilityLocatorKey 的 export. 保留文件内绑定及实现, 不改变行为. 初始全仓库检索已经确认 tests 和 scripts 没有导入这三个名称, 因此不需要调整测试或公开接口.

完整 Source Checkout 验证命令为 pnpm test, pnpm typecheck, node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, node --check lib/reviewer-capability/pool.mjs, node --check lib/reviewer-capability/evidence.mjs, node arw.mjs text check, node arw.mjs terms check --include .scratch/0010-reviewer-capability-private-helpers/ 和 git diff --check. 执行这些检查, 保持已有 issue 04 的候选与人工同步阻塞状态不变. 不运行真实 Reviewer 能力测评, 不安装, 不修改 lib/background-agent/**, 不推送.

预估非测试代码净增 0 行, 仅删除三个 export 关键字; 规划文档净增约 1800 字符. 不新增或语义修改测试.

## Acceptance criteria

- [x] 全仓库引用检索证明三个名称仅在所属模块内部使用, tests 和 scripts 没有导入; 三个声明不再导出, 其他实现字节不变. 观察: 全仓库检索及准确 Git 差异.
- [x] pnpm test, pnpm typecheck, 三个生产检查脚本, 两个受影响文件的 node --check, arw text check, 本 effort 的 terms check 和 git diff --check 通过. 观察: Validation 的实际命令结果.
- [x] issue 04 的现有修改与记录保持原字节, 本提交不包含其路径. 观察: 修改前后哈希与暂存路径集合.

## Blocked by

- None - can start immediately

## Validation

- git grep 与 rg 的全仓库检索只发现 pool.mjs 和 evidence.mjs 内的声明及调用; tests 和 scripts 没有引用三个名称. 主动排除 .git, .tmp 及 .scratch 工作记录, 搜索覆盖隐藏的仓库源码.
- Spec Readiness 第 2 轮返回 No problems., 已 generate, promote 并完成实施前完整 verify.
- pnpm test 通过: 804 个测试, 803 通过, 1 跳过, 0 失败, 耗时约 3.12 秒. pnpm typecheck 通过.
- node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, 两个变更文件的 node --check, text, 本 effort 的 terms 和两种差异检查均通过. 完整输出保存在当前会话 0011_01/validation-results.json.
- 独立的未提交 wizard 候选在完整检查期间保存准确字节, 临时恢复为 HEAD, 检查后恢复候选; issue 04 四个既有路径的前后 SHA-256 完全相同, 没有运行引用审核或分发同步.
- Main Agent 删减自查及回归抽查: 逐字比较 HEAD 删除三个 export 关键字后的内容与工作树完全相等, 其他实现无差异, 非测试代码净增 0 行. 未增加测试, 未改种子值, 候选筛选或定位键算法.

## Comments

- 用户明确授权建立一个小 effort 和一个实施 issue, 按正常 ARW 门禁验证与提交.

- 首轮 Spec Readiness 的两项缺口已核对: subject 现列出精确验证命令, 已确认无测试导入的事实替代假设分支, 四个现有测试文件加入实现证据. 未修改 effort spec 或任何实现文件.

- Commit Audit 第 11 轮的两个 Reviewer 正常结束并返回 No problems., 要求符合覆盖 Gate 1 和 Gate 2. 要求符合请求首次因容量满未启动, Code Standards 完成后重发同一请求成功; 候选与治理输入未变. 报告位于当前会话 _commit-audit/11 的两个角色目录.
- 最终回归抽查确认三个原绑定及全部内部调用保留, 其他导出未变; issue 04 四个路径哈希再次核对一致.
