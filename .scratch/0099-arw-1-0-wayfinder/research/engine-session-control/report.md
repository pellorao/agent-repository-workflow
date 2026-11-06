# Engine 控制 Agent 会话的平台能力核对

## Scope

回答 issue 03: Codex 与 Claude Code 各自对 Engine 启动, 继续, 观察, 中断 Agent 会话, 结构化输入输出, 权限与批准, 并发, 进程故障后接回, 会话历史位置, 按会话选择模型提供哪些接口. 核对日期 2026-11-07, 本机 `codex-cli 0.165.0` 与 Claude Code `2.1.319`. 资料为本机帮助输出, 官方文档, 开源源码和 ARW 当前实现. 没有运行任何模型回合, 没有启动 app-server (协议 schema 用 `codex app-server generate-json-schema` 生成到临时空目录, 已删除).

参考 10-25 材料 (其中核对日期为 09-26, 版本 0.157.0), 已于 11-07 核实: 其结论大体仍成立, 两处已变化 (线程卸载等待由 30 分钟变为默认 60 秒, 新建线程默认使用分页历史), 见 Codex 小节. 表中 [Sn] 是来源编号, 见末尾 Sources. 三列含义: "有官方保证" 指文档或帮助输出明示; "ARW 已用" 指当前代码已实际调用; "未获保证" 指文档未写, 只见于源码, 或没有找到证据.

## Codex

| 项 | 有官方保证 | ARW 已用 | 未获保证或无证据 |
| --- | --- | --- | --- |
| 启动 | `codex exec` 一次性运行, 提示词可走标准输入 [S1,S4]. `codex app-server` 默认 `stdio://` JSONL, 也可 `unix://`; 先 `initialize` 再 `initialized` [S1,S3]. TypeScript SDK 包装 CLI 并交换 JSONL, Python SDK 经 JSON-RPC 控制 app-server [S5] | `codex-app-server.mjs` 的 `ensureServer` 启动一个共享 `app-server --listen stdio://`, 以 `experimentalApi: true` 初始化; `open` 与 `start` 发 `thread/start` [R1] | WebSocket 传输文档称 experimental and unsupported [S3]; app-server 帮助标 `[experimental]` [S1]; 协议只保证对应所运行的确切版本 (`generate-json-schema` 文档) [S3] |
| 按 ID 继续 | `codex exec resume <ID或名称>` 与 `--last`; `codex exec fork` [S1,S4]. app-server 的 `thread/resume`, `thread/fork` [S3] | `resume` 调 `thread/resume` (`excludeTurns: true`) 并核对返回的线程 ID 与记录路径; `manager.mjs` 的 `restoreNative` 调用它 [R1,R3] | `codex exec resume` 没有 `--sandbox` 与 `--cd` (只能用 `-c`) [S1]. 保存的提供方与当前不同则 `thread/resume` 返回 `modelProviderMismatch`, 属明示行为 [S3] |
| 观察事件 | `exec --json` 输出 `thread.started`, `turn.*`, `item.*`, `error` [S4]. app-server 通知含 `turn/started`, `item/*`, `turn/completed`, `thread/status/changed`, `thread/tokenUsage/updated` [S2,S3] | 消费 `thread/started`, `turn/*`, `item/completed`, `thread/status/changed`, `thread/closed`, `thread/tokenUsage/updated`, `serverRequest/resolved` [R1] | 部分通知与方法需 `experimentalApi` 才可用 [S3]; 连接断开后事件投递停止, 重连补发的规则文档未写 |
| 中断 | `turn/interrupt`, 回合以 `interrupted` 结束; `turn/steer` 向进行中回合追加输入, 要求 `expectedTurnId`, 不接受回合级覆盖 [S3] | `interruptGroup` 调 `turn/interrupt`; `steer` 调 `turn/steer` [R1] | `codex exec` 没有文档化的取消接口, 只能结束进程; 取消不回滚已写文件也未承诺 |
| 结构化输入输出 | `exec --output-schema <文件>` 与 `-o`; `turn/start` 的 `outputSchema` 约束最终消息, 只作用于当前回合 [S1,S3,S4]; TypeScript SDK `run()` 的 `outputSchema` [S5]. 输入为文本与图片 [S2] | 在 `lib/` 中没有找到 Codex 侧使用 `outputSchema` | 约束的是形状, 不证明内容正确; schema 方言限制文档未列 |
| 权限, 沙箱, 批准 | `exec` 默认只读沙箱, `-s`, `--approve-for-me` [S1,S4]. `exec` 帮助没有 `-a` 批准策略选项 [S1]. app-server 以服务端请求 `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval` 向客户端征询, 客户端回 `accept`, `acceptForSession`, `decline`, `cancel` [S2,S3]; `turn/start` 可覆盖 `approvalPolicy` 与 `sandboxPolicy` [S2,S3] | 把批准类请求存为待决并经 `respond` 回写; 线程参数按配置传 `approvalPolicy` 与 `permissions` [R1] | `item/tool/requestUserInput`, `item/tool/call` 标 experimental [S3]. 无人应答时请求是否超时, 文档未写 |
| 并发 | 一个 app-server 可承载多个线程 [S3] | 单个共享 server 承载多个根线程, 容量由 ARW 自己的 `maxInstances` 限制 [R5,R6] | 官方无并发上限, 同线程并行回合, 配额公平性的说明. `-32001` 过载只针对 WebSocket 队列 [S3] |
| 进程崩溃后接回 | 线程记录持久化后可 `thread/resume` 继续对话 [S3]. 最后一个订阅者离开后线程空闲默认 60 秒卸载 (`thread_unload_delay_secs`) [S3] | 管理进程与 server 保持 stdio; 故障后不接管旧进程, 用 PID 加创建时间确认旧进程已退出, 再 `resume` 原线程交付新工作, 不重放未完成任务 [R6,R1] | 连接丢失后正在执行的回合是否继续, 文档未写. 源码里线程非活动时库存的 `inProgress` 回合被报告为 `interrupted` [S7]. 共享 daemon (`codex app-server daemon`) 文档称实验性且生命周期合同可能变 [S7] |
| 历史位置 | 持久线程是 Codex home 下 sessions 目录的 JSONL 记录; 归档移到 archived 目录; `thread/read`, `thread/turns/list`, `thread/items/list` 读取; `--ephemeral` 不落盘 [S3,S4]. 新建持久线程默认分页历史 [S3] | `thread.path` 作为会话路径; `thread/read` 与 `thread/turns/list` 读取历史 [R1] | 文档未给 sessions 目录的完整路径与保留期限; 路径由 `thread.path` 字段报告 |
| 选择模型 | `-m`, `-c`, `-p`; `thread/start` 的 `model`, `modelProvider`, `config`; `turn/start` 的 `model` 与 `effort` 对本回合及以后生效 [S1,S2,S3]. 自定义 `[model_providers.<id>]` 含 `base_url`, `env_key`, `experimental_bearer_token`, `http_headers`; `wire_api` 唯一取值 `responses`; `openai`, `ollama`, `lmstudio` 保留 [S6]. `--oss` 配 `--local-provider lmstudio` 或 `ollama`, `exec` 未设默认时报错 [S6]. 线程的提供方在创建时固定, 要换提供方须 `thread/fork` [S3] | `threadParams` 传 `model`, `modelProvider`, `config`; Strata 的 Responses 地址与 bearer 在开线程时覆盖 [R1,R4,R6] | 兼容 Responses 不等于工具调用与推理语义兼容 (文档不保证任一第三方模型能完成完整 Agent 工作); 项目级 `.codex` 配置中的提供方键被忽略 [S6] |

10-25 材料中两处已更新: 线程卸载等待现为默认 60 秒 (旧稿 30 分钟); 旧稿称分页历史尚不能新建, 现为新建持久线程默认分页 [S3].

## Claude Code

| 项 | 有官方保证 | ARW 已用 | 未获保证或无证据 |
| --- | --- | --- | --- |
| 启动 | `claude -p` 加 `--output-format stream-json --verbose` 与 `--input-format stream-json` [S8,S9,S10]. Agent SDK 每个会话启动一个 `claude` 子进程并经 stdio 通信 [S15]. `claude --bg` 启动后台会话, 不能与 `-p` 合用 [S9,S12] | `claude-sessions.mjs` 的 `startTurn` 每个回合启动一个 `claude -p` 进程, 带 `--replay-user-messages` 与 `--include-partial-messages` [R2,R5] | stdin 与 stdout 的线格式只在 Agent SDK 的 TypeScript 类型里描述 (`SDKUserMessage`, `control_request`), CLI 帮助不给 schema [S13] |
| 按 ID 继续 | `--session-id <uuid>` 指定新会话 ID; `--resume` 接 ID, 名称或 `.jsonl` 路径; `--continue`; `--fork-session` [S8,S10,S11]. 可在任意目录按 ID 找到会话 [S9] | 首回合 `--session-id`, 之后 `--resume` [R2] | 默认保留 30 天 (`cleanupPeriodDays`), 超期记录可能不在 [S11]. 同一会话被两个进程同时续接会交错写入一个记录 [S11] |
| 观察事件 | stream-json 每行一个 JSON, 末行是含费用与会话 ID 的 `result`; `system/init` 带 `capabilities` 数组用于功能探测; 另有 `system/api_retry`, `permission_denied` 与可选的部分消息, 钩子事件 [S9,S13] | 读取 `user` 回显, `control_request`, `control_cancel_request`, `result`, `stream_event` 以及 `system` 的 `requesting` 状态 [R2] | `requesting` 状态与 `control_cancel_request` 在所查文档中没有找到 (文档的状态消息只列 `compacting`) [S13] |
| 中断 | 发 SIGINT, 或在流式输入模式调用 SDK 的 `interrupt()`, 回合以 `result` 收尾; `interrupt_cancel_queued_v1` (v2.1.219 起) 可同时取消排队消息. SIGTERM 退出码 143, 未完成回合不记 `result`, 并结束 Bash 进程树 [S9,S13] | `interruptGroup` 对回合进程发 SIGTERM 并等待退出 (ADR 0033 否决了控制请求 `interrupt`, 理由是进程会因排队消息开启新回合) [R2,R5] | 无 |
| 结构化输入输出 | `--json-schema` 配 `--output-format json`, 结果在 `structured_output`; 无有效输出时没有该字段, 子类型 `error_max_structured_output_retries` [S9,S14]. 流式输入可发多条用户消息并含图片 [S15] | Reviewer 回合用 `--json-schema` 约束最终状态; 代码注释称顶层联合类型被拒绝, 所以用 `if` 绕开 [R2] | `format` 关键字只作注解不强制 [S9]; 顶层联合被拒的说法在所查文档中没有找到 |
| 权限, 沙箱, 批准 | `-p` 默认 Manual 模式 (v2.1.302 起); `--allowedTools`, `--disallowedTools`, `--permission-mode`; `--permission-prompts host` 或 `none`; 需批准的调用由 SDK 主机的 `canUseTool` 或 `--permission-prompt-tool` 应答, 无应答时一直等待, 不超时 [S9,S10,S13]. 同一进程的未决请求可经 `initialize` 的 `pending_permission_requests` 重新取得 [S13] | `--permission-prompt-tool stdio`, 把 `can_use_tool` 控制请求存为待决, `respond` 回写 `control_response`; Reviewer 另用 `--safe-mode`, `--setting-sources ''`, `--strict-mcp-config` [R2,R5] | CLI reference 里 `--permission-prompt-tool` 只写 MCP 工具名, 值 `stdio` 在所查文档中没有找到 [S10]. 权限规则是 Claude Code 自身检查, 沙箱化 Bash 工具是单独的可选功能 [S16] |
| 并发 | 一个会话对应一个子进程; 不同会话各给 `cwd`; `--model` 只作用于本次启动, 并行会话各带自己的 [S15,S16] | 每个运行占一个提供方名额与全局名额, 由 ARW 的 `maxInstances` 限制 [R6] | 无官方并发上限; 订阅额度由所有会话共用 [S12] |
| 进程崩溃后接回 | 进程被杀后可 `--resume`; 被中断回合保持原样, 设 `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` 才继续它 [S9]. 后台会话 (研究预览) 由 supervisor 运行, 关终端不停止, 意外退出会重启, `claude agents --json` 是读取状态的受支持接口, 另有 `claude attach`, `logs`, `stop` [S12] | 回合进程记录 PID 与创建时间, 新管理进程据此确认旧回合已结束, 不接管 [R2,R6] | 没有重新接回仍在运行的 `claude -p` 进程的接口. 文档列出的向后台会话发送提示的方式 (`claude --resume <会话> "提示"`) 在管道输入输出或 `--output-format` 等标志存在时不发送并退出码为 1 [S11], 所以脚本化回复未找到受支持路径 |
| 历史位置 | `~/.claude/projects/<项目>/<会话ID>.jsonl`, `CLAUDE_CONFIG_DIR` 可改位置; `--no-session-persistence` 不落盘; Agent SDK 的 `SessionStore` 可镜像到外部存储 [S11,S15] | `claude-consumption.mjs` 的 `readClaudeSession` 与 `findClaudeSessionRecord` 读取记录 [R2] | 项目目录名超 200 字符时截断加哈希 (ARW 已处理) [S11] |
| 选择模型 | `--model` 别名或全名, `--effort`, `ANTHROPIC_MODEL`, `--fallback-model` [S8,S10,S16]. Bedrock, Vertex, Foundry 经各自环境变量; 网关经 `ANTHROPIC_BASE_URL`, 需暴露 Anthropic Messages 等受支持格式 [S16] | `--model` 与 `--effort` 取自设置; 提供方为 `anthropic` 的配置中的 `env` 并入进程环境 [R2] | 文档明说不支持经任何网关把 Claude Code 路由到非 Claude 模型 [S16]. 本地模型没有官方路径 |

## Implications

以下只陈述从上表直接得出的事实, 不替用户作架构决定.

- 两个平台都提供 Engine 所需的四项基本控制 (启动, 继续, 观察, 中断), 都能由程序应答批准请求, 都能约束最终输出形状. 形态不同: Codex 是一个常驻进程里的多个线程, 带按版本生成的 JSON-RPC schema; Claude Code 是每个会话一个进程, 线格式只经 SDK 类型间接记载. 当前 ARW 已按这两种形态各有一套实现, 并且都不依赖平台原生 subagent, 所以 "Engine 启动独立会话" 在两个平台上都有现成的运行基础.
- 两个平台都没有文档承诺 "Engine 崩溃后接回仍在执行的回合". 可依赖的是会话记录持久化和 `resume`; 被中断的回合按中断处理, 工作区里已发生的副作用不回滚. Claude 的后台会话 supervisor 和 Codex 的共享 daemon 都在向这个方向发展, 但前者是研究预览且缺脚本化回复路径, 后者文档称实验性.
- 本地模型和第三方提供方只有 Codex 有官方路径 (自定义提供方只支持 Responses 协议, 另有 `--oss`), Claude Code 官方不支持非 Claude 模型. 因此 Strata 一类驱动目前只能挂在 Codex 后端.
- 两个平台的关键接口都带 experimental, 研究预览或版本门槛 (如 Claude 的 `--permission-prompts` 需 v2.1.259, `interrupt_cancel_queued_v1` 需 v2.1.219; Codex 的 app-server 与 daemon). ARW 现有代码里已有按版本核对的注释 (如 "checked on 2.1.317"), 说明版本漂移是实际成本.
- ARW 已用但文档中没有找到的 Claude 行为有三处: `--permission-prompt-tool stdio` 的取值, `control_cancel_request` 消息, `system` 的 `requesting` 状态. Engine 驱动路线若扩大对它们的依赖, 其稳定性只有 SDK 类型描述和实测可依靠.
- 认证条款: Agent SDK 文档称第三方开发者未经批准不得提供 claude.ai 登录或其额度, 并要求改用 API 密钥; `--bare` 模式不读取订阅登录, 只用 `ANTHROPIC_API_KEY` 或 `apiKeyHelper` [S9,S16]. Codex 文档称 app-server 的认证能力从未获准用于商业或托管服务 [S3]. 两条都针对对外提供的产品, 本地个人使用是否涉及取决于 ARW 的分发形态.
- 并发的真实上限来自订阅额度和本机资源, 不来自协议; Claude 并发会话共用一个额度池 [S12].
- 未验证项 (需要真实模型回合才能确定, 本次未做): Codex 连接断开时进行中回合是否继续; Codex 对同一线程并行 `turn/start` 的行为; Claude `--permission-prompt-tool stdio` 在新版本中的稳定性.

## Sources

| 编号 | 来源 |
| --- | --- |
| S1 | 本机 `codex --help`, `codex exec --help`, `codex exec resume --help`, `codex exec fork --help`, `codex app-server --help`, `codex app-server daemon --help`, `codex queue --help` (`codex-cli 0.165.0`) |
| S2 | `codex app-server generate-json-schema --out <临时空目录>` 生成的 `ClientRequest.json`, `ServerRequest.json`, `ServerNotification.json`, `codex_app_server_protocol.v2.schemas.json` |
| S3 | https://learn.chatgpt.com/docs/app-server.md (Codex App Server) |
| S4 | https://learn.chatgpt.com/docs/non-interactive-mode.md |
| S5 | https://learn.chatgpt.com/docs/codex-sdk.md; github.com/openai/codex 的 `sdk/typescript/README.md` |
| S6 | https://developers.openai.com/codex/config-advanced.md; https://developers.openai.com/codex/config-reference.md |
| S7 | github.com/openai/codex 的 `codex-rs/app-server-daemon/README.md`, `codex-rs/app-server/src/request_processors/thread_lifecycle.rs` |
| S8 | 本机 `claude --help`, `claude --version` (`2.1.319`) |
| S9 | https://code.claude.com/docs/en/headless.md |
| S10 | https://code.claude.com/docs/en/cli-reference.md |
| S11 | https://code.claude.com/docs/en/sessions.md |
| S12 | https://code.claude.com/docs/en/agent-view.md |
| S13 | https://code.claude.com/docs/en/agent-sdk/typescript.md |
| S14 | https://code.claude.com/docs/en/agent-sdk/structured-outputs.md |
| S15 | https://code.claude.com/docs/en/agent-sdk/hosting.md; https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode.md; https://code.claude.com/docs/en/agent-sdk/sessions.md |
| S16 | https://code.claude.com/docs/en/llm-gateway.md; https://code.claude.com/docs/en/model-config.md; https://code.claude.com/docs/en/agent-sdk/overview.md; https://code.claude.com/docs/en/sandboxing.md |
| R1 | `lib/background-agent/codex-app-server.mjs` (`ensureServer`, `open`, `threadParams`, `start`, `resume`, `startTurn`, `steer`, `respond`, `interruptGroup`) |
| R2 | `lib/background-agent/claude-sessions.mjs` (`createClaudeSessions`, `startTurn`, `steer`, `respond`, `interruptGroup`, `observeModelPhases`), `lib/background-agent/claude-consumption.mjs` |
| R3 | `lib/background-agent/manager.mjs` (`restoreNative`) |
| R4 | `lib/background-agent/strata-driver.mjs` (`createStrataDriver`) |
| R5 | `docs/adr/0030-use-user-wide-background-agent-management.md`, `docs/adr/0032-run-claude-reviewers-through-headless-claude.md`, `docs/adr/0033-run-each-claude-turn-as-a-stream-json-process.md` |
| R6 | `docs/specs/agent-repository-workflow/spec.md` 的 Capacity and recovery 节 |
