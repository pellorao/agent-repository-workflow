---
name: unattended-run
description: 仅在驱动程序的开局说明点名时使用, 在 ARW 源码仓库的无人值守自主运行 (由驱动程序扮演用户) 中: 遇到必须由真人完成的步骤时拆分 issue, 先提交不依赖它的部分, 并按驱动的 QUESTION, DONE, BLOCKED 协议提问.
disable-model-invocation: true
---

# 无人值守运行

只有驱动程序的开局说明点名本 Skill 时才使用, 普通会话不使用. 驱动程序扮演用户, 只用文本协议回答, 无法完成必须由真人手工完成的步骤 (例如 `code --wait` 的人工比对, 在本机浏览器中完成登录授权). 它不改变其他规则, 只规定这类步骤怎样处理.

## Human-only steps

- 规划前先找出 issue 中依赖真人的步骤. 不依赖它的部分单独成 issue, 照常实施, 审核并提交.
- 依赖真人的部分单独成 issue 或留作原 issue 的剩余部分: 不运行 Spec Readiness, 不开始实施, `Status` 保持 `ready-for-human`, 在 `## Comments` 写明所需的真人步骤, 作为待用户决定事项上报.
- 不为它发 `QUESTION` 等待. 其余待办都完成后, 在 `DONE` 首行之后逐项列出未完成的真人步骤; 只有剩余待办全被它阻断时才用 `BLOCKED`.

## Questions

需要用户输入时按开局说明的协议提问: 首行 `QUESTION: ...`, 一次一个自成一体的问题, 带背景, 选项和建议. 开局说明已给出的信息不提问. 等待 Reviewer 时在回合内继续等待, 不为等待结束回合.
