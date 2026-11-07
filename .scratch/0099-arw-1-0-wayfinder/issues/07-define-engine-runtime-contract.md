# 定义 Engine 驱动流程的运行合同

Type: grilling
Blocked by: issue:0099:01, issue:0099:03, issue:0099:04, issue:0099:17

##### Question

Engine 怎样拥有流程状态并选择下一个动作, 怎样启动, 继续和恢复 Agent 会话, 传递上下文, 等待用户, 处理超时与失败? 一个流程中途触发另一个流程时按栈执行, Main Agent 启动的多个 worker 各自运行流程时并行执行, 两种情形下 Engine 怎样保证仓库单一写入者? 哪些操作必须可观察, 可恢复?
