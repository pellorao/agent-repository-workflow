# VM 参考

## Configuration

`scripts/release-vm.mjs` 取得的 ARW 发布配置是下面格式的 JSON: 默认是仓库根被 Git 忽略的 `.arw.local.json` 中的 `release` 对象 (见下文), 也可以用 `--config <path>` 指向一个仓库外的完整单文件配置. 示例中的值都是占位符:

```json
{
  "schemaVersion": 2,
  "maxParallelMachines": 3,
  "fixturesDirectory": "<absolute path of the maintainer's fixture archives>",
  "machines": {
    "Windows 11": {
      "machineType": "VMware",
      "vmrun": "C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe",
      "location": "D:\\VMs\\Windows 11\\Windows 11.vmx",
      "snapshot": "<baseline-snapshot>",
      "ssh": {"user": "<user>", "port": 22, "identityFile": "C:\\Users\\<me>\\.ssh\\<key>", "hostKey": "ssh-ed25519 AAAA..."},
      "guestPasswords": {"<account>": "<password>"},
      "nodeExecutables": {"recommended": "C:\\node\\node.exe"}
    },
    "Ubuntu": {"machineType": "VMware", "vmrun": "...", "location": "...", "snapshot": "...", "ssh": {"...": "..."}, "nodeExecutables": {"recommended": "/opt/node-24/bin/node"}}
  }
}
```

### Local configuration file and shared machines file

`$release` 先读仓库根的 `.arw.local.json` (被 `.gitignore` 排除, 只属于 ARW 源码仓库, 只放路径和 ARW 设置, 不放秘密), 取其 `release` 对象; 文件缺失或没有 `release` 对象时才询问维护者各路径并写入, 之后不再询问. 机器的通用信息 (`vmrun`, `location`, `snapshot`, `ssh` 等) 也被其他本机工具使用时放进共用机器文件, `release` 对象只保存 ARW 专用键并用 `sharedMachinesConfig` 引用它:

```json
{
  "release": {
    "sharedMachinesConfig": "<path of the shared machines file, relative to this file or absolute>",
    "maxParallelMachines": 3,
    "fixturesDirectory": "<absolute path of the maintainer's fixture archives>",
    "machines": {
      "Windows 11": {"nodeExecutables": {"recommended": "C:\\node\\node.exe"}},
      "Ubuntu": {"nodeExecutables": {"recommended": "/opt/node-24/bin/node"}}
    }
  }
}
```

- 其他只在 ARW 仓库工作时需要的本机设置以后放在 `release` 的同级对象中.
- `sharedMachinesConfig` 与 `fixturesDirectory` 的相对路径相对所在配置文件的目录解析. 脚本按自身位置找仓库根, 不依赖工作目录. 路径值必须对运行脚本的 Node.js 有效 (用 Windows 的 `node.exe` 时写 Windows 路径).
- 传 `--config <path>` 时, 该文件本身就是 ARW 发布配置 (顶层即 `fixturesDirectory`, `machines` 等, 不带 `release` 包装), 不读 `.arw.local.json`; 不拆分的单文件完整配置继续有效.
- 共用文件的格式是上面单文件示例中的 `machines` (通用键即可, 可含 ARW 不读取的键).
- 脚本按机器键取共用条目, 再用 ARW 发布配置同键条目的顶层键逐键覆盖 (浅合并, 值整体替换). 机器键可以只出现在其中一边, 两个文件都没有时报错.
- 脚本读取的键只有 `fixturesDirectory`, `sharedMachinesConfig` 和 `machines`, 只在 ARW 发布配置中生效; 共用文件中的顶层键被忽略, 脚本也不继续跟随共用文件中的引用. `maxParallelMachines` 和 `schemaVersion` 脚本不读取.
- 不含 `sharedMachinesConfig` 的单文件配置继续有效, 无需迁移.
- 配置或共用文件不存在, 不可读, 不是有效 JSON, `sharedMachinesConfig` 不是字符串, 或没有 `--config` 时本地文件缺少 `release` 对象时, 脚本以退出码 2 结束并只写出文件路径, 不回显文件内容 (含密码).

- `fixturesDirectory` 是维护者保存 fixture 压缩包的仓库外目录, `check` 必须有它: 脚本把其中的 `agent-assisted.tgz` 传入客户机供 guest 检查使用; 其余压缩包由 `./fixtures.md` 的步骤读取. 真实路径不写入仓库.
- 机器键可以自由命名. 当前环境是 Windows 11, Ubuntu 和 Alpine, 至少要覆盖一台 Windows 和一台 Linux. 同时运行的机器数不超过 `maxParallelMachines`.
- `location` 是 VMX 路径. 脚本不读取 `machineType` (只支持 VMware) 和 `guestPasswords` (只供维护者在控制台登录).
- `nodeExecutables` 是客户机中 Node.js 的绝对路径, 不含空格. `check` 对 `recommended` 和可选的 `minimum` (第二个受验 Node.js, 通常省略) 各运行一次客户机检查, 首个失败即停. 客户机检查把该 node 所在目录排在 `PATH` 最前, 所以已安装的 `arw` 启动器也使用它.
- `hostKey` 是客户机的 OpenSSH 公开主机密钥 (`<type> <base64>`). 脚本把它写入临时 known-hosts 文件, 并以 `StrictHostKeyChecking=yes` 和固定 `HostKeyAlias` 连接. 主机密钥不匹配时, 不得关闭校验来绕过. 应通过 VM 控制台读取 `/etc/ssh/ssh_host_*_key.pub` 或 `C:\ProgramData\ssh\ssh_host_*_key.pub` 核对.
- 客户机地址通过 `vmrun getGuestIPAddress -wait` 取得. DHCP 地址不是身份, 身份由主机密钥保证.

## Guest requirements

- x86-64 系统. 基线快照处于关机状态, 并已安装 VMware Tools (`open-vm-tools`).
- OpenSSH 服务只允许密钥认证. 测试账户是具有管理员或 sudo 能力的普通账户, 不使用 root.
- 测试账户的登录 shell 中, `PATH` 上有 Git. `nodeExecutables` 中的 Node.js 满足 `package.json` 的 `engines.node`, 不要求准确的最低版本. Linux 还需要 `bash`, 登录 shell 会读取 `~/.profile`. Alpine 需要使用 musl 构建的 Node.js.
- 以上之外的程序有无与版本都不影响验证, 基线可以含真实用户常见的其他程序; guest 检查本身不调用 pnpm, TypeScript 或 Agent CLI. 客户机不需要访问外网, 候选只通过 bundle 和压缩包传入.
- 关闭操作系统和软件包的自动升级. Linux 使用 UTC 并开启客户机 NTP. 使用 VMware 时设置 `tools.syncTime = "FALSE"`.
- 网络使用隔离的 NAT. 不为了方便添加桥接网络或端口转发.

## Snapshot discipline

基线快照不可变. `check` 运行前后都会硬关机并还原快照, 所以不在客户机中手工清理测试文件. 创建, 替换或删除快照, 升级客户机系统, 以及更改虚拟硬件或网络, 都属于基线维护, 需要维护者另行授权. 替换基线时, 先验证新快照能通过一次 `check`, 再经维护者确认后删除旧快照.

## WSL and Windows host

VMware 运行在 Windows 宿主上, 而 Agent 位于 WSL 时, 使用 Windows 的 `node.exe` 运行脚本, 让 `vmrun`, `ssh` 和 `scp` 都是 Windows 程序, 共用 Windows 路径语义和临时目录:

```text
NODE_WIN="$(wslpath -u "$(powershell.exe -NoProfile -NonInteractive -Command '(Get-Command node).Source' | tr -d '\r')")"
"$NODE_WIN" scripts/release-vm.mjs check 'Windows 11' "$(wslpath -w <tmp>/candidate.bundle)" --archive "$(wslpath -w <tmp>/arw.tar.gz)"
```

- 配置文件和其中的路径都使用 Windows 本地绝对路径. bundle 可以用 `wslpath -w` 转成 UNC 路径, 脚本会先把它复制到 Windows 临时目录再传给 `scp`.
- 不要用 PowerShell 作为父进程再切换到 WSL UNC 工作目录, 应直接从 WSL 启动 `node.exe`.
- known-hosts 文件由脚本写在 Windows 临时目录中. 不要改用 `\\wsl$` 路径.

## Failure lookup

| 症状 | 原因与处理 |
| --- | --- |
| `revertToSnapshot` 或 `start` 报授权或资源错误 | VMware GUI 正以不同权限占用 VM. 关闭该 VM 的 GUI 标签, 或用相同权限运行. 不要编辑锁文件, 不要结束 `vmware-vmx` 进程 |
| `getGuestIPAddress` 一直等待 | 客户机中的 VMware Tools 没有运行. 修复基线 (属于基线维护) |
| SSH 一直不可用, 或报主机密钥错误 | 检查客户机的 sshd, 账户和公钥. 主机密钥按上文核对, 不关闭校验 |
| `新终端解析 arw` 失败 | Windows: 检查用户 `Path` 的注册表值是否包含 Installation 目录. 存储值可能以 `;` 结尾, 末尾分隔符不属于目录. Linux: 检查 `~/.profile` 中的 ARW 行, 并确认没有 `~/.bash_profile` 遮蔽它 |
| `arw --version` 失败, 但能解析到 `arw` | 启动器调用的是 `PATH` 上的 `node`. 确认 `~/.profile` 没有把受验 node 目录挤到后面, 且该 node 满足 Guest requirements 节对 Node.js 的要求 |
| Windows 上 checkout 缺少深层文件, 或文本换行被改写 | 脚本已用 `core.longpaths=true` 和 `core.autocrlf=false` 克隆 (guest 检查另有一轮专门以 `core.autocrlf=true` 检出 ARW 源码, 用来确认仓库根 `.gitattributes` 使分发文件仍为 LF). 若仍出现, 检查客户机 Git 版本 |
| Ubuntu 基线维护时下载失败 | 先检查宿主 VPN, 代理和 DNS, 再怀疑 ISO 或虚拟机监控程序 |
