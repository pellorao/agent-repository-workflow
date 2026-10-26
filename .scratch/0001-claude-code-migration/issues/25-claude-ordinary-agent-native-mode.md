# Claude 普通后台 Agent 使用原生工作方式

Status: ready-for-agent

## What to build

用户确立平台原则 (2026-10-27): 各平台先完整实现规范要求的公共功能, 不打折扣; 公共功能之外尽量使用该平台的原生工作方式 (设置, 权限, 指令文件), 不为与另一平台一致而模仿其机制. 本 ticket 把这条原则写进 `AGENTS.md` Project Overview 中 "ARW 必须在 Codex 和 Claude Code 中都完整可用" 一句之后, 并按它处理下列事项. 用户决定 (2026-10-27): Claude 普通后台 Agent (非 Reviewer) 先保证规范要求的公共功能 (运行中收消息, 主动通知 Main, 待决请求交 Main 回应, 中断与冷启动等), 其余尽量使用 Claude Code 原生工作方式, 不必与 Codex 一致:

- 不用 ARW 自定义的放行列表和 `--safe-mode`: 按用户级与项目级 Claude Code 设置 (权限规则, 权限模式) 和项目 CLAUDE.md 运行. 设置未允许的工具请求仍经 `can_use_tool` 作为待决请求交给 Main.
- ARW 只追加公共功能必需的放行 (如 `arw background-agent`) 和环境变量.
- Reviewer 维持现有受限方式, 不受影响.
- Codex 沙盒禁网时每次调用都要提权: 在 `reviewer-launch` (及使用后台 Agent 的相关 Skill) 中写明, 首次提权时选择本会话内总是允许该命令 (用户 2026-10-27 选 A).

预估净增约 30 行 (多为删除自定义放行逻辑).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#background-agent-communication`

## Acceptance criteria

- [ ] `AGENTS.md` 写入上述平台原则.
- [ ] Claude 普通后台 Agent 加载项目 CLAUDE.md 和用户级, 项目级设置, 不再使用 `--safe-mode` 和自定义放行列表; 公共功能测试仍通过.
- [ ] 设置未允许的工具请求作为待决请求交给 Main, 有测试覆盖.
- [ ] Skill 写明 Codex 禁网沙盒下的会话内总是允许.
- [ ] Claude Code 上跑一次普通后台 Agent 冒烟.

## Blocked by

- None - can start immediately
