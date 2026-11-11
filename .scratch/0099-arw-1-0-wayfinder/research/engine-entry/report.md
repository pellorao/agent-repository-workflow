# Engine 自有对话入口的形态比较

## Scope

回答 issue 07 的前置问题: Engine 与用户对话的入口取哪种形态, 才能把用户的话按所选 Main Agent 模型路由给 Codex 或 Claude Code, 并保持对等. 核对日期 2026-11-11, 本机 `codex-cli 0.167.0` 与 Claude Code `2.1.322` (比 `engine-session-control` 报告核对的 0.165.0 与 2.1.319 新), ACP 协议版本 1. 资料为本机帮助输出, 官方文档, 开源仓库说明, 以及 ARW 现有代码 (只读). 没有启动任何模型回合或 app-server, 没有下载任何包.

标注约定: [官方] 指官方文档或帮助输出明示; [源码] 指只见于开源仓库说明或 ARW 代码; [推断] 指我由事实推出, 未经验证. 已有结论 (两个平台的启动, 继续, 观察, 中断, 批准, 版本漂移, 崩溃后不接回) 见 `research/engine-session-control/report.md`, 本文不重复, 只记本次新发现与形态比较.

本次新发现的接口面 (本机帮助输出 [S1][S2]): Codex 有 `codex --remote <ws 或 unix 地址>` (让 TUI 连接远端 app-server), `codex resume --remote`, `codex queue --thread --message [--resume]`, `codex agents`, `codex remote-control start|stop|pair`, `codex app-server daemon ...` 与 `codex app-server proxy`; Claude Code 有 `claude --bg`, `claude attach|logs|stop|respawn`, `claude agents --json`, `--remote-control`, `--brief`, `--include-hook-events`. 其中 Codex 的 `--remote`, daemon, remote-control 帮助标 experimental.

三种形态共用的底层事实: 无论入口怎么画, 后端都是 Engine 经 Codex App Server 与 `claude -p` stream-json 驱动 harness (ARW 已有 `lib/background-agent/codex-app-server.mjs` 约 1200 行和 `claude-sessions.mjs` 约 300 行 [S33]). 所以三种形态的差别只在前端, 以及前端是否绕开这套驱动.

## Form 1: Terminal TUI

Engine 自己画界面, 经上述两条通路控制 harness.

事实:

- 流式输出与工具展示: Codex 的 `item/*`, `turn/*` 通知含命令, 文件改动, MCP 调用等条目 [S3]. Claude 的 stream-json 加 `--include-partial-messages` 给出文本增量, 子 agent 消息带 `parent_tool_use_id` [S9]. 两边的事件模型不同, Engine 需要自己归一为一套显示事件 (我估计这是前端里最大的一块工作) [推断].
- 批准: Codex 由服务端请求 `item/commandExecution/requestApproval` 等, 客户端回 `accept/acceptForSession/decline/cancel` [S3]. Claude 在 `-p` 下需批准的调用无人应答就拒绝, 应答路径是 SDK 的 `canUseTool` 或 `--permission-prompt-tool`; 而 ARW 用的取值 `stdio` 在官方文档里查不到 [S9][S32]. 另有官方的第二条路: `PermissionRequest` hook 可返回 `allow/deny` [S11], 且 `http` 类型 hook 可把请求 POST 给本机服务 [S11]. Codex 同名 hook 也能 allow/deny, 但类型只有 `command` 与 `mcp_tool`, 且 hook 须先经用户审阅信任 [S6].
- 中途插话与中断: Codex `turn/steer` (需 `expectedTurnId`) 与 `turn/interrupt` [S3]. Claude 在 stream-json 输入下可继续写入用户消息, 在下一次模型请求边界被取用, 中断用 SIGINT 或 SDK `interrupt()` [S9]; ARW 现行用 SIGTERM 结束回合进程 [S33]. 能力对等, 机制不同.
- 中途换模型: 同一 harness 内, Codex `turn/start` 的 `model` 对之后回合生效 (但线程的提供方创建时固定, 换提供方要 `thread/fork`) [S3][S32]; Claude 每个回合进程可带不同 `--model` 并 `--resume` [S33]. 跨 harness 无法续接对方的会话: Codex 的记录是 Codex home 下的 rollout, Claude 的是项目目录下的 `.jsonl` [S32], 格式互不通用 [推断, 未见任何互读文档]. 连续性只能由 Engine 自己保存规范化对话记录 (用户话, 各回合最终回复, 摘要), 换 harness 时新建会话并交接. Codex 有 `thread/inject_items` 可把原始条目追加进已加载线程的模型可见历史 [S3], Claude 则靠首条用户消息或 `--append-system-prompt` [S2] [推断].
- 主动通知: TUI 只在 Engine 前台进程存在时可通知; Engine 常驻后台时需另备通道 (终端响铃, 操作系统通知, 推送) [推断].
- 可移植性: Node 的 `tty.ReadStream.setRawMode` 在 Windows 上需要控制台输入缓冲区的写权限, 二进制安全模式在 Windows 不支持 [S30]; Node 文档没有谈 ConPTY 或 VT 序列. 同类 ACP 终端客户端 Toad 目前只支持 Linux 与 macOS, Windows 靠 WSL [S28]. 所以 Windows PowerShell 原生运行要实测, 不能当成默认成立 [推断].
- 远程或手机: 本形态本身没有; 要么 SSH 进终端, 要么加一层服务 (等于形态 2).
- 零依赖实现量级: 不用第三方库时, 行模式 (readline 加 ANSI 着色, 批准用单键) 约 600 到 1000 行; 全屏 (滚动区, 流式 Markdown, 差异显示, 批准面板) 约 2000 到 3500 行 [推断, 粗估].
- 版本漂移暴露面: 与后端相同 (两条通路), 前端自身不增加面.
- 对等性: 取决于 Engine 的事件归一层, 两边都能做到; Claude 一侧依赖 `stdio` 取值和 `control_cancel_request` 等未载入文档的行为 [S32], 是已知差距.

## Form 2: Local web page

Engine 在 127.0.0.1 起 HTTP 服务, 浏览器作前端, 后端同形态 1.

事实与推断:

- 流式输出, 批准, 插话, 中断, 换模型: 后端能力与形态 1 完全相同, 前端只是另一种渲染. 浏览器侧富文本, 折叠, 差异显示比终端容易 [推断].
- Node 内置全局 WebSocket 只有客户端, 没有服务端 [S29]; 零依赖下用 Server-Sent Events 推送加 POST 回传就够, 不必手写 WebSocket 握手 [推断].
- 主动通知: 浏览器 Notification API 只在安全上下文可用, 需用户授权, 并要求用户手势才能请求权限 [S31]; 页面关闭后的通知要靠 Service Worker 与 Push, MDN 该页未直接说明 [S31]. localhost 是否算安全上下文, 该页没写 (一般浏览器视为安全, 本次未核) [推断].
- 可移植性: 浏览器行为在 Windows, Linux, macOS, WSL 上基本一致, 避开终端差异; WSL 里起服务, Windows 浏览器经 localhost 访问是否通畅取决于网络模式, 本次未验证 [推断].
- 远程或手机: 最自然 (同一个页面, 加认证与隧道); 代价是 Engine 要自己做认证, 并避免把批准按钮暴露给局域网. Codex 文档明确提醒: 非回环 WebSocket 监听默认允许未认证连接, 暴露前须配置认证 [S3], 这类风险同样适用于 Engine 自己的服务 [推断].
- 零依赖实现量级: HTTP 服务, SSE, 静态页面与脚本, 会话列表与批准面板约 800 到 1500 行 [推断, 粗估].
- 漂移与对等: 同形态 1. 另一个相关事实: Claude 的 Agent SDK 文档规定使用其构建的产品不得使用 "Claude Code" 名称或模仿其视觉元素, 只能称 "Claude Agent" 等 [S10]; Engine 若只启动用户本机的 `claude` 可执行文件, 是否落入此条未明, 但界面里写 harness 名称时应留意 [推断].

## Form 3: Reuse the harness's own interactive session

用户仍在 Codex TUI 或 Claude Code TUI 里打字, Engine 经扩展点接入. 分三条路.

路 A, hook / MCP / 命令:

- Codex hooks: `UserPromptSubmit` 可加上下文, 或用 `decision: block` 拦下提示, 但文档未提供改写提示词的能力; `Stop` hook 返回 `block` 时 Codex 会自动以 `reason` 为文本生成新的续写提示, 即 Engine 可借此在回合结束时注入下一条指令; `PermissionRequest` 可代答批准; 另有 `Interrupt` 事件; 非托管 hook 须先审阅信任, 绑定 hook 哈希 [S6]. 工具覆盖不限于 Bash, 含 `apply_patch` 与 MCP, 但 hosted 工具如 WebSearch 不覆盖, 官方称其为护栏而非完整强制边界 [S6].
- Claude hooks: 事件含 `UserPromptSubmit` (可 block 或加上下文, 退出码 2 拦截), `PermissionRequest` (返回 allow/deny), `Stop`, `PreModelSwitch`/`PostModelSwitch`, `Notification` 等; 类型有 `command`, `http`, `mcp_tool`, `prompt`, `agent` [S11]. 文档片段中未见改写提示词.
- Claude channels: 外部 MCP 服务可把事件推入正在运行的交互会话, 也可双向 (回复经同一通道), 并可中继权限提示; 但属 research preview, 须 claude.ai 或 Console 认证, 不支持 Bedrock, Vertex, Foundry, `--channels` 在预览期只收 Anthropic 允许列表中的插件, 自制通道须用 `--dangerously-load-development-channels`, 协议可能变 [S12]. 与 "两边都支持本地与第三方模型" 的要求 (issue 04) 冲突 [推断].
- Codex 一侧没有找到与 channels 对应的官方推送入交互会话机制; 最接近的是 `codex queue --thread <id> --message` (给已有会话排队消息, 可选 `--resume`), 来自本机帮助, 文档未载 [S1].
- 结论: 路 A 能让 Engine 拦截提示, 代答批准, 在回合结束时续写, 但回复展示, 流式, 多 harness 并存都不由 Engine 控制; 用户话仍先进入 harness 的 Main Agent 模型 (hook 拦截除外), 与 D5 "话由 Engine 接收" 相左 [推断]. 两边机制不对称 (Claude 有 channels, Codex 无).

路 B, Engine 充当 harness 交互会话的 "后端":

- Codex: TUI 可用 `--remote ws://...|unix://...` 连接任意 app-server, 带 bearer token [S1][S3]; app-server 支持多个连接, 通知如 `thread/readState/changed` 会广播给已连接客户端, 同一线程的附件操作跨连接串行化 [S4]; 官方称 VS Code 扩展基于 app-server [S3]; 本地 daemon 供桌面与手机 App 经 remote control 使用, TUI 默认附着到已发现的 daemon [S5]. 因此 "Engine 也作为另一个 app-server 客户端连同一个 daemon, 用户在 Codex TUI 里看同一个线程" 在架构上可行, 但文档未写第二个客户端 `thread/resume` 是否自动订阅事件 [S3], 同线程并行 `turn/start` 行为也未验证 [S32]. 另一方向是 Engine 自己实现 app-server 协议服务端让 Codex TUI 连它, 那要实现版本绑定的大协议 [推断].
- Claude: 官方没有让第三方前端接入交互 TUI 的文档化协议; 可用的是 `claude --bg` 加 `claude attach <id>` (用户 attach 进后台会话的原生 TUI), `claude agents --json` 读取状态 (`state` 含 `blocked`, `waitingFor` 值有 `permission prompt`, `input needed`), 以及向后台会话发提示 "脚本化路径" 文档只给 `claude --resume <uuid> --bg "提示"` 一种 (v2.1.257 起), 研究预览 [S14]. Remote Control 让 claude.ai 与手机 App 连本机会话, 但只支持订阅账号, 不支持 API key, Bedrock 等 [S13].
- 对等性差: Codex 能共享一个 app-server 给多个前端, Claude 是每会话一个进程, 前端只能是官方的 attach 或 claude.ai.

路 C, 完全放弃 Engine 自有入口: 即用户直接用 harness. 与 D5 冲突, 不单列.

综合 (形态 3):

- 流式, 工具展示, 插话, 中断由 harness 的 TUI 原生提供, 实现量最小, 且体验是官方的 [推断].
- 换模型跨 harness: 用户必须退出一个 TUI 进入另一个 (或 Engine 在两个 TUI 之间重定向), 连续性仍要靠 Engine 交接; 而 "Engine 先听用户的话" 做不到干净 [推断].
- 主动通知: Claude 有 `Notification`, `agent_needs_input` hook [S11][S14], Codex 的对应物本次未查到文档 (hooks 页无 Notification 事件) [S6].
- 可移植性: 取决于 harness 自己 (Claude 原生 Windows 支持, WSL 支持, Git Bash 可选 [S15]; Codex daemon 在 Windows 要求非提升终端 [S5]). 但 Claude hook 的 Windows 行为有特殊处理 (无 Git Bash 时仅 0 与 2 为判决退出码, 无 `/dev/tty`) [S11].
- 远程或手机: 各用各的厂商方案, 互不通用 (Codex remote-control, Claude Remote Control), 不对等.
- 零依赖实现量级: hook 脚本与路由约 300 到 600 行; 若走 Codex `--remote` 方案则要加协议客户端 (ARW 已有) [推断].
- 漂移: 暴露面最大 (hooks 事件集, 信任审阅, channels 预览, `--remote`, daemon 都带实验或预览标记) [S1][S5][S12][S14].

## ACP and related protocols

ACP (Agent Client Protocol) 事实:

- 协议: JSON-RPC 2.0; 本地 agent 作为子进程走 stdio, 远程 agent 走 HTTP 或 WebSocket 但 "完整远程支持仍在进行中"; 当前稳定协议版本 1, Apache-2.0, 有 Kotlin, Java, Python, Rust, TypeScript 官方 SDK [S16][S19][S23]. 能力: `initialize`, `session/new`, `session/load` (可选), `session/prompt`, `session/cancel`, `session/set_mode`; 客户端方法含 `session/request_permission`, 文件读写与终端 (按能力协商), `elicitation/create` [S19]. `session/update` 含消息增量, 思考, 工具调用, 计划, 模式切换 [S19]. 回合中取消语义明确, 但 "回合运行中能否再发 `session/prompt`" 与中途引导 (steering) 协议页没有规定 [S20].
- Codex 与 Claude 的适配器: 官方 agents 页列 Codex CLI 经 `agentclientprotocol/codex-acp` 适配器, Claude Agent 经 `claude-agent-acp` (基于 Anthropic Agent SDK, 仓库在 `agentclientprotocol` 组织下; 该页写 "Zed Industries" 作者) [S17]. 二者都是适配器, 不是 OpenAI 或 Anthropic 自己出的. codex-acp 内部运行 Codex App Server, 支持 ChatGPT 登录, API key, 兼容网关, 模型, 推理强度, 批准, 沙箱, MCP, 终端输出, 计划, 以及 "中途引导" 等扩展 (AIR 扩展, 需双方协商), 安装用 `npx -y @agentclientprotocol/codex-acp`, 依赖 `@openai/codex` [S21]. claude-agent-acp 支持工具权限, MCP, 子 agent, 会话恢复 (ACP v2 的 `session/resume` 为实验草案), 有无需 Node 的独立可执行文件, 引导 "steering only on v1" [S22].
- 一个客户端同时接多个 harness: 是常态. Zed 的外部 agent 每个是独立子进程, 认证与计费由各 agent 自管; 自定义 agent 用 `agent_servers` 配置命令与参数 [S26]. JetBrains AI Chat 可从注册表选 agent, 不需 JetBrains AI 订阅, 但目前不支持 WSL [S27]. ACP 客户端页列出终端客户端 (Toad, acpx 等), Web 客户端, 手机端, 以及 "Multi-Agent Clients": Jockey ("coordinates Claude Code, Gemini CLI, and Codex"), Coincide ("switches agents mid-conversation"), SpurCode ("mixed fleet of agents in one TUI") 等 [S18]. 这些是第三方项目的自述, 我没有逐个核对其实现 [推断].
- Toad (Will McGugan, Python 与 Textual, AGPL-3.0) 是一个以 ACP 为后端的终端前端, 支持 Claude, Gemini, Codex, OpenHands, 并发会话与恢复, 有 `toad serve` 网页模式, 暂无原生 Windows [S28]. 这是 "一个前端驱动多个 harness" 的最直接一手先例, 但它们都是编辑器或终端中的 "聊天加工具" 前端, 没有 "确定性流程驱动" 的对应物 [推断].
- ACP 代理链 (proxy chains) RFD: 在客户端与 agent 之间可插入代理, 由 conductor 编排并对编辑器呈现为单个 agent [S25]. 本次未核实其采纳状态 [推断].

对 Engine 的含义 (推断):

- 用 ACP 作 Engine 到 harness 的内部通道不划算: 多了适配器和 ACP 两层版本漂移, npm 或独立二进制的外部组件 (违反零第三方运行时依赖的精神), 且 v1 缺少 Engine 已在用的能力 (输出 schema 约束, 回合中引导, 待决批准重放, 用量核算); ARW 已有两条直连通路.
- 把 Engine 暴露为 ACP agent (`engine --acp`) 则让 Zed, JetBrains, Neovim, Toad 以及手机 ACP 客户端直接成为 Engine 的前端, 前端不必自己画. 代价: 要实现 ACP agent 端 (JSON-RPC 与会话更新映射), Engine 特有交互 (选 Main Agent 模型, 流程状态, 等待用户) 只能借 `set_mode`, 配置选项, `elicitation` 表达; 且 ACP 客户端是面向编辑器的, 不保证每个客户端都实现这些.

## SDKs

- Claude Agent SDK (TypeScript, Python): 是 "运行 Claude Code 二进制" 的库, 能力含 hooks, 权限回调, 会话, MCP 等; 文档明言未经批准第三方不得提供 claude.ai 登录或额度, 须用 API key [S10]. 它是 npm 或 PyPI 包, 对零第三方依赖的 Engine 不适用, 但其 TypeScript 类型是 stream-json 线格式的唯一规范来源 [S32]. 另有 `--bare` 模式只认 `ANTHROPIC_API_KEY`, 不读订阅登录 [S9].
- Codex TypeScript SDK (`@openai/codex-sdk`): 包装 CLI 并交换 JSONL 事件, 有 `runStreamed()` 与 `resumeThread()`, 页面未提批准; Python SDK 经 JSON-RPC 控制本地 app-server [S7][S8]. 官方对自定义客户端建议直接用 app-server (它处理批准, 认证, 历史, 流式事件) [S7]. TypeScript SDK 无法应答批准, 不适合交互入口 [S8, 推断].
- Codex App Server 多客户端: 支持 stdio, unix, WebSocket (后者标 experimental and unsupported); 多连接同时存在, 线程订阅用 `thread/start` 自动订阅, `thread/unsubscribe` 与 60 秒卸载 [S3][S4]; 官方称它驱动 VS Code 扩展 [S3]; 同一文档声明 "app-server 认证从未获准用于商业或托管服务", 本地或开源应用可继续用, 建议迁到 Sign in with ChatGPT [S3].

## Comparison

| 维度 | 1 终端 TUI | 2 本地网页 | 3 复用 harness 交互会话 |
| --- | --- | --- | --- |
| 流式与工具展示 | Engine 归一两种事件后自绘 | 同左, 渲染更丰富 | harness 原生 (官方体验), Engine 不控制 |
| 批准应答 | 两边都能; Claude 依赖 `stdio` 取值或 `PermissionRequest` hook | 同左 | hook 代答 (两边都有) 或原生提示 |
| 插话与中断 | 两边都有; 机制不同 | 同左 | 原生 |
| 中途跨 harness 换模型 | Engine 存规范化记录并交接新会话 | 同左 | 用户要换 TUI, 交接仍由 Engine 做, "话先给 Engine" 不干净 |
| Engine 主动通知 | 仅前台; 后台需另备通道 | Notification API 需授权与安全上下文 | Claude 有通知类 hook, Codex 无文档化对应物 |
| 平台 | Windows 原生需实测 (raw mode, VT) | 最一致; WSL 与 Windows 浏览器连通性待验 | 随 harness; hook 的 Windows 行为特殊 |
| 远程与手机 | 需 SSH 或加服务 | 最自然, 需自备认证 | 各厂商方案互不通用, Claude 的限订阅账号 |
| 零依赖实现量级 (粗估) | 600 到 3500 行 | 800 到 1500 行 | 300 到 600 行, 外加协议客户端 |
| 版本漂移暴露面 | 同后端两通路 | 同左 | 最大 (hooks, 预览特性, 实验特性) |
| 两 harness 对等 | 可对等, 靠归一层 | 同左 | 机制不对称 (channels, `--remote`, `queue` 只一边有) |
| 与 D5 的吻合度 | 吻合 | 吻合 | 部分背离 |

## Implications

以下只陈述从上文推出的含义, 不替用户决定.

- 形态 1 与 2 共用同一个 "会话事件流 加命令" 层, 差别只在渲染. 先定 Engine 自己的规范化事件模型, 再决定画在哪, 比先选界面更重要 [推断].
- 形态 3 的优点 (原生体验, 实现量小) 以失去 "Engine 先听用户的话" 和 "两边对等" 为代价, 且漂移面最大. 但它的单点机制仍有价值: `PermissionRequest` hook 可成为两个 harness 统一的批准路由 (Claude 官方文档化; Codex 要求用户信任 hook) [S6][S11], 也可补足 Claude 一侧 `stdio` 取值不在文档中的缺口 [推断].
- ACP 的价值在 "导出" 而非 "导入": Engine 对外作为 ACP agent 可零成本换来多种第三方前端 (含手机), 对内仍用现有直连通路.
- 跨 harness 连续性在所有形态下都要由 Engine 拥有规范化对话记录; 没有任何 harness 提供互读对方会话的官方能力 [S32][推断].
- 认证条款对 Engine 作为产品分发时有影响 (Claude Agent SDK 登录条款, Codex app-server 认证条款), 但对本机个人使用是否涉及, 要看 Engine 是否代用户转发登录 [S3][S10][推断].

## Open decisions

1. 入口形态的取舍.
   - 选项 a: 只做终端 TUI. 代价: Windows 原生与 WSL 差异要实测, 远程需另加.
   - 选项 b: 只做本地网页. 代价: 要自建认证; 通知依赖浏览器授权.
   - 选项 c: 先定 Engine 事件流与命令接口, TUI 与网页作为它的两个薄客户端, 首发其一.
   - 建议: c, 首发先看用户主要使用环境 (WSL 终端还是浏览器); 不替用户决定.
2. 是否让 Engine 对外提供 ACP agent 入口 (让 Zed, JetBrains, Neovim 等作前端).
   - 代价: 实现 ACP agent 端, Engine 特有交互降级为配置选项与 elicitation, 依赖各客户端实现程度.
   - 收益: 前端与手机端不必自建.
   - 建议: 作为后续可选扩展, 不进首版必需范围; Engine 对内不用 ACP.
3. 是否接受 hook 作为批准路由的补充或替代.
   - 代价: Codex hook 须用户审阅信任, 工具覆盖不是完整强制边界; Claude 在 Windows 无 Git Bash 时 hook 行为有限制.
   - 收益: 两边对等, 且 Claude 一侧有文档依据.
   - 建议: 与 `stdio` 取值并行评估, 取文档化者为主.
4. 跨 harness 换模型的连续性策略.
   - 选项: (i) Engine 摘要加最近若干回合交接; (ii) 换 harness 即视为新对话, 仅带任务状态; (iii) 只允许在回合边界换.
   - 建议: 先定义规范化对话记录的内容与大小, 再选 (i) 或 (iii); 需要用户确认可接受的信息损失.
5. 远程与手机.
   - 选项: Engine 自带认证服务加隧道; 只用推送通知加回到桌面; 借各厂商的 remote control (不对等, Claude 一侧限订阅账号).
   - 建议: 不依赖厂商方案以保持对等; 具体取舍等用户给出手机使用场景.
6. Windows PowerShell 原生支持是否为首版硬要求.
   - 影响: 若是, 终端形态需要专门验证, 网页形态更省事.

## Sources

| 编号 | 来源 |
| --- | --- |
| S1 | 本机 `codex --help`, `codex app-server --help`, `codex app-server daemon --help`, `codex app-server proxy --help`, `codex resume --help`, `codex queue --help`, `codex remote-control --help`, `codex agents --help` (`codex-cli 0.167.0`) |
| S2 | 本机 `claude --help`, `claude agents --help`, `claude attach --help` (`2.1.322`) |
| S3 | https://learn.chatgpt.com/docs/app-server.md (读取前 100000 字符) |
| S4 | github.com/openai/codex `codex-rs/app-server/README.md` |
| S5 | github.com/openai/codex `codex-rs/app-server-daemon/README.md` |
| S6 | https://learn.chatgpt.com/docs/hooks.md |
| S7 | https://learn.chatgpt.com/docs/codex-sdk.md |
| S8 | github.com/openai/codex `sdk/typescript/README.md` |
| S9 | https://code.claude.com/docs/en/headless.md |
| S10 | https://code.claude.com/docs/en/agent-sdk/overview.md |
| S11 | https://code.claude.com/docs/en/hooks.md (读取前 100000 字符) |
| S12 | https://code.claude.com/docs/en/channels.md |
| S13 | https://code.claude.com/docs/en/remote-control.md |
| S14 | https://code.claude.com/docs/en/agent-view.md (读取前 100000 字符) |
| S15 | https://code.claude.com/docs/en/setup.md |
| S16 | https://agentclientprotocol.com/overview/introduction |
| S17 | https://agentclientprotocol.com/overview/agents |
| S18 | https://agentclientprotocol.com/overview/clients |
| S19 | https://agentclientprotocol.com/protocol/overview |
| S20 | https://agentclientprotocol.com/protocol/prompt-turn |
| S21 | github.com/agentclientprotocol/codex-acp 的 README |
| S22 | github.com/zed-industries/claude-agent-acp 的 README |
| S23 | github.com/agentclientprotocol/agent-client-protocol 的 README |
| S24 | https://agentclientprotocol.com/libraries/typescript |
| S25 | https://agentclientprotocol.com/rfds/proxy-chains (仅见检索摘要, 未读全文) |
| S26 | https://zed.dev/docs/ai/external-agents |
| S27 | https://www.jetbrains.com/help/ai-assistant/acp.html |
| S28 | github.com/batrachianai/toad 的 README |
| S29 | https://nodejs.org/learn/getting-started/websocket (经检索摘要) |
| S30 | https://nodejs.org/docs/latest/api/tty.html |
| S31 | https://developer.mozilla.org/en-US/docs/Web/API/Notification |
| S32 | ARW `.scratch/0099-arw-1-0-wayfinder/research/engine-session-control/report.md` |
| S33 | ARW `docs/adr/0033-run-each-claude-turn-as-a-stream-json-process.md`, `lib/background-agent/codex-app-server.mjs`, `claude-sessions.mjs` |
| S34 | ARW `.scratch/0099-arw-1-0-wayfinder/issues/04-*.md`, `17-*.md`, `07-*.md` |

未验证项 (需真实回合或进一步核对): Codex 第二个客户端 `thread/resume` 是否自动订阅事件; 同线程并行 `turn/start`; ACP 代理链 RFD 采纳状态; ACP 多代理客户端 (Jockey, Coincide 等) 的实现细节; localhost 作为浏览器通知的安全上下文; Windows 原生终端下 Node raw mode 与 VT 序列行为; Codex 是否有与 Claude `Notification` 对应的通知 hook.

