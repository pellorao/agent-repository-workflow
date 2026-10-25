# 跨平台 VM 验证

必须在可丢弃的 Windows 11, Alpine 或 Ubuntu 来宾系统中验证 ARW 行为时使用本指南. 当前受维护的自动化可以驱动 VMware Workstation Pro, 但 VMware 和所包含的脚本是实施选择, 不是 ARW 产品要求. 其他受治理环境可以在不使用该适配器的情况下实现相同的来宾系统隔离, 场景顺序, 判断, 证据和回滚责任.

## Scope

本指南负责来宾系统要求, 可选 VMware 适配器, 基线纪律, 远程访问规则, ARW 生命周期矩阵, 证据导出, 回滚检查和平台特定恢复经验. 它不负责产品验收标准或发布. 选择测试矩阵前, 阅读活动 issue 和适用规范.

发起请求的项目负责发送给来宾系统或从来宾系统接收的每个测试脚本, 结果和证据归档. 把这些文件保留在当前 Agent 的 Engine 管理工作区中. 测试后不得在复用的来宾系统中保留项目文件.

## Environment boundary

已跟踪的仓库不得包含本地 VM 显示名称, 快照身份, VMX 路径, 可执行文件路径, 凭据路径, 用户名, 主机密钥, 地址, 端口, 来宾系统工具路径, 工作区路径或补偿驱动程序. 把这些事实保留在发布特定的忽略配置或当前会话工作区中. 已跟踪文档中的示例只使用占位符.

当前发布矩阵具有 3 个已配置的虚拟机键: `Windows 11`, `Ubuntu` 和 `Alpine`. 为每个键提供一个来宾系统. 环境责任方选择本地身份和资源分配, 并在发布归档外记录对环境敏感的事实. 如果测试测量并发, 性能, 存储压力或其他对资源敏感的属性, 不得减少资源.

## Guest requirements

按照以下要求配置每个来宾系统. 当前 JSON 适配器还要求 VMware Workstation Pro, 但其他已授权驱动程序可以提供等效的生命周期隔离.

- 使用 x86-64 来宾系统.
- 使用隔离的出站网络. 不得为了方便而添加桥接网络或通用端口转发.
- 保持所选操作系统要求的平台安全配置. Windows 要求 virtual TPM. 受维护的环境中, Ubuntu 使用 UEFI 和 Secure Boot.
- 接受可复用基线前断开安装介质.
- 安装并验证所选驱动程序要求的虚拟机监控程序集成工具.
- 安装一次 OpenSSH 服务和限定主机范围的验证公钥. 配置完成后要求密钥认证.
- 安装 Git 和最低受支持的 Node.js 24 运行时. 项目可以把平台特定的补充运行时放在自己的可丢弃测试目录中. 不得在来宾系统基线中安装 pnpm, TypeScript, Node.js 类型声明或其他 Source Checkout 开发依赖.
- 在 Linux 来宾系统内使用 UTC. 将硬件时钟保持为 UTC, 并启用来宾系统 NTP. 使用 VMware 时保持 `tools.syncTime = "FALSE"`, 使 VMware 时间同步不与来宾系统服务竞争.
- 禁用无人值守的操作系统和软件包升级. 只有已授权的基线更新期间仍允许明确维护.
- 使用具有管理员或 sudo 能力的普通非 root 测试账户. 不得以 root 身份运行生命周期矩阵.

不得把一个精确的 Node.js 补丁版本视为所有 Linux 基线共享的长期事实. 已跟踪发布配置声明每台虚拟机要求的 Node.js 运行时角色, 发布 VM JSON 提供对应的绝对 `nodeExecutables` 路径. 在运行时使用 `--version` 执行每条已配置路径, 并使用观察结果. Musl 来宾系统的补充运行时必须使用 musl 构建版本. 把带版本的运行时保留在仓库外.

## Secrets and remote access

对这些验证来宾系统使用一个持久且限定主机范围的 SSH 密钥, 使新项目无需重新配置访问权限. 私钥位于每个仓库之外. 基线只包含对应的公钥.

密钥访问生效后, 将 Linux SSH 策略设为等同于:

```text
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
```

固定每个来宾系统主机密钥. DHCP 地址不是身份, 因此客户端支持时使用稳定的 `HostKeyAlias`. 如果主机 `ssh-keyscan` 客户端无法协商来宾系统密钥交换算法, 不得禁用主机密钥检查. 通过已经认证的 VMware 来宾系统操作或来宾系统控制台获取公开主机密钥, 把精确密钥写入当前 Runner 所属主机操作系统本地临时目录中的 known-hosts 文件, 并使用范围狭窄且兼容的 `KexAlgorithms` 和 `HostKeyAlgorithms` 选项.

绝不有意把来宾系统密码, virtual TPM 加密密码, SSH 私钥或认证令牌写入本文档或已跟踪 issue. 可行时通过临时进程环境或标准输入传递单次秘密值. 正式归档要求已注册产品步骤的输出不含凭据, 并排除 VM 生命周期, Adapter, 配置和凭据处理输出. 创建发布归档时不扫描, 遮盖或拒绝已注册产品步骤的标准输出或标准错误. 保留这些实际可用字节, 因为启发式凭据扫描无法证明凭据不存在, 且不得替代发布结果验证. 这是对生产方和输入的合同, 不是内容检查保证.

## Release VM configuration handoff

每个发布流程开始时, 在任何网络或 VM 修改前验证已跟踪的根 `release-validation.json`. 它只负责:

- 当前 ARW 仓库的规范来源.
- 主机命令超时.
- VMware 兼容签名.
- 逐虚拟机的软关机超时.
- 明确的初始化 issue 场景选择.

它没有版本, 因为配置和读取代码绑定到相同 Git 修订版本. Release Validation Registry Module 负责完整的虚拟机要求, 场景, 步骤组, 顺序, 依赖, 合同, 参数, 预期问题和归档清单. 不得接受来自任何来源的调用方覆盖, 不得从配置加载场景或步骤定义, 也不得根据虚拟机, 场景或步骤名称推断已配置选择.

Main Agent 起初不知道任何测试环境位置或凭据. 向用户询问一次该发布外部 VM JSON 的绝对路径. 发布验证维护命令使用它执行虚拟机生命周期, 文件传输, 来宾系统执行, 结果取回, 恢复和清理. 不得复用其他发布的路径或读取授权.

当前封闭的顶层是 `{maxParallelMachines, machines, schemaVersion: 2}`. 必需的 `maxParallelMachines` 只接受 `1`, `2` 或 `3`, 没有默认值. `machines` 精确具有键 `Windows 11`, `Ubuntu` 和 `Alpine`, 与已跟踪配置的虚拟机键匹配, 且没有映射字段. 每台虚拟机分别声明 `machineType: "VMware"`, 主机上 `vmrun` 的绝对路径, 精确的绝对 `.vmx` `location`, 精确的 `snapshot`, 封闭的 `ssh` 对象, 以及 Release Validation Registry 中相应虚拟机记录要求的 `nodeExecutables`. `ssh` 精确具有 `user`, `port`, 主机上 `identityFile` 的绝对路径和原始 OpenSSH `hostKey`. 以用户名为键的 `vmwareEncryptionPassword` 和 `guestPasswords` 是可选的. 空密码字符串表示实际的空密码. 验证开始前拒绝未知字段, 缺失的必需字段, 不匹配的虚拟机键集合, 不等于 2 的版本, 无效并发数, 非绝对路径, 缺失的主机路径或不受支持的虚拟机类型.

外部 VM JSON 可以包含运行所需的每项虚拟机特定事实和凭据. 它的路径, 内容和凭据值不是仓库文档或发布证据. 运行状态只保存原始绝对路径和已经验证的并发数, 不保存 JSON 字节, JSON 哈希, 凭据, 身份文件或原始主机密钥. 恢复操作重新读取该路径中当前有效的模式版本 2 配置. 文件是否在开始后发生变化不属于该工作流责任. 恢复和清理保证只适用于当前调用读取的配置. 不得把 JSON 复制到会话文件, 已跟踪文件, issue, 归档或状态报告中. 不得把 ARW 规范来源或发布策略移入该外部文件. 两个目标源码目录由另一份仓库外 JSON 指定, 不加入 VM JSON. 该来源配置封闭为 `agentAssisted` 和 `plain`, 每项只含绝对 `directory`, 不要求原 Git 历史或固定原提交. 准备前核对文件和目录可读取且位于 Source Checkout 外, 本次准备复制当前内容并建立临时 Git 基线和 bundle; 原目录只读. 真实路径, 外部配置和源码不进入 Git 或发布证据.

## Detailed procedures

执行 VM 验证的相应部分前, 阅读适用流程:

- 对可选命令和 VMware 调用细节, 阅读 [VM Commands](cross-platform-vm-commands.md).
- 对虚拟机生命周期和候选内容来源, 阅读 [VM Lifecycle](cross-platform-vm-lifecycle.md).
- 对真实仓库和 ARW 生命周期矩阵, 阅读 [VM Scenarios](cross-platform-vm-scenarios.md).
- 受维护的自动化失败时, 阅读 [VM Troubleshooting](cross-platform-vm-troubleshooting.md).
- 对操作系统特定行为, 阅读 [VM Platform Lessons](cross-platform-vm-platform-lessons.md).
- 对基线变更, 证据或回滚, 阅读 [VM Maintenance and Evidence](cross-platform-vm-maintenance.md).
