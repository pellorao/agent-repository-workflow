# 从 WSL 操作 Windows 宿主 VM

当 Agent 位于 WSL 并操作 Windows 宿主上的 VMware VM 时, 使用以下连接路径:

```text
WSL Agent -> Windows Node.js 运行器 -> Windows OpenSSH / vmrun -> VM
```

这是从 WSL 发起这种操作时唯一支持的连接方式.

从 WSL 中的源码签出工作目录直接启动 Windows `node.exe`, 并让 Windows Node.js 运行器启动 Windows OpenSSH 和 `vmrun`. 可以用 `powershell.exe -NoProfile -NonInteractive -Command "(Get-Command node).Source"` 只读取得 Windows 可执行文件路径, 再把该路径转换为 WSL 可直接执行的 `/mnt/<drive>/.../node.exe`. 不把 PowerShell 作为运行器的父进程后再切换到 WSL UNC 工作目录, 因为该 PowerShell 进程可能无法解析 WSL 为直接启动的 Windows 程序提供的同一 UNC 路径. 运行器, OpenSSH 和 `vmrun` 必须属于同一个 Windows 操作系统, 使它们共享 Windows 路径语义和本地临时目录. WSL Node.js 进程不直接运行发布验证维护命令.

启动 Windows Node.js 运行器时, 把当前 `CODEX_THREAD_ID` 加入该进程的 `WSLENV`, 并保留 `WSLENV` 中已经存在的条目. 该值只用于解析当前 Agent 会话工作区, 不写入仓库或运行证据. 无法把当前会话身份传给 Windows 进程时停止, 不猜测身份或工作区.

同一轮的 `prepare-bundles`, `run` 和 `resume` 都使用 Windows Node.js 运行器和同一个 Windows UNC 工作区. 传给 `--config` 的 VM JSON, 传给 `--sources` 的独立来源 JSON 及其中由 Windows 程序消费的路径使用 Windows 本地绝对路径, `--workspace` 使用当前 WSL 源码签出的 Windows UNC 路径. `prepare-bundles` 因此把 Windows UNC 路径写入 `bundles.json`, 后续 `run` 可以逐字验证相同路径. 不得用 WSL Node.js 准备捆绑包后再用 Windows Node.js 运行验证. 两个目标从 Windows 可读取的仓库外源码目录准备, 不使用原远端或固定原提交. 同次运行复用已准备 bundle; 再次准备在新工作区复制当前内容. 候选捆绑包仍从当前隔离候选仓库重新构建.

Git for Windows 访问 WSL 文件系统中的本地仓库时, 只在当前维护命令的进程级 Git 配置中登记实际使用的来源仓库和新工作区下 3 个准确的 `.bundle-input` 仓库为 `safe.directory`. 使用 `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>` 和 `GIT_CONFIG_VALUE_<n>` 把地址映射与每个准确的 `safe.directory` 条目放入同一个子进程环境, 并把这些变量加入该次调用的 `WSLENV`. 每个配置项使用独立索引, `GIT_CONFIG_COUNT` 等于实际条目总数. 不写入全局或仓库 Git 配置, 不使用 `safe.directory=*`, 也不登记父目录.

VM 路径, SSH `identityFile` 和其他由 Windows 程序消费的 VM 或身份路径都保持为 Windows 本地绝对路径. `UserKnownHostsFile` 必须指向 Windows 本地临时目录中的文件, 不得使用 `\\wsl.localhost\...` 或 `\\wsl$\...` WSL UNC 路径. 保持 `StrictHostKeyChecking=yes`, 已配置的固定主机密钥和稳定的 `HostKeyAlias`; 不用关闭校验来绕过路径或连接错误.

SSH 私钥, VM 密码和其他凭据不复制到 WSL, 不写入仓库文件或 issue, 也不持久化到仓库产物. 继续从仓库外的受控输入提供它们, 并确保错误和结果不包含凭据.

每次 SSH 或 SCP 连接使用自己拥有的 Windows 本地临时目录. 运行器在目录中写入当前连接的固定 known-hosts 文件, 完成 SSH 或 SCP 后清理该目录; known-hosts 写入失败和连接失败也必须执行清理. 正常结束要求临时目录不存在. 如果清理失败, 前序操作成功时整个操作失败; 前序操作已失败时, 保留经过凭据移除的原始操作错误, 不用清理错误覆盖它. 不通过降低主机密钥校验或把临时文件留在 WSL 工作区来恢复.

操作开始前确认 Windows 工具和输入路径可用, 操作结束后确认临时状态已移除. 连接异常时让运行器记录当前失败并继续不依赖该连接的路径, 按原始错误定位问题, 修正路径或权限后从运行器返回的操作边界继续. 启动方式, 会话身份, 捆绑包路径或 Git 所有权配置在创建正式步骤前失败时, 关闭不可用的运行, 使用新的当前会话工作区重新执行 `prepare-bundles` 和 `run`.

这些限制同时适用于首次连接, 文件传输和来宾系统命令. 需要人工处理时, 只处理路径, 权限或环境问题, 不改变固定身份和安全校验.

## Failure lookup

只有从 WSL 操作 Windows 宿主 VM 时才使用下表. 其他发布验证故障返回[通用故障附录](source-checkout-release-validation-troubleshooting.md#failure-lookup).

排查时先核对运行器所属的操作系统和路径语义, 再核对会话身份传递, Git 所有权和 SSH 临时文件. 前一项没有满足时, 后续连接错误不能证明 VM 本身不可用.

路径是否由正确的操作系统解释, 是后续判断成立的前提. 不要先更换凭据, 关闭主机密钥校验, 修改全局 Git 配置或重建 VM. 这些操作会掩盖原始故障, 也会扩大持久状态.

| 症状 | 原因 | 处理方法 | 继续条件 |
| --- | --- | --- | --- |
| WSL 中的维护命令把 Windows 配置路径或 VM 路径判为不存在 | 命令由 WSL Node.js 解释了只属于 Windows 的绝对路径 | 只用 PowerShell 发现 Windows `node.exe` 路径, 再从 WSL 直接启动该可执行文件. `--config` 和 VM 输入继续使用 Windows 本地绝对路径 | 运行器是 Windows Node.js, 且它能按 Windows 路径语义读取全部输入 |
| Windows 运行器报告当前 Agent 会话或工作区身份缺失 | 新 Windows 进程没有继承 WSL 中的 `CODEX_THREAD_ID` | 在保留既有 `WSLENV` 条目的同时加入 `CODEX_THREAD_ID`, 再启动 Windows Node.js. 不把身份写入仓库或证据 | Windows 进程取得与当前 Agent 相同的非空会话身份, 并解析到当前会话工作区 |
| `bundles.json` 中的路径与 `run` 或 `resume` 使用的路径不一致 | `prepare-bundles` 与后续命令混用了 WSL Node.js, Windows Node.js 或不同形式的工作区路径 | 同一轮的 `prepare-bundles`, `run` 和 `resume` 全部使用 Windows Node.js 和同一个 Windows UNC `--workspace`. 不手工改写 `bundles.json` | 后续命令逐字接受准备结果中的工作区和 bundle 路径 |
| Git for Windows 报告 WSL 文件系统中的候选或 `.bundle-input` Repository 存在 `dubious ownership` | Windows Git 不信任 WSL 创建的 Repository 所有权 | 只在当前维护命令的进程级 Git 配置中, 为实际来源 Repository 和本轮 3 个准确 `.bundle-input` Repository 分别加入 `safe.directory`. 同一环境中的 `GIT_CONFIG_COUNT` 必须等于地址映射与这些条目的总数. 不写全局配置, 不使用通配符 | Git for Windows 能读取全部准确 Repository, 且进程外没有新增 `safe.directory` 状态 |
| SSH 或 SCP 报告 known-hosts 无法写入, 路径无效, 或随后出现误导性的连接失败 | Windows OpenSSH 收到了 WSL UNC known-hosts 路径, 或临时目录不属于当前连接 | 为每次连接创建 Windows 本地临时目录和固定 known-hosts 文件, 保持 `StrictHostKeyChecking=yes` 与稳定 `HostKeyAlias`, 并在成功或失败后清理目录. 不把文件移到 WSL 工作区 | Windows OpenSSH 能读写当前连接的本地 known-hosts 文件, 主机密钥准确匹配, 临时目录最终不存在 |
| PowerShell 启动后无法把当前目录切换到 WSL UNC 工作区 | PowerShell 作为父进程时没有沿用 WSL 直接启动 Windows 程序的 UNC 语义 | 不让 PowerShell 承担运行器父进程. 发现路径后从 WSL 直接启动 Windows `node.exe`, 并显式传入 UNC 工作区 | Windows Node.js 直接以当前源码签出的 UNC 路径运行维护命令 |
