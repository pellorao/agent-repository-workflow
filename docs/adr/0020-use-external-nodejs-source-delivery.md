# 使用外部 Node.js 与来源标签交付

## Decision

ARW Engine 继续使用不含 npm 运行时依赖的纯 JavaScript 和 ES Module, 由外部 Node.js `>=24` 运行. 后台消息的私有持久存储使用内置 `node:sqlite`, 因而不增加第三方运行时依赖. 用户下载默认分支的 `scripts/install-arw.mjs`. Bootstrap 选择最高稳定 SemVer, 或采用用户显式指定的准确稳定 `--version`, 建立临时的准确标签签出副本, 再调用该修订版本的 `install.mjs`. 稳定标签与 `arwVersion` 使用相同的无 `v` 前缀规范 `MAJOR.MINOR.PATCH`; Bootstrap, 发布证据, Installation 清单和一致性检查使用同一个版本值, 不转换前缀或提供另一种稳定标签别名. 单一版本表示使用户选择, 已解析标签和发布记录可以直接核对, 避免同一版本因前缀差异形成两个来源身份.

[ADR 0031](0031-use-github-and-local-validation-sources.md) 拥有当前公开 HTTPS 来源和本地验证输入的决定. Bootstrap 从根发布配置取得规范远程地址, 只在存在稳定 tag 时安装正式发布; 无稳定 tag 时由源码安装路线取得本地来源. Installation 复制运行内容, 平台启动器和卸载器, 并在每次调用时从 PATH 解析 Node.js. 因此已安装行为不依赖持久来源签出副本, 用户 Git 状态或安装时的绝对运行时路径.

Windows 和 Linux 是一等支持的操作系统, Ubuntu 与 Alpine 提供有代表性的 Linux 证据, macOS 在取得真实主机一致性证据前保持实验性. CPU 架构不进入支持矩阵, 因为 ARW 不交付原生可执行文件. Node.js 24 是最低运行版本. 只有 Bootstrap 与 Installer 在加载 Installation Implementation 或开始 Git, 网络, 临时资源和安装副作用前执行显式版本检查; 低于最低版本或无法解析时写入标准错误并以退出码 1 结束. 普通 `arw` 与 Uninstaller 不执行显式版本检查. 发布验证用 Node.js 24 覆盖最低版本和完整平台矩阵. pnpm, TypeScript 和 Node.js 类型声明只属于源码仓库开发与宿主机候选验证, 不进入 ARW Installation 或 VM.

这个选择复用既有 JavaScript Engine 和贡献者工作流. 原生重写或 Node.js SEA 都不能替代真实的 macOS 文件系统, Installation 和 Release 证据, 却会引入编译器, 逐平台记录, 架构和 Apple 分发生命周期. C++, Go, Rust 和 Zig 原型因此在开始前退出路线: 它们所服务的原生记录前提已撤回, 并非某种语言原型失败.

稳定标签策略由仓库管理员维护. 每次安装所选标签, 已解析提交和签出副本的一致性只证明本次取得的精确来源, 不证明标签历史不可变. 首期不增加签名, 受信任密钥, 透明度或在线身份子系统; 这些机制只有在定义独立信任权威和恢复契约后, 才可能改善当前精确字节采用工作流.

本 ADR 取代 [ADR 0019](0019-use-delayed-notarized-macos-artifacts.md) 的原生 DMG, 签名, 公证, 装订和按架构发布路线. 旧 ADR 保留编号与现行决定指针; macOS 文件系统, 配置文件, Git 和归属发现仍可作为未来恢复一等支持的输入.
