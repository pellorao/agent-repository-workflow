# 确定 ARW 1.0 的产品边界与 Agent 平台范围

Type: grilling
Status: resolved
Blocked by: issue:0099:01, issue:0099:03

##### Question

改为 Engine 驱动后, ARW 1.0 首版覆盖哪些仓库类型和工作流 (规划, 实施, 验证, Reviewer, 批准, 提交, Application/JIRA, 源码维护), 由 Engine 驱动哪些 Agent 平台: 只驱动 Codex, 还是同时驱动 Claude Code 并保持当前两平台完全对等? 与用户对话的 Main Agent 所在平台与 Engine 启动的 worker 和 Reviewer 所在平台是否必须相同?

## Answer

用户 11-07 的答复: "Engine 用代码里的确定性流程, 加 Jev 类模型做简单判断, 来驱动用户和高智能 Agent" 的理解没有问题; 平台上选两个平台对等, 并且两边都要支持本地或第三方模型. 因此:

- "以 Engine 为基础" 的含义已确认: ARW 1.0 的流程由 Engine 中的确定性流程加 Jev 类模型的简单判断推进, 由它驱动用户和高智能 Agent, 不再由 Codex 或 Claude Code 中的 Main Agent 读规则推进 (D24 之后, 简单判断是正在干活的 Agent 步骤输出 schema 的必填字段, 判断模型可选, 配了只做提示, 见 08).
- Engine 同时驱动 Codex 与 Claude Code, 两平台完全对等, 本地模型与第三方模型在两个平台上都要支持, 不接受 "本地模型只走 Codex" 这类已知差异. 当初候选方案中 "与用户对话的入口由 Engine 自己提供" 不在用户的解释里, 不算已定, 留在地图的 Not yet specified.

可行性依据见 [Claude Code 与 Codex 接入本地和第三方模型的路径](../research/agent-platform-models/report.md) (11-08 核对). 它更正了 [核对 Engine 控制 Agent 会话的平台能力](03-research-engine-session-control.md) 中 "本地模型只能挂在 Codex 后端" 的推论: Anthropic 文档明确不支持把 Claude Code 路由到非 Claude 模型, 但 Claude Code 只要求对端暴露 Anthropic Messages 格式; Ollama, llama.cpp, LM Studio, vLLM 以及多家托管模型厂商都提供该端点, 其中多家给出 Claude Code 配置, 维护者本机的 Strata 部署也已经用 Claude Code 实际跑过. 按进程设置环境变量即可让单个 `claude -p` 进程指向别的端点, 不影响用户自己的会话. Claude Code 一侧的风险写入后续合同: 不受官方支持, 每个版本可能新增请求字段使兼容端点报错, 只设端点不设凭据时订阅登录会随请求发出, thinking, 缓存和服务端工具的行为因端点而异. Codex 一侧仍只支持 Responses 协议的自定义提供方和 `--oss`.

问题中的另外两部分尚未得到用户答复, 移到 [确定 ARW 1.0 首版覆盖的工作流与跨平台组合](17-decide-workflow-coverage-and-platform-mix.md).
