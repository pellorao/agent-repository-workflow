# 工作流前置元数据与终端导入清理

Status: needs-triage

## What to build

从 issue:0022:11 拆出 `.tmp/triage.md` 的 H57 和 H59. H57 筛查三处前置元数据结束定位, 复用或新增公共能力, 保持 Buffer 字节索引与字符串索引语义. H59 筛查 defaultPrompt 的静态导入及全局 process 访问, 确认加载时机及终端行为. 按既有用户授权独立设计并运行 Spec Readiness. 当前仅记录规划, 不授权生产修改.

体积预算: 非测试源码净增不超过 10 行. 保持命令输出, 公开 Interface, 错误结果和持久状态不变. 不修改 lib/background-agent/**, 不安装, 不 push.

预期验证: 实施前选择实际工作流及终端测试, 完成完整 Source Checkout 验证, 包括 text check, 当前 effort 的 terms check 和 git diff --check. 相关边界: 前置元数据缺失与未闭合, 多字节文本, 无效 UTF-8, 交互输入与终端输出.

## Acceptance criteria

- [ ] 设计和 Spec Readiness 完成, 已确认范围交付, 原有字节与终端行为不变.
- [ ] 必要定向及完整仓库验证通过.

## Blocked by

无.
