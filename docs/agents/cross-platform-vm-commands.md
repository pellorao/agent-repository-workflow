# 跨平台 VM 命令

## Optional release validation commands

`scripts/release-vm-validation.mjs` 和 `scripts/release-guest-step.mjs` 是操作当前由 JSON 驱动的 VMware 环境的一种受维护方式. 它们不要求未来发布验证使用 VMware 或该命令顺序. 其他驱动程序可以替换虚拟机生命周期和传输机制, 但必须保留适用的发布规范合同.

当 Agent 位于 WSL 并操作 Windows 宿主 VM 时, 阅读 [从 WSL 操作 Windows 宿主 VM](cross-platform-vm-wsl-windows-host.md).

只能从 ARW Source Checkout 使用主机 CLI. 完整运行成功时写入一个有界 JSON 对象, 其中包含状态, 数量和绝对路径. 操作或选项结构无效时打印用法并以 2 退出. 操作错误向标准错误写入一个规范 JSON 诊断信息并以 1 退出. 可以绑定到虚拟机, 来宾系统, 命令, 验证或清理的失败记录在运行结果中, 不会成为操作错误.

| 操作 | 输入 | 输出 | 失败边界 |
| --- | --- | --- | --- |
| `run` | 发布特定的绝对 JSON 路径, 完整候选提交和当前会话工作区 | `paused` 或 `completed`, 分类数量, 排序后的交接路径, 运行路径, 以及完成时的完整结果路径 | 修改 VM 前拒绝无效的配置, 身份, 工作区, Registry, 捆绑包或计划输入. 记录后续可绑定的失败, 并继续独立路径 |
| `resume` | 现有运行路径, 以及状态需要响应时的必要响应路径, 或状态不需要响应时的精确空值 | 与 `run` 相同的有界结果 | 修改状态前拒绝过期, 重复, 不匹配, 跨会话, 格式错误或不适用的响应. 响应为空值时执行已注册的恢复或归档核对 |
| `validate-config` | 发布特定的绝对 JSON 路径 | `status: "valid"`, 必要并发数和封闭的虚拟机键列表 | 来宾系统步骤开始前拒绝未知字段, 缺失虚拟机, 不受支持的版本或虚拟机类型, 无效并发数, 无效绝对路径, 缺失主机输入或无效凭据结构 |
| `prepare-bundles` | 完整候选提交, 当前会话工作区和独立来源 JSON 的绝对路径 | `status: "prepared"`, 候选提交, 两个目标的当次 `targetCommits` 和 Registry 要求的本地捆绑包路径, 同时写入 `bundles.json` | 已跟踪发布配置无效, 候选无法取得, 本地来源无效或无法复制和打包, 或工作区位于当前 Agent 会话外时, 以关闭方式失败 |
| `copy-to-guest` | 配置, 虚拟机键, 当前会话工作区, 一个指定名称的绝对主机路径和一个指定名称的绝对来宾系统路径 | `status: "copied"`, 方向和虚拟机键 | 传输前拒绝缺失, 重复, 多余, 相对, unknown-machine, linked-source, 非文件或工作区外的请求 |
| `copy-from-guest` | 配置, 虚拟机键, 当前会话工作区, 一个指定名称的绝对来宾系统路径和一个指定名称的绝对主机路径 | `status: "copied"`, 方向和虚拟机键 | 传输前拒绝缺失, 重复, 多余, 相对, unknown-machine 或工作区外的请求 |
| `run-step` | 配置, 虚拟机键, 场景 ID, 步骤 ID 和工作区 | `status: "captured"`, 精确身份, `reviewMaterialPath`, `templatePath` 和变更路径事实 | 身份未注册, 虚拟机不匹配, 来宾系统命令或传输失败, 或无法捕获完整 Git 审查资料时, 在判断前失败 |
| `finalize-step` | 配置, 未修改的模板路径和 Main Agent 判断路径 | `status: "finalized"`, 精确身份, `validationPath`, 且只在最终通过的步骤后包含归档结果 | 拒绝已经变化的机械事实, 不完整判断, 路径集合漂移, 意外结果, 基线推进失败或归档不匹配 |

必需的捆绑包准备和正式发布调用是:

```text
node scripts/release-vm-validation.mjs prepare-bundles --candidate <full-commit> --workspace <absolute-session-workspace> --sources <absolute-json-path>
node scripts/release-vm-validation.mjs run --config <absolute-json-path> --candidate <full-commit> --workspace <absolute-session-workspace>
node scripts/release-vm-validation.mjs resume --run <absolute-run-path> [--input <absolute-response-path>]
```

在 `run` 前, 对精确候选内容, 新的工作区和单独提供的来源 JSON 运行一次 `prepare-bundles`, 并使用从 `release-validation.json` 读取的 Main Agent 主机命令超时. 该时限覆盖整个主机命令, 但本身不能判定每次 Git 获取是否完成.

只有 `run` 或上一次 `resume` 返回 `paused`, 或运行状态要求恢复, 归档核对或重试完整结果时, 才再次运行 `resume`. 在 Runner 返回的精确 `responseTemplatePath` 原位编辑每个待处理响应, 然后把同一路径传给 `resume --input`. 复制出的路径无效.

责任划分如下:

- 命令负责封闭的 Scenario Plan, 有界的跨虚拟机调度, 同一虚拟机串行执行, 虚拟机生命周期, 来宾系统执行, 完整 Git 事实捕获, 机械比较, 依赖传播, 基线推进, 清理和归档构建.
- Main Agent 负责候选内容连续性, 每项由 Registry 标记的语义操作和判断, 所有失败分析, 临时补偿决定和 Runner 外部执行, 结果使用以及外部发布授权.

不得在来宾系统中安装或启动 Agent CLI. 当前 Main Agent 通过现有主机会话执行已注册的初始化 issue. `validate-config`, `copy-to-guest`, `copy-from-guest`, `run-step` 和 `finalize-step` 只用于定向诊断和底层维护. 不得使用它们手动重新创建正式运行.

生产复制 Adapter 保持传输方向明确. `copyToGuest` 把主机路径作为 SCP 来源, 来宾系统路径作为目标. `copyFromGuest` 把来宾系统路径作为来源, 主机路径作为目标. 在公开 Interface 中保留 Windows 和 POSIX 来宾系统路径的原始拼写, 且只在平台特定 Adapter 实现中执行引用和路径转换.

## VMware command handling

调用 `vmrun` 时不得丢失进程参数边界. 把可执行文件路径作为进程文件传递, 并把完整 VMX 路径保留为一个独立参数. 在空格处分割 VMX 路径, 可能使 `vmrun` 报告 `Ubuntu` 等目录片段不是虚拟机配置文件.

对 `start`, `listSnapshots`, `revertToSnapshot` 和其他操作使用相同的参数边界. 自动验证优先使用 `nogui`. 除非控制台交互是唯一剩余的恢复路径, 否则不得把 Workstation 窗口移到前台.

Workstation GUI 和 `vmrun` 必须使用兼容的主机权限运行. GUI 占用 VM 时, 如果只读操作或请求的 VMware 操作因授权或资源错误而失败, 使用匹配的主机权限重新运行该精确限定操作. 不得通过编辑锁文件, 终止 `vmware-vmx` 或硬重置来宾系统来响应.

受维护的 Adapter 具有一条范围狭窄的硬停止兼容路径. 其精确 VMware 版本, `vmrun` 版本, 初始电源状态, 进程结果和输出签名只来自 `release-validation.json`. 只有完整配置的签名匹配时才应用变通办法. 已配置的恢复操作必须成功, 且最终状态必须精确为 `powered-off`. 无法识别或部分匹配, 恢复进程失败, 观察失败或任何其他最终状态, 都会以关闭方式失败. 不得把该变通办法用作通用的 VMware 恢复, 重试或非零结果规则.

对于常规发布验证和其他不要求来宾系统关机语义的工作, 优先使用 `hard-power-off`. 只有场景明确要求软关机时才使用 `soft-power-off`. 生产 VMware Adapter 以 `vmrun stop <vmx> soft` 启动该操作, 把可执行文件路径用作进程文件, 并把 VMX 路径保留为一个独立参数. 从 `release-validation.json` 读取每台受支持虚拟机的有界时限. Adapter 在适用时限只终止该主机进程, 然后观察一次电源状态. 测得的时间是维护输入, 不是持久规则, 也不是应该复制到本指南中的值.

有界软关机进程超时且虚拟机仍为 `running` 时, Adapter 立即硬停止每台已配置的 VMware 虚拟机, 并要求最终观察精确为 `powered-off`. 恢复过程不增加人工等待, 也不检查 VMware 或来宾系统操作系统版本.

以下情况都会以关闭方式失败:

- 软关机进程成功后, 虚拟机仍为 `running`.
- 虚拟机处于其他中间状态.
- 观察失败或硬停止失败.
- 最终状态不是 `powered-off`.

观察结果把 `powerOffMode` 记录为 `soft`, `hard-after-timeout` 或 `already-powered-off`, 使调用方不会把硬恢复误认为软关机.

只要求最终关机状态的调用方接受所有已注册的关机模式. 要求软关机的调用方只接受 `soft`, 但如果 Registry 合同允许已配置的 VMware 虚拟机使用 `hard-after-timeout`, 也接受该结果. 该预期不根据虚拟机名称推断 VMware 或来宾系统操作系统版本. Adapter 不推断控制台文本. 如果持久 Linux 状态很重要, 在请求该操作前完成必要写入并运行来宾系统 `sync`.
