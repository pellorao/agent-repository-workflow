# 延后清理 Host 重复默认值

Status: ready-for-human

## What to build

本 issue 仅保留 `.tmp/triage.md` 的 #543, 即 `lib/arw-background-agent-host.mjs` 中重复选择默认 Strata Driver 的机械清理. 用户已明确要求本轮不修改或提交这项生产代码, 留待后续轮次. 本轮只记录延后决定, 不授权实施.

后续真正实施前, 先解除本轮禁止安装与修改安装目录所造成的验证限制, 按根 AGENTS.md 和 reviewer-capability Skill 完成受影响 Reviewer 角色的改前/改后能力对比. 不得以 not-applicable 就绪记录代替能力对比. 同时保留自定义 Driver 与默认 Driver 的既有行为, 运行完整 Source Checkout 验证及正常提交审核.

预算: 后续预计代码变更 6 行, 测试变更 0 行, issue 与记录约 40 行, 合计约 46 行, 生产代码净增不超过 0 行. 边界情况为有无 nativeSessions, 有无显式 createStrataDriver.

## Acceptance criteria

- [ ] 用户解除后续实施的验证限制, 并完成受影响角色的改前/改后能力对比.
- [ ] #543 的重复默认值清理行为保持, 完整 Source Checkout 验证和提交审核通过.

## Blocked by

- 等待用户在后续轮次授权可验证候选 Host 的执行环境.

## Comments

用户确认本轮跳过 #543, 该项不计入 issue:0089:02 的完成范围. 之前的 not-applicable 记录对应已失效的混合范围, 不是能力对比豁免. 本轮未修改 Host 或 lib/background-agent 下的生产代码.
