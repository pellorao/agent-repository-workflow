# 使用显式配置驱动的 Platform Adapter

ARW 的平台无关部分不直接生成 Codex 或 Claude Code 文件. 配置驱动的 Platform Adapter 接收目标 `platform`, 共享工作流载荷和 Projection 配置, 并生成该平台所需的目标字节.

初始化仍须显式选择一个或两个平台. 选择两个平台时, 分别调用同一个 Adapter, 不为同一映射引擎建立两个包装式具体 Adapter. 平台差异只由 Projection 配置和该 Adapter 解释, 不分散到平台无关的 Module. Adapter 的操作中立和只读边界由 [ADR 0014](0014-use-operation-neutral-platform-adapters.md) 定义.
