# Source Checkout Issue 工作流

## Source Checkout migration

确定性升级工作流是唯一受支持的旧结构迁移方式. 它预检完整的已选 `.scratch` 树, 在写入前报告所有阻断项, 并且不猜测治理引用, Module Design 或例外原因.
