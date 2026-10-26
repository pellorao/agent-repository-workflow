# 收尾接入

Status: completed

## What to build

新规则 `AGENTS.md` 恢复原名并生成 `CLAUDE.md` (`@AGENTS.md`), 在用户级 `~/.claude/CLAUDE.md` 加一句 "项目规则与本文件冲突时以本文件为准", 删除临时规则. 在真实 Claude Code 和 Codex 会话中各跑一次实现一个 issue 并提交的完整流程.

预估改动: 约 100 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#migration-sequencing`

## Acceptance criteria

- [x] `AGENTS.md` 已恢复, 临时 `CLAUDE.md` 已被生成版本取代.
- [x] 两个环境的真实冒烟都完成, 结果记入 `## Validation`.
- [x] 用户级优先级说明已加入.
- [x] README 写明升级说明: `code-spec-reviewer` 和 `commit-audit-reviewer` 已并入 `requirements-reviewer`, 原先给它们设的模型需改到新角色; ADR 0023 加状态说明并修正失效锚点.
- [x] 卸载后不再残留空的 background-agent-state 目录.
- [x] 在旧版目标仓库上运行 `arw workflow update` 时, 已删除规则文档中的仓库自有内容不丢失: 迁入入口文件的仓库自有区域, 并在交接输出中提示用户核对.

- `reviewer-launch` Skill 中 Claude Code 一条仍写着 "只支持 Codex": 按 Claude Code Main 实际驱动 `arw background-agent` 的方式改写, 并在 smoke 中实测.
- Spec Readiness 记录升到版本 7 后, 下游仓库未提交 issue 的旧记录 (含 `not-applicable` 例外) 会被判为过期, 需重新生成: 在 README 升级说明中写明.

## Blocked by

- issue:0001:01
- issue:0001:02
- issue:0001:03
- issue:0001:04
- issue:0001:05
- issue:0001:06
- issue:0001:07
- issue:0001:08
- issue:0001:09
- issue:0001:10
- issue:0001:11
- issue:0001:12
- issue:0001:14

## Validation

- 全量 `pnpm test` 694 pass, 0 fail; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check` 均通过.
- 新增测试 `update moves repository-owned content of a removed rule document into AGENTS.md` (`tests/repository-workflow/workflow.test.mjs`); 卸载测试改为断言安装目录不存在.
- 用户级优先级说明 (`~/.claude/CLAUDE.md`) 由 Main 负责, 本 worker 未改, 该项未勾选.
- 冒烟环境: 一次性目标仓库 (已有 `add`, 待实现 `clamp` issue), 源码 `arw` 包装脚本, 临时 HOME/CODEX_HOME (凭据副本, 用后删除), 不碰已安装 ARW 和用户配置; 两边都先运行 `arw workflow init`.
- Claude Code (`claude -p --model sonnet --effort high`, 约 10 分钟, $1.71): 提交 `e0b5763 feat(math): add clamp`. spec-readiness-reviewer 3 轮 (补 Module Design) 后通过; requirements-reviewer, code-standards-reviewer 均 No problems. 三个 Reviewer 都经 `arw background-agent` Claude 后端, haiku/high. 实测确认 reviewer-launch 新写法 (每个操作单独调用, 等待时保持 stdin 打开).
- Codex (`codex exec` 默认模型, 同一会话分 3 段): 提交 `f3970cd feat: 添加 clamp 区间限制函数`. spec-readiness-reviewer (gpt-6-luna/xhigh) 首轮发现缺少模块设计, Codex 按 rule-and-design-changes 停下请求确认, 确认后复审通过; requirements-reviewer 无问题; code-standards-reviewer 指出 issue 记录章节归类问题, 修正后提交.
- 冒烟中修复的 ARW 缺陷: `lib/background-agent/codex-app-server.mjs` 启动失败时收尾错误盖住真正原因, 现合并两者信息; reviewer-launch Skill 补写 followup_task 需完整字段, stateDirectory 须预先存在.
- 冒烟中的环境问题 (非 ARW 缺陷): Codex 命令跑在 `bash -lc` 中, `~/.profile` 把已安装 ARW 放在 PATH 前面, 需在运行脚本里设 HOME; Codex workspace-write 沙箱让 `.git` 只读, 第三段改用 danger-full-access; Claude 的 `--allowedTools` 白名单造成 13 次拒绝; 祖先目录的 `CLAUDE.md` 需用 `claudeMdExcludes` 排除.
- 未修复的遗留: 分发文档链接到目标仓库不存在的 `docs/specs/agent-repository-workflow/spec.md`; `draftPath` 报告目录约束 (`report-binding-invalid`) 未写入文档; stdin EOF 取消 pending `wait_agent` (公开接口语义, 待决定, 现以文档绕过); Codex PTY 规范模式截断长 JSONL; 新初始化仓库 `arw terms check` 失败 (无术语表, 语言检查未配置); `wait_agent` 超时下限 10000 ms 和重复请求 id 被拒未写入 Skill.
- 本 ticket 未做独立 diff 审查 (worker 不得派生 subagent), 需 Main 补做.
