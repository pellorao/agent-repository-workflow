# Strata Reviewer 运行规则

## Scope and ownership

本文件是程序运行的治理设计, 不属于 Reviewer 的 Agent 指令. 它只用于实际接入 `driver: "strata"` 的运行分支, 是 Strata 固定参数, 压缩, 工作策略及本地测量时限的单一规则来源. 处理该分支的程序实现, 操作或审核时才读取, 其他提供方不加载这些规则. Reviewer 模型仍使用完整公共 Canonical Role 和 [Reviewer 共同规则](../../agents/reviewer.md), 不把本文件的程序检测, 计数和错误处理细节加入审核提示. 三种量化共用本规则, 不复制模型专属角色或每量化规则.

通用后台运行负责准确原生事实, 消息与持久状态, Reviewer 运行层负责角色限制, 绑定报告交付及[公共任务接续](spec.md#reviewer-task-continuation), 提供方程序负责消费这些事实执行本文件的专用策略. [产品规则](spec.md#background-agent-control)继续拥有容量, 原身份, 独占 key 与最终收尾; [安装规则](../agent-repository-workflow-installation/spec.md#shared-model-catalog)继续拥有共享模型目录的来源和生命周期. 本文件不改变这些通用责任, 不建立新的模型管理 Agent 或消息队列.

## Runtime parameters

Strata 模型 ID `qwen3.8-flash-next-q2_0`, `qwen3.8-flash-next-iq2_xs` 和 `qwen3.8-flash-next-iq3_xxs` 分别映射为 `/ownership/start` 的 `Q2_0`, `IQ2_XS` 和 `IQ3_XXS`. ARW 自动传入 `engine_overrides` 中的 `spec-min-p: 0.7` 和 `max-context: 206584`, 以及 `request_defaults` 中的 `temperature: 0`, `top_p: 1` 和 `top_k: 20`; 未指定的服务参数沿用安装配置. 量化与推理强度由本次任务选择, 不固定为 `medium`, 不增加用户配置字段或额外调用步骤.

共享模型目录生成时只对已通过提供方配置接入 Strata 的三个模型条目把 `context_window` 和 `max_context_window` 固定为 `206584`, 其他字段保留; 其他模型条目原样合并. 不写回原生缓存或用户自定义来源, 同一共享 App Server 存活期间不重写生成目录. 模型目录和原生上下文采用一致容量, 避免不同来源分别采用不同窗口.

## Compaction support

ARW 对已接入的 Strata 模型自动使用 `model_context_window=206584` 和 `model_auto_compact_token_limit=150000`, 与[运行参数](#runtime-parameters)中的模型与目录容量保持一致. 固定支持不增加 `models.custom.json.providers` 中的用户可调字段或新的调用步骤; 其他提供方的模型条目与原生运行设置保持其既有来源. 这些设置为实际模型容量保留固定压缩预算.

Strata 历史压缩使用其实际安装目录中的 `config/compact_prompt.txt` 作为基础. 程序读取基础文件, 若调用方已有摘要提示则只追加一次作为补充, 把组合内容写入原任务绑定的私有临时文件, 通过 Codex 的 `experimental_compact_prompt_file` 使用它. 调用方已指向同一基础文件或提供相同基础内容时不重复拼接. 不复制维护 Codex 特定版本的默认摘要快照, 不以自定义摘要要求替代基础指令, 不把压缩提示加入普通审核提示. 服务自动接入的普通启动指令不在调用方重复添加.

组合文件由运行程序在调用方原任务的 ARW Engine 临时工作区内创建, 保持当前用户私有权限, 不扩大 Reviewer 的报告写入范围. 原任务恢复记录绑定准确文件及内容身份, 续做和恢复使用相同字节, 不因安装基础或调用方补充随后改变而重组该任务. 基础或已有补充不能读取, 组合写入失败, 或恢复时绑定内容不可核实时, 在受影响原生审核继续前报告具体原因; 不静默丢弃基础或补充. 文件在原任务仍可恢复或仍被原生运行使用时保留, 结束后仅按原任务临时工作区已有的管理边界处理, 不增加跨会话自动清理或删除旧工作区的权限. 新审核按当时基础与补充建立自己的绑定.

## Work policy

Strata 的重复命令与专用工具响应故障策略用于普通审核, 能力验证和基准执行, 时间策略按[本地测量时限](#local-measurement-time-limit)的用途边界适用. 提供方程序消费准确根线程, 回合, 命令执行与 Reviewer 交付事实, 沿既有管理进程消息通道自动产生专用指示, 不依赖 Main 或 Reviewer 检测和计数, 不取得审核或报告语义权威. 正常未交付的自动接续, 提前结束累计计数, 阈值暂停及所属 Main 普通消息恢复由[公共任务接续规则](spec.md#reviewer-task-continuation)拥有; 其他提供方不应用 Strata 的重复命令, 专用错误与本地时限策略.

同一任务的准确原线程中, 连续完成的命令在命令正文, 工作目录, 退出码及可取得输出上相同时, 第 3 次完成触发说明重复事实的工作提示, 让模型检查已有结果并调整推进方法, 随后清零计数; 后续重新达到 3 次时再次提示. 不同命令或结果重新开始连续计数, 退出码或输出不可取得时不判定连续相同结果. 同一原生命令项只消费一次, 其他线程或重复读取的事件不推进计数. 工具调用错误由程序沿正常工具结果路径反馈给模型, 让其修正后继续请求, 不因一次错误直接结束审核任务; 只有程序核实确实无法继续时才按真实停止条件处理. 无法确认是否已执行的工具副作用不得自动重放.

Strata 桥以 `[invalid_response] Model returned unknown tool: <name>` 明确拒绝未声明工具响应时, 提供方程序消费原生错误的具体事实, 告知模型该工具被拒且未执行, 要求只使用本次声明的工具并保持原绑定压缩指令, 由公共接续沿原任务继续. 不把这类响应错误当作 shell 执行错误, 不从一般失败, EOF 或连接中断猜测安全重试, 不重放未知副作用. 可恢复报告读取故障由 Reviewer 运行层交付具体诊断, 程序沿同一接续通道反馈. 原任务保护, 累计计量和最终收尾按[公共任务接续规则](spec.md#reviewer-task-continuation)保持.

## Local measurement time limit

经已接入 Strata 驱动运行的本地模型, 只在 Reviewer Capability 验证和基准执行的隔离实例中启用程序时限, 从首次实际审核起按 [通用模型工作计量](spec.md#model-work-time)累计本任务的程序时限, 保留原任务起点与已累计值. 普通审核不启用 55 分钟程序提醒或 60 分钟硬截止, 也不把该规则施加给其他提供方. Reviewer 调用层从既有 `ordinary | isolated` 身份及本地模型绑定交付用途事实, 提供方程序只消费这份绑定, 不自行解释角色业务, 不从提供方名称或用户提示决定模式, 不增加公开用途开关. 提供方程序在累计模型工作时间达到 55 分钟时向准确原线程发送整理当前结果并完成交付的提醒, 达到 60 分钟时终止该审核任务及其关联工作, 不停止其他根线程. 自动提示, 续做和故障恢复沿通用计量保留累计值, 不重置原任务开始时间, 提醒状态或预算. 工作时间需要估算时按通用合同尽量准确估算并标记依据, 时限消费同一累计结果, 不因缺少某次调用的精确结束时间而失去保底. 提醒与截止由后台程序保持, 控制客户端退出或单次等待超时不使其失效; 取消, 硬截止和不可恢复故障优先于任何新的续做. 恢复沿准确原任务的累计模型工作时间继续执行时限, 已耗尽预算时先终止而不再启动模型回合. 这为不限制续做次数的本地测量实例提供固定停止边界, 不以反复新回合重置运行预算.

Reviewer 等待期间的用户沟通由[Reviewer 指引](../../agents/reviewer.md)单独拥有, 普通审核通过该指引取得用户的等待或结束决定, 没有自动硬截止. 本地测量实例的程序时限与用户沟通独立, 选择继续等待不取消其硬截止. `Elapsed` 和机器请求超时仍只承担各自的观察与控制请求责任, 不充当任务停止机制.

## Recovery state

提供方程序只拥有 `agents.provider_work_json` 中 Strata 专用内容的解释; 公共接续, 提前结束计数及暂停通知引用由[公共任务接续规则](spec.md#reviewer-task-continuation)拥有, 通用状态存储共同保存和恢复同一对象. 命令去重位置准确绑定原线程的原生记录位置及命令项身份; 比较摘要只涵盖命令, 工作目录, 退出码和可取得输出, 连续计数为非负整数. 记录当前已消费位置与最后比较摘要, 不保存命令或原始输出的历史列表. 第 3 次触发提示时, 将清零后的计数与对应提示 `messageId` 一起登记为当前任务事实, 恢复不能再次消费已处理事件或替该提示生成新编号. Strata 专用部分另外保存适用的 55 分钟提醒 `messageId` 与可空的已核实停止原因; 消息正文, 接受与分发结果只从同一 `messages` 记录读取, 不在该对象复制. 提醒消息已接受但结果未知时不重复生成提醒, 续做分发未知时核对原生事实而不盲目重发. 当前任务未变时重连与恢复保留这些事实, 新审核任务才清空前一任务的策略内容. 时间策略是否适用从 Reviewer 调用层交付且绑定原任务的可靠用途事实取得: 普通审核不启用, 本地能力验证或基准隔离实例启用. 恢复复用原 `ordinary | isolated` 身份与本地模型绑定, 不从提供方名称或提示文字重新决定用途, 不把普通任务转换成测量实例; 用途无法核实时不推定启用硬截止. 原任务起点只使用 `agents.task_started_at_ms`, 适用的提醒与截止消费 [通用模型工作计量](spec.md#model-work-time)的同一累计值; 停机与休眠观察, 估算依据及累计 token 基线仍由绑定的 Reviewer 计量记录拥有, 提供方对象不另存开始时间, 截止时间, 独立工作计量或用量基线.

该对象与 Agent 当前状态, 消息引用共同按既有批量保存边界提交, 不另建表, 文件或状态权威. 未保存或无法核对的去重位置, 消息分发与停止事实保留未知及恢复限制, 不以默认值宣称指示尚未发出或任务已完成. 这样同一任务跨连接和故障恢复仍能保留连续计数, 提醒与续做责任, 同时避免累计保存全部原生事件.

## Module Design

### Modules

提供方程序按 [Scope and ownership](#scope-and-ownership)拥有 Strata 运行支持与机械工作策略, 不拥有审核语义, 报告或评分. 通用后台运行与 Reviewer 运行层保留[产品模块设计](spec.md#modules)中的责任; 本文件只细化提供方程序如何消费它们的事实与能力.

### Interfaces

提供方程序消费 [Work policy](#work-policy) 定义的准确线程, 回合, 命令完成, 用途与交付事实, 通过既有消息和原生控制交付工作指示, 或按已核实停止条件结束原任务. 专用工具响应错误的识别与反馈由该章节拥有, 公共续做与暂停恢复按[公共任务接续规则](spec.md#reviewer-task-continuation)处理, 不增加公开操作或参数. 摘要文件的绑定及读取, 写入和恢复失败由 [Compaction support](#compaction-support) 拥有; 时限用途与累计工作时间交接由 [Local measurement time limit](#local-measurement-time-limit) 拥有.

### Seams and Adapters

复用[产品原生会话与 Strata 控制边界](spec.md#seams-and-adapters). 生产与离线 Adapter 沿相同操作和结果合同交付事实, 提供方策略保持相同责任, 不另建模型代理, 会话控制或消息队列.

### Dependencies and Data Flow

通用原生事实及 Reviewer 的用途和交付事实流向提供方程序, 产生的指示沿通用消息与原线程控制返回. 工作时间只消费[产品计量](spec.md#model-work-time), 最终任务交付沿[公共任务接续规则](spec.md#reviewer-task-continuation)的收尾边界完成. 以下仅索引本文自有规则及原任务状态来源, 通用运行权威仍由[产品权威表](spec.md#dependencies-and-data-flow)拥有.

| 本文范围 | 权威来源 | 消费与完成边界 |
| --- | --- | --- |
| Strata 运行支持与工作策略 | [Runtime parameters](#runtime-parameters), [Compaction support](#compaction-support), [Work policy](#work-policy) 与 [Local measurement time limit](#local-measurement-time-limit) | 提供方程序沿原任务执行, 不解释报告结论 |
| 本任务摘要内容 | [Compaction support](#compaction-support) 中的安装基础, 原任务组合文件及恢复绑定 | 原任务按绑定字节继续, 新任务建立自己的绑定 |
| 当前策略内容与自动消息引用 | [Recovery state](#recovery-state) | 提供方程序解释专用内容, 公共接续部分按产品规则解释, 通用状态存储按既有 Agent 与消息批量提交边界保存; 恢复保留原任务事实 |

### Module Design Rationale

机械策略由提供方程序执行, 可以沿准确事实推进任务, 避免依赖模型检测停滞或 Main Agent 在线转发; 审核语义仍由 Reviewer 负责. 公共续做及用户暂停决定的资源取舍由[产品规则](spec.md#reviewer-task-continuation)拥有; 隔离的本地测量实例另有固定工作预算. 通用控制与状态责任的取舍沿用[产品设计理由](spec.md#module-design-rationale). 本任务摘要按组合字节绑定而不在恢复时重新读取安装来源, 可以保持同一任务的指令一致, 接受保留组合文件的成本. 策略只保存当前比较摘要, 计数与既有消息引用, 可以保留去重和恢复依据, 避免新增完整事件历史或另一状态权威; 接受未保存事实仍有恢复限制.

### ADR Evaluation

[ADR 0016](../../adr/0016-use-repository-owned-agent-projection-configs.md#decision)拥有完整角色和独立 Reviewer 责任, [ADR 0030](../../adr/0030-use-user-wide-background-agent-management.md)拥有共享后台控制与持久状态选择. 本策略沿用这些边界及原任务恢复和计量权威, 不增加管理参与者, 公开控制入口或独立状态来源, 不另立架构决定.
