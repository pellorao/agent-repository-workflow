# Codex Reviewer 不读取用户记忆

## Problem Statement

ARW 启动的后台 Agent 要用来评估分发给其他用户后的效果. 维护者本机的用户级规则和配置不会随分发带给用户, 如果 Reviewer 带入了它们, 审核结论就依赖维护者本机的状态, 无法代表分发后的效果.

Claude 后端的 Reviewer 已按长期规范以隔离设置运行 (不加载用户和项目设置), 不在本规范范围. Codex 后端的 Reviewer 没有对应处理. 维护者的 Codex 配置开启记忆功能时 (这是 Codex 当前的默认状态), Codex Reviewer 的根线程会带入维护者跨会话积累的个人记忆, 与上述要求冲突.

## Solution

Codex Reviewer 的根线程在原生配置中关闭 Codex 记忆功能, 其他后台 Agent 角色仍按用户的 Codex 配置运行. 这样 Reviewer 看到的只有分发后用户也会有的输入: 受审仓库, 随分发安装的规则和 Reviewer 请求. 其他角色保持平台原生的工作方式: 各平台在公共功能之外使用自己的设置, 不为与另一平台一致而模仿其机制, 普通后台 Agent 本来就应遵循用户自己的配置.

Claude 后端没有变化.

## User Stories

1. 作为维护者, 我希望 Codex Reviewer 不带入我本机的 Codex 记忆, 以便 Reviewer 评分反映分发后用户得到的效果.
2. 作为维护者, 我希望非 Reviewer 的后台 Agent 仍使用我自己的 Codex 配置, 以便日常开发保留我积累的偏好.
3. 作为维护者, 我希望调用方传入的配置不能重新打开 Reviewer 的记忆, 以便隔离不因某次调用的配置而失效.
4. 作为维护者, 我希望 Claude Reviewer 的行为保持不变, 以便本改动不影响已有的隔离设置.

## Implementation Decisions

Reviewer 专属层在为 Reviewer 根线程组装原生配置时, 已经强制关闭 Agent 协作 (`agents.enabled`, `features.multi_agent`, `features.multi_agent_v2`). 本规范在同一处增加 `features.memories = false`, 与这些设置遵循同一合同: 只作用于 Reviewer 根线程, 调用方配置不能覆盖, 包括调用方把 `features` 作为嵌套对象传入的写法, 此时嵌套对象中的 `memories` 同样被强制为 `false`, 其余键保持原样.

这个配置同时随新建线程和恢复线程的请求交给 App Server, 因为两者由同一个线程参数组装. 变更前已经创建的 Reviewer 线程不在本规范范围: 同一审核身份的后续审核按既有规则复用可靠原线程, 不为本改动静默改投或替换, 它在变更前已带入的上下文也不因恢复而清除. 所以部署后, 记忆隔离对部署后新建的 Reviewer 线程成立, 对部署前创建的线程只由 ARW 携带该配置, 不作结果保证. 接受这一限制的理由: 强制替换旧线程会违反原线程复用规则并丢失审核链的上下文, 而收益只限部署时刻已存在的有限几条线程, 部署后新建的线程不受影响; 旧线程的残留不会随时间扩大. 维护者要立即隔离某条旧线程时, 可按既有规则 (使用者明确要求) 让它新建替代线程. 接受的成本是这些旧线程在被替代前仍可能带有维护者记忆.

选择线程级配置而不是 App Server 进程级开关, 理由是 Codex 后端的所有角色共用一个 App Server 进程: 进程级关闭会连带关闭非 Reviewer 角色的记忆, 违背 "非 Reviewer 保持原生工作方式". 单独为 Reviewer 使用另一个 Codex 主目录会丢失登录状态并增加第二个服务进程, 同样被放弃. 线程配置是自由格式的覆盖映射, ARW 已用它承载 Reviewer 的权限和 Agent 协作设置, 因此这里不新增机制.

交接顺序如下: Reviewer 调用方交付角色设置 -> Reviewer 专属层补入强制配置 -> 原生会话把配置随线程创建或恢复请求交给 App Server -> Codex 为该线程使用关闭记忆的有效配置. 记忆功能关闭后, 预期该线程的会话也不进入维护者的记忆积累; 这取决于 Codex 记忆功能自身的行为, ARW 不做额外处理.

不新增错误路径: 配置键由 Codex 自己解释, ARW 不探测 Codex 版本是否识别它, 也不核对生效情况, 与现有强制设置一致.

Claude 后端不读取这个配置, 它的 Reviewer 隔离方式不变.

长期规范的修改限于 Reviewer runtime 节的强制配置说明, 改为: Reviewer 专属层只在 Reviewer 根线程的原生配置中强制 `agents.enabled = false`, `features.multi_agent = false` 和 `features.multi_agent_v2 = false`, 配合完整 Reviewer 规则禁止 Agent 协作, 并强制 `features.memories = false`, 使 Reviewer 不带入维护者本机的 Codex 记忆, 审核只依赖分发后用户同样拥有的输入; 这些强制配置都不放到共享 App Server 的全局配置或其他后台根线程. 该节其余文字不变. Isolation and measurement 节不修改: 它所说的 "独立工作目录不等于配置, 记忆, MCP 或其他持久状态隔离" 只陈述工作目录本身不提供这些隔离, 与本改动不冲突. 面向 Agent 的 Reviewer 规则只描述单 Agent 执行, 不涉及记忆, 本规范不修改它.

ADR 评估: 不需要新 ADR. 本选择容易撤销 (删除一个配置项即可恢复), 只沿用 ARW 已有的 "Reviewer 专属强制配置, 非 Reviewer 保持原生工作方式" 边界 (见 `docs/adr/0033-run-each-claude-turn-as-a-stream-json-process.md` 对平台原生工作方式的决定), 不引入新的架构边界, 持久状态或恢复合同; 被放弃的进程级开关和独立主目录已在上文记录理由.

## Module Design

Not required: Reviewer 专属层本来就拥有 Reviewer 根线程原生配置的强制设置, 并保证调用方配置不能覆盖; 本规范只让同一保证多覆盖一个配置键. 它不新增责任 (记忆隔离与已有的 Agent 协作隔离同属 Reviewer 根线程的原生配置), 其输入输出形状, 调用方, 错误行为和字段含义都不变, 依赖方向, 权威来源 (调用方交付的角色设置加该层的强制设置) 和数据流 (经原生会话交给 App Server) 也不变, 没有新增 Seam.

## Testing Decisions

测试边界是 Reviewer 专属层产生的原生配置, 它是 Reviewer 根线程配置的唯一来源; 观察结果是交给原生会话的配置内容, 不启动真实 Codex.

- 以没有任何记忆设置的调用方配置为输入, 观察 Reviewer 配置中记忆被关闭. 这防止新增项被遗漏.
- 以把记忆显式打开的调用方配置 (点号键写法和 `features` 嵌套对象写法各一) 为输入, 观察结果仍关闭记忆且嵌套对象中的其他键保留. 这防止调用方配置重新打开记忆, 或强制设置抹掉无关键.
- 在共享 App Server 的原生会话测试中观察非 Reviewer 角色的线程配置不含记忆设置. 这防止隔离泄漏到其他角色, 是 "其他角色不变" 的唯一证据. 同一测试已经对 Agent 协作设置做同样的观察.

这些观察不证明 Codex 实际遵守该配置键; 那需要一次真实的 Codex Reviewer 运行, 由 Main Agent 在实施后另行核对, 不属于确定性测试.

## Out of Scope

- Codex 用户级配置的其他部分 (用户级指令文件, 技能, MCP, 钩子, 插件) 对 Reviewer 的影响.
- 非 Reviewer 角色, App Server 的启动参数和共享模型目录.
- Claude 后端.
- 面向 Agent 的 Reviewer 规则文本.

## Further Notes

本改动不修改 Reviewer 规则文本, 只改变 Codex Reviewer 的运行时上下文; 是否需要按仓库规则做 Reviewer 能力对比, 由 Main Agent 判断.
