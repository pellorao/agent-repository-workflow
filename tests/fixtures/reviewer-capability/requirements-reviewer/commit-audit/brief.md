# Commit Audit v3.1（修订号 25，草案）盲裁 brief

多模型 benchmark v2 草案（2026-10-24，未冻结；由冻结的 v1 brief 改出，改动见 [v2 计划](../plan.md#4-歧义题目)），冻结后正式盲裁原样使用，只替换下文的 `<ADJ>`（调用方给出的裁决工作目录）与 `<名>`（池名）。

你是盲裁决者。任务：对候选池中每个候选给出一个决定。你看不到候选来自哪个模型、哪次运行；不要试图推断。

## 输入

- 候选池：`<ADJ>/pool-<名>.json`（调用方给出名字）。每项有 `id`、`group`（同一期望句的候选归为一组）、`kind`、`check`（Gate）、`allowedDecisions`、`expectation`（答案键问题用例的期望句；`finding` 类候选为 null）、`finding`（被审报告的 finding 正文）、`result`（gap/uncertain）、`evidence`（报告给出的证据定位或命令）、`requirementSource`（若有：该 finding 所在的要求行）；`finding` 类另有 `problemOptions`（可补关联的问题用例及其期望句）和 `cleanTargets`（被提名的干净用例）。
- 被审的已暂存代码与文档（只读）：`<ADJ>/view/`（issues 与 spec 在 `.scratch/0001-dispatch-control/`，源码在 `src/dispatch/`，测试在 `tests/dispatch/`，合同与政策在 `docs/dispatch/`：`storage-contract.md`、`adapter-contracts.md`、`dispatch-policy.md`）。核实 finding 是否有依据时只读这里，不读工程其他目录、`.tmp` 其他目录、答案键或任何运行目录。
- 不运行被审代码以外的东西；需要时可以 `node` 运行 view 下的代码做核实（不写文件）。

## 决定语义（ARW 原文，冻结 ARW `docs/agents/reviewer-capability-verification.md`「Adjudication」节，原样）

## Adjudication

对于 `needs-adjudication`, Main Agent 根据当前场景和适用要求, 将每个候选中冻结的 `expectation` 与同一候选中规范化的 finding 正文, 结果和证据逐项比较, 判断是否表达同一个真实缺陷. 所有候选都需要决定, 不因词组匹配而自动接受, 也不因同题已有另一条匹配而跳过. 无法确定时选择 `not-matched`. Main Agent 只决定是否关联, 不改写结果类别, 原始文本或证据, 不跨 finding 拼接, 也不直接调整分数或门禁. 验证器以确认后的关联按[最终评分规则](reviewer-capability-scoring.md#final-score)计算批次结果. 写入格式严格为 `{ "decisions": [{"candidateId": "<candidate-id>", "decision": "matched", "reason": "<non-empty reason>"}] }` 的临时 JSON 对象. 拒绝配对项时使用 `not-matched`. 返回的每个候选项必须恰好出现一次, 且不得包含其他候选项. 然后使用相同的 `--prepared` 和 `--input`, 加上 `--adjudication <decisions-path>`, 再次运行 `verify`. 临时决定文件没有模式版本, 持久兼容承诺, 候选内容哈希, 响应摘要值或修改绑定. 第二次调用从相同输入重新建立完整候选集合, 拒绝格式错误, 缺失, 重复或多余的决定. 只有 `matched` 配对参与问题关联和后续评分; `not-matched` 不建立关联. 该两阶段路径同样适用于定向迭代和发布验证. 面向人的结果按最终评分规则展示.

本工程计分升级 r7: 每个候选带 `kind` 与 `allowedDecisions`. 关联候选 (`kind: "association"`) 的决定仍为 `matched` 或 `not-matched`, 并附问题用例 `findingTerms` 作 `referenceTerms`, 仅供参考. 一个 finding 的全部关联候选都已决定且都不是 `matched`, 或它没有关联候选时, 形成发现候选 (`kind: "finding"`, `candidateId` 含 `unassociated`), 附被证据与概念规则提名的干净用例 (`cleanTargets`) 和本范围可补关联的问题用例 (`problemOptions`); 决定取 `problem-N` (补关联到第 N 个问题用例, 按该 finding 的证据计分), `false-positive:clean-N` (确认误报第 N 个干净用例, 只能选被提名的), `unsupported` 或 `supported`. 序号均从 1 起按范围内声明顺序计. 候选集合随关联决定变化, 所以验证器先按提供的决定重新计分, 再核对决定: 每个决定必须对应这次计分的一个候选且取允许值, 否则失败; 仍缺决定的候选以 `needs-adjudication` 返回, 补齐后把全部决定写入同一文件再次运行. 判断不了时, 关联候选选 `not-matched`, 发现候选选 `unsupported`.

本工程补充（multi-model-v2 统一口径，四份 brief 逐字相同，`tools.reviewer.check_briefs --suite v2` 核对）：
- `matched`：一条 finding 写出多个具体缺陷时，其中一个与期望句是同一问题即 matched，其余缺陷不影响该关联；发现候选选 `problem-N` 时同理（[裁决先例](../../reviewer-suite-v1/rulings.md)「一条 finding 讲了两个缺陷，原样贴在几行上」）。
- `supported`：finding 有依据，但不对应本位置（finding 所在的检查或要求行）`problemOptions` 中任何列出的问题用例，不得分也不扣分。包括答案键外的成立缺陷，也包括答案键里的缺陷挂在了别的位置：同一缺陷在正确位置的漏报已按漏报计，不再扣第二次（[裁决先例](../../reviewer-suite-v1/rulings.md)「答案键里的缺陷挂在了别的位置」）。
- `unsupported`：无依据，计一个失败干净用例。同一句通用 finding 原样贴在多个位置的，即使碰巧说中某处的答案也按无依据判：关联候选判 `not-matched`，发现候选判 `unsupported`（[裁决先例](../../reviewer-suite-v1/rulings.md)「模板式的通用 finding 原样贴在多行上」）。一条 finding 写出了两个具体缺陷、原样贴在几个位置的，文中讲到的那一处照常判；没讲到的各处同样按通用句判（关联候选 `not-matched`，发现候选 `unsupported`；Commit Audit 挂在已满足要求行上的按 r8.1 判该行误报），不适用上一条中"答案键里的缺陷挂在了别的位置"那一句（[裁决先例](../../reviewer-suite-v1/rulings.md)「一条 finding 讲了两个缺陷，原样贴在几行上」）。主结论或复现例子与被审材料的实际行为相反（照它去修改不掉真缺陷）的，按无依据判。以下三种不按无依据判（[裁决先例](../../reviewer-suite-v1/rulings.md)「finding 的机制写对了，但结论或例子与代码相反」第 (2)–(4) 款）：主结论和复现都成立，只是个别措辞写反的，按所讲缺陷照常判：与本位置列出的某个问题用例是同一缺陷即 `matched` 或 `problem-N`，否则判 `supported`（先例中那条 finding 所讲的缺陷不是所挂行的问题用例，关联判 `not-matched`、发现候选判 `supported`）；机制说明自相矛盾，但复现的情形实测属实的，判 `supported`，不对应该问题用例（缺陷存在，所以不算误报；所述原因与答案键要求的点相反，所以不算命中）；finding 指出的问题属实，但把答案键缺陷背后的错误意图当成正确要求的（照它修会坐实该缺陷），判 `supported`，不对应该问题用例。
- `false-positive:clean-N`：finding 把被提名的第 N 个干净用例所描述的成立内容当成了缺陷。finding 主张的问题就是某个没有被提名的干净用例所描述的成立内容（照它修会破坏该内容）时，判 `unsupported`，不判 `supported`：它主张的问题本身不成立，与"缺陷属实、只是位置不对"的 `supported` 方向相反。finding 指出的问题属实、只是修法建议欠妥的（包括修法与某个干净用例所描述的成立内容相反），按问题本身判，修法不作判据。
- 判断不了时，关联候选选 `not-matched`，发现候选选 `unsupported`。

本工程补充（评分 r8.1、r8.3，Commit Audit）：发现候选按下面的顺序判。
1. 先看 finding 所挂的要求行（`requirementSource`）。答案键判该行已满足时，计分器已把该行的干净用例列进 `cleanTargets`：finding 主张该行有缺陷，就判该行的 `false-positive:clean-N`，即使它所讲的是相邻行真实存在的缺陷，也不改挂到别的行，不判 `supported`（同一个判断错误只扣一次）。容易出现这种情形的孪生干净行：02:30 与 spec:45（`orderManifestGroups` 按字典序排序，已满足），相邻的问题在 01:38（`groupByDestination` 返回的 `Map` 不是分组对象）。
2. 挂载行是问题行时，`problemOptions` 只列同一要求行的问题用例，发现候选只能补关联到这些用例；缺陷属实、写出了机制、但不是本行的问题用例，按统一口径判 `supported`。
3. finding 只说"实现违背 / 未满足 / 不符合要求"，没写出代码错在哪（什么输入、得到什么错误结果），判 `unsupported`（[裁决先例](../../reviewer-suite-v1/rulings.md)「CA 只说违背」）。

## 裁决口径（v3.1 的答案键与 v3 相同，`expected.json` sha256 `81796f467cc54bde5c1c1f1dbe9a9e1819eca11fbeae59bb650c95b5aff00108`，问题用例与行号不变；`benchmarks/reviewer-suite-v1/commit-audit-v3.md`「裁决口径」一节正文，原样；sha256 a425b70f0fa5ec4da393ca2917f9c1208effb38c285ff3a1921cca3c3ce11320）

随答案键冻结；正式盲裁 brief（[`commit-audit-v3-brief.md`](commit-audit-v3-brief.md)）原样带上本段并记录 sha256（修订号 24 行号）。

**沿用修订号 23**：

- 把令牌字段置为 `undefined` 算移除（JSON 序列化后不出现）；
- 引用已审行：finding 只引用已审行（如 "Same as spec:27"）并照抄结论与证据时，按被引行的 finding 文本裁决。被引行与本用例同属一个合并用例时，本行裁决与被引行相同；不在同一合并用例时，引用本身不构成理由，按本行自身的期望句裁决。
- 合并用例的候选与两侧任一期望句描述的是同一缺陷即算匹配。

**新增**：

- 字典序：`localeCompare` 与按码元比较（`<`、`>`）都视为字典序（02:30/spec:45 的比较器）。
- 01:51 / spec:73：finding 必须指出暂停时 active claim 的范围仍被保留（或等价：暂停只清空自身范围）。只说"未检查暂停"不匹配。
- spec:40：finding 必须指出取的是主机本地小时（`getHours`）而非 UTC。
- 01:19 / spec:75：finding 指出 `retryAfter` 为 0 时回退到退避，或指出非有限 / 非数值的真值 `retryAfter`（如 `Infinity`、非数字文本）替代了计算退避，任一即匹配。只谈单位或上限不匹配。
- 01:23：finding 必须指出移到禁发结束小时后落在窗口外而未拒绝。只谈本地小时不匹配（本版取 `getUTCHours`）。
- 01:30 / spec:59：finding 必须指出 `Number()` 接受非十进制数字文本（任一例即可：`'0x2'`、`'2e0'`、`' 2'`、`''`），或指出接受布尔值。只谈上界 3 不匹配（本版接受 3）。
- spec:50：finding 必须指出非数值的 `sequence`（文本或 `NaN`）没有排在有数值 sequence 的同优先级停靠点之后。只谈缺失 sequence 不匹配（本版缺失值已排后）。
- spec:38：finding 必须指出某类 `priority`（数字文本大于 5，或 `Infinity`）的停靠点不在任何分区。只谈缺失 priority 不匹配。
- spec:23：finding 必须指出 rename 被拒后 `discardTemporary` 不删除（锁定）的临时字节，或指出未调用 `removeTemporary`。只说"没有合同"不匹配。
- 02:22 / spec:17：finding 必须指出传给 `store.remove` 的是 `store.get` 的副本，不是已存对象。
- 02:23 / spec:12：finding 必须指出数组（或非 `Object` 构造的值）里的凭据未删除。
- 02:46 / spec:71：finding 必须指出标 `transient: false` 但带有限 `retryAfter` 的失败被重试。
- 01:49 / spec:26：finding 指出等于上限时余量为 0、`> 0` 为假即匹配，不必提单位换算。
- 01:21：finding 必须指出带 `reassignment` 的停靠点按自身 `driver` 而不是 `reassignment.driver` 归属。
- 01:32：finding 必须指出 `handedOver` 状态的停靠点仍被返回。
- spec:11：finding 必须指出每个停靠点少算 5 分钟停车时间（service time 的定义）。
- spec:74：finding 必须指出通知发往未去空格或连字符的原始 `phone`。
- 01:43：判 uncertain 且指出合同未规定未知地址时 `lookup` 的行为，即完全匹配；判 gap 但理由相同（如"可能拒绝"或"可能返回 null"）时仍算匹配，结果分由评分规则扣除。只说"没有检查未知地址"而不涉及合同的 finding 不匹配。
- spec:53：判 uncertain 且指出合同未规定 `scale.read` 的单位，即完全匹配；理由同 01:43。
- 01:38：finding 必须指出 `groupByDestination` 返回的 `Map`（或其条目）不是 `orderManifestGroups` 期待的分组对象，因此没有排序。
- spec:35（保底题）：finding 必须指出只有顶层键被排序（`withSortedKeys` 只代理计划对象本身），嵌套对象的字段顺序进入序列化字节和哈希。
- 02:37：`labelDriver` 在缺 label 时写入字符串 `"undefined"`，是同一处改写的附带表现，不算清单外缺陷。只以此为理由、未指出改写调用方对象的 finding 不匹配。

修订号 23 中 spec:11（只排顶层）和 01:51（缺末尾 LF）两条口径随旧题删除。spec:35 现在考的是"只排顶层"，口径按本版。

## 输出

写 `<ADJ>/decisions-<名>.json`，格式严格为：
`{"adjudicator": "blind Opus high", "decisions": [{"id": "<池中 id>", "decision": "<allowedDecisions 之一>", "reason": "<一句中文理由>"}]}`
池中每个 id 恰好出现一次。判断不了时，关联候选选 `not-matched`，发现候选选 `unsupported`。同组候选逐个独立判断，不因同组其他候选的决定而跳过。完成后用一条 python 命令核对 id 集合与池完全相同、每个决定都在 allowedDecisions 内，并在最终回复中给出各决定的计数和你认为最难判的 3–5 项（id + 理由）。
