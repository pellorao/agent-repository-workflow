# 恢复发布验证与能力测试的七项保护

Status: completed

## What to build

实现本 effort `spec.md` 的七项行为, 全部尽量简单, 只新增 `summary` 的 `compare` 一个程序接口 (预算: 文档净增约 3200 字符, 非测试代码净增约 28 行, 测试约 15 行):

1. `AGENTS.md` 的 Reviewer 能力测试触发: 括号内加 "Reviewer 运行时 (原生工具, 权限, 沙盒, 上下文, 默认模型与设置)", 并写明这类改动频繁时可只用受影响角色的一个场景, 或把几次改动合并为一次测试.
2. `.agents/skills/reviewer-capability/SKILL.md` Run 第 4 步: 报告为空或缺失时先看 `agent.json`: `completion` 非空 (`ready` 或 `incomplete`) 而报告没有可评分内容是模型失败 (`score` 记 0, 结果表写理由, 不看 `reason` 文本), `completion` 为 `null` (含状态 `exited` 而没有结论) 或没有生成记录是运行故障, 不计分并用新实例重跑 (两个判据按 `completion` 是否为 `null` 互斥); 启动前先确认场景文件和交接路径可读, 同一场景, 设置和实例序号用新实例路径连续尝试三次都是 `completion` 为 `null` 时不记分, 停止并报告维护者.
3. 同一 Skill 新增 `## Drift check` 节和同目录 `last-results.md` 登记表 (列: 场景, 后端, 设置, 日期, 候选 commit, `final` 平均, 实例数; 初始只有表头与说明), `.agents/skills/release/SKILL.md` 第 3 节在 Agent CLI 检查之后增加可选的 "Reviewer 能力漂移检查" 一步, 发布规格 `Reviewer capability tests` 一节加一句说明它是可选检查而非门禁, 判定漂移后继续或放弃发布由维护者决定.
4. `.agents/skills/release/SKILL.md` 第 3 节增加可选的 "初始化后交接冒烟" 一步 (通过条件见 spec), 发布规格新增 `Optional checks` 小节 (交接冒烟与漂移检查, 选择 skip 时在 `## Comments` 记一行), 发布规格 `Not release gates` 表中 "初始化 issue 生命周期" 一行保持原文不变 (交接冒烟不运行生命周期).
5. `scripts/release-guest-check.mjs` 在 Bootstrap 安装候选之后, 以及同版本交互重装和卸载后重装之后各运行一次新增步骤: 读安装目录 `manifest.json` 的 `managedFiles`, 逐文件与解压载荷的同一相对路径逐字节比较, 不同时 `FAIL` 并列出路径; 发布规格 `Every system` 表加一行.
6. `.agents/skills/reviewer-capability/SKILL.md` Run 第 1 步 (haiku 那句之后) 加 A/B 规则, 第 8 步 `summary` 命令行加 `[--compare <对照标签> <候选标签>]` 和一句说明: A/B 按事先固定的两阶段, 两组交替各先跑 3 次, 用 `summary --compare` 的差值 (候选减对照) 95% 区间, 整体低于 0 拒绝, 候选均值不低于对照接受, 其余两组各加跑到 10 次, 加跑期间不看结果, 跑满后只再判一次 (区间整体低于 0 拒绝, 否则接受); 每个场景分别判定, 任一拒绝即拒绝; 结果表写每阶段差值与区间, 不把 "未拒绝" 写成 "没有降低"; 不看两格各自区间是否重叠; A/B 两组同一版场景, 答案键, 简报, 评分器并同期运行, 不与旧历史分数比较, 不在同一改动里修场景或答案键; Reviewer 没遵循已有规则时先查原因, 不叠加同义指令 (规则全文见 spec).
7. `summary` 增加可选输入 `compare: [对照标签, 候选标签]` 与 `comparison` 输出 (`statistics.mjs` 加 Welch 差值函数, `operations.mjs` 与 `scripts/reviewer-capability.mjs` 解析 `--compare` 两个值并在 `--markdown` 时多一个比较表), 不受 `MAIN_N` 限制, 单格主统计不变; 开发规格 `summary` 条目, Design Rationale 的 `MAIN_N` 一句, 测试覆盖清单同步; 单元测试加已知值用例与 `blocked` 用例.

同步 `.claude/skills/` 投影. 两个可选步骤和漂移检查只写文字, 不运行.

## Acceptance criteria

- [x] `AGENTS.md` 触发含 "Reviewer 运行时 (原生工具, 权限, 沙盒, 上下文, 默认模型与设置)" 和减轻或合并测试的说明, 其余触发文字不变 (观察: `git diff AGENTS.md` 只在该条触发出现新增).
- [x] Skill Run 第 4 步含上述 `completion` 判据: `completion` 非空而无可评分内容才记 0 并写理由 (不看 `reason` 文本), 其余情形不计分并新实例重跑, 同一场景, 设置和实例序号连续三次尝试都为 `completion` 空时停止并报告 (观察: 对 Skill 文件 grep `新实例` 与 `模型失败`).
- [x] Skill `## Drift check` 节写明: 4 场景 × 2 后端默认设置各 1 个实例; 与 `last-results.md` 同格记录相对比较, 没有记录只登记; 低于记录 0.15 以上时同格加跑 2 个实例, 3 个平均仍低 0.15 以上才判定漂移并停下排查; 比较后 (发布完成之后随 `release` Skill 第 5 节提交) 更新 `.agents/skills/reviewer-capability/last-results.md` 并重新投影, 同格只留最新, 写入或提交失败时表保持原样并报告维护者; 只由本检查维护登记表 (观察: 读该节逐项核对).
- [x] `last-results.md` 存在且含表头与上述列; `.claude/skills/reviewer-capability/` 下有同样的投影 (观察: `node scripts/project-claude-skills.mjs --check` 通过, `ls` 两处目录).
- [x] `release` Skill 第 3 节有可选的交接冒烟步骤和可选的漂移检查步骤, 都写明 run 或 skip 由维护者选, 不设默认值, skip 不阻断发布, 并给出通过条件或指向 Drift check 节 (观察: 读 `release` Skill 第 3 节).
- [x] 发布规格 `Every system`, 新的 `Optional checks` 和 `Reviewer capability tests` 各处按上文更新, `Not release gates` 表保持原文, 与 Skill 一致 (观察: 对三处各 grep 关键词, 与 Skill 对照).
- [x] `scripts/release-guest-check.mjs` 在宿主 Linux 隔离 `HOME` 的运行中新步骤输出 `ok`, 载荷中有被改动文件时输出 `FAIL` 并列出路径 (观察: 运行 `node scripts/release-guest-check.mjs`, 步骤行出现 `ok` 或 `FAIL`).
- [x] Skill Run 第 1 步含两阶段 A/B 规则与同版本同期, 先诊断规则, 第 8 步含 `--compare` (观察: 对 Skill 文件 grep `--compare`, `事先固定`, `同期`, `先查原因`; 不再含 "区间分开即停" 的写法).
- [x] `summary --compare` 对已知值用例返回 `diff` -0.1, `se` 约 0.08165, `df` 4, `ci95` 约 [-0.3267, 0.1267]; 标签不存在或相同, 少于 2 个文件返回 `blocked`; `se` 为 0 时 `ci95` 等于 `[diff, diff]`; 10 个文件的格 `compare` 取全部文件, 主统计仍取前 5 个; 无 `compare` 时输出不变 (观察: 新增单元测试).
- [x] 开发规格 `summary` 条目, Design Rationale 与测试覆盖清单含 `compare` (观察: grep `compare`).
- [x] `pnpm typecheck` 与 `pnpm test` 通过, 文本, 术语, 分发, 投影检查通过.

## Blocked by

- None - can start immediately

## Validation

- 2026-11-04, 实现后的工作树: `pnpm typecheck` 通过; `pnpm test` 890 通过, 0 失败 (新增 summary compare 断言在 `tests/reviewer-capability/reviewer-capability.test.mjs` 的 summary 用例内: 已知值 diff -0.1, se 约 0.08165, df 4, `ci95` 约 [-0.3267, 0.1267], 10 个文件的对照格取全部文件而主统计仍取前 5 (`nControl` 10, 主统计 `n` 5), se 为 0, 三种 `blocked`); `node --check scripts/release-guest-check.mjs` 通过; `node scripts/project-claude-skills.mjs` 重新投影后 `--check` 通过, `node scripts/check-workflow-distribution.mjs`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0081-release-and-capability-restores/` 通过, `git diff --check` 无输出.
- 逐字节核对步骤: 宿主 Linux 上隔离 `HOME` 与 `USERPROFILE` (全新临时目录), `PATH` 去掉真实安装目录, `ARW_NESTED_GUEST_CHECK=1`, 用 `pack-release` 压缩包和一个临时构造的 agent-assisted fixture (候选 `workflow init` 后提交的小仓库) 运行完整 guest 检查: 全部步骤 `ok`, 末行 `PASS linux node 24.22.1 0.5.2 <commit>`, 新步骤 `已安装的 216 个受管文件与载荷逐字节相同` 在 Bootstrap 安装后, 同版本重装后, 卸载后重装后三处均 `ok`. 反例: 在一份临时副本里于第一次检查前往已安装的 `LICENSE.txt` 追加一个字节, 同一运行输出 `FAIL 已安装的 216 个受管文件与载荷逐字节相同` 并列出 `LICENSE.txt`; 临时副本已删除.
- 交接冒烟, 漂移检查和两个 A/B 规则只写文字, 未真实运行 (没有使用 VM, 没有运行能力测试, 没有调用真实 Codex 或 Claude).
- 实测净增 (`git diff --numstat` 对 HEAD; 本 effort 未暂存, 没有 `commit-audit prepare` 的数字): 非测试代码 +52/-9 (净增 43 行), 测试 +13/-1, 文档净增约 4690 字符 (不含 `.claude/skills` 投影). 预算 (文档约 3200 字符, 非测试代码约 28 行) 均超出, 见 Comments.

## Comments

- 来源: 已删规则价值复查 (removedrules) 项 2, 3, 4, 5, 11 (C1a, C2, A1, C1b, A5), 并入原 0069 (项 12, C4) 与 0070 (A/B 同版本同期, 先诊断再加规则), 次数规则的设计由独立分析 `removedrules-abstat` 给出 (用户 2026-11-04 采纳, 保留第二阶段跑到 10 次).
- 超出预算: 非测试代码净增 43 行对约 28 行预算, 超出约 15 行, 原因是 spec 要求的 `blocked` 条件 (标签缺失, 相同, 少于 2 个文件), `se` 为 0 的分支, 比较的 Markdown 表和 CLI 两值参数解析, 以及三处调用的逐字节核对函数; 文档净增约 4690 字符对约 3200 字符预算, 超出约 1500 字符, 因为合并了 0069 和 0070, 发布规格同时新增 `Optional checks`, `Every system` 行, 且各规则在 Skill, 发布规格, 开发规格由不同归属方各写一次. 已按提交审核第 1 轮删去发布规格与 Skill 间的重复段落.
- Spec Readiness: 新线程共 3 轮 (第 1 轮 9 条, 第 2 轮 1 条 (项数计数), 第 3 轮 `No problems.`); 先前 7 轮因线程过期被放弃.
- 本改动改变能力测试流程的规则 (A/B 判定, 运行故障不计 0 分, 漂移检查) 和 `AGENTS.md` 的能力测试触发, 但不改变 Reviewer 角色指令, `docs/agents/reviewer.md`, Reviewer 交接或 Request 内容, 不触发能力 A/B.
- 发布规格 `Not release gates` 的 "初始化 issue 生命周期" 一行按 spec 保持原文. 接受的限制与各项成本见 `spec.md` 对应章节.
- 台账: AGENTS.md:92 "评分不降低才接受改动" 一句与 .agents/skills/reviewer-capability/SKILL.md:24 两阶段 A/B 接受规则 冲突裁决 用户 2026-11-04 已采纳 F3 两阶段判定; 授权规格要求 AGENTS.md 该条其余文字不变, 故本提交保留原句, 紧接本提交另作规则提交把 AGENTS.md:92 改为引用该判定
- 台账: docs/specs/agent-repository-workflow-release/spec.md Reviewer capability tests 段与 Optional checks 引言 各一句 冲突裁决 effort spec 要求发布规格承载维护者决定权与 skip 记录, 保留这两句, 其余重复按第 1 轮删去
- 台账: issue What to build 预算 记录不修 Main 接受超出: 恢复的规则与 --compare 比预估多, 已删去重复段落
- 台账: .agents/skills/release/SKILL.md:43 (及 .claude 投影) 与发布规格 spec.md:30, :105 重复的维护者决定与 skip 记录两句 记录不修 第 3 轮的重复类问题
- 台账: scripts/release-guest-check.mjs:131 载荷侧文件缺失 冲突裁决 第 2 轮 Code Standards 要求只查安装侧; 载荷侧缺失时脚本以未捕获异常非零退出, 检查不会误判通过, 满足 spec 发现安装后写坏的目的, 不来回改
