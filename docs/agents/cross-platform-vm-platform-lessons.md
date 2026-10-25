# 跨平台 VM 平台经验

## Windows lessons

把 Windows PATH 作为逻辑项进行测试, 不要把它视为不透明的注册表字符串. 存储的值可能以分隔符结尾:

```text
%USERPROFILE%\AppData\Local\Microsoft\WindowsApps;
```

末尾的分号是 PATH 分隔符, 不是目录的一部分. 拆分各项, 删除由空分隔符产生的内容, 比较归一化目录项, 并在不产生额外空项的情况下序列化最终列表. 同时验证未展开的用户值和实际展开的进程 PATH. 完整的安装和卸载周期必须保留无关的实际项, 例如:

```text
%USERPROFILE%\AppData\Local\Microsoft\WindowsApps
```

执行变更的安装程序进程不能证明 PATH 已经持久化. 必要时重启, 打开新的 PowerShell, `cmd.exe` 和 Git Bash 登录进程, 并验证每个进程都精确解析到一个已经安装的 ARW 启动器. 卸载后, 验证存储的用户 PATH 和新进程中都没有 Installation 项.

在共享基线中保持禁用 Windows Update 自动安装. 这不授权禁用 Secure Boot, virtual TPM 或 Microsoft Defender 等安全控制. 创建新快照前, 把任何明确的维护更新记录为基线维护变更.

## Alpine lessons

安装期间创建普通验证用户, 并且只授予配置所需的管理权限. 没有点击表示安装已经完成的 VMware 图形界面按钮, 不能证明磁盘安装失败. 决定重新安装前, 先关机, 断开 ISO, 从磁盘启动, 并验证已经安装的文件系统和服务.

在可复用基线中使用 `open-vm-tools`, OpenSSH, Bash, Git 和当前 Node.js 运行时. 运行时下限测试使用 musl Node.js 归档. 不得把 glibc 归档复制到 Alpine, 并把加载器失败视为 ARW 结果.

发布验证不会在 Alpine 来宾系统中安装 Source Checkout 开发依赖, 也不会运行 `pnpm typecheck` 或完整的 `pnpm test`. 独立的运行时调查必须把其诊断命令保留在发布归档外, 不得静默替换已注册步骤.

除非另行安装, 否则 Alpine 没有自动的 `apk` 升级计划. 验证实际 cron 和服务状态, 不要写入无意义的禁用设置. 已授权的基线维护期间仍允许明确安装软件包.

## Ubuntu lessons

Ubuntu 安装程序下载失败可能由主机 VPN 引起, 而不是 ISO 或虚拟机监控程序. 替换安装介质前, 检查主机 VPN, 代理, DNS 和 Fake IP 行为. 只更改发生失败的网络路径, 然后重复相同下载, 以区分环境问题和来宾系统镜像问题.

可以使用 Easy Install, 但它不能证明最终基线已经就绪. 验证账户, 主机名, 磁盘布局, 固件, Secure Boot, OpenSSH, `open-vm-tools`, `open-vm-tools-desktop`, Git, Node.js, 时区, NTP 和更新策略. 只安装或更新缺失的基线工具. 不得运行通用软件包升级.

Ubuntu 基线使用 `Etc/UTC`, 来宾系统 NTP, 已禁用的 APT 周期性工作, `apt-daily.timer`, `apt-daily-upgrade.timer`, `unattended-upgrades.service`, 以及适合验证周期的 Snap 刷新暂停. 明确安装软件包可能留下既有的待处理升级. 记录前后数量, 并要求安装事务报告既有软件包没有升级.

启动后立即检查时, `systemd-timesyncd` 可能处于活动状态, 而 `NTPSynchronized=no`. 捕获基线证据前轮询 `timedatectl`, 直到同步变为 `yes`. 在有意快速执行第二次重启前, 还要验证 `grub-common.service` 和 `grub-initrd-fallback.service` 成功完成, 且 GRUB 环境不再记录启动失败.

内核发生变化后, 即使 GRUB 能读取内核和 initrd, Ubuntu 来宾系统仍可能失败. 一种可能的症状是:

```text
error: you need to load the kernel first.
VFS: Unable to mount root fs on unknown-block(0,0)
```

首先从来宾系统控制台验证实际磁盘拓扑, 文件系统身份, 生成的菜单, 内核和 initrd. 使用实际根设备临时手动启动, 可以区分内核命令行问题和缺失的启动文件. 一项可逆的 GRUB 设置是:

```text
GRUB_DISABLE_LINUX_UUID=true
GRUB_DISABLE_LINUX_PARTUUID=true
```

只有观察到的来宾系统事实支持时, 才使用该设置. 把它存储在 `/etc/default/grub.d/` 下的本地文件中, 运行 `update-grub`, 运行 `grub-script-check /boot/grub/grub.cfg`, 并验证每个 Linux 项都使用实际根设备且保留相应的 `initrd` 行. 绝不从本指南复制设备路径. 在任何磁盘拓扑或控制器变更后重新检查, 并在接受修复后的基线前要求连续两次温重启.
