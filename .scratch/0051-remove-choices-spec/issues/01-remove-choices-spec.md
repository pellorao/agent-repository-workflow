# 产品 spec 补 workflow remove 的非交互选择规则

Status: completed

## What to build

`docs/specs/agent-repository-workflow/spec.md` 的 `workflow remove` 一段没有规定哪些残留类别需要 `retain | delete` 选择, 也没有规定缺少选择时的行为; `docs/adr/0016-use-repository-owned-agent-projection-configs.md` Decision 写 "对整批作出 `retain | delete` 选择", 字面与实现不一致. 实现 (`lib/repository-workflow/workflow.mjs` 的 `validateRemovalChoices` 与 `runRemove`): 只有本仓库实际存在残留的类别需要选择; 非交互调用缺少必需选择时先输出残留预览, 以退出码 `1` 结束且不执行任何删除; 对没有残留的类别给出选择是用法错误, 退出码 `2`.

- 产品 spec 在 `workflow remove` 一段补一句上述规则.
- ADR 0016 Decision 与理由两处改为按仓库中实际存在残留的类别作出选择, 产品 spec 同句补防止的风险与理由.

体积预算: 文档净增不超过 300 字符.

预期验证: `node arw.mjs text check`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `git diff --check`, `node arw.mjs language inspect` 两份文档.

## Acceptance criteria

- [x] 产品 spec 含非交互 remove 只要求实际存在残留类别的选择, 缺少时只预览并以退出码 `1` 结束不执行, 对无残留类别给选择为退出码 `2` 的规则 (审核对照 `validateRemovalChoices` 和 `runRemove` 核对).
- [x] ADR 0016 不再要求 "对整批" 选择, 与产品 spec 一致 (审核核对文字).
- [x] 上述验证命令退出码 0.

## Blocked by

None.

## Validation

- `node arw.mjs text check`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs terms check --strict`, `git diff --check` 全部通过; `node arw.mjs language inspect` 两份文档均以中文为主 (84.1% 与 88.1%).
- 体积 (`wc -m`): 产品 spec +169, ADR 0016 +16, 合计净增 185 字符, 在预算内.
- 行为依据: `validateRemovalChoices` 对存在残留且选择缺失的类别报 `missing-removal-choice`, 对无残留却给了选择的类别报 `inapplicable-removal-choice`; `runRemove` 先以 `requireChoices: false` 输出预览, 再带选择构建计划, 有诊断即不应用; `lib/arw.mjs` 把 `inapplicable-removal-choice` 映射为退出码 2, 其余为 1. 既有测试 `tests/repository-workflow/workflow.test.mjs` 观察缺少选择时不改锁文件.
- Spec Readiness: 记录 `not-applicable` 例外 (用户 2026-11-02 常设确认), `arw spec-readiness verify` 通过.
- 只删减与合并的自查: 改动是产品 spec 新增一句和一句理由, ADR 0016 两处措辞替换, 没有新增段落, 没有可合并或删除的重复内容.

## Comments

- 提交审核第 1 轮 3 条: ADR 0016 第 31 行 "整批文件" 与第 29 行不一致 (两份报告都提出), 已改为 "每个残留类别整体"; 产品 spec 新增句缺理由, 已补一句防止的风险和理由 (按用户级规则不逐处预先确认, 由用户复核整体 diff). 因 `## What to build` 改动, 已重新记录 `not-applicable`.
- 台账: .scratch/0051-remove-choices-spec/issues/01-remove-choices-spec.md:10 冲突裁决 第 1 轮 code-standards 要求补理由, 范围与预算 (300 字符) 的调整经 Main 接受
