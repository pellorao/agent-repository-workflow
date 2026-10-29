# Spec Readiness 能力场景合并

## Problem Statement

Reviewer 能力套件把 Spec Readiness 拆成两个子场景 (两份答案键, 共用一份 `common/` 夹具叠加层, 一份盲裁 brief 和锚点), 评分器和盲裁流程为此带着大量只服务于拆分的代码: 一个子场景的分数没有 `final`, 须经 `combine` 融合两份 `score` 输出; 盲裁视图有两个固定名称并要求同时给出两个场景目录; 候选带 `scenario` 字段; 兄弟答案键在加载时一并校验.

拆分本身还留下一个计分缺陷: 其中一个子场景沿用 "提前返回" 计分, 报告了 REQUIREMENTS 问题后继续检查就被丢弃后续检查, 并另计一个失败的干净用例 (`requirement-scope-continuation`). 当前 Reviewer Role 要求不提前返回, 所以按现行 Role 正确工作的实例会被扣分, 登记的格式基线虽然只用 r 与 T, 不受影响, 但 Role 改动后测得的能力分数偏低.

## Solution

最终状态如下.

- Spec Readiness 只有一个场景 `tests/fixtures/reviewer-capability/spec-readiness-reviewer/spec-readiness/`, 目录名与评分单元 `spec-readiness` 一致, 布局与其他角色相同: `base/`, `candidate/`, `expected.json`, `brief.md`, `anchors.json`. 原 `common/` 并入该目录, 原来两个子场景目录和已无用的 `handoff.md` 删除. 角色目录下只保留 `repeats.json`. 合并后 Spec Readiness 没有子场景概念, 旧场景名不再作为场景, 目录, 登记项, 归档, 代码, 测试, Skill 或规范中的名称出现. 合成仓库自身的领域内容 (`specs/runtime-migration.md` 文件及其标题 "Runtime Migration") 是被审文档的内容, 保持不变.
- 合成仓库以原第二个子场景的叠加结果为主体, 恢复第一个子场景中 `specs/runtime-migration.md` 的版本及其 issue 对该交付的描述, 因此它是被审的交付之一. 原第一个子场景独有的用例并入同一份答案键: REQUIREMENTS 的两个跨 spec 要求一致性问题用例 (全套件仅有的此类用例, 对应 Reviewer 的检索比较职责) 和它的干净用例. 原干净用例中 `validation-report.md:19` 的 "read-failure 字段集合完整" 与合并后该行的真实缺陷语义冲突, 删除. 两份 `noOtherSupportedFinding` 各自合成一个.
- `specs/runtime-migration.md` 的 `## Scope` 一句 (第 5 行) 改写为不与其交付迁移的第 11 行矛盾 (行号不变), 并去掉 brief 中依赖 "未选节" 推理的判例, 因为 issue 不再选择要求.
- `specs/runtime-migration.md` 发布运行时迁移并精确定义 `promote` 的公开结果, 却没有 `## Module Design`, 这是真实的未预设缺陷 (历史基线报告中 5 次有 4 次报告它). 按 `reviewer-capability` Skill 的规则补成 MODULE-DESIGN-APPLICABILITY 问题用例 (默认 k), 证据为该文档第 5, 11, 23 行, 不区分 "应写 `Not required`" 与 "应写完整格式".
- 评分器不再有 "提前返回" 概念: `requirement-scope-continuation` 诊断及其失败干净用例处理, 以及按场景区分的 `allowContinuation` 删除. Spec Readiness 一次 `score` 输出直接带 `final`, 与其他角色一致; `combine` 子命令, `combineScenarios`, 候选的 `scenario` 字段, 兄弟答案键校验, `common/` 叠加, 盲裁视图的两个固定名称和多目录参数都删除. `pool view` 只接受一个场景目录, 视图名与其他角色相同.
- 锚点 24 个全部保留 (去掉 `scenario` 字段, 其中 5 个原第一个子场景的锚点涉及的文件在合并视图中逐字不变, 期望裁决仍成立, 在 `confirmed_by` 补记合并复核). `repeats.json` 的用例名去掉场景前缀并按合并后的序号重登记.
- 重新测量并登记 `spec-readiness` 格式基线: Claude 后端 haiku high, 5 次重复, 每次重复一份报告; 登记项的场景键为 `spec-readiness-reviewer/spec-readiness`; 旧归档目录 `spec-readiness-no-selection` 删除 (历史在 Git 中), 新归档另建. 合并前后的能力分数口径不同 (答案键变化, 去掉继续检查扣分), 不可比.

## Module Design

### Modules

- **场景读取** (`lib/reviewer-capability/scenario.mjs`): 只读单个场景目录 (其 `base/`, `candidate/`, `expected.json`, `brief.md`, `anchors.json`), 不再叠加角色级 `common/`, 不再读取兄弟场景的答案键. 答案键校验改为只校验本场景的答案键与角色级 `repeats.json`.
- **计分与报告读取** (`scoring.mjs`, `reports.mjs`): 一份 Spec Readiness 报告读完整的检查序列, 不再因 REQUIREMENTS 问题而截断或扣分.
- **组池与视图** (`pool.mjs`, `lib/reviewer-capability-view.mjs`): Spec Readiness 与 Commit Audit 的池只有一个视图 `view`, 其余角色是 `view` 与 `change.diff`; 候选与池项不带 `scenario`. 视图名集合不再因场景而异, 所以 `pool view` 不再比较场景给出的视图名与池键.
- **操作与入口** (`operations.mjs`, `scripts/reviewer-capability.mjs`): 删除 `combine`; `score` 对所有角色给出 `final`.

### Interfaces

- `score`: Spec Readiness 的输出像其他角色一样含 `final`, `f`, `overallDeduction`; `summary` 直接接受 `score` 输出. 输入声明与错误分支不变.
- 删除 `combine {scores}`. 调用它的脚本须改用 `score` 输出.
- `pool view <root> <name> <scenario-directory>`: 只接受一个场景目录; 返回 `{views, files}`, `views` 原样回显池键的 `views` (当前版本建立的池: Spec Readiness 与 Commit Audit 为 `view`, 其余角色为 `view` 与 `change.diff`), `files` 是实际写入的文件数. 池未 `build`, 场景目录所属角色与池键的 `role` 不一致, 任一目标视图已存在, Spec Readiness 的 Reviewer Request 不是恰好一份或没有字符串 `draftPath`, 都返回 `blocked` 且不写入任何视图; 场景搭建或 Git 失败返回 `failed`, `stage` 为 `scenario-build`, 写文件阶段的文件系统错误返回 `failed`, `stage` 为 `pool-write`; 全部内容先在内存中组装并检查, 写文件中途失败可能留下部分视图, 须删除已写的 `adj/<视图>` 后重跑 (沿用既有合同, 本变化不改变). `pool view` 总是写出 `view`, 池键的 `views` 含 `change.diff` 时另写 `change.diff`, 不读取池键中的其他视图名, 场景目录也不决定视图名. 按合并前规则建立的旧 Spec Readiness 池, 其键列出旧的两个视图名: `pool view` 仍按上述规则成功写出 `view` (返回的 `views` 回显旧名, `files` 只计实际写入的文件), 但随后 `pool prompt` 的 `adj/` 检查因缺少键中列出的旧视图返回 `blocked` (现有合同, 本变化不改变), 须重新 `pool build`; 这个状态由 `pool prompt` 的 `blocked` 暴露, `pool view` 不单独识别. 原先 "产生的视图名集合须等于池键 `views`" 的检查随两个固定视图名一起删除.
- 候选 (`score` 输出的 `candidates`) 不再带 `scenario` 字段; 池项不含 `scenario`. 裁决库按候选指纹套用, Spec Readiness 候选的指纹因此变化, 旧裁决不再套用 (`score` 的 `staleDecisions` 列出它们), 须重裁; 答案键和 brief 也已变化, 旧裁决本来就不再适用.
- 答案键加载: 同一角色目录下只有本场景的答案键参加 k 档平衡与重复问题检查.

### Seams and Adapters

不新增 Seam. 场景读取读取文件系统, 计分是纯函数, 测试用夹具目录和临时目录观察.

### Dependencies and Data Flow

依赖方向不变 (入口 -> `lib/reviewer-capability/` -> `lib/common/`). 数据流上删除一条汇合: 过去两个子场景的 `score` 输出经 `combine` 汇合成一次重复的分数; 现在一份报告一次 `score` 即得完整分数. 盲裁池由同一批报告的候选一次建池, 仍只有一个视图.

### Module Design Rationale

保留两个子场景的替代方案是只改名与删除失效逻辑, 被拒绝: 拆分的唯一动机 (两个交付各自独立计分) 在 Reviewer 的检索比较职责下已不成立, 一次审核本来就看到全部相关文档, 两个场景叠成一个仓库冲突很小. 合并以第二个子场景为主体而不是以第一个为主体, 因为第二个覆盖的文件更多, 其覆盖是各自注入的缺陷, 逐字相同的覆盖文件冗余可删. 把 `specs/runtime-migration.md` 恢复为被审交付而不是继续让它是未交付的背景文档, 是为了保留全套件仅有的跨 spec 要求一致性用例; 代价是它的 `Module Design` 缺失变成一个真实缺陷, 补成答案键问题用例比给候选补一段 Module Design 更省, 因为后者又引出 "写 `Not required` 还是完整格式" 的新争议. 不保留 "提前返回" 计分: 它违反当前 Role. 结果表在合并前后不可比, 在 issue 的验证记录中注明. 删除 `scenario` 字段使已有 Spec Readiness 裁决库的指纹全部失效, 这个重裁成本被有意接受: 裁决库位于调用方给出的盲池目录, 不随仓库保存 (登记的基线只用 r 与 T, 不依赖裁决), 且答案键与 brief 在本次合并中都已变化, 旧裁决本来就不能沿用; 被拒绝的替代方案是让指纹忽略已删除的字段或兼容读取旧裁决, 它们只为一份已经过期的裁决库增加代码.

### ADR Evaluation

不需要新 ADR, 也不修改现有 ADR. 本变化确实改变 Reviewer Capability Module 的调用方可见合同: 删除 `combine` 操作, `pool view` 由多个场景目录改为一个, `score` 对 Spec Readiness 给出 `final`, 候选与池项不再带 `scenario`, 并使已有 Spec Readiness 裁决库的指纹失效. 但该 Module 是只供维护者经 `reviewer-capability` Skill 使用的源码专用工具, 开发规范已写明它不改变授权主体, 持久格式, 信任根或分发边界, 其裁决库位于调用方给出的盲池目录, 不进入分发, 也不被其他 Module 读取. 所以这些合同变化只是该 Module 内部合同的收窄, 不构成需要 ADR 的跨 Module 持久决定, 开发规范 `Reviewer Capability Module` 一节就地改写以反映它们. 没有新增持久状态或安全边界.

## Testing Decisions

- 答案键加载: 合并后的答案键通过 k 档平衡与重复问题校验 (含 `repeats.json` 的重登记), 防止拼合时用例重复或某档失衡.
- 计分: 用合并场景的夹具观察 REQUIREMENTS 之后继续检查的报告不被截断, 无继续检查扣分诊断; 一次 `score` 含 `final`. 防止回归到提前返回计分.
- `pool view`: 观察一个场景目录生成 `adj/view`, 角色与池键不一致时 `blocked` 且不写视图, 视图由池键决定 (Spec Readiness 只写 `view`, 不写 `change.diff`; 对旧键成功写出 `view`, 之后 `pool prompt` 因缺少旧视图而 `blocked`). 防止视图与池键错配, 或 Spec Readiness 的裁判看到多余的差异文件.
- 基线: `node scripts/reviewer-capability.mjs baseline <unit>` 对四个评分单元都成功, 其余三个不受影响. 防止场景变化后格式基线与场景不符.
- 测量耗时: 新增或改动的测试单个回调不超过 100 毫秒.

## Out of Scope

- 不修改 Reviewer Role, Spec Readiness 产品行为或其他角色的场景.
- 不重新裁决 Reviewer 模型的能力分数; 登记的基线只衡量格式错误率.
- `.scratch` 中已完成 effort 的记录是历史, 不改写.
