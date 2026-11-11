# 确定 Engine 对话入口的形态

Type: grilling
Blocked by: issue:0099:07

##### Question

Engine 对入口提供与形态无关的会话事件流和命令接口 (见 [定义 Engine 驱动流程的运行合同](07-define-engine-runtime-contract.md)), 首版用户实际通过什么与 Engine 对话: Engine 自绘的终端界面, Engine 在本机回环地址上提供的网页, 还是复用 Codex 与 Claude Code 自己的交互界面并经 hook 等扩展点接入? 是否另外把 Engine 暴露为 ACP agent, 让支持 ACP 的编辑器和客户端作为前端? 远程与手机使用, Windows 原生 PowerShell 是否为首版硬要求? 事实见 [Engine 自有对话入口的形态比较](../research/engine-entry/report.md).
