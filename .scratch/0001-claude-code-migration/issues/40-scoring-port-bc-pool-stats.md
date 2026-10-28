# 评分体系移植 B 与 C: 盲裁 pool 工具, 统计与模板标记

Status: completed

## What to build

用户决定 (2026-10-28): qwen_strata 的评分体系完整, 精确地移植进 ARW 的 Reviewer 能力套件 (`lib/reviewer-capability/`), 不由 Agent 自行缩小范围. 移植后 ARW 是正统版本, 必须脱离 qwen_strata 工程独立完整工作: qwen_strata 只是一次性的等价参照, 其纯函数 (`chunks`, `pool_item`, `pick_anchors`, `statistics`, `t_quantile`, `template_findings`, `difflib` 比率) 的输出作为金标准数据保存为测试夹具, 测试不运行 qwen_strata. 评分核心, 报告修复, 格式罚, `final` 与暂停扣分已在 issue 39. 本 ticket 合并原计划的票 B (盲裁 pool 工具) 与票 C (统计与重复), 因为二者共用同一规格段落, 入口与 Skill 步骤, 且 `summary` 消费 `score` 的 `provisional` 与候选状态.

用户已决定的范围:

- 完整移植盲裁 pool 工具, `bench_score` 的枚举, 暂计, 过期裁决统计与模板式 finding 标记, 以及 `benchmark_summary` 的格内统计与 Markdown 输出.
- `pool anchor-add` 移植, 规格给出受控例外: 只有 `anchor-add` 可以写锚点文件 (`anchors.json`), 其余命令仍只读夹具.
- 不移植依赖 qwen_strata 配置表的统计行 (一致性行, 补充行, 敏感性行, 第二与第三阶段, pooled 格), 理由写入规格: benchmark 不应依赖任何模型工程的配置表.
- 不移植 `override` 的回查退路 (`pending.json` 与 `candidates.json`) 与 `adjudicate` 的两条一致性错误及 10 轮上限, 理由写入规格; 改为同一次评分内候选编号重复判 `blocked`.
- 其余沿用 issue 39 已删除的范围.

交付内容 (合同全文在开发规格 `#reviewer-capability-suite`, 本节只列要点):

- `pool build` (新增 `--limit`, 缺省 150, Spec Readiness 与 Code Standards 为 210): 超过池上限时按期望句分组拆成多个池 `<name>-<n>` (分组不拆开, 组大小降序, 首次适配, 随机数发生器在池之间延续); 新增 `--decisions` 跳过指纹与简报哈希都相符的候选; 前置检查 (控制项占满池, 分组过大, 候选重复, 锚点 `origin` 与候选冲突, 控制项不合规, Spec Readiness 候选缺子场景) 均 `blocked`; key 新增 `role`, `registrySha256`, `views`.
- `pool view <root> <name> <scenario-directory ...>` (顶层连接 `lib/reviewer-capability-view.mjs`): 从夹具现场搭出被审状态写入 `adj/`, 写 `change.diff` 与脱敏的 `REVIEWER-REQUEST.json`, 写 `view-binding.json`.
- `pool prompt` 先检查 `adj/` (池哈希, 只含池, 裁决与 view, 缺 view, 视图哈希绑定); `pool split` 增加简报核对, `--hard`, 家族与模型分层一致率, Main 复核清单与 `split-<name>.json`; `pool override` 增加决定格式与种类校验和 `--by`; 新增 `pool anchor-add`.
- `score` 新增: 复用裁决时比较简报哈希并报告 `staleDecisions`, `decisions`, `decisionSources`; `--provisional lower|upper`; `--enumerate`; 重复候选编号 `blocked`; `templateFindings` (规范化文本与 `difflib` 比率聚类, 只作标记); `combine` 同步合并这些字段.
- `summary --cell <标签> <文件 ...> [--markdown]`: 格内 mean, SD, SE, t 95% 区间, 负分数个数, 最小, 中位数, `meanR83`, 平均 `rawScore`, 平均 `f`, 修复总数; 每格前 5 个实例入主统计, 其余入 `extraIds` 并提示.
- 同步更新 `$reviewer-capability` Skill 步骤 5 到 7 并新增统计步骤.

预估净增: 代码约 +700, 测试约 +400, 规格与 Skill 文字约 +70, 夹具数据约 50 KB (`qwen-golden.json`).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-development/spec.md#reviewer-capability-suite`
- `docs/specs/agent-repository-workflow-release/spec.md#reviewer-capability-tests`

## Acceptance criteria

- [x] 拆池与前置检查: 池数, 池名, 分组完整, 随机数延续, 各 `blocked` 分支. 观察: 确定性测试经 `pool build` 的 `limit` 传入较小的池上限; 以 `qwen-golden.json` (由 qwen_strata `blind_pool.build` 对同一候选集生成, 含锚点选取) 为金标准, 断言每个池的池项 id, 分组, 指纹, 来源与池名逐项相等.
- [x] 视图与提示检查: `pool view` 写出的 view 文件, `change.diff`, `REVIEWER-REQUEST.json` 的 `draftPath` 为 `<redacted>`, `view-binding.json` 的文件哈希; `pool prompt` 对池文件改动, `adj/` 多余文件, 缺 view, 视图哈希不符返回 `blocked`. 观察: 测试在小夹具上断言这些输出与 `blocked` 分支.
- [x] 拆分与复核清单, override, anchor-add. 观察: 测试断言分族与分模型一致率, `split-<name>.json` 在控制不通过时仍写出且 `written` 为 0, 复核清单三种 `why` 与 `--hard`, 简报改动 `blocked`; override 的格式, 种类, `--by` 与历史; anchor-add 的自动编号, 重复 id, 缺 `--model`, 发现候选拒绝, 写回格式, 写入后 `pool build` 能用该锚点.
- [x] `score` 的过期裁决, `--provisional`, `--enumerate`, 重复编号. 观察: 测试断言简报哈希或指纹不符进入 `staleDecisions` 且候选保持待裁, `lower` 与 `upper` 的分数区间包住实际分数且 `candidates` 为空, `--enumerate` 返回全集且无 `scores`, 互斥参数与重复编号返回 `blocked`; `combine` 合并新增字段.
- [x] 统计: `tQuantile`, `tTwoSidedP`, 格内 `mean/sd/se/ci95/nNegative/min/median` 与 qwen_strata `benchmark_summary` 的金标准输出相对误差不超过 1e-9; `summary` 的前 5 个与 `extraIds` 提示, 未定稿输入, 缺 `final` 的 Spec Readiness 单子场景输入, 重复标签或文件的 `blocked`; `--markdown` 输出左对齐顶格的表.
- [x] 模板标记: `normalizedFinding`, `sequenceMatcherRatio` (含长度不少于 200 的文本) 与 `templateFindings` 与金标准逐项相等; `score` 输出含 `templateFindings`.
- [x] 等价核对 (一次性, 记入 `## Comments`): 对 qwen_strata 的 `blind_pool.build` 与纯函数运行同一候选集, 与 ARW 的结果逐项比较, 不依赖 qwen_strata 的测试保持独立可运行.
- [x] 开发规格 `#reviewer-capability-suite` (已在实施前更新) 与 `$reviewer-capability` Skill 一致. 观察: `arw text check` 通过, 规格各 Interface 字段在测试中被断言.
- [x] 测试回调均不超过 100 毫秒; 全量测试, 类型检查, 分发检查, `arw text check`, Skill 投射检查通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 771 个测试, 770 通过 / 0 失败 / 1 跳过; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过; `arw spec-readiness verify --issue issue:0001:40` 退出 `0` (第 6 轮 `No problems.`).
- 测试回调耗时: 新增测试均在 100 毫秒内, 除 `pool view` 的 Spec Readiness 一例 (真实 Git 与 `prepareSpecReadiness`, 单独运行约 100 毫秒, 并行时到 128 毫秒); 已有的 Spec Readiness `setup` 测试 (最终复测 92 毫秒) 与融合测试 (复测低于 90 毫秒) 均在阈值内, 瓶颈是 `setupScenario` 的 Git 子进程.
- 同一次评分内候选编号重复判 `blocked`: 正常报告无法制造重复编号, 所以只测试查找函数 `repeatedId`, `score` 中的 `blocked` 分支本身没有端到端测试.
- 净增 (估算): 代码约 +560 (新增 `statistics.mjs` 92, `templates.mjs` 86, `reviewer-capability-view.mjs` 79 行), 测试约 +300, 规格与 Skill 约 +40 (仅计净变化), 数据 `qwen-golden.json` 60 KB. 代码低于预估 (+700), 因为入口脚本改为通用选项解析, 删去了原来的逐命令分支.

## Comments

- 等价核对 (一次性, 只读 qwen_strata): 脚本在会话临时目录, 用 qwen `blind_pool.build` (池上限 40, 40 个生成候选, 以 `requirements-reviewer/code-spec` 的 24 个锚点与简报, 触发锚点选取与三池拆分 15/15/10), `bench_score.template_findings`, `benchmark_summary` 的 `t_quantile`, 均值, SD, 中位数, 以及 Python `difflib` 比率 (32 对, 含长度不少于 200 的文本) 生成 `qwen-golden.json`. ARW 的结果与它逐项相等: 池项 id, 分组, 指纹, 来源, 引用; `tQuantile` 与 `tTwoSidedP`, 格内统计相对误差不超过 1e-9; `SequenceMatcher` 比率, 规范化文本与 `templateFindings`. 测试读取该夹具, 不运行 qwen_strata.
- Spec Readiness 共 6 轮 (Reviewer 为 haiku high): 前几轮的问题是 Spec Readiness 池的场景与简报来源, 随机数消耗顺序, 公平性段落正文, 失败分类, 写入失败的恢复, 拆池测试的注入点, 不移植项的理由 (`MAIN_N`, `templateFindings`, `legacy`), ADR 评估. 注入点的最终解法是把池上限公开为 `pool build --limit`, 不引入测试 Seam.
- 与预备分析和用户决定的偏离: `pool anchor-add` 的 `origin` 取自候选的 `candidateId`, 没有 `--origin` 选项; `summary` 不输出 `nValid`, `invalid`, `complete` (由 qwen 有效性判据派生); `pool build` 总是返回 `{alreadyDecidedSkipped, pools}` (单池时 `pools` 只有一项, 原来是平铺字段); `--markdown` 的表在 JSON 载荷的 `markdown` 字符串字段中; 不移植锚点文件 `scenario` 与场景名的核对, `--adj-as`, 实例项 `family`, `key.json` 的 `suite` 与 `pool_path`, 答案键 `legacy` 豁免 (用户 2026-10-29 决定, 选项 A).
- 提交审核第 30 轮的争议项 (Main 已接受, 不修改): (1) Code Standards 要求把 `tQuantile`, `tTwoSidedP` 与 `sequenceMatcherRatio` 移入 `lib/common/`: 它们只有一个调用方, 没有第二处使用, 移动还要改规格而使就绪记录失效, 属于 `Efficiency First` 第 3 条反对的过度设计. (2) 要求导出 `poolPaths(root, name)` 集中池目录布局: 只有两处使用, 增加一层抽象. (3) 视图模块重复定义 `exists` 与 `blocked`: 同样的写法已存在于 `operations.mjs` 与 `reviewer-capability-setup.mjs`, 合并是跨模块重构, 不属于本 ticket. (4) `pool view` 的 Spec Readiness 测试超过 100 毫秒 (单独约 100 毫秒, 并行 128 毫秒): Main 接受为例外, 每周测试清理处理.
- 第 31 轮争议项 (不修改): `repeatedId` 保留导出, 因为规格的测试覆盖段落承诺测试重复编号, 而 `score` 中的分支无法由正常报告触发, 只能测试查找函数; `sharedPath` 内联的存在性判断与 `exists` 重复, 理由同第 30 轮的 `exists` 争议.
