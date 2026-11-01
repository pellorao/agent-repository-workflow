# 公共诊断文字拼接清理

Status: needs-triage

## What to build

从 issue:0022:09 拆出 `.tmp/triage.md` 的 H45. 筛查 bootstrap-artifact.mjs 和 installation-payload.mjs 重复的诊断文字拼接, 复用或新增公共能力. 新增跨模块导出涉及 Interface 和依赖边界, 按既有用户授权独立设计并运行 Spec Readiness. 当前仅记录规划, 不授权生产修改.

体积预算: 非测试源码净增不超过 10 行. 保持诊断消息顺序, 空格连接, 错误结果及持久状态不变. 不修改 lib/background-agent/**, 不安装, 不 push.

预期验证: 实施前选择实际安装载荷及安装引导测试, 完成完整 Source Checkout 验证, 包括 text check, 当前 effort 的 terms check 和 git diff --check. 相关边界: 空诊断, 多条诊断, blocked 与 failed 结果.

## Acceptance criteria

- [ ] 设计和 Spec Readiness 完成, 已确认范围交付, 诊断文字和错误结果不变.
- [ ] 必要定向及完整仓库验证通过.

## Blocked by

无.
