# 将 Local Tracker 原地演进为 Agent Repository Workflow

本项目把现有 Local Tracker 原地扩展并更名为 Agent Repository Workflow (ARW), 不再保留功能较窄的跟踪器或另建产品. ARW 将既有 `.scratch` 记录能力纳入仓库工作流管理, 统一管理 Workflow Distribution, Managed Content 和工作流检查.

产品, 仓库内软件包和 Installation 均使用 ARW 身份. 唯一的命令行入口是 `arw`, 不提供 `tracker` 兼容入口, 从而避免长期维护两个产品身份或模糊内容归属.
