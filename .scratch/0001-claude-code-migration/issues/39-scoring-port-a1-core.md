# 评分体系移植 A: 评分核心, 报告修复, 格式罚与 final, 暂停扣分

Status: completed

## What to build

用户决定 (2026-10-28): qwen_strata 的评分体系完整, 精确地移植进 ARW 的 Reviewer 能力套件 (`lib/reviewer-capability/`); 不由 Agent 自行缩小范围, 认为应砍的内容作为候选交 Main 转用户决定. 用户已明确删除的范围: 有效性判据与 relay/硬时限重判, 预注册比较/成本/速度/导出, harness/prompts/roles/code sha 绑定 (只留锚点, 简报, 夹具 sha 绑定), "blind Opus high" 身份校验, `--accept-failed`, 布局与报告 sha 核对, `model-failures.json` 确认流程和 `pause_basis`. 终态是整套评分体系都在 ARW 内. 按 "issue 宁粗勿细" 原则, 评分核心, 报告修复, 格式罚, pBase 登记与 `final`, 暂停扣分合并为本 ticket 一次提交. 盲裁 pool 工具 (B) 与统计重复 (C) 另票.

本 ticket 移植冻结评分补丁 (`benchmarks/reviewer-suite-v1/arw-patches/scoring-k.patch`, `benchmarks/multi-model-v2/arw-patches/scoring-r8.5.patch`) 中 ARW 尚缺的部分, 以及 `tools/reviewer/bench_score.py` 中对应部分; 新输出字段只增加, 不删除已有字段:

- `kScore` 前置检查: 没有问题用例或 (负分时) 没有干净用例时抛错.
- 加载答案键时 (入口一次校验, 失败返回 `blocked`): 没有问题用例或没有干净用例报错; k = 4 一律报错; 带 k 标记的档位按角色内全部子场景合计必须每档问题用例数等于 k 乘干净用例数; 合并用例 (`merge`) 必须恰好两个同种类, 同 k, 同 `result`, 同证据, 不同范围的用例且不得带 k >= 1; 同一答案键内期望句重复 (合并用例的两个用例除外) 一律报错, 证据重复且未在角色级 `repeats.json` 登记为 `sharedEvidence` 时报错 (`repeats.json` 对应冻结的 `judgment/repeats.json`, 不含 `legacy`; 用例名 `<scenario>:<scope>/<kind>/<n>`, 与同角色全部场景的答案键一起校验).
- 模型失败得 0 (`zeroCapabilityScore`): 报告为空 (或只含空白) 或没有可评分内容时不再 `blocked`, 返回 `succeeded`, 分数 0, 并给出 `modelFailure.reason`.
- Spec Readiness 两子场景融合 `combineScenarios`: 计数相加后再 `kScore`, 融合后 `kTiers` 不平衡抛错; `score` 输出新增 `role` 与 `scenario`; 入口新增 `combine` 子命令, 读取同角色两个不同场景的 `score` 输出 (角色相同, 场景不同, 候选 id 不重复, 才融合).
- 报告诊断 `reportDiagnostics` 全套, `REPORT_DIAGNOSTIC_TREATMENT` (format, record, case, cut) 与 `unrepairableFormatErrors`: 读取报告时 JSON 行无效, 行无效, 证据无效, Commit Audit 要求行缺失, 重复, 冲突, 范围外, 越过停止点等都按冻结的诊断码记录, 不再整体 `blocked`; 越界证据范围另记 `review-evidence-overrun`.
- 0.9 残差折减 (`ARW_CUT` = 0.1, 按 `score - 0.1 * |score|`): 只有不在 `REPORT_DIAGNOSTIC_TREATMENT` 内的诊断码触发. 输出字段按 qwen_strata 命名: `scoreBeforePenalty` (折减前), `rawScore`, `score` (折减后); `final` 在 A3.
- 夹具测试: Spec Readiness 越过停止点 (scope continuation) 写法与冻结补丁等价.

报告修复, 格式罚与暂停 (完整照搬 `repair_reviewer_report.py`, `format_penalty.py`, `bench_score.py` 的 `merge`):

- `repair` 操作: 标量 `lines` 改数组, Commit Audit 要求行位移, Markdown 前言, 散行, 短路径补全, 溢出文件定位转换; 写出副本与 `.changes.json`; 检查副本与记录一致.
- `score` 必须声明 `--repair <changes.json>` 或 `--no-repair`, 必须给 `--agent <list_agents 结果>` (统计暂停, 去重 `messageId`); 输出 `rRepairable`, `rUnrepairable`, `rOverrun`, `finalStatusFormatErrors` (恒 0, 理由写入规格), `r`, `T`, `p`, `pBase`, `f`, `paused`, `pauseCount`, `overallDeduction`, `final`.
- pBase 登记表 `tests/fixtures/reviewer-capability/format-baseline/registry.json` 与归档 `archive/` (四个评分单元的 Haiku x5 基线: code-spec, commit-audit, spec-readiness 取 v2, code-standards 取 v1 条目; 登记以评分单元为键), 场景 SHA-256 (答案键加基线与候选输入) 与登记不符时 `blocked` (用户 2026-10-28: 基线是固定标尺, 只在场景改动时重测); `baseline <unit>` 子命令做归档校验 (`verify_archive`) 与自助区间 (`bootstrap_interval`, 种子 0).
- `combine` 合并格式罚与暂停 (`paused` 取或, `pauseCount` 取最大) 并重算 `final`.
- `$reviewer-capability` Skill 步骤: 阈值暂停通知自动回复 "继续", 完成后卸载前保存 `list_agents` 结果为 `agent.json`; 不改 Reviewer runtime 与 background-agent 接口.

冻结补丁中的 `MODEL_FAILURE_FAILS_CLEAN_CASES` 与 `SCOPE_CONTINUATION_FAILS_CLEAN_CASE` 开关固定为 `false` 与 `true` 的现行值, 在代码中以具名常量表示. 不移植 judgmentBinding 与 registry 覆盖 (ARW 的 `expected.json` 已含 k). 融合输出保留逐实例明细 (`caseScores`, `scopes`).

预估净增: 代码约 +1000 (含测试), 夹具数据约 0.5 MB (归档基线报告与修复记录) 加 `repeats.json` 两份约 +40 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-development/spec.md#reviewer-capability-suite`
- `docs/specs/agent-repository-workflow-release/spec.md#reviewer-capability-tests`

## Acceptance criteria

- [x] 评分核心各项实现 (前置检查, 答案键加载校验, 模型失败得 0, 诊断与残差折减, 融合). 观察: 确定性测试覆盖各 `blocked` 与成功分支, `score` 输出含 `reportDiagnostics`, `scoreBeforePenalty`, `rawScore`, 已有字段不删.
- [x] `repair` 各修改种类实现. 观察: 对归档基线报告重跑 `repair`, 修复记录的计数与归档 `.changes.json` 一致.
- [x] 格式罚, pBase 登记, `final`, 暂停扣分实现. 观察: 对归档基线报告计分, `rRepairable`, `rUnrepairable` 与 `rOverrun` 等于登记的各次运行值, `T` 与登记值的差异逐项记入 `## Comments`; `baseline <unit>` 对四个评分单元返回登记的 pBase 与区间; 场景答案键改一字节即 `blocked`; 用由 qwen 记录构造的 `agent.json` 核对 `paused` 与 `pauseCount`.
- [x] 与开发规格 `#reviewer-capability-suite` (已在实施前更新) 和 `$reviewer-capability` Skill 一致. 观察: `arw text check` 通过, 规格各 Interface 字段在测试中被断言.
- [x] 与旧流程等价: 对 `.tmp/t29-old` 的冻结评分器和 qwen_strata 只读工具, 已有基线报告的 `score`, `rawScore`, 各计数与 `final` 一致, 比较记入 `## Comments`.
- [x] 测试回调均不超过 100 毫秒; 全量测试, 类型检查, 分发检查, `arw text check`, Skill 投射检查通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 756 通过 / 0 失败 / 1 跳过 (每个回调不超过 100 毫秒); `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check` 通过; `arw spec-readiness verify --issue issue:0001:39` 退出 `0`.
- 回归测试 (`tests/reviewer-capability/format-penalty.test.mjs`): 对 25 份归档基线报告逐份重跑 `repair` 与 `score`, 每次运行的 `rRepairable`, `rUnrepairable`, `rOverrun` 与 `T` 必须等于登记值, 无需模型运行即可发现基线标尺漂移.
- 等价核对 C (脚本 `.tmp/t39-eq/compare.mjs`, 只读 qwen_strata): 对 `code-spec-v5.1`, `commit-audit-v3.1`, `spec-readiness-v4.5` 各 5 次运行 (共 15 次), 用归档修复记录, 由 qwen 的 `instance.json` `arw_pause_events` 构造的 `agent.json` (含重复通知以检验按 `messageId` 去重), 以及与冻结流程相同的下界裁决 (所有待裁候选取 `not-matched` 或 `unsupported`, 候选数与冻结的 `decisions` 逐次相等), 计分 (Spec Readiness 再 `combine`), 与 `work/<场景>/a<k>/score.json` 逐字段比较 `scoreBeforePenalty`, `arw_score`, `rawScore`, `arw_cut`, `r`, `rRepairable`, `rUnrepairable`, `rOverrun`, `T_locators`, `p`, `f`, `overall_deduction`, `final` 与逐实例 `locatorCount`, `rawScore`: 15 次中 14 次完全一致 (含 Commit Audit `haiku-4` 的 145 次暂停, 暂停数与 `paused` 均一致). 唯一差异是 Spec Readiness `haiku-3` 的 `f`, `overall_deduction`, `final`: 冻结值隐含 pBase 0.05, ARW 用登记的 0.0221729; 冻结 `score.json` 写于 05:39, 登记 v2 基线写于 05:43, 即冻结当时用的是旧基线, 不是移植偏差 (`f = 0.1 * min(1, (1/43) / (2 * 0.0221729)) = 0.05244`).
- code-standards 无冻结的计分记录 (v1 套件没有对应 `score.json`), 只比较了 `r` 与 `T` (回归测试), 其余字段未比较.
- 净增: 代码与测试约 +1023 / -66 (净 +957, 含新增文件 `format-penalty.mjs` 94 行, `repair.mjs` 228 行, 测试 171 行), 数据 `format-baseline/` 824 KB (含 3 个 spill 文件), 两个 `repeats.json`; 估算 +1000 行与约 0.5 MB.

## Comments

- 范围由 A1 扩为 A1 至 A4 (Main 决定); 暂停采集放在 Skill 步骤 (`wait` 返回暂停通知后发 "继续", 完成后在卸载前保存 `list_agents` 结果为 `agent.json`), 不改运行时或后台 Agent 接口; 因此 `finalStatusFormatErrors` 恒为 `0`, 理由写入规格.
- Spec Readiness 共 18 轮 (haiku high). 第 13 轮首次 `No problems.`, 之后登记改键, 场景哈希范围和摘要定义变化使记录失效, 第 14 轮线程不可靠, 按规则用 `spawn_agent` + `newThread: true` 替代; 第 18 轮 `No problems.`.
- 与 qwen_strata 的偏离: 登记以评分单元为键 (qwen 以角色加哈希), 因为 `requirements-reviewer` 目录含 `code-spec` 与 `commit-audit` 两个独立评分单元; 键 `scenarioSha256` 覆盖答案键加基线与候选输入 (用户决定: 场景改动才重测, 哈希不符必须报错, 只哈希 `expected.json` 范围太窄), 登记值按 ARW 夹具重算. `scoringPatchSha256` 与 `archive` 原样保留为只读数据 (Main 决定); 只去掉由 `runs` 派生并以 pBase 核对的 `pooled` 与 `floor`.
- 等价核对发现并修正三处移植错误: (1) Commit Audit 报告在冻结流程里先经 ARW 的 `validateCommitAuditReviewForCapabilityScoring` 规范化 (同文件证据合并, 行号排序, 相邻或重叠行并为区间), 移植版漏了, 使 `T` 偏高 (217, 243, 205, 213, 225 现与登记完全一致); (2) Spec Readiness 的 subject 只含 `## What to build` 至 `## Acceptance criteria` 结尾的片段, 移植版用了整份 issue, 行号偏 4, 使 `haiku-1` 的 `T` 为 103 而非 101; 现 subject 片段与冻结 Request 的 subject 逐字节相同; (3) Spec Readiness 无效行 (check 名未知, result 或 finding 无效, 键集合不符, finding 首尾有空白) 按冻结评分器计 `review-format-invalid`, 此前误记为 `review-row-invalid`.
- 场景等价证据: `commit-audit` 答案键 (`scopes`, `auditRecords`) 与冻结 prepared 契约逐值相同 (比较 `.tmp/t29-old/prep/commit-audit-v3.1`); `commit-audit`, `code-spec` 的 `base/` 与 `candidate/` 与冻结准备树 (`work/<场景>/a1/prep/arw/tests/fixtures/...`) `diff -rq` 无差异; Spec Readiness 的 `common/base`, `common/candidate` 与冻结的 `scenario/base`, `scenario/candidate`, 以及 `artifact-promotion/candidate` 与 `scenario/full-review/candidate` 无差异, subject 片段与冻结 Request 的 subject 相同.
- 项 D 已验证: 3 个 spill 文件 (sha256 与 `.changes.json` 记录一致) 归档到 `format-baseline/archive/code-spec-v5.1/haiku-2` 与 `haiku-4`; 带 spill 重跑 `repair` 得到的 `changes`, `details` 与 `diagnostics` (含 `haiku-4` 的 `inRangeSpillReadable: 1`) 与归档记录一致, 回归测试也使用它们. 归档里没有实际发生 spill 转换 (`changes` 为空), 转换本身只由单元逻辑覆盖.
- 提交审核第 1 轮 (requirements-reviewer 与 code-standards-reviewer, haiku high): 已修正 SR 停止点之后的行格式诊断 (只记保留检查的), 模型失败时干净用例全部通过 (与规格一致), CLI 缺少 `--agent` 返回 `blocked`, `baseline` 校验归档的溢出文件 SHA-256, 短定位补全与行数计数只保留 `repair.mjs` 一份 (消除末尾换行的不一致), 答案键 k 档平衡复用 `unbalancedKTiers`, 删去不可达三元与未用绑定, `complete` 改名 `ownsFinalScore`, 去掉文件内部名称的 `export`; 规格改为 pBase 下限用 "运行数", 并说明 `review-row-invalid` 只在处理表中保留, 本 issue 期望句重复一律报错的措辞与规格对齐. 第 2 轮后又修正: 行诊断按冻结计分器与检查共用一个停止点谓词, 共享的 Markdown 定位规则与行数计数移入 `evidence.mjs` (`scoring.mjs` 复用), Commit Audit 要求行映射移入 `repair.mjs`. 规格因 Spec Readiness 复审补充 (合并用例例外, 诊断码映射, 溢出文件归档位置), 复审 4 轮后 `No problems.`. 加载答案键条款的措辞已核对冻结实现: qwen `check_repeats` (`tools/reviewer/freeze_arw_source.py:327-339`) 只允许 `sharedEvidence` 登记证据组, 期望句重复除合并用例与 `legacy` 键外一律报错, 因此规格与代码正确, 只有 issue 措辞不精确, 已改正. `legacy: true` 豁免 (保留旧版答案键只用于重判旧报告) 未移植, 是删减候选, 交 Main 转用户决定. 停止点之后的诊断按冻结计分器 (`scoring-k.patch` `withoutScopeContinuation`) 处理: 只有审核越过停止点后才丢弃其后检查的行诊断, 检查与诊断共用一个谓词. 保留 (不改): 两个具名开关常量 (Main 要求命名, 理由在相邻注释), 计分器与加载校验的证据集合读取和 `zeroCapabilityScore` 的合并分组 (结构不同, 合并的体积收益小), 测试的登记样板 (两处各几行).
