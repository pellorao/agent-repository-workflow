# 精简 arw-common 模块

Status: ready-for-agent

## What to build

本 effort 按模块分三项依次处理 `.tmp/triage.md` 中已确认的行为保持重构. 本项处理 #63, #64, #58, #67, 范围为 lib/arw-common/artifacts.mjs, lib/arw-common/codex-configuration.mjs. 逐处核对当前代码, 只删除死代码或不可达分支, 合并完全相同的重复实现. 非测试源码净增量预算为 -5 至 -15 行, 不新增行为或测试框架.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 因此不运行 Spec Readiness, 保留 Commit Audit.

预期验证: 相关现有测试, 完整 `pnpm test`, `pnpm typecheck`, 三项 Source Checkout 分发和生成检查, 受影响文件的 `node --check`, 文本和术语检查, `git diff --check`. 边界情况: 规范与旧格式目录, 重复编号, 符号链接和诊断路径; TOML 控制字符, 单行与多行字符串, 空白与注释. 不增加仅复述实现的测试.

## Acceptance criteria

- [ ] 已核对并精简 #63, #64, #58, #67, 行为保持不变.
- [ ] 必要验证通过, 净增量在预算内.

## Blocked by

无.
