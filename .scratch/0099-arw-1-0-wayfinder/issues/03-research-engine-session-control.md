# 核对 Engine 控制 Agent 会话的平台能力

Type: research
Status: resolved
Blocked by: None

##### Question

依据本机 CLI 的只读帮助输出, 官方文档和当前 ARW 后端实现, Codex (`codex exec`, App Server, SDK) 与 Claude Code (`claude -p`, `stream-json`, Agent SDK) 各自对 Engine 启动, 继续, 观察, 中断 Agent 会话, 结构化输入输出, 权限与批准交互, 并发, 进程故障后接回, 以及按会话选择模型 (含第三方与本地模型) 提供哪些有保证的接口? 区分有保证的接口, ARW 已实际使用的部分和未获保证的部分.

## Answer

研究记录见 [Engine 控制 Agent 会话的平台能力核对](../research/engine-session-control/report.md) (核对版本 `codex-cli 0.165.0` 与 Claude Code `2.1.319`). 两个平台都提供 Engine 驱动所需的基本控制: 启动, 按 ID 继续, 观察事件流, 中断, 约束最终输出形状, 由程序应答批准请求. 形态不同: Codex 是一个常驻 App Server 进程里的多个线程, 用按版本生成 schema 的 JSON-RPC; Claude Code 是每个会话一个 `claude -p` stream-json 进程, 线格式只在 Agent SDK 的 TypeScript 类型里间接记载. 当前 ARW 已按两种形态各有一套实现, 都不依赖平台原生 subagent. 三项限制: 两个平台都没有承诺 Engine 崩溃后接回执行中的回合, 可依赖的只有会话记录持久化和 `resume`; 第三方与本地模型只有 Codex 有官方路径 (自定义提供方只支持 Responses 协议, 另有 `--oss`), Claude Code 官方不支持经网关使用非 Claude 模型, 所以 Strata 一类驱动只能挂在 Codex 后端; 两边关键接口都带 experimental, 研究预览或版本门槛, ARW 已用的三处 Claude 行为 (`--permission-prompt-tool stdio`, `control_cancel_request`, `system` 的 `requesting` 状态) 在所查文档中没有找到. 参考 10-25 材料, 已于 11-07 核实: 旧结论大体仍成立, 线程卸载等待已变为默认 60 秒, 新建持久线程默认使用分页历史. Codex 断线时进行中回合是否继续, 同一线程并行 `turn/start` 的行为, 需要真实模型回合才能确定, 本次未做.
