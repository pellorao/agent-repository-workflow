# Reviewer 能力夹具去除要求选择

## Problem Statement

effort 0003 删除了 issue 的 `## Spec Requirement` 章节, Spec Readiness Reviewer 不再判断要求选择, 而是根据交付内容自行检索相关既有章节. Reviewer 能力套件的 Spec Readiness 夹具仍带该章节, 答案键仍有专测要求选择的用例, 登记的格式基线对应旧场景. 套件因此测量的是已不存在的行为, 并且 `baseline spec-readiness` 在夹具变化后无法通过.

## Solution

最终状态如下.

- `spec-readiness-reviewer` 的两个夹具 issue (`runtime-migration` 经 `common/`, `artifact-promotion`) 不含 `## Spec Requirement` 章节, `What to build` 不再提到 governing requirement 清单.
- `runtime-migration` 答案键删除只测要求选择的 4 个用例: 问题用例 `request-consistency.md` 未提供 (INPUTS, k 为 0.25), 图像预览清理超出交付 (REQUIREMENTS, k 为 1), 条件性 export-retention 是否属于本 issue (REQUIREMENTS, 结果 uncertain, k 为 0.25), 以及干净用例 "准确选择了 validation-report 要求" (INPUTS, k 为 0.25). 其余用例不变. k 为 0.25 的用例不参与 k 档平衡 (校验只统计 k 不小于 1 的档), 所以只有 k 为 1 的用例影响平衡. 这 4 个用例的期望句都以 "subject 选择了某要求" 或 "该要求是否属于本 issue 的选择" 为前提, issue 不再有选择, 这个前提不再成立. Reviewer 自行检索相关章节后判断无关章节是否扩大范围, 是另一种行为, 需要新的用例, 不在本 effort 内. export-retention 用例的期望句是 "该条件性章节是否属于本 issue", 它判断的是 issue 清单所选章节是否成立; 现在章节不由 issue 选择, Reviewer 只读取检索到的章节, 角色中 "无法确定要求是否属于交付" 的 `uncertain` 分支仍存在, 但它的答案键用例须以检索结果为前提重新设计, 同样不在本 effort 内.
- k 为 1 档按角色合计 (两个子场景的答案键之和) 问题用例数等于干净用例数乘 k: 删除前为 4 对 4 (问题用例: `artifact-promotion` 的 MODULES 两个和 SEAMS-ADAPTERS 一个, 加上图像预览清理; 干净用例: MODULES 三个和 SEAMS-ADAPTERS 一个), 删除 k 为 1 的图像预览清理后为 3 对 4, 因此删除 `artifact-promotion` 的 `MODULE-DESIGN-MODULES` 干净用例 "Readiness Module retains its existing non-report responsibilities without overlap". 选它的理由: 它只断言 Readiness Module 没有重叠, 没有诱导误报的对立问题用例, 在 k 为 1 档中信息量最低; 它不是任何锚点的对象.
- 共用的盲裁 `brief.md` 与 `anchors.json` 与答案键保持一致: 删除绑定被删用例的 4 个锚点和 2 个合成对照, 删除 export-retention 判例, 把 `MODULES` 反例序号从 2 改为 1 (`MODULES` 检查内原有干净用例序号 0, 1, 2 加固定的 `noOtherSupportedFinding` 用例; 删除序号 1 后, 原序号 2 的用例前移为 1, `noOtherSupportedFinding` 用例顺延, 它与序号 0 都不被 brief 引用, 所以 brief 只需改序号 2 的引用), 并把 "选定与未选定 Input" 一条中 "选定" 的含义改为 Reviewer 按 `What to build` 与验收标准检索到的章节 (原指 issue 的 `Spec Requirement` 所选).
- 旧归档 `archive/spec-readiness-v4.5/` 对应旧夹具, 随旧登记项删除, 历史在 Git 中.
- 重新测量并登记 `spec-readiness` 评分单元的格式基线, 沿用已登记的设置 (Claude 后端 haiku, high, 5 次重复, 两个子场景合为一次重复), 使 `baseline spec-readiness` 通过.

## Testing Decisions

- `node scripts/reviewer-capability.mjs baseline spec-readiness` 退出 `0`, 其余登记单元的 `baseline` 不受影响. 防止夹具变化后格式基线与场景不符, 或本次重新登记影响其他评分单元.
- 现有套件测试 (`pnpm test`) 在新夹具下全部通过, 包括重新计分每份归档基线报告得到登记的 r 与 T. 防止登记的 r 与 T 同归档报告不一致.
- 答案键加载校验 (k 档平衡, 期望句与证据不重复) 通过. 防止 k 档失衡和重复问题.

## Out of Scope

- 不修改计分器, 盲裁流程或 Reviewer Role.
- 不重新裁决 Reviewer 模型的能力分数; 登记的基线只衡量格式错误率.
