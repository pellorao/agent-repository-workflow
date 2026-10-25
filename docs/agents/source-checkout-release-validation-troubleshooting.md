# 源码签出发布验证故障排查

## Scope

本附录只在源码仓库发布验证出现与下列症状匹配的故障时读取. 它帮助区分候选缺陷, 固定输入漂移和宿主环境限制, 不替代[发布验证](source-checkout-release-validation.md)中的正式结果, 补偿, 集中修复, 审核或候选重跑规则.

先保存 Runner 或 Conformance 返回的原始正式结果, 再完成所有不依赖失败结果的路径. 只有当前可执行路径都完成后, 才按发布验证规则记录和修复候选缺陷. 环境补偿不得改写正式失败, 降低检查强度或进入发布归档.

从 WSL 操作 Windows 宿主的 VMware VM 时, 另外读取[从 WSL 操作 Windows 宿主 VM](cross-platform-vm-wsl-windows-host.md#failure-lookup).

## Failure lookup

| 症状 | 判断 | 处理方法 | 继续条件 |
| --- | --- | --- | --- |
| 隔离候选中的命令报告根 `config.json` 缺失, 但 Source Checkout 中存在该文件 | 根 `config.json` 是被 Git 忽略的操作者配置, 不会随暂存 tree 或 clone 进入隔离候选 | 把 Source Checkout 中本次需要的准确配置字节复制到隔离候选根目录, 比较文件字节或 SHA-256, 并确认它仍被 Git 忽略. 不暂存, 不提交, 不归档该文件 | 隔离候选的受跟踪状态保持干净, 配置字节与 Source Checkout 相同, 且后续命令只在该隔离候选中消费它 |
| 启用本地 Git 地址映射后出现 `remote-url-mismatch`, 或 `git remote get-url --all origin` 显示本地路径 | 使用 `url.*.insteadOf` 一类改写会改变 Git 报告的远端 URL, 从而破坏规范远端身份检查 | 使用只属于验证子进程的传输适配, 把对规范 HTTPS URL 的实际传输交给当前隔离裸 Repository, 同时保持 Repository 中配置的 `origin` 和 Git 查询结果仍是规范 URL. 不写用户或 Repository Git 配置 | `origin` 查询准确返回配置的规范 URL, 实际传输只到本轮隔离 Repository, 子进程结束后映射消失 |
| 宿主检查出现 `EPERM`, 子进程无法启动, 或本地监听 `127.0.0.1` 失败, 但错误与受验行为无关 | 当前 Agent 执行环境限制了子进程或 loopback, 不能据此判断候选失败 | 保留准确失败, 用最小只读诊断确认被限制的是进程启动或 loopback. 随后在允许该能力的环境中原样重跑同一正式命令或测试, 不修改产品代码, 不删除测试, 不改变断言 | 未修改的正式命令在具备所需能力的环境中完成, 或返回可归因于候选的真实失败 |
| 本地目标目录中出现旧 issue, 旧 ARW 状态或与场景前提不同的数据 | 当前提供的源码目录已经包含这些内容, 或不再适合 Registry 场景 | 核对外部来源配置所选目录和相关文件. 若不符合真实场景, 更新本地材料并在新工作区重新准备, 不在 VM 中临时制造缺口 | 新准备的源码与场景前提一致, 同次运行使用同一组新 bundle |
| 候选 fetch 持续较久, 或修复轮次重复准备目标 | 候选取得仍需要 Git, 目标只来自本地目录 | 让正式准备使用配置时限. 同次运行复用已经检查的目标 bundle; 再次准备使用新工作区, 重新复制当前源码 | 准备返回完整成功或准确失败, 不以原目录重建活动输入 |
| Windows 来宾 checkout 缺少深层文件, 后续 `git status` 报脏, 或文本字节因换行转换变化 | 某个新的临时 clone 边界没有把 Windows 长路径和字节保持设置留在 checkout 自身 | 对每个临时 clone 使用 checkout 自身的 Repository 配置 `core.longpaths=true` 和 `core.autocrlf=false`, 并让后续 Git 进程读取同一局部配置. 不修改用户全局配置 | 深层受跟踪路径完整存在, 文本字节与 Git 对象一致, checkout 在后续 Git 进程中保持干净 |
| 真实旧版安装后, Candidate helper 报告历史 checkout 缺少当前内部模块, 或按 Candidate 布局读取旧版失败 | 不同 Release 的内部目录不是跨版本 Interface, Candidate 不能要求历史 Release 具有当前内部布局 | 让每个 Release 自己的 Installer 和载荷验证器验证并安装自己的 tag, commit, 软件包版本和源载荷. Candidate 只在安装后核对公开 manifest, 命令版本, managed file 准确字节, PATH 所有权和状态转换, 不增加跨版本内部兼容层 | 历史 Release 的验证只依赖该 Release 自己发布的入口, 安装后公开状态与同一 Release checkout 准确一致 |

## Classification boundary

如果症状能由固定回归稳定复现为候选代码缺陷, 按发布验证规则把问题和修复方法记录到当前发布准备 issue, 并进入集中修复. 如果只在宿主或 Agent 受限环境中出现, 环境补偿只用于重新执行未修改的正式检查. 如果本地目标数据与 Registry 前提不一致, 这是场景输入变化, 不能通过忽略旧数据或在受验 Repository 中临时改造来宣称通过.
