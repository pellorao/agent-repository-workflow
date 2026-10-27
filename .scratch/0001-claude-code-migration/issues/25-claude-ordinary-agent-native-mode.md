# Claude 普通后台 Agent 使用原生工作方式

Status: completed

## What to build

用户确立平台原则 (2026-10-27): 各平台先完整实现规范要求的公共功能, 不打折扣; 公共功能之外尽量使用该平台的原生工作方式 (设置, 权限, 指令文件), 不为与另一平台一致而模仿其机制. 本 ticket 把这条原则写进 `AGENTS.md` Project Overview 中 "ARW 必须在 Codex 和 Claude Code 中都完整可用" 一句之后, 并按它处理下列事项. 用户决定 (2026-10-27): Claude 普通后台 Agent (非 Reviewer) 先保证规范要求的公共功能 (运行中收消息, 主动通知 Main, 待决请求交 Main 回应, 中断与冷启动等), 其余尽量使用 Claude Code 原生工作方式, 不必与 Codex 一致:

- 不用 ARW 自定义的放行列表和 `--safe-mode`: 按用户级与项目级 Claude Code 设置 (权限规则, 权限模式) 和项目 CLAUDE.md 运行. 设置未允许的工具请求仍经 `can_use_tool` 作为待决请求交给 Main.
- ARW 只追加公共功能必需的放行 (如 `arw background-agent`) 和环境变量.
- 获准写入目录的编辑放行和 `--add-dir` 保留 (公共功能).
- Reviewer 维持现有受限方式, 不受影响.
- Codex 沙盒禁网时每次调用都要提权: 在 `reviewer-launch` (及使用后台 Agent 的相关 Skill) 中写明, 首次提权时选择本会话内总是允许该命令 (用户 2026-10-27 选 A).

预估净增约 30 行 (多为删除自定义放行逻辑).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#background-agent-communication`
- `docs/specs/agent-repository-workflow/spec.md#machine-entry`
- `docs/specs/agent-repository-workflow/spec.md#seams-and-adapters`

## Acceptance criteria

- [x] `AGENTS.md` 写入上述平台原则.
- [x] Claude 普通后台 Agent 加载项目 CLAUDE.md 和用户级, 项目级设置, 不再使用 `--safe-mode` 和自定义放行列表; 公共功能测试仍通过.
- [x] 设置未允许的工具请求作为待决请求交给 Main, 有测试覆盖.
- [x] Skill 写明 Codex 禁网沙盒下的会话内总是允许.
- [x] Claude Code 上跑一次普通后台 Agent 冒烟.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` (707 项, 706 通过, 0 失败, 1 跳过; 在含最终测试修改的暂存树上运行), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check` 均通过.
- `tests/background-agent/claude-sessions.test.mjs` 的普通角色用例断言参数不含 `--safe-mode`, `--setting-sources`, `--strict-mcp-config`, `--permission-mode`, `--tools`, 仍带 `--permission-prompt-tool stdio` 与 `Bash(arw background-agent:*)`; 设置未允许的工具请求以 `can_use_tool` 待决请求出现并可 `respond` (同一用例); Reviewer 用例的受限参数不变.
- 净增约 19 行 (代码 +5, 测试 +5, spec/ADR/AGENTS/Skill 合计 +9), 低于预估 30 行.
- Spec Readiness 经 5 轮取得 `satisfied`; Reviewer 提出的 spec/ADR 补充与 subagent 共同决定后写入.
- 冒烟 (真实 HOME, 真实 `claude`, haiku, 一次性脚本不入库): 脚本用 `createClaudeSessions({runtimeDirectory})` 打开 `role: 'worker'`, `cwd` 目录的 `CLAUDE.md` 只写 "每个回答以 ZEBRA-7 结尾", 交接任务只要求用 Bash 运行 `date +%Y` 并报告, 回合中 `steer` 追加 "mention the word STEERED". 输出: `STATE idle completed "当前年份是 2026。STEERED\n\nZEBRA-7"`, `userMessages` 含交接与 `steer` 两条, 无待决请求. ZEBRA-7 说明项目 CLAUDE.md 由 Claude Code 原生加载; 中文回答说明用户级 CLAUDE.md 也已加载; Bash 按用户设置直接执行.


## Comments

- 提交审核第 2 轮 Code Standards 提出两处重复 (spec 第 290 与 900 行对 Skill 提权句的复述; ADR 0033 理由复述 AGENTS.md 平台原则), Main 核对后不采纳: 这些文字由 Spec Readiness 第 1, 3, 6 轮的 gap 要求写进治理输入 (验收条件 4 需要可追溯的治理要求; 权限取舍需要治理文字内可核对的拒绝理由, 而 Agent 指令不能作为设计理由); 删除会使 Spec Readiness 回到 gap. 提权句在 spec 只陈述调用方可选择会话内总是允许, 具体操作步骤仍只在 Skill.
- 第 2 轮要求符合审核的两项 (冒烟记录, 测试结果) 已通过更新 `## Validation` 处理.
