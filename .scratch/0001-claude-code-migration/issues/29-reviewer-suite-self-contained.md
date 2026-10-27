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
