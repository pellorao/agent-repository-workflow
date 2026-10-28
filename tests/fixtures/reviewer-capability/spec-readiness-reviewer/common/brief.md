# Spec Readiness v4.5（修订号 48）盲裁 brief（multi-model-v2 草案）

多模型 benchmark v2 草案（2026-10-24，未冻结；由冻结的 v1 brief 改出，改动见 [v2 计划](../plan.md#4-歧义题目)），冻结后正式盲裁原样使用，只替换下文的 `<ADJ>`（调用方给出的裁决工作目录）与 `<名>`（池名）。

你是盲裁决者。任务：对候选池中每个候选给出一个决定。你看不到候选来自哪个模型、哪次运行；不要试图推断。

## 输入

- 候选池：`<ADJ>/pool-<名>.json`（调用方给出名字）。每项有 `id`、`group`（同一期望句的候选归为一组）、`kind`、`scenario`（`runtime-migration` 即 RM，或 `artifact-promotion` 即 AP）、`check`（被审报告中 finding 所在的检查）、`allowedDecisions`、`expectation`（答案键问题用例的期望句；`finding` 类候选为 null）、`finding`（被审报告的 finding 正文）、`result`（gap/uncertain）、`evidence`（报告给出的证据定位）；`finding` 类另有 `problemOptions`（可补关联的问题用例及其期望句）和 `cleanTargets`（被提名的干净用例）。
- 被审的规格与上下文（只读）：`<ADJ>/view-rm/` 与 `<ADJ>/view-ap/`，分别是两个子场景 reviewer 所见的场景根；各自的 `REVIEWER-REQUEST.json` 是该子场景的 Reviewer Request（列出选定的 Input 及章节）；行号以其中 `inputs[].content` 与 view 中的文件为准。按候选的 `scenario` 只读对应的一个 view。核实 finding 是否有依据时只读这两处，不读工程其他目录、`.tmp` 其他目录、答案键或任何运行目录。
- 不运行被审材料（本场景的 Input 都是文档）；只读文件。唯一例外是「输出」一节要求的那条 python 核对命令。

## 决定语义（ARW 原文，冻结 ARW `docs/agents/reviewer-capability-verification.md`「Adjudication」节，原样）

## Adjudication

对于 `needs-adjudication`, Main Agent 根据当前场景和适用要求, 将每个候选中冻结的 `expectation` 与同一候选中规范化的 finding 正文, 结果和证据逐项比较, 判断是否表达同一个真实缺陷. 所有候选都需要决定, 不因词组匹配而自动接受, 也不因同题已有另一条匹配而跳过. 无法确定时选择 `not-matched`. Main Agent 只决定是否关联, 不改写结果类别, 原始文本或证据, 不跨 finding 拼接, 也不直接调整分数或门禁. 验证器以确认后的关联按[最终评分规则](reviewer-capability-scoring.md#final-score)计算批次结果. 写入格式严格为 `{ "decisions": [{"candidateId": "<candidate-id>", "decision": "matched", "reason": "<non-empty reason>"}] }` 的临时 JSON 对象. 拒绝配对项时使用 `not-matched`. 返回的每个候选项必须恰好出现一次, 且不得包含其他候选项. 然后使用相同的 `--prepared` 和 `--input`, 加上 `--adjudication <decisions-path>`, 再次运行 `verify`. 临时决定文件没有模式版本, 持久兼容承诺, 候选内容哈希, 响应摘要值或修改绑定. 第二次调用从相同输入重新建立完整候选集合, 拒绝格式错误, 缺失, 重复或多余的决定. 只有 `matched` 配对参与问题关联和后续评分; `not-matched` 不建立关联. 该两阶段路径同样适用于定向迭代和发布验证. 面向人的结果按最终评分规则展示.

本工程计分升级 r7: 每个候选带 `kind` 与 `allowedDecisions`. 关联候选 (`kind: "association"`) 的决定仍为 `matched` 或 `not-matched`, 并附问题用例 `findingTerms` 作 `referenceTerms`, 仅供参考. 一个 finding 的全部关联候选都已决定且都不是 `matched`, 或它没有关联候选时, 形成发现候选 (`kind: "finding"`, `candidateId` 含 `unassociated`), 附被证据与概念规则提名的干净用例 (`cleanTargets`) 和本范围可补关联的问题用例 (`problemOptions`); 决定取 `problem-N` (补关联到第 N 个问题用例, 按该 finding 的证据计分), `false-positive:clean-N` (确认误报第 N 个干净用例, 只能选被提名的), `unsupported` 或 `supported`. 序号均从 1 起按范围内声明顺序计. 候选集合随关联决定变化, 所以验证器先按提供的决定重新计分, 再核对决定: 每个决定必须对应这次计分的一个候选且取允许值, 否则失败; 仍缺决定的候选以 `needs-adjudication` 返回, 补齐后把全部决定写入同一文件再次运行. 判断不了时, 关联候选选 `not-matched`, 发现候选选 `unsupported`.

本工程补充（评分 r7、r8，冻结 ARW `docs/agents/reviewer-capability-scoring.md` 的升级说明）：`problem-N` 指 finding 与第 N 个问题用例的期望句表达同一缺陷（标准与关联候选相同），只是没有形成关联候选。越过停止点之后的检查内容已由计分器忽略，不会出现在池中。

本工程补充（multi-model-v2 统一口径，四份 brief 逐字相同，`tools.reviewer.check_briefs --suite v2` 核对）：
- `matched`：一条 finding 写出多个具体缺陷时，其中一个与期望句是同一问题即 matched，其余缺陷不影响该关联；发现候选选 `problem-N` 时同理（[裁决先例](../../reviewer-suite-v1/rulings.md)「一条 finding 讲了两个缺陷，原样贴在几行上」）。
- `supported`：finding 有依据，但不对应本位置（finding 所在的检查或要求行）`problemOptions` 中任何列出的问题用例，不得分也不扣分。包括答案键外的成立缺陷，也包括答案键里的缺陷挂在了别的位置：同一缺陷在正确位置的漏报已按漏报计，不再扣第二次（[裁决先例](../../reviewer-suite-v1/rulings.md)「答案键里的缺陷挂在了别的位置」）。
- `unsupported`：无依据，计一个失败干净用例。同一句通用 finding 原样贴在多个位置的，即使碰巧说中某处的答案也按无依据判：关联候选判 `not-matched`，发现候选判 `unsupported`（[裁决先例](../../reviewer-suite-v1/rulings.md)「模板式的通用 finding 原样贴在多行上」）。一条 finding 写出了两个具体缺陷、原样贴在几个位置的，文中讲到的那一处照常判；没讲到的各处同样按通用句判（关联候选 `not-matched`，发现候选 `unsupported`；Commit Audit 挂在已满足要求行上的按 r8.1 判该行误报），不适用上一条中"答案键里的缺陷挂在了别的位置"那一句（[裁决先例](../../reviewer-suite-v1/rulings.md)「一条 finding 讲了两个缺陷，原样贴在几行上」）。主结论或复现例子与被审材料的实际行为相反（照它去修改不掉真缺陷）的，按无依据判。以下三种不按无依据判（[裁决先例](../../reviewer-suite-v1/rulings.md)「finding 的机制写对了，但结论或例子与代码相反」第 (2)–(4) 款）：主结论和复现都成立，只是个别措辞写反的，按所讲缺陷照常判：与本位置列出的某个问题用例是同一缺陷即 `matched` 或 `problem-N`，否则判 `supported`（先例中那条 finding 所讲的缺陷不是所挂行的问题用例，关联判 `not-matched`、发现候选判 `supported`）；机制说明自相矛盾，但复现的情形实测属实的，判 `supported`，不对应该问题用例（缺陷存在，所以不算误报；所述原因与答案键要求的点相反，所以不算命中）；finding 指出的问题属实，但把答案键缺陷背后的错误意图当成正确要求的（照它修会坐实该缺陷），判 `supported`，不对应该问题用例。
- `false-positive:clean-N`：finding 把被提名的第 N 个干净用例所描述的成立内容当成了缺陷。finding 主张的问题就是某个没有被提名的干净用例所描述的成立内容（照它修会破坏该内容）时，判 `unsupported`，不判 `supported`：它主张的问题本身不成立，与"缺陷属实、只是位置不对"的 `supported` 方向相反。finding 指出的问题属实、只是修法建议欠妥的（包括修法与某个干净用例所描述的成立内容相反），按问题本身判，修法不作判据。
- 判断不了时，关联候选选 `not-matched`，发现候选选 `unsupported`。

## 本场景口径（Spec Readiness v4.5）

依据：`benchmarks/reviewer-suite-v1/spec-readiness-v4.md`（v4.2、v4.3 两节）、冻结 Role `docs/agents/roles/spec-readiness-reviewer.md`、答案键（`expected.json` sha256 `74252e0aa4e50d231efaefdfa24a27e1b4d97936e747425787d30bace996a344`，k 覆盖文件 `judgment/spec-readiness-v4.2.json`）。v4.5 相对 v4.3 只改三行措辞（RM、AP 两份 view 相同），行数与答案键与 v4.3 相同：v4.4 把 `promotion-recovery.md:65`、`:85` 中被拒绝自报的 caller 写明为 promote 的 caller；v4.5 把 `promotion-runtime.md:11` 的"Promotion 信任此前置条件, 不增加 public 参数"改为"不增加 public 参数或失败分支"，与 `:45` 对 retentionDays 的写法一致（修订号：v4.4 为 47，v4.4 brief 标题漏改）。

- 两个子场景是两道独立的题：RM 只审 `SPEC-READINESS-INPUTS`、`SPEC-READINESS-REQUIREMENTS` 两项需求检查，这两项的问题用例与干净用例都只属于 RM；AP 是全量审查，这两项在 AP 只有 `noOtherSupportedFinding`，其余 9 项检查的用例都属于 AP。候选只按它所属子场景的 view 与答案键判断，不因另一子场景有同一缺陷而改判。
- 期望句描述一个规格缺陷。finding 与它表达同一个缺陷（同一对象、同一错误含义）才算 `matched`；只讲同一 Input 或同一检查下另一个问题的 finding 不算。finding 另外还写了别的缺陷，不影响已对上的那一个（见上文统一口径的 `matched` 一条）。finding 的结果类别（gap/uncertain）与期望不同，但所说的缺陷相同时仍算匹配，结果分由评分规则处理；裁决者不因结果类别改判。
- 选定与未选定 Input：Role 原文"未选择的章节或 Input 只有在其声明角色支持当前使用方合同或责任归属时才作为比较证据, 不能变成 issue 要实现的要求或独立审查范围."
- 答案键内的缺陷报在没有其 placement 的检查下（不是该问题用例的候选，`problemOptions` 中也没有它）：按上文统一口径判 `supported`。v4.2 正式计分的先例：一条把 MODULES#0 的重复校验所有权报在 DEPENDENCIES-DATA-FLOW 下的 finding 判 `supported`（经独立审查确认），与下文 m2 的判法相同。
- 豁免两项检查的分工：`MODULE-DESIGN-APPLICABILITY` 判该不该用 Module Design 豁免（改变了 caller-visible Interface 的规格不得豁免），`MODULE-DESIGN-EXEMPTION` 判可以豁免时豁免理由是否具体。主张 `result-summary.md` 不得豁免的 finding 属于 APPLICABILITY 的问题；主张 `parser-scan.md` 的豁免理由空泛、没说明 Module 边界为什么不变的 finding 属于 EXEMPTION 的问题。报在另一项检查下时按上一条判 `supported`。
- 读法：下文"正例 N""反例 N""MODULES#0"是答案键在该检查内从 0 起的序号，与 `problem-N`、`false-positive:clean-N`（从 1 起）不同；选 `problem-N` 或 `clean-N` 时一律按 `problemOptions`、`cleanTargets` 中的期望句内容对应，不按序号换算。`prc` 指 `promotion-recovery.md`，`prt` 指 `promotion-runtime.md`；文中文件名省略了 view 内的 `specs/` 目录前缀。
- `prc:65`、`:85` 的读法（v4.4）：这里的 caller 指 `promote(inputPath)` 的调用方，即 Promotion 的公开调用方，不是 `recoverPromotion` 的调用方。`prc:19` 规定 `recoverPromotion` 的输入含 failedCommitId 与 commitFailureCode，由它的调用方 Promotion 按 `:65` 从失败尝试记录取得后传入，与 `:65` 不矛盾。只就 caller 指谁立论的 finding——主张 `:65` 与 `prc:19` 矛盾，或主张 `recoverPromotion` 的直接调用方（Promotion）传入这两项就是被拒绝的"自报"——判 `unsupported`。以 `:65` 为证据讲其他缺陷的 finding（例如交接或重复校验）不受本条影响，照常判。
- request binding 失配（v4.5）：`prt:11` 写明 artifact.requestId 与 request.requestId 相等、inputPath 等于已绑定路径是 Readiness 在调用 Promotion Persistence Interface 之前确认的内部前置条件，Promotion 信任它，不增加 public 参数或失败分支（`:97` 也写明不作为公开合同单独测试）。所以主张 binding 失配缺少失败结果或诊断的 finding（例如 `:41` 只定义了 missing、non-string、empty 三种 inputPath，`:51` 或 architecture 的诊断没有 binding 一项），RM 与 AP 都判 `unsupported`。指出 Promotion 在 `prt:27` 再次验证 request、与 Readiness 重复的 finding 不属于本条，按 MODULES 正例 0（Readiness 与 Promotion 重复校验）判；要求补上失配结果或把 request 传给 Promotion、好让这次再次验证做得成的 finding，按统一口径 `unsupported` 一条的第三种判 `supported`，不对应该问题用例。
- 冻结前的逐项裁决口径（`spec-readiness-v4.md`「裁决 brief（新用例）」一节正文，原样；sha256 743abf4708ebc55b1f9fc5dbd594774943395c11b65a39666da00f6a6e155b64）：

- MODULES 正例 1：指出 Promotion 提前返回、绕过 Recovery 交接，或与 `promotion-runtime.md:41/:45/:57`、`promotion-recovery.md:65/:73`、`architecture/02-commit.md:5` 的交接或传播表述不一致的 finding，与重复校验是同一缺陷，判 matched。这类 finding 若同时成为 DEPENDENCIES-DATA-FLOW 正例 0（缺权威来源表）或正例 1（Promotion Flow 缺 Artifact Storage 读取调用）的候选，按各自缺陷判 not-matched。
- SEAMS-ADAPTERS 正例 0：指出 Data Flow（`access-review.md:55`）只写 Seam 的 allowed decision、未提 Module 的检查，或 allowed decision 有两个来源的 finding，与重复授权策略是同一缺陷，判 matched。针对"Seam 允许、Module 拒绝"分支缺少测试的 finding，属于同一缺陷或证据不足，不另算问题（审计 m1）。
- MODULES 反例 2 与 MODULES 正例 1 的区分：指出 Promotion 在 `prc:31` 按 Invalid Input Diagnostic 顺序检查 recovery input、与 Recovery 重复的 finding 属于正例 1，不算反例 2 的误报；只有把 Promotion 的持久化前置检查（`prt:31`）与 Recovery 的输入校验当成重复的 finding，才算反例 2 被误报。
- SEAMS-ADAPTERS 反例 4 与 SEAMS-ADAPTERS 正例 0 的区分：指出 Access Review 与 Policy Adapters 重复授权策略的 finding 属于正例 0；只有声称 Artifact Reader Adapters 与 Validation Report Module 重复持有校验或结果策略的 finding，才算反例 4 被误报。

- 第 2、3 轮审计补充（m1、m2、m5，冻结前补齐，冻结后改 brief 就不能沿用已有裁决）：
  - RM 键外疑点（m1）：`runtime-migration.md:5`（Scope 只写 reader guide）与 Requirements 的"不一致"或"migration 未定义"，判 `unsupported`：Scope 未被选择，按 Role 只能作比较证据，不构成独立审查范围（Role 对未选章节的限制针对的是范围扩张：审查者不得把未选章节当作新的审查对象）；`:5` 说的是 reader guide 本身不拥有 runtime behavior，与 `:11` 的迁移要求不矛盾；判 `supported` 又会与"夹具不得含清单外受支持缺陷"冲突（第 2 轮建议 `supported`，第 3 轮改判，按第 3 轮执行）。选定 Requirements 把部分失败结果委托给未选 Interfaces 节（`access-review.md:15`、`promotion-runtime.md:11`、`promotion-recovery.md:19`）的 finding，判 `unsupported`。
  - MODULES 正例 1（m2）：上面的交接与传播表述清单加上 `promotion-recovery.md:11`（commit 失败后必须先完成 rollback attempt，而 Promotion 提前返回时不调用 Recovery）；MODULE-DESIGN 检查下判 matched，AP 中归到 REQUIREMENTS 的判 `supported`。
  - SEAMS-ADAPTERS 正例 0 类 finding（Module 与 Adapter 重复授权策略）因证据含 `access-review.md:51` 而成为 INTERFACES 正例 1 的候选时，判 not-matched（m5，Opus 盲答已实际出现）。
  - 指出 Recovery Storage 成功形状缺失的 finding 判 `unsupported`：`promotion-recovery.md:57` 已给出精确的成功 `recoveryState`（第 3 轮审计修改后）。

- 未选节（上面 m1 末句的推广，multi-model-v2 新增）：主张选定章节因为把内容委托给或引用未选节而不完整的 finding（m1 末句那一类），以及把未选节本身当作审查对象、主张未选节自身有缺陷的 finding，RM 与 AP 一律判 `unsupported`。例外：选定章节经引用采用的未选节合同（例如选定 Requirements 所引用的 Interfaces 字段定义），可以用来核对选定章节之间的冲突或缺失，这类 finding 照常判断（Role 原文见上：未选章节在其声明角色支持当前使用方合同时作为比较证据）。
- 原样段之外的已定判例：RM 的 REQUIREMENTS export-retention 问题用例（期望结果为 uncertain）：断言"target 是人工维护的文档、该节不适用"的 finding，关联候选判 `not-matched`；成为发现候选时判 `unsupported`，不选对应的 `problem-N`（v4 正式计分已定判例，v4.2 沿用）。判 gap、但理由与期望句相同的 finding 仍算匹配，结果分由评分规则扣除。
- 只说违背（[裁决先例](../../reviewer-suite-v1/rulings.md)「CA 只说违背」按本场景 Role 推广，multi-model-v2 新增；只用于发现候选不对应任何问题用例、在 `supported` 与 `unsupported` 之间判定时）：finding 只说某项检查不满足、规格未就绪或不符合某条规则，没写出具体缺陷、缺失的内容或相互冲突的两侧合同的，判 `unsupported`。缺失类 finding 写明缺了什么即可，不要求写出机制或修复方法。依据：冻结 `docs/agents/roles/spec-readiness-reviewer/findings.md`:15 原文"`finding` 解释具体缺陷, 缺失内容或冲突合同, 以及它对就绪的影响"。
- 只依据 Input 原文判断，不依据 finding 自称的严重程度或把握。

## 输出

写 `<ADJ>/decisions-<名>.json`，格式严格为：
`{"adjudicator": "blind Opus high", "decisions": [{"id": "<池中 id>", "decision": "<allowedDecisions 之一>", "reason": "<一句中文理由>"}]}`
池中每个 id 恰好出现一次。判断不了时，关联候选选 `not-matched`，发现候选选 `unsupported`。同组候选逐个独立判断，不因同组其他候选的决定而跳过。完成后用一条 python 命令核对 id 集合与池完全相同、每个决定都在 allowedDecisions 内，并在最终回复中给出各决定的计数和你认为最难判的 3–5 项（id + 理由）。
