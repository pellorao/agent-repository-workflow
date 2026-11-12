# requirements Reviewer 补复审指针并统一前轮报告的证据地位

Status: completed

## What to build

`docs/agents/roles/requirements-reviewer.md` 是三个 Reviewer 角色里唯一没写复审按 `../reviewer.md` 的 Re-review 节进行的: Instructions 无条件要求每轮全量差异回归检查, 与 `reviewer.md` Re-review 的 "前轮已完成且未受影响的内容不再审核" 字面冲突; Inputs 又把自己前轮的报告列为证据, 而 `reviewer.md` 说前轮报告不作为当前证据. 以 `reviewer.md` 为准: 在差异回归检查段末补 "首轮完成全部适用检查; 复审按 `../reviewer.md` 的 Re-review 节进行, 差异回归检查只覆盖相邻版本变化中的改动文件", 并在 Inputs 把前轮报告限定为只用于确认已有覆盖. 能力测试不过时改走选项 B: 在 `reviewer.md` Re-review 写明 requirements 的差异回归每轮全做.

体积预算: 文档净增约 100 字符.

预期验证: 按 `reviewer-capability` Skill 在 requirements 两个场景 (`code-spec`, `commit-audit`) 做 A/B (Codex `gpt-6-luna` `xhigh`, 盲裁 sonnet high), 同批按 `source-checkout-reviewer-testing.md` 待测项补测 `4e285e8` (code-standards 场景, 对照只还原该提交对根 `AGENTS.md` 的改动). 套件没有多轮场景, A/B 只证明首轮不退步, 复审行为测不到.

## Acceptance criteria

- [x] 角色文件与 `reviewer.md` 不再有复审范围与前轮报告证据地位的字面矛盾.
- [x] A/B 按 Skill 规则接受 (或改走选项 B), 结果表写入 Validation.
- [x] `4e285e8` 待测项测完, 结果记入 Validation.

## Blocked by

- None - can start immediately

## Validation

A/B 阶段 1 (每格 3 次, Codex `gpt-6-luna` `xhigh`, 对照与候选交替启动, 盲裁 sonnet high, 三池锚点全对, 合成对照全对, 无剩余候选). 差值 = 候选减对照, 三个场景均值都不低于对照, 按 Skill 接受, 不跑阶段 2:

| 场景 | 对照均值 | 候选均值 | 差值 (95% 区间) | 平均用时 对照/候选 |
|---|---|---|---|---|
| requirements `code-spec` | 0.600 | 0.638 | +0.038 (-0.372..+0.447) | 832 s / 814 s |
| requirements `commit-audit` | 0.674 | 0.760 | +0.086 (-0.071..+0.244) | 726 s / 954 s |
| code-standards (`4e285e8` 补测, 对照只还原 `4e285e8` 对根 `AGENTS.md` 的改动) | 0.473 | 0.511 | +0.038 (-0.332..+0.407) | 628 s / 562 s |

区间下界是本次不能排除的降幅 (最大约 -0.37), 样本 3 次, 区间很宽, 不能写成 "没有降低". 套件没有多轮场景, A/B 只证明首轮不退步, 复审行为测不到. code-standards 的 incomplete (对照 1 次, 候选 2 次) 原因都是场景交接缺少预估净增行数, 与 `4e285e8` 无关 (已知场景问题). inspect 标记 4 个都判为误报 (`/` 分隔符或列出自己运行目录), 结果保留. 结果文件: `.tasks/ARW/c13ab/data/sum-{rs,ca,cs}-3.json`.

## Comments

定稿改法 (按独立 Opus 复核, 与 What to build 的初版措辞不同): (a) `requirements-reviewer.md` 差异回归段末改为 "首轮完成全部适用检查; 复审按 `../reviewer.md` 的 Re-review 节进行.", 删掉 "差异回归检查只覆盖相邻版本变化中的改动文件" (它比 Re-review 窄, 第 2 轮只改 spec 时会漏掉对未改代码的新要求核对), 与 `code-standards-reviewer.md` 的写法一致; (b) Inputs 改为 "证据只来自本轮 Request 和受审版本; 复审时自己前轮的报告按 `../reviewer.md` 的 Re-review 节只用于确认已有覆盖, 不作为当前证据." `distribution/baseline/` 副本同步, 两份一致. `source-checkout-reviewer-testing.md` 待测表中 `4e285e8` 一行已测完, 删除.

不重测: 定稿只删去收窄的表述, 措辞对齐 `reviewer.md`, 首轮行为不变, 上面 Validation 的首轮 A/B 结论仍适用; 套件没有多轮场景, 重测也测不到复审行为.

Spec Readiness: 本 issue 无设计决定, 交付只含规则与文档, 属于 `spec-readiness` Skill 不适用的非实施分类内容, 不生成就绪记录 (生成 `not-applicable` 记录会使它改走实施提交流程, 而无记录时走非实施工作流, 其中改 Reviewer 角色适用一轮 `requirements-reviewer`).

遗留: commit-audit 候选用时 +31%, token 约 1.8 倍 (3 次, 分不出噪声), 下次 requirements A/B 或效率分析时关注.
