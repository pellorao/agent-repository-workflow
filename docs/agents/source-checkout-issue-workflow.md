# Source Checkout Issue 工作流

## Source Checkout migration

确定性升级工作流是唯一受支持的旧结构迁移方式. 它预检完整的已选 `.scratch` 树, 在写入前报告所有阻断项, 并且不猜测治理引用, Module Design 或例外原因.

## Source Checkout release validation issue lifecycle

处理发布验证 issue 的生命周期和预先配置的用户选择答案时, 遵循 `docs/agents/validation.md`. 一次性目标任务仍然是普通实施 issue. 普通 issue 格式, 状态转换, 精确的 `## Validation` 证据标题和严格读取规则保持不变. 不得在目标 issue 正文中加入发布场景限制.
