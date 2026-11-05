# Code Standards 场景加入根 AGENTS.md 并做首批待测项 A/B

Status: completed

## What to build

`docs/agents/source-checkout-reviewer-testing.md` 待测项表已有 4 项 (触发线 3 项), 其中 2 项在根 `AGENTS.md`, 而 Code Standards 场景仓库没有根 `AGENTS.md`, 测不到. 本 issue 给场景补上根 `AGENTS.md` 和能触发这两项的受审改动, 然后按 `reviewer-capability` Skill 做一次 A/B, 接受后清空待测表. 不含设计决定.

1. `lib/reviewer-capability-setup.mjs`: 角色为 `code-standards-reviewer` 时, 把被测检出的根 `AGENTS.md` 拷进场景仓库根 (与 `INSTRUCTIONS` 同法, 随对照与候选的检出而不同).
2. `tests/fixtures/reviewer-capability/code-standards-reviewer/code-standards/`: 候选加两处受审改动并补答案键两个问题用例和简报说明: `src/billing/invoice-service.mjs` 删掉 `nothing to invoice` 检查而未写明守护目标 (根 `AGENTS.md` Efficiency First 第 6 条); `src/catering/catering-service.mjs` 末尾的 `notifyVendorWithRetry` 与 `tests/catering/vendor-retry.spec.mjs`, 其 `retryDelayMs` 参数只为测试传 0 (根 `AGENTS.md` 耗时阈值条).
3. `tests/fixtures/reviewer-capability/format-baseline/registry.json`: 更新该场景的 `scenarioSha256`. 格式错误基线 (pBase) 只校准报告格式错误率, 新增两个用例不改变它, 且 A/B 两组共用同一值, 所以不重测基线.
4. `docs/agents/source-checkout-reviewer-testing.md`: 待测项节的对照改为 "在当前版本中只还原待测项" (d37aec5 之前的版本夹杂已测过的改动和旧版套件, 两组场景也不同), A/B 接受后清空待测表.
5. 按 `reviewer-capability` Skill 做 A/B: 对照 = 当前工作树只还原表中 4 项各一句 (`issue-tracking/SKILL.md` 两句, `AGENTS.md` 两句), 候选 = 当前工作树; 场景 SR 与 CS, Codex `gpt-6-luna` `xhigh`, 盲裁 sonnet high. CS 的判定分数扣除新增的两个用例 (退化检测), 新用例命中数单列, 不参与判定.

测试: `tests/reviewer-capability-setup.test.mjs` 断言场景仓库含根 `AGENTS.md`. 预算: 非测试代码净增不超过 3 行.

预期验证: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0093-c10-reviewer-check-ab/`, `git diff --check`.

## Acceptance criteria

- [x] CS 场景仓库含被测检出的根 `AGENTS.md`, 答案键含两个新用例, 有测试断言根 `AGENTS.md` 存在.
- [x] A/B 按 Skill 的两阶段规则完成并记录结果表, 判定为接受; 待测表已清空, 对照定义已改写.
- [x] 预期验证全部通过.

## Blocked by

- None - can start immediately

## Comments

用户 2026-11-02 已确认这类不含设计决定的 issue 不需要治理设计 (就绪记录 `not-applicable`). Main 授权自主实施 (`.tasks/ARW/c10ab.md`); 对照方案 (只还原 4 句, 不用 `d37aec5^`) 与新用例不计入判定分数均由 Main 2026-11-05 裁定.

遗留: 两个场景的 Reviewer 有时因 "交接缺少验证事实和授权 issue 的净增行数预估" 返回 `incomplete` 且报告为空 (对照 control-cs-6 一次, 候选 cand-cs-10 一次, 另有历史上的 CS 对照 `incomplete`), 这是场景交接的问题, 与待测规则无关的可能性大但无证据; 值得以后修场景交接 (为 CS 场景补验证事实和预估行数). 本次 A/B 对 cand-cs-10 按 Skill 记 0 分, 去掉后的敏感性见 Validation.

偏离: (1) 对照没有用 `d37aec5^`, 而是当前工作树只还原表中 4 句 (Main 2026-11-05 裁定; `d37aec5^` 与 HEAD 之间含已测过的 `aa20600`, 旧版套件, 且 CS 场景无根 `AGENTS.md`, 两组场景不同). (2) 没有重测 haiku 格式基线: 套件的 `baseline` 命令要求场景变化后重测, 这里只把 CS 的 `scenarioSha256` 改成新值; pBase 只校准报告格式错误率, 两组共用同一值, 本次 CS 阶段 2 的格式错误只有 control-cs-5 修复 2 处, 其余为 0, 对结论无影响. (3) CS 判定用扣除 2 个新用例的答案键 (`pruned`, 由同一工作树复制并从 `expected.json` 去掉最后两个问题用例, 同步 registry 的 sha; 在其中新代码上有依据的 finding 被盲裁判 supported, 不加不扣): 这两个用例只有带新规则的候选组能命中, 计入会给候选组白送分; Main 2026-11-05 裁定. 真实答案键下的命中数单列, 不参与判定. (4) 以后 CS 分数与本次之前的历史分数不可直接比较 (场景仓库新增根 `AGENTS.md`, 候选新增两处改动).

台账: `tests/fixtures/reviewer-capability/format-baseline/registry.json:100` 不重测 pBase、只更新 `scenarioSha256` 记录不修: 与 `reviewer-capability` Skill 步骤 4 "场景答案键改动后须重测基线" 的字面要求冲突, Main Agent 2026-11-05 看过该偏离及理由 (pBase 只校准格式错误率, 两组共用同一值, 本次格式错误几乎为 0, 对 A/B 判定无影响) 后裁定接受, 属 Main Agent 对 Skill 规则的例外, 不修订 Skill.

## Validation

A/B 命令与数据: 脚本 `.tasks/ARW/c10ab/data/ab/`, 运行目录 `.tmp/claude-code/<session>/c10ab/`; 设置 Codex `gpt-6-luna` `xhigh`, 盲裁 sonnet high (claude-api), 盲裁一轮后候选清零.

| 场景 | 阶段 | 对照均值 | 候选均值 | 差值 | SE | 95% 区间 | 判定 |
|---|---|---|---|---|---|---|---|
| SR | 1 (3 对 3) | 0.593 | 0.601 | +0.007 | 0.087 | -0.245 到 0.260 | 候选不低于对照, 接受 |
| CS (pruned) | 1 (3 对 3) | 0.563 | 0.529 | -0.035 | 0.022 | -0.097 到 0.028 | 未拒绝, 候选低于对照, 进阶段 2 |
| CS (pruned) | 2 (10 对 10) | 0.540 | 0.480 | -0.060 | 0.059 | -0.189 到 0.069 | 区间含 0, 接受 |

- CS 逐次 final (阶段 2 的 10 次, 按开始先后): 对照 0.565 0.539 0.586 0.352 0.539 0.545 0.582 0.615 0.537 0.537; 候选 0.561 0.502 0.523 0.564 0.454 0.573 0.486 0.591 0.542 0. SR 阶段 1: 对照 0.518 0.573 0.688, 候选 0.742 0.524 0.535 (均值 0.601).
- 失败: cand-cs-10 的 Reviewer 回 `incomplete` ("交接缺少该比较的验证事实和授权 issue 的净增行数预估"), 报告为空, `completion` 非空, 按 Skill 记为模型失败 0 分 (`inspect` 无 flag). 去掉该次后候选 9 次均值 0.533, 与对照差 -0.007, SE 0.027.
- 作废重跑: control-cs-6 第一次同样回 `incomplete` (拒绝理由相同), 但 Reviewer 环境提前退出, `list_agents` 记录缺少 threadId 与 snapshot members, `inspect` 返回 `blocked`, 按 Skill 作废 (旧目录 `void-control-cs-6`), 用新实例重跑得 0.545.
- `inspect` flags 共 3 个, 均核对为误报并保留: control-cs-1 的 `sed -i 's/.../'` 的 `/` 分隔符; control-cs-3 与 cand-cs-9 的 `rg --files` 只列文件名, 运行目录里没有答案键.
- 新用例命中 (真实答案键 `--provisional`, 不参与判定): 下界两组都是 0; 上界 `issueInvoice` 删检查两组 0/10, `retryDelayMs` 对照 3/10, 候选 4/10. 两条新规则几乎没被应用, 候选组也没有明显更多命中.
- 预期验证: `pnpm test` 908 通过, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0093-c10-reviewer-check-ab/`, `git diff --check` 在受审暂存树 `23525681468a63ca43fffc6b1478fc25fb839cc7` 上通过: `pnpm test` 908 通过 0 失败, `pnpm typecheck` 无错误, 三个脚本检查退出码 0, `arw text check` (976 个文本文件) 与 `terms check` 通过, `git diff --check` 与 `git diff --cached --check` 退出码 0. 其中对 issue 文件内容敏感的三项 (`arw text check`, `terms check`, `git diff --check`) 在本条记录写成之后, 对包含它的最终 issue 文件再跑一遍, 均通过 (退出码 0); 代码与测试文件自 `23525681468a63ca43fffc6b1478fc25fb839cc7` 起未变, 其余各项的记录仍对应该树.
- 待测表已清空, 对照定义已改为 "在当前版本中只还原待测项".
