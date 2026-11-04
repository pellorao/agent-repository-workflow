# 容量与优先级

## Capacity priority

关卡 Reviewer (Spec Readiness, 提交审核) 优先于基准, 批量和能力验证运行. 同一提供者的并行实例上限由用户配置的 `backgroundAgent.providers.<provider>.maxInstances` 决定, 管理进程在上限用尽时对新的启动请求直接返回 `capacity is exhausted`, 不排队, 所以批量或基准运行同时占用的某提供者实例数不超过上限减 2, 为提交审核的两个并行 Reviewer 留出名额. 关卡 Reviewer 启动因容量用尽失败, 或启动后 2 分钟内没有回合开始时, 排队等待: 用一次 `list_agents` 找出占用名额的运行, 用 `wait_agent` 等其中一个结束后重发同一请求, 不反复轮询 `list_agents`; 同时第一时间向用户报告是哪些运行占用名额, 不静默等待. 提交审核的两个 Reviewer 只得到一个名额时先运行一个, 其 `<id>:done` 后再运行另一个, 不为凑齐并行而等待.
