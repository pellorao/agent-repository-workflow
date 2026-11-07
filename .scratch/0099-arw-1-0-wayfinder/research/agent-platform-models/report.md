# Claude Code 与 Codex 接入本地和第三方模型的路径

## Scope

本记录为 Wayfinder issue "确定 ARW 1.0 的产品边界与 Agent 平台范围" 核对两个平台接入本地与第三方模型的可行性, 核对日期 2026-11-08. 资料为官方文档, 开源仓库 README 与发布说明, 以及维护者本机 Strata 部署仓库 (私有) 的源码和文档 (只读源码与文档, 未运行程序, 未访问服务端口). 没有运行模型回合. 表中 [Sn] 见末尾来源表. 区分三类: 事实 (有一手来源), 推断 (标明), 未确认. 本记录更正 [Engine 会话控制研究](../engine-session-control/report.md) 中 "Strata 一类驱动目前只能挂在 Codex 后端" 的推论; 该报告关于 Codex 一侧的结论仍成立.

## Questions

1. Claude Code 官方对网关, 第三方提供方, 非 Claude 模型的确切说法.
2. `claude -p` 能否按进程指向不同 base URL 与模型, 且不影响用户登录.
3. 本地推理服务对 Anthropic Messages 的兼容.
4. 协议转换网关 (LiteLLM) 的支持与限制.
5. 其他厂商托管的非 Claude 模型的 Anthropic 兼容端点.
6. 维护者本机 Strata 前端暴露哪些协议.
7. Codex 一侧是否仍只支持 Responses.
8. 行为差异, 风险, 替代路径的事实依据.

## Key findings

1. 事实: Anthropic 文档明确不支持把 Claude Code 路由到非 Claude 模型, 原句: "Anthropic doesn't endorse, maintain, or audit third-party gateway products, and doesn't support routing Claude Code to non-Claude models through any gateway." [S1] 同一句在网关总览页重复 [S2]. 这是 "不提供支持" 的措辞, 文档没有写 "技术上会拒绝".
2. 事实: 技术上只要对端暴露 Anthropic Messages (`/v1/messages`, `/v1/messages/count_tokens` 可选) 并原样转发 `anthropic-version` 与 `anthropic-beta`, Claude Code 就能连 [S4]. 维护者本机的 Strata 与 DeepSeek 两条路径已在 Claude Code 2.1.295 到 2.1.309 上实际跑通 [S25].
3. 事实: 按进程配置可行. 环境变量只作用于该进程, `ANTHROPIC_MODEL` 与 `--model` "apply only to the session you launch with them" [S5]. `ANTHROPIC_AUTH_TOKEN` 设置后立即优先于已保存的订阅登录, `-p` 下 `ANTHROPIC_API_KEY` 存在即使用 [S3, S6]. 维护者本机的运行脚本用全新 `HOME` 与 `CLAUDE_CODE_CONFIG_DIR` 隔离 [S25].
4. 事实: 本地服务几乎都已提供 `/v1/messages`: Ollama 自 v0.14.0 (2026-01-10), llama.cpp 自 2025-11-28 合并的 PR 17570, vLLM 自 v0.11.1 (2025-11-18), LM Studio 文档列出该端点 (版本未写) [S10 到 S17]. 差异在 count_tokens, tool_choice, 缓存, thinking 预算等.
5. 事实: 五家模型厂商 (DeepSeek, Kimi, Z.ai, MiniMax, 阿里云) 的官方文档都给出 Anthropic 端点 URL 和 Claude Code 的环境变量配置 [S19 到 S23].
6. 事实: LiteLLM 官方文档给出 "Claude Code 经 Anthropic 格式 `/v1/messages` 访问非 Anthropic 模型" 的教程, 并写明会双向翻译 [S18]. 文档同时说明模型名选择器过滤, 上下文窗口需客户端另设.
7. 事实: Strata 前端同时暴露 Chat Completions, Responses, Messages 三套协议, 并为 Claude Code 做了专门配置 (关闭工具搜索, 关闭内置 WebSearch 改挂 Brave MCP) [S25].
8. 事实: Codex 一侧未变: `wire_api` "`responses` is the only supported value", `--oss` 配 `ollama` 或 `lmstudio` [S24]. Ollama, LM Studio, llama.cpp (部分), vLLM 都有 Responses 端点 [S15, S16, S17, S12].
9. 风险 (事实依据在第 8 节): Claude Code 对未知模型名按 "当前 Claude 模型" 发送 adaptive thinking, effort, 系统角色消息等字段; 每个 Claude Code 版本还会新增 beta 字段, 官方排错表已有两次因新字段令第三方网关整批请求 400 的记录 [S3, S4].
10. 未找到一手依据: 把 Claude Code 用于非 Claude 模型的服务条款层面的明文许可或禁止 (只有上面 "不支持" 一句). 查过 S1 到 S9 各页.

## 1. Claude Code documentation

| 项 | 内容 | 来源 |
| --- | --- | --- |
| 非 Claude 模型 | 原句见要点 1. 区分: 托管 Claude 的第三方 (Bedrock, Agent Platform 即原 Vertex, Foundry, Claude Platform on AWS) 是官方支持路径; 非 Claude 模型与 "任何网关" 组合不受支持 | S1, S2, S5 |
| 网关格式要求 | "A gateway must expose at least one of" 三种格式: Anthropic Messages (`ANTHROPIC_BASE_URL`), Bedrock InvokeModel, Agent Platform rawPredict. Messages 格式的端点是 `/v1/messages` 与可选的 `/v1/messages/count_tokens` | S4 |
| `ANTHROPIC_BASE_URL` | "Override the API endpoint to route requests through a proxy or gateway." 且 "changes where requests are sent, not which model answers them" | S6, S5 |
| `ANTHROPIC_AUTH_TOKEN` | 发 `Authorization: Bearer`; `ANTHROPIC_API_KEY` 发 `x-api-key`; `apiKeyHelper` 两个头都发 | S3, S6 |
| `ANTHROPIC_MODEL` | 不做事先校验: "Claude Code doesn't check it up front, and a mistyped value produces [There's an issue with the selected model] on the first request" | S5 |
| `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` | 决定别名解析, 且 HAIKU 变量同时决定后台功能用的模型 | S6 |
| `CLAUDE_CODE_SUBAGENT_MODEL` | 子 agent, 队友, workflow agent 的默认模型, 可被定义内的 `model` 字段覆盖; `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` 可强制 | S5 |
| `*_SUPPORTED_CAPABILITIES` | 文档称 "They have no effect behind an `ANTHROPIC_BASE_URL` gateway." 只对 Bedrock, Vertex, Foundry, Mantle 配置生效 (`_NAME`, `_DESCRIPTION` 对网关也生效) | S4, S5 |
| 未知模型 ID | 窗口假定 200K, 可用 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 改写; 最大输出默认 32000, 上限 128000; `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 范围 100000 到 1000000 | S5, S6 |
| `--bare` | 跳过 hooks, skills, MCP, memory, CLAUDE.md 的自动发现; "never reads OAuth credentials or the system keychain"; Anthropic API 须用 `ANTHROPIC_API_KEY` 或 `--settings` 中的 `apiKeyHelper`. 文档称它 "will become the default for `-p` in a future release" | S7 |
| 网关与订阅 | 网关凭据变量或 `apiKeyHelper` 生效时, 请求不带订阅登录; 只设 `ANTHROPIC_BASE_URL` 时 "a saved claude.ai login remains the active credential", 订阅额度与计费仍适用 | S1 |

## 2. Per-process configuration

- 事实: 优先级. `ANTHROPIC_AUTH_TOKEN` 设置即压过已保存登录; `ANTHROPIC_API_KEY` 交互模式需一次确认, `-p` 下 "always used when present" [S3, S6]. 两者并存时出现 auth-conflict 警告 [S3].
- 事实: `--settings <file-or-json>` 的优先级在用户, 项目, 本地文件之上, 仅作用于该会话, 不写盘 [S8]. 设置文件的 `env` 块与 shell 变量同名时, 设置文件值生效 [S3].
- 事实: 维护者本机运行脚本 `claude_headless.py` 的子进程隔离做法: 极简环境 (等同 `env -i`), 全新 `HOME` 与 `CLAUDE_CONFIG_DIR`, `--setting-sources ""`, `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` 防止后端密钥进入命令环境 [S25].
- 事实: 后台会话由 supervisor 托管时, 只在 shell 里导出的网关变量未必到达会话, 官方建议写入设置文件的 `env` 块 [S9]. 这对 Engine 有意义: 要走本地模型的会话应由 Engine 直接起进程并给环境, 不依赖 supervisor.
- 推断: 用 `--settings '{"env":{...}}'` 传 base URL 也应可行 (`env` 是普通键, `--settings` 可设用户文件能设的任意键 [S8]), 但文档未说明 `--settings` 中的 `env` 是否早于启动时的登录检查生效. 稳妥做法是直接用进程环境变量, 与维护者本机的运行脚本一致.
- 未确认: `--bare` 与 `ANTHROPIC_AUTH_TOKEN` 的组合. S7 只写 `ANTHROPIC_API_KEY` 或 `apiKeyHelper`. 维护者本机的运行脚本未用 `--bare`.

## 3. Local inference servers

| 服务 | 端点与起始版本 | 支持 | 不支持或限制 | 点名 Claude Code | 来源 |
| --- | --- | --- | --- | --- | --- |
| Ollama | `/v1/messages`, 自 v0.14.0 (2026-01-10) | 消息, 流式, system, 多轮, 图像 (仅 base64), 工具和工具结果, thinking | `/v1/messages/count_tokens`, `tool_choice`, `metadata`, 提示缓存 `cache_control`, Batches, citations, PDF, 流中 `error` 事件; `budget_tokens` 接受但不强制 | 是: 有 Claude Code 指南, 建议 64k 以上上下文; 文档称 "Hosted WebSearch and advanced tool controls are not fully supported" | S10, S11, S12 |
| llama.cpp `llama-server` | `/v1/messages` 与 `/v1/messages/count_tokens`, PR 17570 于 2025-11-28 合并 | 流式; 工具调用须 `--jinja`; 有 `--reasoning` 与 `--reasoning-budget` 参数 | README 称 "no strong claims of compatibility with the Anthropic API spec are made"; 多模态 "currently an experimental feature" | README 未提及 | S16 |
| LM Studio | `/v1/messages` (文档列出的唯一 Anthropic 端点); 版本未写 | 支持 `x-api-key` 与 Bearer | 页面未列出支持矩阵 | 是: 有 Claude Code 集成页, 建议 `CLAUDE_CODE_ATTRIBUTION_HEADER=0`, 上下文大于约 25k | S13, S14 |
| vLLM | `/v1/messages` 自 v0.11.1 (2025-11-18); `count_tokens` 自 v0.17.0, thinking blocks 自 v0.17.0 (2026-03-07) | 工具, 流式, base64 图像等 (发布说明逐版修复) | 在线服务文档只列出端点, 无兼容矩阵 | 在线服务文档未提及 | S17 |

说明: Ollama 文档同时写 "Compatible models support messages, streaming, and function calling" [S10], 工具调用能力取决于具体模型.

## 4. Protocol translation gateways

- 事实: 官方教程称 LiteLLM 接收 Anthropic Messages 格式, "Translates the request to the target provider's format (OpenAI, Gemini, etc.)", 再把响应翻译回 Anthropic 格式; 要求 `ANTHROPIC_BASE_URL` 指向提供 Anthropic Messages 格式的网关; 教程标注 "Verified against Claude Code v2.1.247" [S18].
- 事实: 限制与注意. 声明 `max_input_tokens` 不改变客户端显示和压缩时机, 须另设 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; `/model` 选择器只保留 id 含 `claude` 或 `anthropic` 的网关模型, 非 Anthropic 模型需起 claude 风味的名字 (如 `kimi-k3-claude-compatible`); 模型发现须 `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` [S18]. 另一页称 MCP 工具搜索在 base URL 非第一方时被 Claude Code 关闭, 可设 `ENABLE_TOOL_SEARCH=true` [S18].
- 未确认: LiteLLM 另有 "context management" 与 "auto mode" 两页, 据搜索摘要称对非 Claude 模型自行实现 `context_management` 编辑, 并要求配置 `safeguards_classifier_model`; 未读原文.
- 未确认: 各目标后端 (OpenAI Chat 或 Responses) 的逐字段翻译损失. `/v1/messages` 页只给出 thinking 预算最小 1024, temperature 范围等 [S18], 没有 Claude Code 专用的不支持清单.

## 5. Other hosted model vendors

| 厂商 | Anthropic 端点 | Claude Code 配置要点 | 限制 | 来源 |
| --- | --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/anthropic` | 兼容页给出 `ANTHROPIC_BASE_URL` 与 API key; `x-api-key` 与 Bearer 都接受 | 忽略 `cache_control`, `top_k`, `budget_tokens`, `mcp_servers`; `adaptive` 当作 `enabled`; `tool_choice` 的 `any` 当作 `auto`, 思考模式下指定工具名返回 400; `deepseek-flash` 接受图像, `deepseek-v4-pro` 把图像换成 "[Unsupported Image]"; 不支持 `document`, `search_result`, `redacted_thinking`, MCP 块 | S19 |
| Kimi (Moonshot) | `https://api.moonshot.ai/anthropic` (国内为 moonshot.cn) | 设置文件 `env` 块: `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, 三个 `ANTHROPIC_DEFAULT_*`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` | 页面称缺 HAIKU, FABLE 或子 agent 变量时 "background tasks and sub-agents will fail"; `kimi-k2.7-code` 必须开 thinking, 否则 400; 页内示例模型名不一致 | S20 |
| Z.ai (智谱 GLM) | `https://api.z.ai/api/anthropic` | `ANTHROPIC_AUTH_TOKEN`, 三个 `ANTHROPIC_DEFAULT_*` 映射到 GLM, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `API_TIMEOUT_MS` | 页面注明按 Claude Code 2.0.14 验证 | S21 |
| MiniMax | `https://api.minimax.io/anthropic` (国内 minimaxi.com) | 设置文件 `env` 块 (模型名带 `[1m]`, `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW=524288`) | 兼容页: 忽略 `temperature`, `top_k`, `stop_sequences`, `mcp_servers`, `context_management`, `container`; `tool_choice` 仅 `auto`; 图像和视频仅限 M3 系列; `cache_control` 页面未提; thinking 恒开, `MAX_THINKING_TOKENS=0` 无效 | S22 |
| 阿里云百炼 (Qwen) | Token Plan, 按量计费, Coding Plan 三种地址, 路径均以 `/apps/anthropic` 结尾 | 全套 `ANTHROPIC_*` 变量加 `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | key 与地址不配套返回 401; 默认上下文 200K; 页内按量计费地址前后不一致; 无模型列表端点 | S23 |

DeepSeek 的 Claude Code 专页 (模型映射 `claude-opus*` 到 v4-pro, `claude-sonnet*` 与 `claude-haiku*` 到 flash) 只在搜索摘要和维护者本机的 benchmark 计划里见到 [S25], 未直接读到该页原文, 列为未确认.

## 6. Maintainer's local Strata deployment

- 事实: 前端 `src/frontend.py` 的 `GENERATION` 元组含 `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/messages/count_tokens`; 调用手册把 Messages 端点列为 "Anthropic Messages (Claude Code)", 请求原样转发到原生 Strata 服务; 前端只补 `model`, Messages 的 thinking 预算, 循环提醒 [S25].
- 事实: 调用手册 "Claude Code integration" 给出完整环境变量组: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL` (三个别名模型同值), `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_EFFORT_LEVEL`, `ENABLE_TOOL_SEARCH=false`, 外加 `--settings` 关掉 WebSearch 和 WebFetch 预检, 用 PreCompact 与 PermissionRequest hook [S25]. 手册还写了 `CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE` 用于自动压缩阈值, 该变量在官方环境变量页已读部分内未找到, 属经验值, 未确认官方稳定性.
- 事实: 已知差异 (该部署的上游问题记录). (a) Strata Messages 端点不实现 `defer_loading` 和 `tool_reference`, 占位工具被当作普通工具, 所以必须 `ENABLE_TOOL_SEARCH=false`. (b) 输出撞上限时 Messages 不做内部重试, Claude Code 自己把半截 `tool_use` 当失败结果返回给模型并继续. (c) Claude Code 内置 WebSearch 依赖 Anthropic 服务, 改用 Brave MCP [S25].
- 事实: 该部署的抓包记录: Claude Code 2.1.303 对未知模型名照样发送 `output_config.effort` 和 `thinking: {type: adaptive}` (mock 抓包, 2026-10-19) [S25].

## 7. Codex side

- 事实: `model_providers.<id>.wire_api`: "`responses` is the only supported value, and it is the default when omitted." `openai`, `ollama`, `lmstudio` 等 id 被保留; `--oss` 配 `--local-provider` 或 `oss_provider` 选 `ollama` 或 `lmstudio`, 都未设时 `codex exec` 报错 [S24]. 与 Engine 会话控制研究一致.
- 事实: 本地服务的 Responses 端点: Ollama 有 `/v1/responses` (v0.14.2 起改进, 云端不支持 stateful Responses 与自定义工具重放) [S12, S27]; LM Studio 文档列 `POST /v1/responses`, 含流式, reasoning, `previous_response_id` [S15]; llama.cpp 有 `/v1/responses` (PR 18486 于 2026-01-21 合并, 标题为 "partial") [S16]; vLLM 文档列出 Responses API [S17].
- 未确认: Codex 使用自定义 provider 时是否完全不要求 ChatGPT 登录 (未在 S24 读到相关说明).

## 8. Behavior differences, risks and alternative paths

| 方面 | 事实 | 来源 |
| --- | --- | --- |
| 工具调用格式 | 本地端点需模型自带可用的工具模板 (llama.cpp 须 `--jinja`), 质量取决于模型; Ollama 称 tool-choice 控制不完整; DeepSeek 与 MiniMax 对 `tool_choice` 有限制; Strata 不支持延迟工具 | S10, S16, S19, S22, S25 |
| thinking 与 effort | 对未知模型 ID, Claude Code 发 adaptive thinking, 并发 effort 与 context management 字段; 上游拒绝 `thinking` 时 Claude Code 自动改用 enabled 或 adaptive 重试一次; 文档故障表: 400 提到 `adaptive` 时 "Upgrade the gateway's upstream"; 各家对 `budget_tokens` 的处理不一 (Ollama 不强制, DeepSeek 忽略, MiniMax 忽略 `context_management`) | S3, S4, S10, S19, S22 |
| 提示缓存 | Claude Code 给 `system` 和消息加 `cache_control`; 被剥离时 "No error: the conversation bills as uncached input on every turn". Ollama 与 DeepSeek 忽略该字段; Ollama v0.19.0 称改进了 Anthropic API 下的 KV 缓存命中 | S4, S10, S19, S12 |
| 服务端工具 | 内置 WebSearch 依赖 Anthropic 服务, Ollama 文档称托管 WebSearch 不完整支持; Strata 部署禁用并改挂 MCP; WebFetch 的域名预检仍访问 `api.anthropic.com`, 需 `skipWebFetchPreflight` | S3, S11, S25 |
| 模型名校验 | 启动时不校验, 首次请求才报错; 未知 ID 触发 "isn't recognized" 警告, 窗口按 200K; 模型选择器过滤与 LiteLLM 的 claude 名限制 | S5, S18 |
| 超长上下文 | 网关内部限额小于 Claude Code 假定值时会出现改写后的 400, Claude Code 不能自动压缩恢复, 须设 `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 并把 `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 设在模型上限以下 | S3 |
| 版本漂移 | 官方称 "Claude Code adds capabilities with each release, and a gateway that doesn't forward them breaks the corresponding features". 排错表有实例: v2.1.265 到 2.1.267 的 Artifact 工具 schema 含 `\p{...}` 正则, v2.1.275 的 advisor 工具条目, 都令校验严格的网关整批请求 400, 随后版本修复. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 会禁用自动更新 | S1, S3, S6 |
| 订阅凭据外泄面 | 只设 `ANTHROPIC_BASE_URL` 时已保存的 claude.ai 登录仍为有效凭据, 且 `anthropic-beta` 会带 OAuth 能力值 | S1, S4 |
| 其他功能影响 | `ANTHROPIC_BASE_URL` 指向非 `api.anthropic.com` 主机时 Remote Control 禁用; 凭据变量生效时语音听写不可用 | S3, S6 |
| 服务条款 | 除 "不支持" 一句外, 未找到一手依据 (查过 S1 到 S9) | 无 |

替代路径的事实依据 (只列事实, 不作取舍):

- A. Claude Code 一侧接本地或第三方模型: 每回合起 `claude -p` 进程时注入 `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, 全部模型变量和上限变量, 并隔离 `HOME` 与 `CLAUDE_CONFIG_DIR` (维护者本机的运行脚本已如此做) [S25]. 前提是对端暴露 Anthropic Messages (Strata, Ollama, llama.cpp, LM Studio, vLLM 以及上节五家厂商都有).
- B. 在 Claude Code 用户机器上 Engine 改用 Codex 驱动本地模型: Codex 官方只有 Responses 协议自定义 provider 加 `--oss` [S24]; 本地 Ollama, LM Studio, llama.cpp, vLLM 都有 Responses 端点 [S12, S15, S16, S17]; ARW 已经经 Codex App Server 接入 Strata [S26]. 事实缺口: 用户机器不一定装有 Codex, 且 Codex 是否需要 ChatGPT 登录未确认.
- C. Engine 自己调用 OpenAI Chat 或 Responses 协议跑本地模型: 本地服务均提供这两类端点 [S16, S17, S25]. 此路径下不存在 Claude Code 的版本漂移问题, 也无 Claude Code 的工具与权限层, 需 Engine 自行承担 Agent 循环. 未在官方资料中找到对该路径的相关限制.
- D. 协议转换网关 (LiteLLM) 置于 Claude Code 与任意 OpenAI 兼容后端之间: 官方有教程, 但属 Anthropic "不支持" 范围 [S1, S18].

## Risks and open items

1. 支持立场: Anthropic 明确不支持非 Claude 模型, 官方不保证兼容; 风险是未来版本在不通知的情况下改变行为. 已有证据显示每个 Claude Code 版本都可能引入新请求字段 (S3 排错表).
2. 订阅登录误用: 仅设 base URL 会把订阅 OAuth 能力头发给第三方地址 [S1, S4]. 缓解事实: 设置 `ANTHROPIC_AUTH_TOKEN` 后订阅不再随请求发送 [S1].
3. 自动更新: 用户机器上的 Claude Code 版本会漂移; `DISABLE_AUTOUPDATER=1` 与 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 可停更 [S3, S25]. 未确认 Engine 能否固定到某个已验证版本 (本次未查安装文档).
4. 文档与产品的时间差: 多个厂商页注明的验证版本较旧 (Z.ai 为 2.0.14, LiteLLM 教程为 2.1.247), 维护者本机当前为 2.1.319.
5. 只看了摘要的项: LiteLLM 的 context management 与 auto mode 页, DeepSeek 的 Claude Code 专页; Kimi 与 MiniMax 的配置块已由 S20, S22 直接读取确认.
6. 未确认: `--bare` 与 `ANTHROPIC_AUTH_TOKEN` 的组合; `--settings` 内 `env` 的生效时机; `CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE` 的官方地位; Codex 自定义 provider 是否需要 ChatGPT 登录.
7. 模型名和版本号在多个厂商页中前后不一致 (Kimi, 阿里云), 以页面访问当日为准.

## Sources

| 编号 | URL 或路径 | 访问日期 |
| --- | --- | --- |
| S1 | https://code.claude.com/docs/en/llm-gateway.md | 2026-11-08 |
| S2 | https://code.claude.com/docs/en/gateways.md | 2026-11-08 |
| S3 | https://code.claude.com/docs/en/llm-gateway-connect.md | 2026-11-08 |
| S4 | https://code.claude.com/docs/en/llm-gateway-protocol.md | 2026-11-08 |
| S5 | https://code.claude.com/docs/en/model-config.md | 2026-11-08 |
| S6 | https://code.claude.com/docs/en/env-vars.md (前 100000 字符) | 2026-11-08 |
| S7 | https://code.claude.com/docs/en/headless.md | 2026-11-08 |
| S8 | https://code.claude.com/docs/en/settings.md | 2026-11-08 |
| S9 | https://code.claude.com/docs/en/agent-view.md (LLM gateway 一节) | 2026-11-08 |
| S10 | https://docs.ollama.com/api/anthropic-compatibility 与 github.com/ollama/ollama 的 `docs/api/anthropic-compatibility.mdx` | 2026-11-08 |
| S11 | https://docs.ollama.com/integrations/claude-code | 2026-11-08 |
| S12 | https://api.github.com/repos/ollama/ollama/releases (v0.14.0, v0.14.2, v0.19.0 等发布说明) | 2026-11-08 |
| S13 | https://lmstudio.ai/docs/developer/anthropic-compat | 2026-11-08 |
| S14 | https://lmstudio.ai/docs/integrations/claude-code | 2026-11-08 |
| S15 | https://lmstudio.ai/docs/developer/openai-compat/responses | 2026-11-08 |
| S16 | github.com/ggml-org/llama.cpp 的 `tools/server/README.md`; PR 17570 (2025-11-28), PR 18486 (2026-01-21) | 2026-11-08 |
| S17 | https://docs.vllm.ai/en/latest/serving/online_serving/ 与 github.com/vllm-project/vllm 发布说明 (v0.11.1, v0.17.0) | 2026-11-08 |
| S18 | https://docs.litellm.ai/docs/tutorials/claude_non_anthropic_models; https://docs.litellm.ai/docs/tutorials/claude_responses_api; https://docs.litellm.ai/docs/anthropic_unified | 2026-11-08 |
| S19 | https://api-docs.deepseek.com/guides/anthropic_api/ | 2026-11-08 |
| S20 | https://platform.kimi.ai/docs/guide/claude-code-kimi | 2026-11-08 |
| S21 | https://docs.z.ai/devpack/tool/claude | 2026-11-08 |
| S22 | https://platform.minimax.io/docs/api-reference/text-anthropic-api; https://platform.minimax.io/docs/m-plan/claude-code | 2026-11-08 |
| S23 | https://help.aliyun.com/zh/model-studio/claude-code; https://www.alibabacloud.com/help/en/model-studio/claude-code | 2026-11-08 |
| S24 | https://learn.chatgpt.com/docs/config-file/config-advanced.md; https://learn.chatgpt.com/docs/config-file/config-reference.md (前 100000 字符) | 2026-11-08 |
| S25 | 维护者本机的 Strata 部署仓库 (私有): `src/frontend.py`, `src/output_limit.py`, `docs/installation-directory-manual.md`, `docs/strata-upstream-issues.md`, `README.md`, `tools/reviewer/claude_headless.py`, `benchmarks/multi-model-v1/plan.md` | 2026-11-08 |
| S26 | 本 effort 的 `research/engine-session-control/report.md` | 2026-11-08 |
| S27 | github.com/ollama/ollama 的 `docs/api/openai-compatibility.mdx` | 2026-11-08 |
