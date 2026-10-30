# 移除 Reviewer Capability 的未使用导出

Status: ready-for-agent

## What to build

按用户批准的小范围代码清理, 全仓库检索 SEED, poolItem 和 reviewerCapabilityLocatorKey 的使用, 包括 tests 和 scripts. 确认没有外部使用者后, 移除 lib/reviewer-capability/pool.mjs 中 SEED 和 poolItem 的 export, 以及 lib/reviewer-capability/evidence.mjs 中 reviewerCapabilityLocatorKey 的 export. 保留文件内绑定及实现, 不改变行为. 若测试导入内部辅助项则核对能否通过现有公开函数覆盖相同观察, 不额外增加测试或接口.

运行完整 Source Checkout 验证, 保持已有 issue 04 的候选与人工同步阻塞状态不变. 不运行真实 Reviewer 能力测评, 不安装, 不修改 lib/background-agent/**, 不推送.

预估非测试代码净增 0 行, 仅删除三个 export 关键字; 规划文档净增约 1800 字符. 不新增或语义修改测试.

## Acceptance criteria

- [ ] 全仓库引用检索证明三个名称仅在所属模块内部使用, tests 和 scripts 没有导入; 三个声明不再导出, 其他实现字节不变. 观察: 全仓库检索及准确 Git 差异.
- [ ] pnpm test, pnpm typecheck, 三个生产检查脚本, 两个受影响文件的 node --check, arw text check, 本 effort 的 terms check 和 git diff --check 通过. 观察: Validation 的实际命令结果.
- [ ] issue 04 的现有修改与记录保持原字节, 本提交不包含其路径. 观察: 修改前后哈希与暂存路径集合.

## Blocked by

- None - can start immediately

## Validation

- 初始全仓库检索只发现 lib/reviewer-capability/pool.mjs 和 evidence.mjs 内的声明及调用; tests 和 scripts 没有引用三个名称.

## Comments

- 用户明确授权建立一个小 effort 和一个实施 issue, 按正常 ARW 门禁验证与提交.
