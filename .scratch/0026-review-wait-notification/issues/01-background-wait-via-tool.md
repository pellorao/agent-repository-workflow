# Claude Code 中审核等待用 Bash 工具后台运行

Status: completed

## What to build

本 issue 只改 Agent 规则 Markdown, 按 `commit` Skill 的非实施工作流提交, 不安排 Spec Readiness. 问题: Claude Code 中 Main Agent 若用 shell `&` 在子 shell 里脱离运行 `arw background-agent --wait`, Claude Code 不知道该进程, 结束时没有通知, 只能靠定期检查发现. 实测一次提交审核 (4 轮) 中 Reviewer 实际运行合计约 10 分钟, Main 发现结束的延迟合计约 39 分钟, 而用 Bash 工具 `run_in_background` 启动的轮次延迟为 0 到 4 分钟.

改动: `reviewer-launch` Skill 平台差异一节 Claude Code 条中的 "等待较久的命令放进后台命令" 改为 "等待较久的命令用 Bash 工具自身的后台运行 (结束时有通知), 不用 shell `&`, `nohup` 或 `setsid` 脱离 (结束时没有通知)". 三个副本逐字相同: `.agents/skills/reviewer-launch/SKILL.md`, `.claude/skills/reviewer-launch/SKILL.md`, `distribution/skills/reviewer-launch/SKILL.md` (投影与分发副本用对应脚本同步或直接编辑后由检查脚本确认一致).

总层 (本机用户级) 的同类一句不属于 ARW, 不在本 issue 内.

体积预算 (文档字符, 含两份副本): 净增约 +180; 上限 +250.

预期验证: `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, 对改动的源文档运行 `arw language inspect`, 提交前 `arw commit-audit verify --non-implementation`. 不改变 Reviewer 行为 (只约束 Main 怎样等待), 不做 Reviewer 能力对比. 边界情况: 三个副本必须逐字一致; Codex 条不变.

## Acceptance criteria

- [x] 三个副本的 Claude Code 条含上述新文字, 且不再含 "放进后台命令".
- [x] 预期验证中的命令全部成功; `arw commit-audit verify --non-implementation` 需要已暂存候选, 由 Main 提交前运行.

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1: 三个副本各 1 处替换 (`git diff --stat` 为 3 个文件各 1 行); `grep -c "放进后台命令"` 三个副本均为 0.
- 验收条件 2: `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check` 均通过; `arw language inspect` 中文 89.3%, 英文 10.7% (命令与路径等精确文字). `arw commit-audit verify --non-implementation` 未运行 (候选未暂存, Git 写入由 Main 执行).
- 体积: 每副本新增 59 字符, 三副本净增约 +177, 在上限 +250 内.
