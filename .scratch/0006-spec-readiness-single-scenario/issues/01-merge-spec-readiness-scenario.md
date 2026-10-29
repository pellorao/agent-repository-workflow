# 合并 Spec Readiness 能力场景并重新登记基线

Status: completed

## What to build

用户确认的最终状态见 effort `spec.md` 的 `Solution` 与 `Module Design`: Spec Readiness 能力场景合并为 `tests/fixtures/reviewer-capability/spec-readiness-reviewer/spec-readiness/`, 删除只服务于子场景拆分的代码与测试, 并重新测量和登记格式基线.

夹具 (不计入体积预算):

- 新建 `spec-readiness/`, 把原 `common/` 的 `base/`, `candidate/`, `brief.md`, `anchors.json` 并入, 再叠加原第二个子场景的 `base/` 与 `candidate/` 覆盖, 其中撤掉它对 `specs/runtime-migration.md` 和 issue 的覆盖 (恢复 `common` 版本, 使该文档成为被审交付), 并删除与 `common` 逐字相同的冗余覆盖文件. 删除 `common/`, 两个旧子场景目录和 `handoff.md`.
- `expected.json`: 合并两份答案键; 删除 REQUIREMENTS 干净用例 "read-failure 字段集合完整" (`validation-report.md:19`); 两个 `noOtherSupportedFinding` 各合成一个; 新增 MODULE-DESIGN-APPLICABILITY 问题用例 (默认 k), 证据 `specs/runtime-migration.md` 第 5, 11, 23 行, 不区分应写 `Not required` 还是完整格式.
- `specs/runtime-migration.md` 第 5 行改写为不与第 11 行的迁移交付矛盾 (行号不变).
- `repeats.json`: 用例名去掉场景前缀, 按合并后序号重登记. `anchors.json`: 去掉各项 `scenario` 字段, 5 个原第一个子场景的锚点在 `confirmed_by` 补记合并复核. `brief.md`: 所有对旧场景名和 "未选节" 推理的引用改为合并后的说法, 并去掉依赖 issue 选择要求的判例.

代码 (非测试, 估算净增 -95 至 -115 行, 无新增逻辑):

- `scripts/reviewer-capability.mjs`: 删除 `combine` 分派, 头注释与 usage 中的 `combine`; `pool view` 改为一个场景目录.
- `lib/reviewer-capability/operations.mjs`: 删除 `combine` 及只供它用的常量, `ownsFinalScore` (`score` 总给 `final`), 候选 `scenario` 字段, `summary` 中 "需要 combine" 的提示语.
- `lib/reviewer-capability/scoring.mjs`: 删除 `combineScenarios`, `K_COUNT_KEYS`, `SUM_KEYS`, `SCOPE_CONTINUATION_FAILS_CLEAN_CASE` 与 `requirement-scope-continuation` 诊断处理项.
- `lib/reviewer-capability/reports.mjs`: 删除 `allowContinuation`, stopped, continued, keeps 的停止点逻辑.
- `lib/reviewer-capability/pool.mjs`: 删除 `SUB_SCENARIO_VIEWS`, `viewOf`, 池项 `scenario` 字段及对应检查; `poolViews` 对 Spec Readiness 与 Commit Audit 给 `view`, 其余角色给 `view` 与 `change.diff`.
- `lib/reviewer-capability-view.mjs`, `lib/reviewer-capability/scenario.mjs`: 视图改为单目录 (视图名与池键比较的检查随之删除); 删除 `common` 叠加, `sharedPath`, 兄弟答案键循环, `checkAnswerKeys` 改为只收本场景的键.

测试与文档:

- 测试: 删除 `combine`, 停止点, 子场景视图与 `combineScenarios` 的测试, 其余测试改为新路径; 新增或调整测试覆盖: REQUIREMENTS 之后继续检查不被截断且无继续检查扣分诊断, 一次 `score` 含 `final`, `pool view` 单目录.
- `.agents/skills/reviewer-capability/SKILL.md` 与其 `.claude` 投影 (`node scripts/project-claude-skills.mjs`); `docs/specs/agent-repository-workflow-development/spec.md` 中 Reviewer Capability Module 的 Module Design 与测试覆盖清单就地改写.

格式基线: 按 `reviewer-capability` Skill, Claude 后端 haiku high 对合并场景运行 5 次, 修复并计分得到 r 与 T, 归档报告与修复记录到新目录 `format-baseline/archive/spec-readiness-merged/`, 更新 `format-baseline/registry.json` 的 `spec-readiness` 项 (`runs`, `sumR`, `sumT`, `pBase`, `pBaseBootstrap90`, 场景键 `spec-readiness-reviewer/spec-readiness` 及其 SHA-256, `archive`, 来源说明), 删除旧归档 `spec-readiness-no-selection/`.

体积估算 (按 `AGENTS.md` 的 `Efficiency First` 第 7 条, 只计非测试代码): 净增约 -95 至 -115 行; 净增为正时停下说明原因.

不做: 修改 Reviewer Role, 其他评分单元的场景或基线, 已完成 effort 的 `.scratch` 记录.

## Acceptance criteria

- [x] 夹具: `tests/fixtures/reviewer-capability/spec-readiness-reviewer/` 下只有 `repeats.json` 和 `spec-readiness/`; 答案键加载通过 (k 档平衡, 无重复问题); 新增 APPLICABILITY 问题用例存在. 观察: `pnpm test` 中套件测试通过; `ls` 该目录.
- [x] 旧名: 在 `.scratch` 历史记录以外, 仓库中不再有把旧子场景名当作场景, 目录, 登记项, 归档, 代码, 测试, Skill 或规范名称的用法 (合成仓库的 `specs/runtime-migration.md` 文件与 "Runtime Migration" 标题除外). 观察: `grep -rniE "runtime-migration|artifact-promotion" . --exclude-dir=.git --exclude-dir=.scratch --exclude-dir=.tmp --exclude-dir=node_modules` 的命中只来自合成仓库内容 (夹具中 `specs/runtime-migration.md` 的路径, 标题与引用).
- [x] 代码: `combine`, `combineScenarios`, 停止点逻辑, `ownsFinalScore`, 候选 `scenario` 字段, `common` 叠加和兄弟答案键都已删除; `score` 对 Spec Readiness 给出 `final`; `pool view` 只接受一个场景目录. 观察: 对应测试通过; `git diff --numstat -- lib scripts` 的净增为负.
- [x] 基线: `node scripts/reviewer-capability.mjs baseline spec-readiness` 退出 `0`, 登记 5 次重复 (每次一份报告), `baseline code-standards`, `baseline code-spec`, `baseline commit-audit` 仍通过. 观察: 四条命令输出 `status: succeeded`.
- [x] 验证与耗时: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check` 通过; 新增或改动测试的单个回调不超过 100 毫秒.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 798 项全部通过 (含新增与改动的套件测试, 单个回调均未超过 100 毫秒阈值), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check` 通过.
- 非测试代码 (`lib`, `scripts`) 净增 -131 行 (新增 74, 删除 205); 测试净增 -53 行 (新增 25, 删除 78).
- 基线重测: haiku high 5 次, 每次一份报告, 5 次 r 均为 0, sumT 398 (79, 83, 78, 75, 83), pBase 0.0251256 (取下限 2 / (sumT / 运行数)), bootstrap 90% 区间 [0.0243902, 0.0259067]. 旧登记 (两个子场景, 每次两份报告) sumT 526, pBase 0.0190114. 两者场景不同, 分数不可比. 归档在 `tests/fixtures/reviewer-capability/format-baseline/archive/spec-readiness-merged/`, 旧归档 `spec-readiness-no-selection` 已删除. `baseline` 对 `code-standards`, `code-spec`, `commit-audit`, `spec-readiness` 四个评分单元均成功.
- 旧名 grep: `.scratch` 以外只剩合成仓库内容 (`specs/runtime-migration.md` 路径, 标题与引用).
- 偏离: `pool view` 对 Spec Readiness 只写 `view` 与脱敏 `REVIEWER-REQUEST.json`, 不写 `change.diff`; `repeats.json` 的用例名保留 `<场景名>:` 前缀 (Spec Readiness 为 `spec-readiness:`), 与其他角色一致.
