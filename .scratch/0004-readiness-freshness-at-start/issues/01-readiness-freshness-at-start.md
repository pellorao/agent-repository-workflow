# Spec Readiness 新鲜度只用于开始实施

Status: completed

## What to build

用户确认的最终状态见 effort `spec.md` 的 `Solution`: 就绪记录的新鲜度只在开始实施时完整核对; 开始实施后 Input 与 Reviewer Role 的字节变化不再阻断; 实施提交只核对 subject; 除实施提交外不为 issue 收尾或已完成的 issue 另行验证; `promote` 与记录格式不变.

代码 (`lib/`):

- `lib/arw.mjs`: `spec-readiness verify` 解析可选开关 `--subject-only` (用法行, 命令类型, 解析, 传给 `verifySpecReadiness`).
- `lib/spec-readiness/spec-readiness.mjs`: `verifySpecReadiness` 增加布尔参数 `subjectOnly`; 为真时跳过 Input 与 Reviewer Role 两个检查块, 其余不变; 更新其注释.

文档与规则 (主副本; `distribution/` 副本, `docs/manuals/skills{,.zh-CN}.md` 与 `.claude/skills/` 投影随之同步):

- `spec-readiness` Skill 的 `Authorization timing`: 改写时点规则 (开始实施前完整 `verify`, 过期则增量复审且不由 Main 自判; "已开始实施" 的规则界定: 当前分支已有本 issue 授权的实施提交, 或工作树已有本 issue 的实现改动; 开始实施后 Input 与 Reviewer Role 变化不再阻断; 提交时 `verify --subject-only`; 除实施提交外不为收尾或已完成 issue 另行验证), 把 `architecture-evidence` 豁免句并入新规则.
- `implement` Skill 第 5 步: "修改实现文件前" 改为 "首次修改本 issue 的实现文件前", 引用上述界定; "实现文件" 指该 issue 交付的所有已跟踪文件 (代码, 测试, 文档, 规则, 含它的治理 Input), 不含 `.scratch` 中该 issue 的 issue 文件与就绪记录. `commit` Skill 第 8 步改为先确认授权 issue 文件没有未暂存修改 (`git diff --quiet -- <issue 文件>`), 再运行 `verify --subject-only`. `arw-commands` Skill 与主 spec 的命令列表补 `[--subject-only]`.
- 主 spec (`docs/specs/agent-repository-workflow/spec.md`): 实施 issue 一行 (约第 39 行) 的 "在完成与实施提交前满足" 改为开始实施前满足, 提交时 subject 未变; 命令列表 (约第 190 行); Spec Readiness 一节: 约第 43 行 "修改实现文件前须取得当前有效就绪结果" 改为首次修改前, 约第 45 行 "任一治理输入, 审核对象, Reviewer Role 或结果绑定变化都会使旧记录失效" 限定为开始实施前, 约第 515-517 行 `verify` 一段定义 `--subject-only` 的精确合同, 约第 824 行并行审核的 "当前有效就绪" 改为按设计就绪工作流的时点有效.
- ADR 0006 (含 "两层中的任何问题都关闭式阻止 issue 完成, Commit Audit 与提交授权" 一句) 与 ADR 0023 (含第 9 行并行审核前 "当前有效 Spec Readiness" 和 Decision rationale 中就绪刷新一句) 按 spec `ADR Evaluation` 就地改写, 在各自已有章节 (ADR 0006 的 `Decision rationale`, ADR 0023 的 `Decision` 末尾与 `Consequences`) 中写明原决定, 修改理由与接受成本.
- 其他: 根 `README.md` 与 `README.zh-CN.md` 的命令表, `tests/arw-entry.test.mjs` 的用法文本.

测试: 新增 `--subject-only` 用例 (Input 过期时完整 verify 失败, `--subject-only` 通过; subject 变化时 `--subject-only` 失败; 带开关时记录缺失与 `gap` 结果仍失败, `not-applicable` 例外仍通过; 缺 `--issue` 退出 `2`).

不做: 引擎判断 "已开始实施"; 记录格式升级; 删除 Reviewer Role 绑定.

体积估算 (按 `AGENTS.md` 的 `Efficiency First` 第 7 条, 只计非测试代码): 净增约 +8 行 (`lib/arw.mjs` +4, `spec-readiness.mjs` +4). 净增超过 +16 行时停下说明. 文档和测试不计入.

## Acceptance criteria

- [x] `--subject-only`: 记录有效但某个治理 Input 在记录之后被修改时, `arw spec-readiness verify --issue ...` 退出 `1` 且报告 `Stale Spec Readiness Input`, 加 `--subject-only` 退出 `0`; subject 变化时 `--subject-only` 退出 `1` 并报告 `Stale Spec Readiness subject`. 带开关时记录缺失或结果为 `gap` 仍退出 `1`, `not-applicable` 例外仍退出 `0`, 缺 `--issue` 退出 `2`. 观察: `tests/spec-readiness/` 与 `tests/arw-entry.test.mjs` 新测试断言.
- [x] 用法: `arw` 用法文本含 `[--subject-only]`. 观察: `tests/arw-entry.test.mjs`.
- [x] 文档: `grep -rn "subject-only" .agents docs README.md README.zh-CN.md distribution` 在 `spec-readiness`, `commit`, `arw-commands` Skill, 主 spec 和两份 README 中命中; ADR 0023 不再含 "不以旧结论满足新的完成或提交授权" 的就绪输入刷新要求; ADR 0006 写明就绪只授权开始实施; `spec-readiness` Skill 含 "已开始实施" 的界定.
- [x] 验证与体积: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check` 通过; 新增测试用例的单个测试回调耗时低于 100 毫秒 (按 `test-performance-optimization` Skill 测量); 非测试代码净增不大于 +16. 观察: `git diff --numstat -- lib`.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 799 通过, 0 失败, 1 跳过 (原有). `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check`, `git diff --check` 均通过.
- 非测试代码净增 +2 行 (`git diff --numstat -- lib`: 11 增 9 删), 低于估算 +8.
- 本 issue 自己的验证: 实施期间修改了 ADR 0006 与 ADR 0023 (本 issue 的治理 Input), 完整 `verify` 报告 `Stale Spec Readiness Input`, `verify --subject-only` 通过.
- 新增测试用例回调耗时: `subjectOnly verify ...` 39 毫秒, gap 用例追加断言后 34 毫秒, 均低于 100 毫秒.
