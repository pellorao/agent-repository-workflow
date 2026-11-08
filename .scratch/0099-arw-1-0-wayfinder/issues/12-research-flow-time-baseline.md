# 测量当前 ARW 流程的耗时分布

Type: research
Status: resolved
Blocked by: None

##### Question

在近期真实 ARW 工作中, 从用户发出消息到 Agent 结束回复的时间主要花在哪些步骤 (grilling, Spec Readiness, 实施, 验证, 各轮 Reviewer 与修复循环)? 只计 Agent 工作时间, 不计用户阅读和回复前的等待. 可用的数据来源 (ARW 已有的 Reviewer 耗时与模型阶段测量, 会话历史) 及其读取授权需先由 Main Agent 确认.

## Answer

研究记录见 [当前流程耗时分布](../research/flow-time-baseline/report.md). 数据是维护者本机 10-25 到 11-08 ARW 源码仓库的日常工作, 只读会话记录的时间戳, 记录类型, 工具名和模型 ID 等元数据, 不读正文; Codex 一侧不读 `~/.codex/`. 审核关卡是最大的单项耗时: Claude Code 一侧 17 次实施交付 (每次中位数 24.9 分钟, 8 到 74 分钟) 中, 等待 ARW 后台管理进程启动的 Reviewer 占 50%, 模型生成与思考占 38%, 测试, Git 和 `arw` 命令占 12%; Codex 一侧 29 个 issue (中位数 14.8 分钟) 中提交审核含修复循环占 58%, Spec Readiness 占 26%, 实施 9%, 分析 5% (这组数字来自本机 Codex 无人值守驱动器已生成的阶段记录, Main Agent 11-08 确认采用). 每次提交审核通常 2 到 5 轮, 首轮占一半, 单次 Reviewer 运行时间主要由受审内容与报告长度决定, 调度和重复审核不是瓶颈. 本机按自主方式工作, worker 运行中没有 grilling 等待; Claude Code 一侧的 Spec Readiness 与 Commit Audit, 实施与验证, 只凭元数据分不开. 推断: ARW 1.0 的预检若有收益, 主要来自减少审核轮次与修复循环. 样本只有一台机器, 一位用户, 46 个 issue, 时长不反映结果质量与用户满意度.
