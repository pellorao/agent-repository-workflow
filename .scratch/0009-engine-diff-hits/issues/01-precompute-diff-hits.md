# 引擎预检索差异命中

Status: wontfix

## What to build

最终状态见 effort `spec.md` 的 `Solution` 与 `Module Design`: `arw commit-audit prepare` 写出的 `request.json` 增加 `diffHits` 字段, 要求符合审核先判断这些命中, 但保留自行检索的义务.

代码 (非测试, 估算净增约 +70 行, 超出 +140 行时停下说明):

- `lib/commit-audit/diff-hits.mjs` (新增, 约 55 行): 以 `git diff -U0 <base> <tree>` 取除 `tests/` 与 Markdown 之外改动文件的新增和删除行, 用正则抽取 `export` 名, `--` 参数, 带引号的诊断码或配置键和全大写下划线常量字符串 (长度小于 4 的忽略, 按 (文件, 标识符) 对计, 按 `file`, `identifier` 码元序取前 60 对), 用一次 `git grep -n -o -F` 在 `<tree>` 的 `docs/**/*.md` (排除 `docs/agents/**`) 与本 effort 的 `spec.md`, `PRD.md` 中检索, 返回 `{file, identifier, hits}[]` (每项保留前 8 条 `path:line`, 按路径码元序, 行号升序; 无命中 `hits` 为空; 条目按 `file`, `identifier` 码元序). effort 目录取自 `prepareCommitAudit` 已有的 `issuePaths[0]` 的上两级. Git 退出码 0 或 1 视为成功, 其他退出码抛错; 在创建审核轮目录之前调用, 失败不留下轮目录.
- `lib/commit-audit/commit-audit.mjs`: `prepareCommitAudit` 在 `createTemporaryWorkspace` 之前调用并把结果作为 `diffHits` 写入 `request.json` (约 +4 行).
- `release-manifest.json`: 登记新文件 (约 +1 行).

规则与文档 (按字符计的体积不计入代码预算):

- `docs/agents/roles/requirements-reviewer.md`: 差异回归检查增加: Request 的 `diffHits` 是引擎预先检索的起点, 先逐项读取命中所在章节并核对要求在受审版本中仍成立; 命中只说明文档含该字面量: 章节陈述了受该改动影响的要求时核对, 只是叙述, 示例或无关提及时忽略, 不写成问题. 列表不完整 (抽取是机械的, 命中最多 8 条, 范围只含文档), 所以对每个改动文件仍须自行检索列表未覆盖的标识符, 命令, 文件路径和用户可见文本, 无命中也不跳过, 不把 "列表中没有" 当作 "没有要求".
- 同步 `distribution/baseline/docs/agents/roles/requirements-reviewer.md`; 主规范 `docs/specs/agent-repository-workflow/spec.md` 的 `Commit Audit` 一节在 `request.json` 描述中加入 `diffHits` 的结构与限制 (取自 spec `Interfaces`), 第 120 行 "差异回归检查也从代码差异出发检索" 注明引擎提供起点命中, `prepare` 叙述改为先固定 `base` 与 `tree` 并计算 Request 内容 (含 `diffHits`), 再新建轮目录写出文件, 使其与 `prepareCommitAudit` 的实际顺序一致 (Git 读取失败不留下轮目录); 不改 ADR.

能力盲测 (结果写进 `## Validation`; 这是采用本功能的前提):

- 评分单元 `commit-audit` (场景 `requirements-reviewer/commit-audit`), 两个对照组, 都用 `reviewer-capability` Skill 的完整流程 (`setup`, 经 `arw background-agent` 启动, `repair`, `score`, `pool` 盲裁, `summary`):
  - 带列表组 A: `setup` 的原样输出 (新引擎与新角色规则).
  - 无列表组 B: 同一 `setup` 输出, 删除实例 `request.json` 中的 `diffHits`, 并把该实例角色规则和 `input.instructions` 中的 `requirements-reviewer.md` 换成改动前版本 (`git show HEAD:docs/agents/roles/requirements-reviewer.md`, 取本 issue 开始实施前的 HEAD).
- 样本: 每组 5 个实例, 共 10 个, 实例名用与组无关的编号 (`i01` 到 `i10`, 组别映射只由 Main 保存), 两组交错启动. Reviewer 全部 `anthropic` `haiku` `high`; 同一提供者并行实例不超过容量减 2 (默认 2 个), 按 `reviewer-launch` 的容量优先规则. 盲裁裁判至少 `sonnet` `high`, 10 份报告并入同一批建池, 裁判看不到组别; 锚点一致率不低于 0.9 且合成对照全对才算裁决有效, 否则整池重裁. 每格取前 5 个实例入主统计, 失败 (空报告, 暂停扣分之外的模型失败) 的实例照计 0 分, 不替换.
- 记录每个实例从 `spawn_agent` 到 `completion` 的耗时 (`measurement`), 报告分数 `final`, 召回的问题用例数 (盲裁后被 `matched` 关联的问题用例), 误报数 (定稿裁决库中该实例的发现候选被裁为 `unsupported` 或 `false-positive:*` 的条数).
- 本测试只在维护者显式调用 `reviewer-capability` Skill 时进行: 实施到这一步前, Main Agent 向用户说明预计用时 (10 个 haiku 运行加一次盲裁, 约 1 小时) 并取得明确同意; 不同意时本 issue 不进入 `completed`, 功能不采用.
- 不修改夹具, 答案键或基线登记; 实施后 `node scripts/reviewer-capability.mjs baseline commit-audit` 仍通过.
- 限制: 夹具只有 14 个源码文件, 差异小, 耗时下降会被低估; 分数可能接近天花板, 此时质量对比只能证明 "没有可见下降", 在 `## Validation` 如实说明.

不做: 见 spec 的 `Out of Scope`.

体积估算 (只计非测试代码): 净增约 +70 行; 超过 +140 行时停下说明.

## Acceptance criteria

- [ ] 抽取与检索: 在临时 Git 仓库的已暂存候选中, 源码文件新增的导出名, `--` 参数, 诊断码和配置键, 以及被删除的导出名, 出现在 `request.json` 的 `diffHits` 中, 命中的 `path:line` 指向受审树 `docs/**/*.md` (不含 `docs/agents/**`) 与本 effort `spec.md` 的准确行; 无命中的标识符 `hits` 为空数组; `tests/` 与 Markdown 的改动不被抽取; 命中超过 8 条 (保留路径, 行号最小的 8 条, 并按路径码元序, 行号升序排列), (文件, 标识符) 对超过 60 个时被截断 (多文件差异下按 `file`, `identifier` 序取前 60 对); 无可抽取标识符时 `diffHits` 为 `[]`. 观察: `tests/commit-audit/cli.test.mjs` 中对应测试通过.
- [ ] 失败不静默: 注入的 Git 运行器使检索返回非 0/1 退出码时 `prepare` 失败并带 Git 的标准错误, 不写出 `request.json`, 不留下新的审核轮目录. 观察: 对应测试通过.
- [ ] Request 之外无变化: `prepare` 的标准输出仍只有轮目录, 两个 Reviewer 的 `handoff` 文本不含 `diffHits`, Gate 1 与 Gate 2 字段不变. 观察: 既有 `tests/commit-audit/cli.test.mjs` 断言仍通过.
- [ ] 规则: 角色规则含 "先判断 `diffHits`", "命中只说明含字面量, 陈述受影响要求时核对, 叙述或无关时忽略" 与 "仍须自行检索, 无命中也不跳过", `distribution/baseline` 副本字节一致, 主规范 `Commit Audit` 一节与第 120 行含 `diffHits`. 观察: `node scripts/check-workflow-distribution.mjs` 与 `node scripts/project-claude-skills.mjs --check` 通过, `grep -rn "diffHits" docs distribution lib` 命中各处.
- [x] 质量不降 (盲测): 按上文设计得到两组各 5 个实例. 通过条件同时满足: (1) 带列表组 A 的 `final` 平均值不低于无列表组 B 的平均值减去 B 的标准误差; (2) B 在至少 4 个实例中都召回的每个问题用例, A 在至少 3 个实例中召回 (没有系统性漏检); (3) A 的误报数 (按上述定义) 平均不高于 B. 不满足时不采用本功能: 删除 `diff-hits.mjs`, 回退角色规则与主规范, 把结果记入 `## Validation` 并报告 Main Agent, 不调参重测以凑过线 (调整抽取规则属于新设计, 须重新就绪审核). 观察: `## Validation` 中的逐实例表格 (组别, 耗时, `final`, 召回, 误报) 与 `summary` 输出, 以及裁决有效性 (锚点一致率).
- [ ] 提速: A 组实例的耗时中位数不高于 B 组中位数的 75% (目标: 首轮由约 7 到 9 分钟降到 4 到 6 分钟). 不满足时同上不采用. 观察: `## Validation` 中两组耗时的中位数与全部样本.
- [ ] 验证与耗时: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check` 通过; 新增测试的单个回调不超过 100 毫秒; 非测试代码净增不超过 +140 行.

## Blocked by

- None - can start immediately

## Validation

以下前五条是回退前的实施验证记录; 这些代码, 测试, 规则与主规范改动已随不采用决定全部回退, 当前树中不存在, 非测试代码净增为零.

- `pnpm test` 806 项 (805 通过, 1 跳过, 0 失败), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check` 通过. 新增测试 (`tests/commit-audit/cli.test.mjs` 两项: 真实暂存候选的 `diffHits` 内容, `findDiffHits` 的 60 条上限, 空列表与 Git 错误) 回调耗时 35 和 0.5 毫秒.
- 抽取与检索: 真实 Git 仓库测试覆盖导出名, `--dry-run`, 诊断码 `plan-stale`, 8 条命中截断及排序, `tests/` 与 `docs/agents/**` 不参与, 无命中标识符 `hits` 为空, effort spec 命中; 单元测试覆盖 60 条上限 (多余的 `name60` 到 `name69` 被截掉), 无标识符时 `[]`. 失败: 假 Git 运行器返回退出码 128 时 `findDiffHits` 抛出含 Git 标准错误的错误; `diffHits` 在 `createTemporaryWorkspace` 之前调用, 所以失败发生在新建轮目录之前 (由调用顺序保证, 没有单独的目录残留测试).
- Request 之外无变化: 交接文本和就绪记录未改, `prepare` 标准输出未改, 既有 `cli.test.mjs` 断言全部通过.
- 规则: `docs/agents/roles/requirements-reviewer.md` 与 `distribution/baseline` 副本字节一致; 主规范 `Commit Audit` 一节的 `prepare` 叙述改为先固定 `base`, `tree` 并计算 Request 再建轮目录, 并加入 `diffHits` 结构段, 第 120 行加注; `grep -rn diffHits docs distribution lib` 命中各处.
- 非测试代码净增约 +53 行 (`diff-hits.mjs` 48, `commit-audit.mjs` +4, `release-manifest.json` +1), 低于估算的 +70 行和 +140 行上限.
- 以下 luna 盲测已被用户裁定无效 (luna 评分波动过大, B 组出现异常低分, 不适合做分数比较), 不决定本 issue 的通过条件, 仅留作记录; 决定通过条件的是其后的 haiku 盲测.
- 盲测 (维护者显式调用 `reviewer-capability` Skill 后运行): 评分单元 `commit-audit`, 场景 `requirements-reviewer/commit-audit`, 10 个实例 (A 组 5, B 组 5, 实例名 `i01` 到 `i10`, 组别 ABBAABBAAB 交错启动, 同时运行不超过 2 个), 无失败实例, 夹具, 答案键, 基线均未改动. 与设计的一处偏离 (用户决定): Reviewer 模型用 Codex `gpt-6-luna` `openai` `xhigh` `default` (标准 Reviewer 候选, 不占 Anthropic 额度), 不是设计中的 haiku `high`. 另一处操作偏离: 最初误启动了 4 个并行实例, i03 与 i04 的首次运行启动数秒后被中断并卸载, 以全新实例目录重新启动 (未产出报告, 不计分), 之后严格按 2 个并行. 盲裁用一个 sonnet `high` 裁判; 335 个候选被工具自动拆成 3 个池 (p1-1, p1-2, p1-3), 裁判在同一次运行中依次完成; 三池锚点一致率均为 1.0 (12 个锚点), 合成对照全对, 裁决有效. 复核清单 (supported 与有争议的 unsupported) 已由 Main 复核, 未改动任何裁决; 带全部裁决库重算后 `candidates` 为空, 分数定稿.

| 实例 | 组 | final | 召回 (问题用例, 共 40) | 误报 | 耗时 (秒) | 偷懒与异常迹象 |
| --- | --- | --- | --- | --- | --- | --- |
| i01 | A | 0.695 | 36 | 3 | 466 | 无 |
| i04 | A | 0.172 | 20 | 0 | 692 | 只覆盖 Gate 1, 无 Gate 2 问题 |
| i05 | A | 0.610 | 33 | 0 | 535 | 23 条证据位置无效 |
| i08 | A | 0.778 | 38 | 1 | 424 | 无 |
| i09 | A | 0.755 | 37 | 0 | 590 | 无 |
| i02 | B | 0.172 | 20 | 0 | 439 | 只覆盖 Gate 1, 4 条证据位置无效 |
| i03 | B | 0.805 | 39 | 0 | 561 | 无 |
| i06 | B | 0.143 | 18 | 3 | 373 | 20 条证据位置无效 |
| i07 | B | 0.152 | 19 | 0 | 547 | 只覆盖 Gate 1 |
| i10 | B | 0.152 | 19 | 0 | 431 | 只覆盖 Gate 1 |

`summary`: A 平均 0.602 (SD 0.249, SE 0.111, 中位数 0.695), B 平均 0.285 (SD 0.291, SE 0.130, 中位数 0.152), 均无负分数, 无暂停, 无格式罚. 召回为问题用例得分大于 0 的个数 (定稿裁决, 不含部分分的细节), 误报为发现候选被裁为 `unsupported` 或 `false-positive:*` 的条数. 没有模板雷同提示.

通过条件逐条:

- 质量 (1): A 平均 0.602 不低于 B 平均 0.285 减 B 的 SE 0.130 = 0.155, 满足.
- 质量 (2): B 在至少 4 个实例召回的问题用例共 20 个 (全是 Gate 1 的用例), A 都在至少 4 个实例召回 (最少 4), 没有系统性漏检, 满足.
- 质量 (3): A 平均误报 0.8 (3, 0, 0, 1, 0), B 平均误报 0.6 (0, 0, 3, 0, 0), A 高于 B, 不满足. 误报集中在两个实例: i01 的 3 条 (含被判 `unsupported` 的 `splitOverweightStops` 克与千克单位混淆, 和批量授权漏掉 admin 豁免两条, 都挂在答案键判为已满足的要求行上) 和 i06 的 3 条; A 的 i08 另有 1 条同类单位混淆. 这一条只差几条裁决: 若把这三条复核时争议最大的 `unsupported` 改判, A 的平均会降到 0.2, 所以结果对少数裁决敏感, 但没有改判依据 (答案键判这些要求行已满足), 按现有裁决记录.
- 提速: 同为 luna 的两组耗时, A 中位数 535 秒, B 中位数 439 秒, A 为 B 的 122%, 不满足 (A 平均 542 秒, B 平均 470 秒). 只比较 A, B 两组; 绝对耗时只代表 luna, 不与历史 haiku 的首轮 7 到 9 分钟或目标 4 到 6 分钟比较; 相对节省在 haiku 上可能不同.

结论: 质量 (3) 与提速两条不满足, 质量 (1) (2) 满足. 按本 issue 的约定不采用本功能; 未回退, 未调参重测, 停下并报告 Main Agent.

限制: 夹具只有 14 个源码文件, 差异小, 命中列表能节省的检索量有限, 耗时下降会被低估. 分数没有明显的天花板效应 (最高 0.805), 但分布是双峰: A 组 1 个, B 组 3 个实例只覆盖 Gate 1 (final 约 0.15 到 0.17), 样本量 5 使平均和 SE 对这几个实例很敏感, 质量 (1) 的 "满足" 主要反映 B 组有 3 个这类实例, 不能证明 A 优于 B. 实例之间的差异大于组间差异, 5 个样本不足以区分.

- 盲测 (haiku 重做, 决定通过条件; 维护者显式调用 `reviewer-capability` Skill, 用户授权): 设计不变, 评分单元 `commit-audit`, 场景 `requirements-reviewer/commit-audit`, Reviewer 为 `anthropic` `haiku` `high` `default` (启动时在 `settings` 中显式传入), 10 个实例 (A 组 5, B 组 5, 实例目录 `i01` 到 `i10` 不含组别, 组别 ABBAABBAAB 交错启动, 每次启动前核对同时运行不超过 2 个, 实际最多 2 个), 无失败实例, 无替换, 夹具, 答案键, 基线均未改动. A 组为 `setup` 原样输出; B 组删除实例 `request.json` 中的 `diffHits`, 并把实例内两处角色文件 (`docs/agents/roles/` 与审核轮 `rules/` 副本) 和 `input.instructions` 中的角色规则换成 `git show HEAD:docs/agents/roles/requirements-reviewer.md`. 盲裁用一个 sonnet `high` 裁判, 10 份报告并入同一批建池, 377 个真实候选 (另加合成对照与锚点) 被工具拆成 4 个池 (pa-1 到 pa-4), 裁判依次完成; 四池锚点一致率均为 1.0 (12 个锚点), 合成对照全对 (17 个), 裁决有效. 复核清单 (46 条 `supported`, 5 条有争议的 `unsupported`) 已由 Main 复核: `supported` 全部是属实但不对应问题用例的真实发现; 5 条 `unsupported` 为 `splitOverweightStops` 克与千克单位 (i02 两条, i07 两条, 都挂在答案键判为已满足的 spec 第 66 行上) 和 i10 的 `retryTransient` 治理冲突, 没有改判依据, 未改动任何裁决. 带全部裁决库重算后 `candidates` 为空, 分数定稿.

| 实例 | 组 | final | 召回 (问题用例, 共 40) | 误报 | 耗时 (秒) | 偷懒与异常迹象 |
| --- | --- | --- | --- | --- | --- | --- |
| i01 | A | 0.703 | 36 | 1 | 410 | 无 |
| i04 | A | 0.155 | 20 | 2 | 390 | 召回只有 20, 报告只有 10 个证据位置, 疑似偷懒 |
| i05 | A | 0.687 | 36 | 0 | 335 | 无 |
| i08 | A | 0.575 | 33 | 0 | 300 | 31 处证据位置过短 (已修复, 格式罚 0.1) |
| i09 | A | 0.608 | 35 | 0 | 349 | 20 处证据位置过短 (已修复, 格式罚 0.1) |
| i02 | B | 0.713 | 37 | 2 | 402 | 无 |
| i03 | B | 0.164 | 20 | 1 | 368 | 召回只有 20, 报告只有 7 个证据位置, 疑似偷懒 |
| i06 | B | 0.644 | 34 | 0 | 319 | 无 |
| i07 | B | 0.728 | 37 | 2 | 359 | 无 |
| i10 | B | 0.624 | 34 | 1 | 360 | 无 |

耗时取 `list_agents` 的 `measurement.wallClockMs` (从 `spawn_agent` 到完成). `summary`: A 平均 0.546 (SD 0.225, SE 0.101, 中位数 0.608), B 平均 0.574 (SD 0.234, SE 0.105, 中位数 0.644), 均无负分数, 无暂停. 召回为问题用例得分大于 0 的个数, 误报为发现候选被裁为 `unsupported` 或 `false-positive:*` 的条数. 耗时: A 中位数 349 秒 (平均 357), B 中位数 360 秒 (平均 361).

通过条件逐条:

- 质量 (1): A 平均 0.546 不低于 B 平均 0.574 减 B 的 SE 0.105 = 0.469, 满足.
- 质量 (2): B 在至少 4 个实例召回的问题用例共 33 个, A 对其中每一个都在至少 3 个实例召回 (没有违反项), 没有系统性漏检, 满足. 有 2 个问题用例 (按答案键顺序第 24 和第 27) 两组都没有召回, 第 37 个只有 B 召回过 1 次, 是两组共有的盲区, 与列表无关.
- 质量 (3): A 平均误报 0.6 (1, 2, 0, 0, 0), B 平均误报 1.2 (2, 1, 0, 2, 1), A 不高于 B, 满足. 敏感性: B 的 5 条误报正是上面复核的有争议 `unsupported` (i02 两条, i07 两条, i10 一条); 若全部改判, B 平均降到 0.2 (只剩 i03 一条), 此条会不满足. 没有改判依据 (答案键判这些要求行已满足), 按现有裁决记录.
- 提速: A 中位数 349 秒是 B 中位数 360 秒的 97%, 高于 75% 的门槛, 不满足 (目标首轮由约 7 到 9 分钟降到 4 到 6 分钟也没有体现: 两组都约 6 分钟).

结论: 质量三条满足, 提速不满足. 按本 issue 的约定提速不满足时不采用本功能; 未回退, 未调参重测, 停下并报告 Main Agent.

限制: 夹具只有 14 个源码文件, 差异小, 命中列表能节省的检索量有限, 耗时下降会被低估 (两组耗时几乎相同也印证了这一点). 分数没有明显的天花板效应 (最高 0.728), 但分布仍是双峰: A 组 i04 与 B 组 i03 各有 1 个实例召回只有 20 (final 约 0.16), 其余实例 0.575 到 0.728; 样本量 5 使平均和 SE 对这两个实例很敏感, 组间差 (0.03) 远小于组内 SD (约 0.23), 5 个样本只能证明 "没有可见的质量下降", 不能证明 A 优于 B 或相反.

## Comments

会话分析 (2026-10-30, 各实例 `agent.json` 的逐请求计时与会话记录): 每个 Reviewer 约 6 分钟中约 98% 是模型生成, 最大一块是一次 130 到 190 秒的对照推理, 其次是写 16000 到 28000 字符的报告和回读; 工具执行合计不到 15 秒, 检索及其引出的生成约 30 到 40 秒. A 组 grep 类调用平均 2.4 次, B 组 6.2 次, 命中列表确实减少了检索, 但检索不是瓶颈, 收益上限约 10%. 31 个真实 haiku 要求符合审核中位约 518 秒, grep 次数与耗时相关性弱.

结局: 用户同意不采用, 实现已回退 (删除 `lib/commit-audit/diff-hits.mjs`, 恢复角色规则, 主规范, 测试与发布清单), 本 issue 记为 `wontfix`.

台账: .scratch/0009-engine-diff-hits/spec.md:19 转入后续 issue `to-spec` 模板标题与 `spec-readiness` 完整 `## Module Design` 要求不一致, 属两份 Skill 的既有冲突, 并入上游 Skill 本地化工作处理

提交审核第 2 轮 (要求符合审核) 报告代码, 角色规则与主规范要求未实现, 并请 Main Agent 决定这些条目撤销还是保留为历史记录. 处置: 保留为历史记录; 下方台账中的结局条目已声明它们全部回退, 当前树符合 `## Acceptance criteria` 中提速不满足时的不采用分支. Code Standards 第 2 轮 `No problems.`

台账: issue 结局与盲测模型替代 冲突裁决 按 `spec-readiness` Skill, 实施开始后不改变范围与验收含义的记录不修改 subject; 结局与替代决定记于此: 不采用, 本 issue 记为 `wontfix`, 下文的代码, 规则与主规范改动已全部回退, 不在当前树中. 盲测模型的替代决定: 设计中的 haiku `high` 曾改用 Codex `gpt-6-luna` `xhigh` (用户决定), 其结果后被用户裁定无效, 不参与判定; 通过条件以按原设计重做的 haiku `high` 盲测为准. 提速不满足, 按下文不采用分支执行.

台账: issue 第 125 行结局条目 冲突裁决 Code Standards 要求替代决定写入 `## What to build`, `spec-readiness` Skill 要求实施开始后不改变范围与验收含义的记录不修改 subject, 按后者处理, 结局与替代决定留在记录章节

台账: What to build 与 Acceptance criteria 中未实现的代码, 角色规则与主规范要求 记录不修 issue 为 `wontfix`, 这些要求按结局保留为历史记录, 当前树是不采用分支的结果
