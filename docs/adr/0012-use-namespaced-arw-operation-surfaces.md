# 使用有命名空间的 ARW 操作面

ARW 不提供含义宽泛的 `arw check`, `arw verify` 或 `arw check-integrity`. 公开 CLI 将完整 Repository Workflow 生命周期置于 `workflow` 命名空间: `arw workflow init`, `arw workflow update`, `arw workflow update --dry-run`, `arw workflow verify` 和 `arw workflow remove`. Code Map 验证, 文本策略和记录迁移分别使用 `arw code-map verify`, `arw text check|fix` 和 `arw migrate artifacts`.

用户通过 `arw agent start <name> [agent-arguments...]` 从用户配置启动外部 Main Agent CLI. `<name>` 之后的参数只属于外部 CLI, 不构成 ARW 选项. 这个命名空间将直接启动进程的责任与 Repository Workflow 及平台内部 subagent 编排分开. Engine 修复或升级从 Source Checkout 运行 `node install.mjs`; Engine 移除运行已安装的 `uninstall.mjs`.

按责任分组的命令名不会让含义过宽的命令暗示已经完成全部检查, 也避免混淆 Repository Workflow, Agent CLI 启动和 Engine Installation 生命周期. 上述规范命令不提供旧拼写别名.
