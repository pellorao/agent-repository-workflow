# Claude 后端跑通 Reviewer

Status: completed

## What to build

`arw background-agent` 按 Reviewer 配置选择后端. 新增 Claude 后端实现 `NativeSessions`, 每个 Reviewer 会话运行一次 headless `claude -p` (`stream-json`, `--session-id`, `--resume`, `--allowedTools`, `--permission-mode`); 跟进以续接实现, 中断以结束进程实现. Claude 默认 `haiku` / `high`. `arw lba` 显示两种后端的 Reviewer. 写新 ADR 取代 ADR 0016 的暂停决定并修订 ADR 0030 的范围.

预估改动: 约 800 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#platform-and-reviewer-runtime`

## Acceptance criteria

- [x] 在 Claude Code 中经 `arw background-agent` 能启动, 跟进, 等待和中断一个 Reviewer, `arw lba` 可见.
- [x] Codex 后端行为不变.
- [x] 用假 `claude` 脚本覆盖新建, 续接, 中断和失败退出.
- [x] 新 ADR 已写入.

## Blocked by

- issue:0001:01

## Comments

- 后端选择: Reviewer 设置的 `modelProvider` 为 `anthropic` 时走新 Claude 后端 (`lib/background-agent/claude-sessions.mjs`), 其余仍走共享 Codex App Server. 宿主用一个很薄的路由把 `open` 分发到对应后端, `ensureServer`/`observeServer` 只属于 Codex; manager 对 Claude 设置跳过共享 App Server 启动. 模型目录与 Strata 未进入 Claude 后端.
- 默认值: 客户端把 Main 的平台 (`caller.platform`) 传给守护进程. Claude Code 中解析结果的提供方不是 `anthropic` 时用 `haiku`/`anthropic`/`high`. 原因: 安装和 `loadConfig` 会把 Codex 默认值写满用户级配置, 无法区分"默认"与"显式选择 Codex". 后果: Claude Code 中只有显式写 `modelProvider: "anthropic"` 才采用配置中的模型; 从 Claude Code 选 Codex Reviewer 暂不支持 (待用户决定是否需要).
- 每回合一个 `claude -p --output-format stream-json --verbose --model --effort`, 首轮 `--session-id`, 会话文件已存在时 `--resume`; 限制: `--tools Read,Grep,Glob,Edit,Write`, `--permission-mode dontAsk`, `--allowedTools Edit(//<报告目录>/**)`, `--add-dir`, `--setting-sources ''`, `--strict-mcp-config`, 工作目录为审核仓库. 运行中 `steer` 直接报错 (Reviewer 跟进本就只在空闲时发生), 中断即 kill 进程.
- 测试: 假 `claude` 脚本 `tests/fixtures/fake-claude.mjs`; `tests/background-agent/claude-sessions.test.mjs` 覆盖新建, 续接, 中断, 失败退出, 以及经 host `dispatch` 的启动, 等待完成, 跟进, 中断和 `arw lba` 渲染. 全量 1061 项: 1056 通过, 2 失败 (main 上已存在: `AGENTS.md` 迁移期改名为 `.bak`), 3 跳过. typecheck 通过.
- 真实 smoke (claude 2.1.310, haiku): 两轮均成功, 写报告目录成功, 写目录外文件被 `dontAsk` 拒绝, 续接后记得上一轮内容, 会话文件路径推算正确, 在 Claude Code 内嵌套运行无问题. 但 Haiku 两次都没有只输出 `{"status":"ready"}`, 而是附带解释文字, 真实 Reviewer 会因此被判为最终状态无效; 需在 Reviewer 规则或后续 ticket 中处理.
- 未做: 经已安装守护进程的端到端 `arw background-agent` 实跑 (会与用户正在运行的守护进程共用运行目录). 守护进程崩溃后遗留的 Claude 运行仍按 Codex 旧进程核对逻辑恢复. Windows 下权限规则路径格式未验证.
- 独立审查 (opus): 修复了 stdin EPIPE 可能使守护进程崩溃, 中断后进程未退出就判定空闲, 首轮被提前中断后无法续接 (改为按会话文件是否存在选择 `--resume`); 删除 manager 中重复的 `sharedServerOpen` 赋值.
