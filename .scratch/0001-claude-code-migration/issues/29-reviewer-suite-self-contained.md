# Reviewer 能力测试套件自成一体并精简

Status: ready-for-agent

## What to build

用户决定 (2026-10-28), 取代 issue 18 中 "用 qwen_strata benchmark v2 整套替换仓库内 Reviewer 能力验证" 一条: 套件必须在 ARW 内自成一体, 并在迁移时精简.

- 把 qwen_strata benchmark v2 的 Reviewer 测试 (4 个计划的场景夹具, 原始答案键与判例覆盖, 盲裁 brief, 锚点, 评分方法) 搬进 ARW, 替换 `tests/fixtures/reviewer-capability/` 的旧夹具和 ticket 10 简化的 `expected.md`, 并更新 `$reviewer-capability` Skill.
- 去掉补丁链: qwen_strata 以冻结 ARW 源码加 v1, v2 补丁逐版应用的方式物化场景. ARW 内直接保存物化后的最终结果 (base, candidate, handoff, 答案键, brief), 不保留补丁和物化流程.
- 精简代码, 不改最终逻辑: 冻结的 Node 评分器 (约 5 千行, 与冻结 ARW 耦合) 改为直接读取物化结果; qwen_strata 的 Python 盲裁工具 (`blind_pool` 等, 约 3.1 千行) 改写为 Node (用户选择, ARW 只保留一种运行时, 没有第三方依赖). 删除只服务补丁链或冻结 ARW 的代码.
- 等价性验收: 用 issue 18 第一到第三批已有的 Reviewer 报告和裁决, 分别经旧流程 (qwen_strata 原样) 和新流程组池, 生成 brief 和计分, 结果逐字节一致 (盲池随机部分固定种子后比较). 不一致处逐一说明并修正, 直到一致.
- qwen_strata 的内容不修改. 之后由用户让 qwen_strata 删除其补丁形式, 改为复制 ARW 精简后的版本, 不在本 ticket 范围.
- 套件只属于 Source Checkout 维护, 不进入 Workflow Distribution, 也不进入 release 安装包 (issue 30).
- 盲裁裁判至少 sonnet high (issue 18 已写入 Skill).

范围缩减 (Main 2026-10-28 同意): 不移植 pause, format penalty, registry sha 绑定, `anchor-add` 和 0.9 残差截断. ARW 只用无惩罚的上游分数; 这些是 benchmark 记录数据, 不属于能力测试本身. 盲池随机部分用 Python 兼容的 MT19937 (种子 20261020) 以保证字节一致.

报告格式 (Main 2026-10-28 决定): 不为评分改 Reviewer 输出格式. Node 内提供 txt 适配器 (移植 ticket 18 的 `sr_txt2jsonl.py` 与各场景匹配逻辑), 只覆盖当前角色的实际输出. 已知限制: Commit Audit 的 txt 报告没有 satisfied 行, 无法复现 clean-observation 评分, 该场景只评问题召回, 此限制写入 spec. 等价验收对 txt 报告用旧流程 (Python 适配器加冻结评分器) 与新流程分别计分比较. 复用已有 decisions.json, 不重新调用裁判.

开工条件: issue 18 第三批已合入 main (改了 `$reviewer-capability` Skill).

预估净增: 代码约 +2500 (取代约 8 千行原代码), 测试约 +200; 夹具与 brief 等数据约 1.3 MB 另计, 旧夹具 155 KB 删除.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-release/spec.md#reviewer-capability-tests`
- `docs/specs/agent-repository-workflow-development/spec.md#source-checkout-layout`

## Acceptance criteria

- [ ] 4 个计划的物化结果与 qwen_strata 物化结果逐文件一致 (差异清单为空), 旧夹具与简化答案键已删除, qwen_strata 未修改.
- [ ] 评分与盲裁工具为 Node, 不依赖 Python 或冻结 ARW 源码; 等价性验收结果逐字节一致, 记入 `## Comments`.
- [ ] `$reviewer-capability` Skill 用新套件跑通一次 (Reviewer haiku high, 裁判 sonnet high), 结果记入 `## Comments`.
- [ ] 套件不在 Workflow Distribution 和 release 安装包中; 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Comments

阶段 (b) 完成, 阶段 (c) 等价性验收结果 (Worker, 2026-10-28). 中间产物在 `.tmp/t29-*`, qwen_strata 未修改 (`git status` 为空). 全部使用已有报告与裁决, 未调用任何裁判.

夹具: 5 个场景的 `base/`, `candidate/` 与重新物化的旧流程 (`prepare-all.sh`, `.tmp/t29-old/prep/*/arw`) 逐文件一致 (`diff -rq` 为空). `expected.json` 取自旧流程已准备状态 (k 档位已套用), 只保留 `scopes` 与 `auditRecords`. 旧夹具与 `expected.md` 已删除.

等价性 (旧流程为 qwen_strata `blind_pool` 与冻结 r8.5 评分器, 新流程为 `scripts/reviewer-capability.mjs`):

| 范围 | 数据 | 比较内容 | 结果 |
| --- | --- | --- | --- |
| Spec Readiness v4.5 | issue 28 的 4 份 txt 报告与真实裁决 (2 条记录, 2 个池) | 候选 57 + 5 (内容与顺序, 除下述 `scenario` 字段), 池 r1 r2 的 `pool-*.json`, 裁判提示, 裁决库 62 条, 定稿分数 | 池, 裁判提示, 裁决库, 分数逐字节一致; 候选只差 `scenario` 字段 |
| Code Spec v5.1 | 4 份 chg txt 报告, 下界与上界裁决 | 全部分数字段, 逐例得分 | 一致 |
| Code Standards v5.1 | 同上 | 同上 | 补移植短路径补全后一致 |
| Commit Audit v3.1 | 基线 jsonl (base-haiku) | 同上 | 一致 |

不一致与处理:

- 唯一差异: 新候选多一个 `scenario` 字段. 旧流程由实例 id 推出 scenario, 新流程显式写出; 池项和指纹的输入字段不含它, 所以池, 裁判提示, 裁决库与分数不受影响. 这是逐一说明后的有意差异, 不修正.
- Code Standards 在 4 份报告中的 3 份先不一致: 旧流程 `repair_reviewer_report.py` 把只写文件名的反引号定位 (如 `` `a.mjs:3` ``) 补全为唯一同名源文件的完整路径. 已在 txt 适配器移植该补全 (约 8 行), 其余修复 (前言, 散行, 溢出定位) 由 markdown 解析本身覆盖或属基准专用, 未移植. 之后全部一致.
- 旧候选 id 在两条记录间相同 (靠 record 区分), 新流程裁决库不分 record, 所以验收时给每份报告唯一的 `--instance`. 池内容不含 id, 不受影响.
- 与旧流程一致的行为 (等价性所需, 不改): Markdown 锚点区段解析 `markdownSectionRanges` 与冻结评分器一样不识别围栏代码块; 返回字段 `locatorCount` 与 `overrunLocators` 保留, 删除会改变计分输出.
- 未覆盖: `match` 边界 (match.py 的指派) 和 Commit Audit txt 报告 (旧流程没有 txt 适配器, 规格已写明该场景只计问题召回).

### 新套件首次完整跑通 (Reviewer haiku high, 裁判 sonnet high, Claude 后端)

规模: 5 个 Reviewer (haiku high) + 4 个盲裁裁判 (sonnet high, Spec Readiness 两个子场景并一个池) = 9 个 Agent. 约 16:20 起至 17:05, 其中首次启动因 `stateDirectory` 被拒 (见问题 1) 于 16:42 重启; Reviewer 16:42 起 6 到 16 分钟完成, 裁判各 2 到 4.5 分钟.

锚点一致率: 4 个池全部 1.0 (12/12), 合成对照全对, `pool split` 均通过.

计分 (召回 = k 加权问题召回, 误报 = 失败干净用例数, score 为 `score` 输出):

| 场景 | 召回 | 完全命中 | 误报 | score | 备注 |
| --- | --- | --- | --- | --- | --- |
| requirements-reviewer/code-spec | 0.510 | 0 / 20 | 0 | 0.510 | 终值 |
| requirements-reviewer/commit-audit | 0.729 | 0 / 40 | 0 (只计召回) | 0.700 | 终值 |
| code-standards-reviewer/code-standards | 0.718 | 3 / 26 | 3 | 0.706 | 终值 (第二轮 1 个候选裁决后) |
| spec-readiness-reviewer/runtime-migration | 0.574 | 0 / 5 | 2 | 0.467 | 终值 |
| spec-readiness-reviewer/artifact-promotion | 0.795 | 8 / 18 | 7 | 0.642 | 终值 (第二轮 8 个候选裁决后) |

样本量每格 1, 无重复; haiku 在这些场景均未达天花板, 绝对分只作新套件可用性证据, 不作模型结论.

遇到的问题:

1. `setup` 返回的 `stateDirectory` 是目标目录的同级 `state`; 目标放在 `.tmp/t29-cap/` (不在 `.tmp/<platform>/<session>/` 之下) 时, `spawn_agent` 以 `Reviewer recovery path must name a valid session workspace record` 拒绝. 这是合同要求 (Reviewer 恢复记录必须位于会话临时目录内, 能力验证的场景生命周期归调用方), 不是 `setup` 的缺陷; 已修: Skill 步骤 2 明确写出实例不能放在会话目录之外, 不改代码.
2. Skill 原先没写第二轮裁决. 已修: 步骤 7 补上循环 (`candidates` 非空就对新候选再建池, 带新旧裁决库重新 `score`, 直到为空). 本次已按此补完 code-standards (池 cs2, 27 项) 与 artifact-promotion (池 ap2, 29 项) 的第二轮, 两个裁判均为 sonnet high, 锚点一致率 1.0, 合成对照全对, 重新计分后 `candidates` 为空.
3. 裁判提示中的输出示例写 `"adjudicator": "blind Opus high"` (冻结 brief 原文), 与本次实际裁判 sonnet 不符, 不影响计分.
4. Spec Readiness 两个子场景的 view 中同名规格文件内容不同 (设计如此), 裁判按候选所属 view 判断, 无异常.

审核后复验 (Worker, 2026-10-28): 提交审核的修复改了 `evidence.mjs`, `pool.mjs`, `operations.mjs` (公共 JSON 工具来源, 删除 `adjAs`, 输入错误映射) 后重跑等价脚本: Spec Readiness 候选 57 字段差异与顺序同前, 第二轮池 5 项一致; Commit Audit 与 Code Standards 基线报告的上下界分数与旧流程相同. `pnpm test` 728 项 727 通过 0 失败 1 跳过, 分发检查通过.
