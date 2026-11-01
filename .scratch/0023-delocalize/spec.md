# 去除本机专属内容

## Context

ARW 仓库只保留对任何下载, 安装或维护 ARW 的人都成立的内容. 本 effort 移除已跟踪文件中只在某一台机器上成立的内容: 含用户名的绝对路径, 只对某个使用者成立的工作方式规则, 以及写死在程序中的某台机器的 Strata 部署参数. `.scratch` 中已有的历史记录不改写. Agent 规则与文档的改动只写在 issue 01 中; 本文件定义 issue 02 和 issue 03 的行为合同.

## Portable format baseline archive

Reviewer 能力测试的格式基线存档 (`tests/fixtures/reviewer-capability/format-baseline/archive/**`) 中, 每份修复记录 `*.changes.json` 的 `original` 字段, 以及其中 3 份记录的 `normalized` 字段, 保存了生成记录时某台机器上的绝对路径. 这些路径对其他检出没有意义, 还暴露了用户名.

这两个字段不参与任何校验. `node scripts/reviewer-capability.mjs baseline <unit>` (内部为 `verifyArchive`) 只核对报告与修复记录的 SHA-256, 修复记录的 `original_sha256`, 按 `spills[].path` 文件名定位的溢出文件, 以及可修复处数; 存档回放测试只比较修复结果的 `changes` 与 `details`. 但修复记录的完整字节由 `registry.json` 中对应报告条目的 `changesSha256` 登记, 所以改写字段必须同步更新登记值, 否则 `baseline` 以 "Archived repair record ... differs from its registration" 失败.

要求的结果:

- `original` 改为该报告在存档中的相对路径, 即 `registry.json` 中同一报告条目的 `report` 值, 例如 `code-standards-v5.1/haiku-1/review-result.md`.
- `normalized` 改为 `<report 所在目录>/repair/<报告文件名>`, 表示生成时修复副本相对存档的位置. 该副本不在存档中, 字段只作说明, 没有读取方.
- 修复记录的其他字段字节不变, 文件保持原写出格式 (`JSON.stringify(record, null, 1)` 加结尾换行).
- `registry.json` 只更新受影响条目的 `changesSha256`, 其他字节不变.

可观察结果: 四个格式基线单元 (`code-spec`, `code-standards`, `commit-audit`, `spec-readiness`) 的 `baseline` 命令仍返回 `succeeded`, 输出与改动前相同; 存档回放测试照常通过; 格式基线目录中不再有绝对路径. 这防止为去除路径而意外改变计分依据: 报告字节, `original_sha256`, `changes` 与 `details` 都保持不变.

仓库忽略规则只列对任何检出都成立的条目. 状态页目录 `.status/` 属于某个使用者的个人工具, ARW 不产生它, 所以 `.gitignore` 删除该条目及其注释.

## Strata provider uses installation-published facts

### Problem

ARW 通过全局 `config.json` 中 `backgroundAgent.providers` 里 `driver: "strata"` 的提供方条目调用本地 Strata 推理服务. 现有实现在程序中写死了三个模型 ID 到 Strata 模型名的映射, 一个上下文窗口, 一个自动压缩阈值, 引擎参数 `spec-min-p` 和采样默认值, 并在每次连接时运行安装目录中的控制脚本, 通过 `/ownership/*` 接口管理服务. 这些数值是某台机器上某个量化的实测结果: 不同机器服务的量化不同, 同一量化在不同机器上的引擎参数和上下文档位也不同, 程序中写死的 `spec-min-p` 已与安装的实测值不一致.

同时, 当前 Strata 安装已改为常驻前端: 控制脚本和 `/ownership/*` 接口已删除, 公开的模型启动请求只接受模型和上下文档位两项, 引擎参数, 采样默认值, 思考预算和输出上限由安装按 "主机 + 量化" 预置, 调用方不能覆盖. 因此现有驱动既写死了本机内容, 也无法与当前 Strata 安装通信.

### Where per-machine configuration lives

ARW 不保存任何 Strata 部署参数. 每台机器的 Strata 配置只放在两个已有位置:

1. ARW 全局 `config.json` 的 `backgroundAgent.providers.<id>`. 字段仍只有 `driver`, `installationDirectory` 和 `maxInstances`, 不增加字段, 核对规则不变. `installationDirectory` 指向本机 Strata 安装目录, 是 ARW 运行环境中可访问的绝对路径 (例如 Strata 作为 Windows 程序安装而 ARW 运行在 WSL 中时, 填 WSL 中的挂载路径).
2. 该安装目录中由 Strata 安装发布的事实, ARW 只读不写:

| 安装文件 (相对 `installationDirectory`) | ARW 读取的内容 | 用途 |
| --- | --- | --- |
| `config/frontend.json` | `listen_address` (非空字符串), `port` (正安全整数) | 控制地址 `http://<listen_address>:<port>`; 模型请求地址为控制地址加 `/strata/v1` |
| `config/deployment.json` | `models`: 本安装对外服务的 Strata 模型名数组; `context_tiers`: 模型名到档位数组的对象, 每档含整数 `context_window` 和 `auto_compact_token_limit`, 且 `0 < auto_compact_token_limit < context_window`; 每个模型的第一档是默认档 | 模型解析与默认档 |
| `config/prompts/compact-prompt.txt` | 基础压缩提示 | 压缩支持, 组合与绑定规则不变 |

配置中没有 `driver: "strata"` 的提供方时 (安装默认如此), ARW 不读取任何 Strata 安装文件, 不发出 Strata 请求, 共享模型目录与原生任务设置不做 Strata 调整; 只使用其他提供方的机器不受影响. 已配置 Strata 提供方但安装文件缺失或无效时, 在实际使用的阶段 (目录生成, 连接, 启动, 任务准备) 报告具体原因, 不以猜测值继续; 用户修正安装, 或从配置中删除该提供方条目即可恢复.

### Model resolution and default tier

Reviewer 配置中的 `model` 是 ARW 模型 ID. 它对应的 Strata 模型名, 是 `deployment.json` 的 `models` 中唯一一个满足 "模型 ID 以 `-` 加该名称的小写形式结尾" 的名称. 这条规则来自 Strata 安装手册公布的命名约定 (模型 ID 为模型系列前缀加对外模型名的小写), 因此 ARW 不写死系列前缀, 量化列表或任何模型名, 安装改变服务的模型时 ARW 无需修改.

该模型的默认档是 `context_tiers.<模型名>` 的第一项. ARW 只使用默认档, 不提供档位选择: 当前没有使用者需要非默认档, 需要时再增加选择字段.

失败结果, 每项都在相应阶段以具体错误消息失败, 不发出后续请求:

- `deployment.json` 无法读取或不是 JSON 对象: 报告安装部署配置不可用.
- `models` 中没有或有多个名称匹配: 报告该安装不服务此模型 ID, 消息包含模型 ID.
- 该模型没有档位, 或第一档不满足上述整数约束: 报告档位缺失或无效, 消息包含模型名.

### Frontend protocol

驱动只实现 Strata 前端的公开协议. 管理进程拥有的准入, key 即时保存, 模型切换, 归还时机与容量规则不变.

| 操作 | 请求 | 成功判定 |
| --- | --- | --- |
| 连接 | 读取 `config/frontend.json`, 不启动任何进程 | 得到控制地址与模型请求地址 |
| 领取 | `POST /lease/acquire`, 正文 `{}`, 不带 key | 返回非空字符串 `key`, 且 `lease` 为 `"held"` |
| 状态 | `GET /model/status`, 带 key | `status` 为 `stopped`, `starting`, `unloaded` 或 `running`; `starting` 按管理进程已有的 `partial` 处理 (模型未完全加载, 切换前须先停止); `running` 时必须有字符串 `model` |
| 启动 | `POST /model/start`, 正文恰好是 `{"model": <解析出的 Strata 模型名>, "context_window": <默认档窗口>}` | 返回 `status` 为 `"running"`, 且 `model` 等于请求的模型 ID |
| 停止 | `POST /model/stop`, 正文 `{}` | 返回 `status` 为 `"stopped"`; `clean_unload` 按现有方式报告 |
| 归还 | `POST /lease/release`, 正文 `{}` | 返回 `lease` 为 `"free"`; Strata 归还合同在成功时撤销 key, 驱动结果中的 `previousKeyRevoked` 仍为 `true` |

带 key 的请求使用 `Authorization: Bearer <key>`. HTTP 错误, 非 JSON 响应, 控制地址校验和错误消息中 key 的遮盖保持现有行为. 前端未运行时领取请求无法连接, 管理进程按现有合同报告提供方错误, 不持有 key, 不创建原生根线程. 前端以 400 拒绝启动 (例如安装不服务该模型) 时同样报告具体错误, 不把目标模型当作已就绪.

### Window and compaction consistency

同一模型的默认档同时决定三处: 启动请求的 `context_window`, 共享模型目录中该模型条目的 `context_window` 与 `max_context_window`, 以及原生任务设置的 `model_context_window` 和 `model_auto_compact_token_limit`. Strata 安装手册要求调用方把 harness 的窗口和自动压缩阈值设为同一档的两个值; 三处取自同一来源, 避免模型实际容量, 目录和压缩预算各自采用不同窗口.

共享模型目录生成时, 若配置中有 Strata 提供方, 按配置顺序取第一个. 目录中模型 ID 能按 Model resolution and default tier 节解析为该安装所服务模型的条目, 写入其默认档窗口, 其他字段保留; 其他条目原样合并. 读取安装事实失败时目录生成失败并报告具体原因, 不启动 App Server, 与提供方设置无效时的现有结果一致. 限制: 配置多个 Strata 提供方, 且它们服务同一模型 ID 而默认档不同时, 目录只反映第一个; 当前没有多个 Strata 安装的使用者, 不为此增加核对. 启动请求和任务设置始终按任务所用提供方自己的安装取档.

每次为 Strata 分支准备原生任务设置 (新任务和恢复) 时, 读取该模型当时的默认档. 压缩提示的读取, 组合, 绑定与恢复规则不变, 只把基础文件改为 `config/prompts/compact-prompt.txt`.

### Rejected alternatives

- 在 `backgroundAgent.providers` 中为每个模型增加映射, 窗口, 阈值, 引擎参数和采样字段: 复制安装已发布的事实, 两处会漂移, 而且当前 Strata 拒绝调用方覆盖引擎参数和采样默认值.
- 只把数值移出程序, 保留模型表: 仍写死某台机器可服务的量化列表.
- 继续支持控制脚本与 `/ownership/*`: 当前 Strata 安装已删除它们, 保留只会留下无人使用的分支.
- 增加档位选择字段: 没有当前需求.

### Testing

确定性测试在临时目录中构造 Strata 安装文件 (`config/frontend.json`, `config/deployment.json`, `config/prompts/compact-prompt.txt`), 用注入的 `fetchImpl` 记录请求, 用注入的文件读取观察是否访问安装:

- 启动请求的方法, 路径和正文恰好是解析出的模型名与默认档窗口, 不含其他字段; 这防止写死的引擎或采样参数重新出现, 也防止发送前端会拒绝的字段.
- 模型解析的成功, 无匹配, 多匹配, 档位缺失和档位无效各给出对应错误, 且失败时不发出启动请求.
- 连接只读取前端配置, 不启动进程; 前端配置缺失或无效时报告错误; 各操作使用表中的路径, `starting` 报告为 `partial`, 归还要求 `lease: "free"`.
- 共享模型目录: 可解析的条目得到默认档窗口, 其他条目字节不变; 没有 Strata 提供方时安装文件读取一次也不发生; 安装部署配置无法读取时目录生成失败并给出原因.
- 原生任务设置的窗口, 压缩阈值和压缩提示路径取自安装事实.

## Module Design

本节只适用于 Strata 提供方改动 (issue 03). 格式基线存档与忽略规则的改动不修改非测试运行时代码.

### Modules

- Strata 提供方程序 (`lib/background-agent/strata-models.mjs`, `strata-driver.mjs`, `strata-work-policy.mjs`): 拥有安装事实的读取与核对, 模型解析, 默认档选择和前端协议, 以及既有的压缩支持与工作策略.
- Shared Model Catalog Module (`lib/background-agent/model-catalog.mjs`): 责任不变 (提供方设置核对, 来源合并, 生成文件生命周期), 用已核对的提供方设置调用 Strata 提供方程序调整目录条目.
- 后台 Agent 管理 Module (`lib/background-agent/manager.mjs`): 责任和行为不变, 仍只把 `installationDirectory` 交给驱动.

### Interfaces

- 模型解析 (位于 `strata-models.mjs`, 输入 `installationDirectory`, `modelId` 和可选的文件读取函数): 返回 `{strataModel, contextWindow, autoCompactTokenLimit}`; 按 Model resolution and default tier 节的失败结果抛出错误. 每次调用重新读取 `config/deployment.json`, 不缓存.
- `createStrataDriver({installationDirectory, readText?, fetchImpl?})`: 操作集合与结果形状不变 (`connect` 返回 `{controllerUrl, responsesUrl}`, `acquire` 返回 `{leaseKey}`, `status` 返回 `{status, model}`, `start` 返回 `{status: 'running', model}`, `stop` 返回 `{status: 'stopped', cleanUnload}`, `release` 返回 `{ownership: 'free', previousKeyRevoked: true}`); 删除 `runCommand` 输入.
- 目录调整函数 (`applyStrataCatalogSupport`): 改为异步, 输入已核对的提供方设置, 按 Window and compaction consistency 节调整条目.
- `createStrataTaskSupport({installationDirectory})` 与 `prepareStrataSettings`: 输入不变, 窗口与阈值改由模型解析提供.

### Seams and Adapters

保留 HTTP Seam `fetchImpl`. 文件读取 Seam `readText` 取代进程启动 Seam `runCommand`. 生产 Adapter 使用 `fetch` 和文件系统读取, 离线测试通过同一 Interface 注入安装文件内容, 请求记录和传输失败.

### Dependencies and Data Flow

安装的 `config/deployment.json` 经模型解析流向三个消费方: 驱动的启动请求, 共享模型目录条目和原生任务设置. `config/frontend.json` 经驱动连接流向管理进程, 控制地址和 key 仍按现有合同保存. 配置中的提供方设置经 Shared Model Catalog Module 核对后提供 `installationDirectory`. 依赖方向不变: `model-catalog.mjs`, `strata-driver.mjs` 和 `strata-work-policy.mjs` 依赖 `strata-models.mjs`, 不新增反向依赖.

### Module Design Rationale

每项部署事实只有安装这一个来源, 由一个模型解析函数供三个消费方共用, 保证窗口和阈值一致. 接受每次使用时读取一个小 JSON 文件的成本, 不引入缓存及其失效规则; 读取发生在连接, 启动, 任务准备和目录生成时, 频率很低.

### ADR Evaluation

`docs/adr/0030-use-user-wide-background-agent-management.md` 的决定 (管理进程持有 Strata key, 在私有 SQLite 中保存未确认归还的 key 与控制器地址) 不变, 控制地址只是改为从安装前端配置取得. `docs/adr/0032-run-claude-reviewers-through-headless-claude.md` 中 Strata 只属于 Codex 后端的边界不变. 不需要新 ADR: 本改动是提供方 Adapter 的协议更新和参数来源的调整, 容易撤销, 不改变安全, 授权, 持久化或公开 Interface 边界; 选择理由写入 `docs/specs/agent-repository-workflow/strata.md`.
