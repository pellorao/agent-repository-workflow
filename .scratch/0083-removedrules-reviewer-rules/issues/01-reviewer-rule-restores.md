# 已删规则复查: 删除前说明目标, 能力测试接受标准对齐, 要求符合审核规则 A/B 未通过

Status: completed

## What to build

已删规则价值复查 (removedrules) 中用户 2026-11-04 同意的三项, 只改 Agent 规则文档. "A/B" 指 `reviewer-capability` Skill 的两阶段规则.

### 删除前写明所守护的目标

在根 `AGENTS.md` 的 Efficiency First 第 6 条末尾加一句: 删除规则, 检查, 门禁或测试前, 写明它守护的目标, 以及该目标已不存在或由何处覆盖; 说不出时保留, 或交用户决定. 同步 `distribution/baseline/AGENTS.md` 的受管区域. 目的: 10-26 迁移按 "精简" 删掉了发布覆盖和会话检查中的禁止来源核对, 没有人被要求说明它们守护什么. 这条约束的是 Main Agent 的删除纪律, 不改变 Reviewer 的评审行为; 能力测试的场景仓库不含 ARW 根 `AGENTS.md` (`lib/reviewer-capability-setup.mjs` 的 `INSTRUCTIONS` 不含它), 对照组与候选组输入相同, 无法用能力 A/B 度量, 所以不做 A/B (Main 2026-11-04 同意).

### 能力测试接受标准与 A/B 判定规则对齐

根 `AGENTS.md` Source Checkout Validation 的能力测试一条中, "评分不降低才接受改动" 改为 "接受或拒绝按 `reviewer-capability` Skill 的 A/B 判定规则", 后一句改为 "速度提升很大, 而该规则拒绝或候选均值低于对照时, 交用户决定" (速度限定对两种情形都适用; 规则接受且均值不低于对照的改动不交用户). 目的: 用户 2026-11-04 采纳了该 Skill 的两阶段规则 (`d6eed37`), 原句 "评分不降低" 与之冲突 (`d6eed37` 提交审核台账). 纯措辞对齐, 不做 A/B.

### 要求符合审核的来源限制与防误报 (A/B 未通过, 本 issue 不交付)

本 issue 不交付这一项, 它只是记录 A/B 结论. 曾计划在 `docs/agents/roles/requirements-reviewer.md` 加: (a) 证据只来自本轮 Request, 受审版本和自己前轮的报告, 不读其他角色的报告或未交接的 `.tmp` 文件, 记录中的链接不增加读取范围; (b) 要求定义了更广的集合时核对整个集合, 不缩小为附近列出的几项; 只按每项要求自身的文字判断, 不从相邻文本借入顺序, 格式, 原子性等约束, 不把未规定的依赖行为或个人偏好当作要求. (a), (b) 合为一个候选做 A/B. 结果见 `## Validation`: 场景 `requirements-reviewer/code-spec` 在第二阶段被拒绝, 所以角色文件不改, 本 issue 不交付这两项. 现有夹具的干净用例已含误报陷阱和更广集合, 未改夹具和答案键.

净增预算: 文档约 +200 字符. 实际见 `## Validation`.

## Acceptance criteria

- [x] `AGENTS.md` 与 `distribution/baseline/AGENTS.md` 含删除前说明目标的一句, 受管区域一致.
- [x] `AGENTS.md` 的能力测试一条按 `reviewer-capability` Skill 的 A/B 判定规则接受或拒绝.
- [x] A/B 结果表 (每阶段每组实例数, 平均, 差值区间, 耗时, 作废数) 写在 `## Validation`; 被拒绝的角色文件改动已回退.
- [x] `node scripts/check-workflow-distribution.mjs`, `node arw.mjs text check`, `git diff --check` 通过.

## Blocked by

- None - can start immediately

## Validation

候选 (a)+(b) 与对照 (HEAD `d6eed37` 的角色文件, 以 `git archive` 副本搭场景) 交替启动, Claude `haiku` `high`, 同一版夹具与评分器, 每个场景每组先 3 次, 再按 F3 加到 10 次, 同期运行 (并发 2 到 3). 盲裁: 每个池一个 sonnet high 裁判 (headless `claude -p`), 锚点一致率阶段 1 全为 1; 阶段 2 池 `commit-audit-s2-1` 第一次对照失败整池重裁, 第二次锚点 0.917 通过; 偏离 `reviewer-capability` Skill 步骤 6: Main 复核清单 (全部 `supported` 的发现候选, 阶段 1 共 30 个, 阶段 2 另有若干) 未逐条复核, 原因是 150 分钟预算; 两组候选并入同一批裁决, 裁决口径相同, 对差值方向的影响预计小, 但未验证. `inspect`: 无作废; 少数 `flags` 的 `match` 是正则交替里的 `/` 分隔符, 另有 2 例 (`code-spec-k-1` 对照, `code-spec-c-5` 候选) 是一次 Glob 的 path 指向该运行自己的目录 (实例的父目录, 只含该运行的 `setup.json`, `state` 与实例, 没有答案键, 没有其他实例或以前运行的记录), 均保留; 两例分属两组, 不影响两组均值的比较方向. 全部 40 个实例 `completion` 为 `ready`.

阶段 1 (每组 3 次): 差值为候选减对照, 95% 区间为 Welch.

| 场景 | 对照均值 | 候选均值 | 差值 | 95% 区间 | 判定 |
| --- | --- | --- | --- | --- | --- |
| code-spec | 0.626 | 0.534 | -0.092 | -0.297 到 0.113 | 候选均值低且未拒绝, 加到 10 次 |
| commit-audit | 0.578 | 0.515 | -0.063 | -0.851 到 0.724 | 同上 |

阶段 2 (每组 10 次, 只判一次):

| 场景 | 对照均值 (SD) | 候选均值 (SD) | 差值 | 95% 区间 | 判定 |
| --- | --- | --- | --- | --- | --- |
| code-spec | 0.609 (0.077) | 0.533 (0.059) | -0.076 | -0.141 到 -0.011 | 拒绝 |
| commit-audit | 0.550 (0.223) | 0.432 (0.249) | -0.118 | -0.340 到 0.104 | 未拒绝 (均值低, 下界不能排除降幅 0.34) |

任一场景拒绝即拒绝: 角色文件改动已回退, 至本 issue 完成时 `docs/agents/roles/requirements-reviewer.md` 与 HEAD 相同. commit-audit 两组各有若干 0.14 到 0.16 的低分实例 (对照 2 个, 候选 4 个, 报告含大量问题行导致干净用例失分), 方差大是其区间宽的原因. 耗时: code-spec 每个实例约 5 到 15 分钟 (阶段 1 前两个 14 到 15 分钟, 其后约 6 到 8 分钟), commit-audit 约 5 到 8 分钟; 两组耗时无明显差别. 运行数据在会话临时目录 `.tmp/claude-code/<session>/ab/`.

检查: `node scripts/check-workflow-distribution.mjs`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 均通过. 实测 (`git diff --numstat`): `AGENTS.md` +2/-2, `distribution/baseline/AGENTS.md` +1/-1, 文档净增约 165 字符 (两处副本合计).

## Comments

- 2026-11-04 Main 同意: 项 1 不做 A/B; 本 effort 为纯文档, 不安排就绪审核 (`implement` Skill Entry 第 5 条), 走非实施提交工作流.
- 要求符合审核规则 (a)+(b) 被 A/B 拒绝. 若仍想要来源限制 (a), 可单独做一轮 A/B (只测 (a)), 因为拒绝可能来自 (b) 的防误报文字; 本轮未拆分.
- 2026-11-04 手工 `requirements-reviewer` 一轮 (按 `commit` Skill 非实施例外, 不复审) 的处置: 修 2 条 (第三项写明本 issue 不交付; `AGENTS.md:92` 速度限定改为对两种情形都适用并以 "候选均值低于对照" 定界), 订正 Validation 中 Glob 例数 (2 例) 并补充依据; 台账: `## Validation` 的盲裁清单未逐条复核 记录不修 (偏离已写入 Validation, 无预算复核); 台账: Status completed 与第三项不交付 记录不修 (已在 What to build 写明不交付).
