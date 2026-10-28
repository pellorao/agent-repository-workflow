# 发布流程: tag 后失败回滚重试, 临时路径与语言检查对齐 spec

Status: completed

## What to build

用户批准的待办 merge-release (2026-10-28), 范围只限发布 Skill 与 release spec 的文字, 不新增代码:

1. tag 推送之后, 在维护者公告之前, 任一后续步骤 (压缩包生成, Release 创建与核对, 公开 Bootstrap 验证) 失败时, 流程删除本次运行创建的同版本 tag 与 GitHub Release (本地与远端), 修复根因后重试; 公告之后失败仍保留并停止. 理由: 公告前无人下载, 回滚安全 (用户规则 recover, don't fail). 决定: 发布授权同时覆盖同版本回滚; 不新增 ADR, 在 ADR 0031 注明该例外并记入 spec 的 `Design rationale`; `$release` Skill 运行期间一律视为未公告 (公告由维护者在流程结束后发布); 同一版本连续回滚 2 次仍失败时停止并报告; 新 commit 回到 Skill 第 2 节重新验证 (含 VM), 候选不变时不重跑 VM.
2. `release` Skill 与 `vm.md` 中的 `.tmp/release` 改为会话工作区 `.tmp/<agent-platform>/<sessionId>/release/` (遵循 `docs/agents/environment.md`), `publication.md` 的 `<tmp>` 同处.
3. release spec 的 `Release procedure` 第 2 步清单补入分发副本语言检查 (`arw language inspect distribution`), 与 Skill 和 `AGENTS.md` 一致.

投影副本 `.claude/skills/release/` 用 `node scripts/project-claude-skills.mjs` 生成. 平台: 两平台共用同一份文本, 会话工作区占位符由各平台 Platform Adapter 提供.

预估净增: 权威文件约 22 行, 含投影镜像约 40 行, 无代码.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-release/spec.md#release-procedure`
- `docs/specs/agent-repository-workflow-release/spec.md#failure-recovery-and-authorization`
- `docs/specs/agent-repository-workflow-release/spec.md#design-rationale`
- `docs/specs/agent-repository-workflow/spec.md#document-language-inspection`

## Acceptance criteria

- [x] release spec 的 `Failure recovery and authorization` 改为: 公告前可回滚同版本 tag 与 Release 并重试 (只删除本次运行创建的对象, 连续 2 次失败停止), 公告后保留并停止; 授权句列出该例外; `Design rationale` 说明这是对 "不移动已推送 tag" 的受限例外. 观察: `grep -n "回滚" docs/specs/agent-repository-workflow-release/spec.md`.
- [x] `docs/adr/0031-use-github-and-local-validation-sources.md` 第 7 行注明公告前本次运行创建的对象可回滚的唯一例外. 观察: `grep -n "唯一例外" docs/adr/0031-use-github-and-local-validation-sources.md`.
- [x] `publication.md` 的 `Rollback after the tag` 含记录状态, 仅删除本次创建的对象, 删除 (Release 与仅 tag 两种情形), 本地 tag 删除, 三项核对 (Release, 远端 tag, 本地 tag 都不存在), 新候选与不变候选两条重试路径, 2 次上限; `Failures after the tag` 不再存在. 观察: `grep -rn "Failures after the tag" .agents .claude docs` 无输出.
- [x] `SKILL.md` 与 `vm.md` 不再出现 `.tmp/release`; `publication.md` 的 `<tmp>` 指明会话工作区. 观察: `grep -rn "\.tmp/release" .agents .claude` 无输出.
- [x] release spec `Release procedure` 第 2 步清单含语言检查. 观察: `grep -n "language inspect" docs/specs/agent-repository-workflow-release/spec.md`.
- [x] `node scripts/project-claude-skills.mjs --check`, `node scripts/check-workflow-distribution.mjs`, `arw text check` 通过; `arw terms check` 无新增发现.

## Blocked by

- None - can start immediately

## Validation

- Spec Readiness: 3 轮 haiku high 后 `No problems.` (前两轮问题: 公告边界自相矛盾, 回滚完成条件与失败分支缺失, ADR 0031 "不自动删除" 冲突与接受成本未记, ADR 不应整份列为要求引用), `arw spec-readiness verify --issue issue:0001:43` 退出 `0`.
- 纯文字改动, 无代码与测试. `node scripts/project-claude-skills.mjs --check`, `node scripts/check-workflow-distribution.mjs`, `arw text check`, `git diff --check` 通过; `arw terms check` 只剩既有的 spec 859 行 `Artifact` 发现. `grep -rn "Failures after the tag\|\.tmp/release" tests lib .agents .claude docs` 无输出.
- 净增 (`git diff --numstat`, 不含投影): 权威文件 +25/-14, 约 +11, 低于预估.
- 偏离: 审核发现 ADR 0031 禁止自动删除, 故在其第 7 行注明例外 (原决定不新增 ADR 仍成立).

## Comments
