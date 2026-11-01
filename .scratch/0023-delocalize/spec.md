# 去除本机专属内容

## Context

ARW 仓库只保留对任何下载, 安装或维护 ARW 的人都成立的内容. 本 effort 移除已跟踪文件中只在某一台机器上成立的内容: 含用户名的绝对路径, 只对某个使用者成立的工作方式规则, 以及写死在程序中的某台机器的 Strata 部署参数. `.scratch` 中已有的历史记录不改写. Agent 规则与文档的改动只写在 issue 01 中; 本文件定义 issue 03 的行为合同; 格式基线存档与忽略规则中的本机路径改由 effort 0024 处理.

## Strata provider uses installation-published facts

### Problem

ARW 通过全局 `config.json` 中 `backgroundAgent.providers` 里 `driver: "strata"` 的提供方条目调用本地 Strata 推理服务. 现有实现在程序中写死了三个模型 ID 到 Strata 模型名的映射, 一个上下文窗口, 一个自动压缩阈值, 引擎参数 `spec-min-p` 和采样默认值, 并在每次连接时运行安装目录中的控制脚本, 通过 `/ownership/*` 接口管理服务. 这些数值是某台机器上某个量化的实测结果: 不同机器服务的量化不同, 同一量化在不同机器上的引擎参数和上下文档位也不同, 程序中写死的 `spec-min-p` 已与安装的实测值不一致.

同时, 当前 Strata 安装已改为常驻前端: 控制脚本和 `/ownership/*` 接口已删除, 公开的模型启动请求只接受模型和上下文档位两项, 引擎参数, 采样默认值, 思考预算和输出上限由安装按 "主机 + 量化" 预置, 调用方不能覆盖. 因此现有驱动既写死了本机内容, 也无法与当前 Strata 安装通信.

### Where per-machine configuration lives

ARW 不保存任何 Strata 部署参数. 每台机器的 Strata 配置只放在两个已有位置:

1. ARW 全局 `config.json` 的 `backgroundAgent.providers.<id>`. 原有字段 `driver`, `installationDirectory`, `maxInstances` 及其核对规则不变; Strata 提供方另可设置可选字段 `contextWindow` 选择上下文档位, 见 Model resolution and tier selection 节; 其他字段仍被拒绝. `installationDirectory` 指向本机 Strata 安装目录, 是 ARW 运行环境中可访问的绝对路径 (例如 Strata 作为 Windows 程序安装而 ARW 运行在 WSL 中时, 填 WSL 中的挂载路径).
2. 该安装目录中由 Strata 安装发布的事实, ARW 只读不写:

| 安装文件 (相对 `installationDirectory`) | ARW 读取的内容 | 用途 |
| --- | --- | --- |
| `config/frontend.json` | `listen_address` (非空字符串), `port` (正安全整数) | 控制地址 `http://<listen_address>:<port>`; 模型请求地址为控制地址加 `/strata/v1` |
| `config/deployment.json` | `models`: 本安装对外服务的 Strata 模型名数组; `context_tiers`: 模型名到档位数组的对象, 每档含整数 `context_window` 和 `auto_compact_token_limit`, 且 `0 < auto_compact_token_limit < context_window`; 每个模型的第一档是默认档 | 模型解析与档位选择 |
| `config/prompts/compact-prompt.txt` | 基础压缩提示 | 压缩支持, 组合与绑定规则不变 |

配置中没有 `driver: "strata"` 的提供方时 (安装默认如此), ARW 不读取任何 Strata 安装文件, 不发出 Strata 请求, 共享模型目录与原生任务设置不做 Strata 调整; 只使用其他提供方的机器不受影响. 已配置 Strata 提供方但安装文件缺失或无效时, 在实际使用的阶段 (目录生成, 连接, 启动, 任务准备) 报告具体原因, 不以猜测值继续; 用户修正安装, 或从配置中删除该提供方条目即可恢复.

### Model resolution and tier selection

Reviewer 配置中的 `model` 是 ARW 模型 ID. 它对应的 Strata 模型名, 是 `deployment.json` 的 `models` 中唯一一个满足 "模型 ID 以 `-` 加该名称的小写形式结尾" 的名称. 这条规则来自 Strata 安装手册公布的命名约定 (模型 ID 为模型系列前缀加对外模型名的小写), 因此 ARW 不写死系列前缀, 量化列表或任何模型名, 安装改变服务的模型时 ARW 无需修改.

可选档位就是该安装在 `context_tiers.<模型名>` 中为该模型发布的档位, ARW 程序中不写死任何档位. 安装的档位记录除顺序外只有 `context_window` 能区分各档, Strata 前端的启动请求和 harness 设置也都以这个值表达档位, 所以 Strata 提供方条目的可选字段 `contextWindow` 取所选档的 `context_window` 整数. 设置时, 所选档是 `context_window` 等于该值的那一档; 省略时, 所选档是第一档, 即默认档. 同一模型各档的 `context_window` 互不相同 (前端也只凭这个值选择档位); 安装若发布了相同的值, 取其中第一个相等的档. 安装增删或调整档位时 ARW 无需修改, 已有配置也不会因档位顺序变化而指向另一档. 该字段作用于该提供方解析的每个模型; Strata 安装只对外服务一个模型, 所以不提供按模型分别选择.

`contextWindow` 的取值只在模型解析这一处核对: 解析读取安装发布的档位时, 把配置值与各档 `context_window` 精确比较, 没有相等的档 (包括配置值不是整数) 即为配置错误. 读取 `config.json` 时只确认该字段出现在 `driver: "strata"` 的条目中, 不另外核对取值, 因为只有安装文件才能说明哪些值有效. 解析结果交给启动请求, 共享模型目录和原生任务设置后, 这些消费方不再核对. 使用者修正或删除该字段 (提供方设置在管理进程启动时读取, 修改后重新启动管理进程生效), 或安装重新发布该档位后即可恢复.

失败结果, 每项都在相应阶段以具体错误消息失败, 不发出后续请求:

- `deployment.json` 无法读取或不是 JSON 对象: 报告安装部署配置不可用.
- `models` 中没有或有多个名称匹配: 报告该安装不服务此模型 ID, 消息包含模型 ID.
- 设置了 `contextWindow` 但该模型没有 `context_window` 等于它的档: 报告配置错误, 消息包含字段名 `contextWindow`, 配置值, 模型名和该模型已发布的各档窗口. 不改用默认档, 以免任务在使用者没有选择的窗口下运行.
- 该模型没有档位, 或所选档不满足上述整数约束: 报告档位缺失或无效, 消息包含模型名.

### Frontend protocol

驱动只实现 Strata 前端的公开协议. 管理进程拥有的准入, key 即时保存, 归还时机与容量规则不变; 模型切换只增加下面的新租约启动规则.

| 操作 | 请求 | 成功判定 |
| --- | --- | --- |
| 连接 | 读取 `config/frontend.json`, 不启动任何进程 | 得到控制地址与模型请求地址 |
| 领取 | `POST /lease/acquire`, 正文 `{}`, 不带 key | 返回非空字符串 `key`, 且 `lease` 为 `"held"` |
| 状态 | `GET /model/status`, 带 key | `status` 为 `stopped`, `starting`, `unloaded` 或 `running`; `starting` 按管理进程已有的 `partial` 处理 (模型未完全加载, 切换前须先停止); `running` 时必须有字符串 `model` |
| 启动 | `POST /model/start`, 正文恰好是 `{"model": <解析出的 Strata 模型名>, "context_window": <所选档窗口>}` | 返回 `status` 为 `"running"`, 且 `model` 等于 ARW 模型 ID (见表后说明) |
| 停止 | `POST /model/stop`, 正文 `{}` | 返回 `status` 为 `"stopped"`; `clean_unload` 按现有方式报告 |
| 归还 | `POST /lease/release`, 正文 `{}` | 返回 `lease` 为 `"free"`; Strata 归还合同在成功时撤销 key, 驱动结果中的 `previousKeyRevoked` 仍为 `true` |

`/model/start` 与 `/model/status` 返回的 `model` 是前端的模型 ID, 即安装的模型系列前缀加 `-` 和 Strata 模型名的小写 (与 Model resolution and tier selection 节的命名约定相同), 没有运行中的模型时为 `null`. 经模型请求地址发出的推理请求, 其 `model` 也必须等于这个 ID, 否则前端拒绝. 因此 Reviewer 配置的 ARW 模型 ID 就是前端的模型 ID: 驱动原样返回 `model`, 管理进程直接与 ARW 模型 ID 比较, 不做映射. ARW 模型 ID 的后缀能匹配某个名称但前缀与安装不同时, 解析成功而启动后的确认因 `model` 不等而失败, 按现有方式报告提供方未确认请求的模型. 这一模型 ID 形式同样是外部前提, 出处是 Strata 安装目录根下的调用手册 `README.md` 中模型 ID 的命名与 `GET /model/status` 的说明, ARW 仓库内没有其他来源; 实施时随下文两项前端行为一起写入 `docs/specs/agent-repository-workflow/strata.md` 并注明该出处 (issue 03 第 6 项). 若某个前端返回的 `model` 不是这种形式, 每次启动都在确认步骤失败, 按上述方式报告提供方未确认请求的模型, 管理进程不使用该模型, 不会静默用错模型.

带 key 的请求使用 `Authorization: Bearer <key>`. HTTP 错误, 非 JSON 响应, 控制地址校验和错误消息中 key 的遮盖保持现有行为. 前端未运行时领取请求无法连接, 管理进程按现有合同报告提供方错误, 不持有 key, 不创建原生根线程. 前端以 400 拒绝启动 (例如安装不服务该模型) 时同样报告具体错误, 不把目标模型当作已就绪.

新租约启动规则: 管理进程新领取租约后, 不论状态如何, 总是直接发出一次启动请求, 不先停止, 也不做模型切换的冲突检查, 再按现有方式确认状态. 已持有的租约沿用现有切换规则: 状态已是目标模型 `running` 时不启动; 否则先做冲突检查, `running` 或 `partial` 时先停止, 再启动和确认.

需要这次启动, 是因为前端的公开状态不报告档位, 上一个租约持有者可能留下同一模型的另一档; 若照旧因模型相同而跳过启动, 任务设置会按所选档设置窗口和压缩阈值, 而实际加载的是另一档. 前端的启动请求在已加载模型的完整运行配置 (按校验后的配置比较, 包括部署后改动的安装预置) 与请求相同时直接复用 (返回 `reused: true`), 不同时 (其他模型, 其他档或未完全加载) 自行先停再启动, 所以 ARW 不必先停止, 档位一致时也不重新加载.

这两项前端行为与上文的模型 ID 形式一样是外部前提, 出处是 Strata 安装目录根下的调用手册 `README.md` 中 `POST /model/start` 的说明, ARW 仓库内没有其他来源; 实施时随协议事实一起写入 `docs/specs/agent-repository-workflow/strata.md` 并注明该出处. 设计的正确性不依赖它们成立: 管理进程只在启动请求成功且随后的状态确认显示目标模型 `running` 后才使用模型, 档位由前端按请求的 `context_window` 加载. 若某个前端不自行停止而拒绝启动 (HTTP 错误), 驱动报告前端的错误消息, 管理进程不把目标模型当作已就绪, 不创建原生根线程, 使用者可通过前端停止模型后重试; 若前端不复用而每次重新加载, 只多花加载时间.

不做冲突检查的前提是: 新领取租约时, 该提供方在当前共享 App Server 中没有已加载的工作. 原生根线程只能在持有租约后创建; 上一个租约只在正常关闭共享 App Server 前确认所有运行都不占用名额且没有待启动工作后, 或确认共享 App Server 已退出 (其中的根线程随之结束) 后才归还. 提供方准备 (领取, 状态, 启动) 串行执行, 同一提供方的其他运行此时最多在排队, 要等本次准备完成才使用模型. 因此这次启动即使重新加载也不中断任何工作, 不属于 `docs/specs/agent-repository-workflow/spec.md` 的 Capacity and recovery 节禁止的 "提供方仍被占用或有忙碌工作时切换"; 现有冲突检查却把排队的启动 (`starting`) 也算作冲突, 若在此适用, 同时启动的两个运行中先到者会无故失败. 同一租约存续期间只有 ARW 启动模型, 提供方设置在管理进程存活期间不变, 所以已持有的租约无需重复启动.

### Window and compaction consistency

同一提供方为同一模型解析出的所选档同时决定三处: 启动请求的 `context_window`, 共享模型目录中该模型条目的 `context_window` 与 `max_context_window`, 以及原生任务设置的 `model_context_window` 和 `model_auto_compact_token_limit`. Strata 安装手册要求调用方把 harness 的窗口和自动压缩阈值设为同一档的两个值; 三处取自同一来源, 避免模型实际容量, 目录和压缩预算各自采用不同窗口. 唯一的例外是目录窗口的确定时点, 见本节后文: 省略 `contextWindow` 且安装在共享 App Server 存活期间改变第一档时, 目录窗口可以暂时落后.

共享模型目录生成时, 若配置中有 Strata 提供方, 按配置顺序取第一个. 目录中模型 ID 能按 Model resolution and tier selection 节匹配到该安装所服务模型的条目, 写入该提供方所选档的窗口, 其他字段保留; 其他条目原样合并. 读取安装事实失败, 或匹配到的模型没有所配置的档时, 按现有的目录生成失败处理: 报告具体原因, 不启动 Codex App Server; 这不是提供方设置无效, 不拒绝 Claude 后端运行, Claude 后端也不读取 Strata 安装文件. 限制: 配置多个 Strata 提供方, 且它们服务同一模型 ID 而所选档不同时, 目录只反映第一个; 当前没有多个 Strata 安装的使用者, 不为此增加核对. 启动请求和任务设置始终按任务所用提供方自己的安装取档.

目录中的窗口在共享 App Server 启动前生成时确定, 按现有生命周期在该 App Server 存活期间不重写; 启动请求和任务设置则在每次使用时读取安装. 设置了 `contextWindow` 时三处窗口都等于该配置值, 不会分歧. 省略时, 若安装在 App Server 存活期间改变了第一档, 目录保留旧窗口直到下一次共享 App Server 启动, 启动请求和任务设置已使用新的第一档. 安装改变档位是少见的维护操作, 不为此增加目录重写或核对.

每次为 Strata 分支准备原生任务设置 (新任务和恢复) 时, 按任务所用提供方的 `contextWindow` 和安装当时发布的档位重新解析所选档. 恢复时安装已不再发布所配置的档, 恢复以配置错误失败, 不改用其他档. 压缩提示的读取, 组合, 绑定与恢复规则不变, 只把基础文件改为 `config/prompts/compact-prompt.txt`.

### Rejected alternatives

- 在 `backgroundAgent.providers` 中为每个模型增加映射, 窗口, 阈值, 引擎参数和采样字段: 复制安装已发布的事实, 两处会漂移, 而且当前 Strata 拒绝调用方覆盖引擎参数和采样默认值.
- 只把数值移出程序, 保留模型表: 仍写死某台机器可服务的量化列表.
- 继续支持控制脚本与 `/ownership/*`: 当前 Strata 安装已删除它们, 保留只会留下无人使用的分支.
- 只使用默认档: 使用者无法使用安装已发布的其他档位.
- 在 ARW 中写死可选档位, 或按档位序号选择: 前者把某台机器的实测档位写回程序; 后者在安装调整档位顺序后会让同一配置指向另一档.
- 新租约时按状态中的档位比较, 档位相同才跳过启动: 前端公开状态不报告档位, 而且前端判断 "相同" 按完整运行配置, 只有启动请求本身能确认.
- 新租约时只在提供方没有其他运行时才重新启动: 此时本来就没有已加载的运行, 剩下的只有排队的启动; 为它们改为报错会让并发启动失败, 改为跳过启动又会沿用错误的档.
- 读取 `config.json` 时就对照安装核对 `contextWindow`: 提供方条目内部字段按现有规则只在后台运行时使用时核对, 而有效档位只有读取安装文件才能知道, 提前核对需要在配置读取中再读一次安装.

### Testing

确定性测试在临时目录中构造 Strata 安装文件 (`config/frontend.json`, `config/deployment.json`, `config/prompts/compact-prompt.txt`), 用注入的 `fetchImpl` 记录请求, 用注入的文件读取观察是否访问安装:

- 启动请求的方法, 路径和正文恰好是解析出的模型名与所选档窗口, 不含其他字段; 这防止写死的引擎或采样参数重新出现, 也防止发送前端会拒绝的字段.
- 模型解析的成功, 无匹配, 多匹配, 档位缺失, 档位无效和 `contextWindow` 未发布 (含非整数值) 各给出对应错误, 且失败时不发出启动请求; 同一模型两档窗口相同时选第一档 (返回第一档的阈值).
- 安装发布两档时, 配置 `contextWindow` 为第二档的窗口, 启动正文, 共享模型目录条目和原生任务设置 (新任务和恢复) 都使用第二档的窗口与阈值; 省略该字段时都使用第一档. 这证明三处取自同一所选档, 防止某处仍用默认档或写死的档位. 恢复时安装已不再发布所配置的档, 任务准备以配置错误失败, 不改用其他档.
- 提供方配置接受 Strata 条目中的 `contextWindow`, 拒绝非 Strata 条目设置它, 其他未知字段仍被拒绝; 管理进程把配置的值交给驱动与任务支持.
- 新领取租约时, 状态分别是 `stopped`, `unloaded`, `partial` (驱动对 `starting` 的报告), 目标模型 `running` 和其他模型 `running`, 管理进程都直接发出一次启动请求, 之前没有停止请求; 同一提供方另一运行正在排队启动时也不报切换冲突; 已持有租约且模型相同时不发出启动请求 (已持有租约而模型不同时的现有切换测试保持通过). 这防止沿用上一个持有者留下的其他档位, 也防止并发启动无故失败.
- 连接只读取前端配置, 不启动进程; 前端配置缺失或无效时报告错误; 各操作使用表中的路径, `starting` 报告为 `partial`, 归还要求 `lease: "free"`; 启动被前端以 400 拒绝时驱动报告前端的错误消息, 启动返回的 `model` 与 ARW 模型 ID 不等时驱动报告未确认请求的模型, 领取请求无法连接时驱动以错误失败; 领取失败时管理进程不持有 key, 不创建原生根线程 (现有 manager 测试用注入驱动观察).
- 共享模型目录: 可解析的条目得到所选档窗口, 其他条目字节不变; 没有 Strata 提供方时安装文件读取一次也不发生; 安装部署配置无法读取, 或所配置的档未发布时, 目录生成失败并给出原因.
- 原生任务设置的窗口, 压缩阈值和压缩提示路径取自安装事实.

## Module Design

本节只适用于 Strata 提供方改动 (issue 03).

### Modules

- Strata 提供方程序 (`lib/background-agent/strata-models.mjs`, `strata-driver.mjs`, `strata-work-policy.mjs`): 拥有安装事实的读取与核对, 模型解析, 档位选择和前端协议, 以及既有的压缩支持与工作策略.
- Shared Model Catalog Module (`lib/background-agent/model-catalog.mjs`): 责任不变 (提供方设置核对, 来源合并, 生成文件生命周期); 核对时接受只属于 Strata 条目的 `contextWindow`, 不核对其取值; 用已核对的提供方设置调用 Strata 提供方程序调整目录条目.
- 后台 Agent 管理 Module (`lib/background-agent/manager.mjs`): 责任不变, 把已核对提供方设置中的 `installationDirectory` 和 `contextWindow` 原样交给驱动与任务支持, 不解读档位; 行为只增加 Frontend protocol 节的新租约启动规则.

### Interfaces

- 模型解析 (位于 `strata-models.mjs`, 输入 `installationDirectory`, `modelId`, 可选的 `contextWindow` (提供方配置原值) 和可选的 `readText`): 返回所选档的 `{strataModel, contextWindow, autoCompactTokenLimit}`; 按 Model resolution and tier selection 节的失败结果抛出错误. 每次调用重新读取 `config/deployment.json`, 不缓存.
- `createStrataDriver({installationDirectory, contextWindow?, readText?, fetchImpl?})`: 操作集合与结果形状不变 (`connect` 返回 `{controllerUrl, responsesUrl}`, `acquire` 返回 `{leaseKey}`, `status` 返回 `{status, model}`, `start` 返回 `{status: 'running', model}`, `stop` 返回 `{status: 'stopped', cleanUnload}`, `release` 返回 `{ownership: 'free', previousKeyRevoked: true}`); 删除 `runCommand` 输入.
- `readText(path)`: 以 UTF-8 读取绝对路径 `path` 的文件, 返回 `Promise<string>`, 读取失败时拒绝; 省略时使用文件系统读取. 它只用于 `config/frontend.json` 和 `config/deployment.json` 两个 JSON 文件, 模型解析, 驱动的连接和目录调整函数共用这一形状. 基础压缩提示不经由它: 仍按现有方式从文件系统以字节读取, 组合并按字节的 sha256 绑定 (`docs/specs/agent-repository-workflow/strata.md` 的 Compaction support 节), 只改路径, 避免解码改变字节而使绑定失效.
- `applyStrataCatalogSupport(models, providers, readText?)`: 改为异步. `models` 是合并后的目录条目数组, `providers` 是已核对的 `backgroundAgent.providers` 对象. 没有 Strata 提供方时原样返回 `models`, 不调用 `readText`; 否则由本函数按配置顺序取第一个 Strata 提供方, 读取其安装事实, 对 `slug` 按模型解析的规则恰好匹配一个名称的条目写入所选档窗口, 其他条目原样保留, 返回 `Promise<unknown[]>`. 安装事实读取或核对失败, 或匹配到的模型没有所配置的档时, 以与模型解析相同的错误消息拒绝, 调用方按目录生成失败处理.
- `createStrataTaskSupport({installationDirectory, contextWindow?})` 与 `prepareStrataSettings`: 增加可选的 `contextWindow` 并原样交给模型解析, 窗口与阈值改由模型解析提供.

### Seams and Adapters

保留 HTTP Seam `fetchImpl`. 文件读取 Seam `readText` 取代进程启动 Seam `runCommand`. 生产 Adapter 使用 `fetch` 和文件系统读取, 离线测试通过同一 Interface 注入两个 JSON 安装文件的内容, 请求记录和传输失败; 基础压缩提示由测试在临时安装目录中提供.

### Dependencies and Data Flow

安装的 `config/deployment.json` 经模型解析流向三个消费方: 驱动的启动请求, 共享模型目录条目和原生任务设置. `config/frontend.json` 经驱动连接流向管理进程, 控制地址和 key 仍按现有合同保存. 配置中的提供方设置经 Shared Model Catalog Module 核对后提供 `installationDirectory` 和可选的 `contextWindow`, 后者原样传到模型解析, 只在那里对照安装发布的档位核对. 依赖方向不变: `model-catalog.mjs`, `strata-driver.mjs` 和 `strata-work-policy.mjs` 依赖 `strata-models.mjs`, 不新增反向依赖.

### Module Design Rationale

每项部署事实只有安装这一个来源, 由一个模型解析函数供三个消费方共用, 保证窗口和阈值一致; 档位选择的核对也只在这个函数中进行, 它是配置值与安装事实相遇的唯一位置. 接受每次使用时读取一个小 JSON 文件的成本, 不引入缓存及其失效规则; 读取发生在连接, 启动, 任务准备和目录生成时, 频率很低.

### ADR Evaluation

`docs/adr/0030-use-user-wide-background-agent-management.md` 的决定 (管理进程持有 Strata key, 在私有 SQLite 中保存未确认归还的 key 与控制器地址) 不变, 控制地址只是改为从安装前端配置取得. `docs/adr/0032-run-claude-reviewers-through-headless-claude.md` 中 Strata 只属于 Codex 后端的边界不变. 不需要新 ADR: 本改动是提供方 Adapter 的协议更新和参数来源的调整, 容易撤销, 不改变安全, 授权, 持久化或公开 Interface 边界; 新增的可选配置字段只在安装已发布的值中选择, 不改变已有配置的含义; 选择理由写入 `docs/specs/agent-repository-workflow/strata.md`.

按 ADR 的三项条件 (难以撤销, 无上下文会令人意外, 真实取舍) 分别评估本次三项决定:

- 部署事实的权威从 ARW 程序常量改为运行时读取的 Strata 安装文件: 存在真实取舍 (见 Rejected alternatives 节), 读者也可能问为什么不由 ARW 自己保存这些值; 但它不难撤销: 读取只在 Strata 提供方程序内部; 恢复记录中的运行设置虽带有上次准备时的窗口与阈值, 恢复时按当前配置和安装重新解析并覆盖, 不作为权威, 所以改回其他来源只需修改这一 Adapter, 不迁移持久数据. 理由由长期规范 `strata.md` 保存, 不需要 ADR.
- 恢复时安装已不再发布所配置的档则以配置错误失败, 不改用其他档: 这是让任务只在使用者选择的窗口下运行的直接结果, 改用其他档反而令人意外; 恢复不以记录中的窗口为准, 每次按当前配置和安装重新解析, 没有需要迁移的持久数据, 改变该失败结果只涉及一个分支, 容易撤销. 不需要 ADR.
- 新领取租约后总是启动一次, 不先停止, 不做切换冲突检查: 有真实取舍 (见 Rejected alternatives 节), 不了解前提的读者可能意外; 但它不改变安全或授权边界: key 的领取, 即时保存, 持有与归还, 以及只有持有租约才能创建原生根线程的规则都不变, 省去的冲突检查保护的是已加载的工作, 而新租约时按 Frontend protocol 节所述没有这样的工作. 它只是管理进程中一个分支, 不写入持久状态, 改回 "先停止再启动" 或恢复冲突检查都只需修改该分支, 容易撤销. 前提与理由由长期规范 `docs/specs/agent-repository-workflow/spec.md` 的 Capacity and recovery 节保存, 不需要 ADR.
