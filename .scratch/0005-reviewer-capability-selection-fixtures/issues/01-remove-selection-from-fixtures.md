# 夹具去除要求选择并重新登记基线

Status: completed

## What to build

用户确认的最终状态见 effort `spec.md` 的 `Solution`: Spec Readiness 夹具不再含 `## Spec Requirement`, 答案键只保留仍有意义的用例, 格式基线按新夹具重新登记.

夹具 (`tests/fixtures/reviewer-capability/spec-readiness-reviewer/`, 不计入体积预算):

- 两个夹具 issue (`common/base/.scratch/0001-reviewer-capability/issues/01-review-readiness.md`, `artifact-promotion/base/.scratch/0001-reviewer-capability/issues/01-review-readiness.md`) 删除 `## Spec Requirement` 章节与 `What to build` 中关于 governing requirement 清单的句子.
- `runtime-migration/expected.json` 删除 4 个只测要求选择的用例 (INPUTS 的 request-consistency 问题用例与 "准确选择" 干净用例, REQUIREMENTS 的图像预览清理 k 为 1 问题用例与 export-retention uncertain 问题用例). `artifact-promotion/expected.json` 删除 `MODULE-DESIGN-MODULES` 的干净用例 "Readiness Module retains its existing non-report responsibilities without overlap" 以保持 k 为 1 档平衡.
- `common/anchors.json` 删除绑定被删用例的锚点 a04, a09, a14, a24 与合成对照 s01, s03; `common/brief.md` 删除 export-retention 判例, 把 "选定" 的含义改为检索到的章节, 并把 `MODULES` 反例序号从 2 改为 1.

格式基线: 按 `reviewer-capability` Skill, 用 Claude 后端 haiku high 对两个子场景各运行 5 次, 修复并计分得到 r 与 T, 归档报告与修复记录到 `format-baseline/archive/`, 更新 `format-baseline/registry.json` 的 `spec-readiness` 项 (`runs`, `sumR`, `sumT`, `pBase`, `pBaseBootstrap90`, 两个 `scenarioSha256`, `archive`, 来源说明).

不做: 修改计分器, Reviewer Role 或其他评分单元的基线.

体积估算 (按 `AGENTS.md` 的 `Efficiency First` 第 7 条, 只计非测试代码): 非测试代码净增 0 行; 改动全部在测试夹具与 `.scratch`.

## Acceptance criteria

- [x] 夹具: 两个夹具 issue 不含 `## Spec Requirement`, `grep -rn "Spec Requirement" tests/fixtures/reviewer-capability/spec-readiness-reviewer --include=*.md` 只可能命中 `brief.md` 中说明其不存在的一句; 答案键加载通过 (k 为 1 档按角色合计的问题用例数等于干净用例数, 删除后均为 3). 观察: `pnpm test` 中套件测试通过.
- [x] 基线: `node scripts/reviewer-capability.mjs baseline spec-readiness` 退出 `0`, 登记 5 次重复 (每次含两个子场景), 其余三个评分单元的 `baseline` 仍通过. 观察: 命令输出 `status: succeeded`.
- [x] 验证与体积: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check` 通过; 非测试代码净增为 0. 观察: `git diff --numstat -- lib` 为空.

## Blocked by

- None - can start immediately

## Validation

- 答案键: k 为 1 档按角色合计 3 对 3 (删除前 4 对 4). 删除的用例: runtime-migration 的 INPUTS request-consistency 问题用例与 "准确选择" 干净用例, REQUIREMENTS 图像预览清理 (k 为 1) 与 export-retention (uncertain) 问题用例; artifact-promotion 的 MODULES "Readiness Module retains..." 干净用例 (k 为 1). 锚点 28 到 24, 合成对照 9 到 7.
- 基线: Claude 后端 haiku high 对两个子场景各 5 次 (10 个实例; 提供方并发上限 4, 分三批运行), 全部 r 为 0, sumT 为 526 (runtime-migration 86, artifact-promotion 440), pBase 取下限 2 / (526 / 5) = 0.0190114, bootstrap 90% 区间 [0.0171821, 0.0208333]. 旧登记 sumT 451, pBase 0.0221729. `node scripts/reviewer-capability.mjs baseline spec-readiness` 返回 succeeded, filesChecked 20; 其余三个评分单元的 `baseline` 仍通过.
- 能力分数: 登记的基线只衡量格式错误率, 不需要盲裁. 10 份报告的下界暂计分数 (全部未裁决候选按失败计, 非定稿) runtime-migration 为 -0.56, -0.56, -0.89, -0.67, -0.89, artifact-promotion 为 -0.56, -0.47, -0.51, -0.53, -0.62. 旧夹具没有对应的同口径分数, 前后分数不可比; 定稿分数需要 sonnet high 以上的盲裁, 未做.
- `pnpm test`: 799 通过, 0 失败, 1 跳过 (原有); 修改夹具后 7 个测试失败 (基线与归档重算依赖登记), 重新登记后全部通过. `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check`, `git diff --check` 均通过. `git diff --numstat -- lib` 为空.
- 本 issue 的 Spec Readiness 经 4 轮 (前 3 轮的发现均为 spec 对 k 档, 序号和删除依据的表述不足, 已补全), 第 4 轮 `No problems.`.
- 旧归档 `archive/spec-readiness-v4.5/` 随旧登记项删除: 它对应旧夹具, 不再被登记引用, 历史在 Git 中.
