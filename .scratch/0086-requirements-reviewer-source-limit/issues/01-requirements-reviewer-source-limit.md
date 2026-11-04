# 要求符合审核: 证据来源限制

Status: completed

## What to build

已删规则价值复查 (removedrules) 项 8: 在 `docs/agents/roles/requirements-reviewer.md` 的 Inputs 一节末尾加一句 (同步 `distribution/baseline/docs/agents/roles/requirements-reviewer.md`): 证据只来自本轮 Request, 受审版本和自己前轮的报告, 不读其他角色的报告或未交接的 `.tmp` 文件, 记录中的链接不增加读取范围.

目的: 提交审核的两个 Reviewer 并行写同一轮目录, 不加限制就可能互相读对方的报告而附和, 失去独立性; 10-26 迁移删掉了这类限制. 防误报和更广集合的两句 (原项 9) 不在本 issue 内: 它们与本句合并测试时被拒绝 (见 0083 的 issue), 本 issue 只测本句.

净增预算: 文档约 +80 字符 (两处副本合计约 +145).

## Acceptance criteria

- [x] 两个角色文件含这一句, 两处副本逐字一致.
- [x] 按 `reviewer-capability` Skill 的 A/B 规则测试, 两个场景都没有被拒绝, 结果表写在 `## Validation`.
- [x] `node scripts/check-workflow-distribution.mjs`, `node arw.mjs text check`, `git diff --check` 通过.

## Blocked by

- None - can start immediately

## Validation

候选只含这一句, 与对照 (HEAD 的角色文件, 与上轮对照组的角色文件逐字相同) 比较. Claude `haiku` `high`, 场景 `requirements-reviewer/code-spec` 与 `commit-audit`. 对照组复用上一轮 (0083) 的 10 个实例: 角色文件, 同目录规则副本, 夹具和答案键与 HEAD `42aa921` 逐字相同 (`42aa921` 与上轮对照所用的 `cb92e98` 之间只改了 `lib/` 的实现与测试, 没有改 Reviewer 输入, 夹具, 评分与裁决代码的行为); 候选组为本轮新跑的 10 个实例 (并发 2, 与对照组不同期, 这是对 Skill "同期运行" 的偏离, 因对照输入逐字相同才复用). 候选实例由 HEAD 的 `git archive` 副本加这一句搭场景, 用已安装的 `arw background-agent` 运行 (与对照组同一安装). 盲裁: 候选的发现候选按池 (阶段 1 一个池, 阶段 2 在 150 候选上限内分池) 由 sonnet high 裁判 (headless, 经 `claude-api`) 裁决, 全部池锚点一致率为 1, 合成对照全对; 对照组沿用上一轮的裁决 (候选不同, 不重裁). 偏离 Skill 步骤 6: Main 复核清单 (全部 `supported`) 未逐条复核. `inspect`: 无作废; 全部 `flags` 的 `match` 是 grep 或正则交替里的 `/` 分隔符 (文本中即使出现该运行自己的实例路径, 也只是搜索自己的文件). 20 个候选实例 `completion` 全为 `ready`.

阶段 1 (每组 3 次, 对照取上一轮前 3 个): 差值为候选减对照, 95% 区间为 Welch.

| 场景 | 对照均值 | 候选均值 | 差值 | 95% 区间 | 判定 |
| --- | --- | --- | --- | --- | --- |
| code-spec | 0.626 | 0.570 | -0.056 | -0.268 到 0.157 | 候选均值低且未拒绝, 加到 10 次 |
| commit-audit | 0.578 | 0.460 | -0.118 | -0.814 到 0.577 | 同上 |

阶段 2 (每组 10 次, 只判一次):

| 场景 | 对照均值 (SD) | 候选均值 (SD) | 差值 | 95% 区间 | 判定 |
| --- | --- | --- | --- | --- | --- |
| code-spec | 0.609 (0.077) | 0.550 (0.071) | -0.059 | -0.128 到 0.011 | 未拒绝, 接受 (均值低, 下界不能排除降幅 0.128) |
| commit-audit | 0.550 (0.223) | 0.432 (0.253) | -0.118 | -0.342 到 0.106 | 未拒绝, 接受 (均值低, 下界不能排除降幅 0.342) |

按 F3 规则两个场景都未被拒绝, 所以接受; 但两个场景的候选均值都低于对照, 区间下界不能排除明显降幅, 这是 "未拒绝", 不是 "没有降低". commit-audit 的低分实例 (0.13 到 0.16, 召回仅 0.26 到 0.28, 报告为多行长条目格式) 对照 2 个, 候选 4 个; 这类低分在两组都出现, 来自报告格式, 不能归因于这一句. 耗时: code-spec 对照均值 431 秒 (中位 388), 候选 363 秒 (中位 372); commit-audit 对照 323 秒 (中位 316), 候选 301 秒 (中位 302); 无明显差别. 上一轮合并候选 (含防误报两句) code-spec 被拒绝 (差值 -0.076), 本轮只留来源限制后差值 -0.059, 区间含 0.

检查: `node scripts/check-workflow-distribution.mjs`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0086-requirements-reviewer-source-limit/`, `git diff --check` 均通过. 实测 `git diff --numstat`: 两个角色文件各 +1/-1, 每处净增约 72 字符.

## Comments

- 两个场景的候选均值都低于对照 (-0.059, -0.118) 且区间下界不低, 接受只是规则的结果; 如果想更保守, 可以让 Main 决定是否再加跑 (已达 F3 的 10 次上限, 再跑须新增规则).
- 数据在会话临时目录 `.tmp/claude-code/<session>/ab2/` (候选实例, 池, 裁决, 驱动脚本), 对照数据在 `ab/`.
