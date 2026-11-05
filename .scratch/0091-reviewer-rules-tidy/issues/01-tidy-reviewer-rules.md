# 整理 Reviewer 规则并统一能力测试模型

Status: completed

## What to build

按 ruletidy3 (2026-11-05 规则整理周检的 (b) 批) 合并一个 issue, 不含设计决定, 全部是去重, 缩小读取范围和写明已有规则, 加一处能力测试政策. 保持各 Reviewer 的检查内容不变.

1. T5a: 角色文件写明各自适用的文档. `docs/agents/reviewer.md` 的 Agent instructions 节改为 "角色文件列出的其他文档和 Skill", 并写明工作流触发条件只约束 Reviewer 自己的动作 (写报告, 创建临时文件), 不用来选择审查标准. Code Standards 角色写明适用的是根与嵌套 `AGENTS.md`, 不另读它们指向的其他文档 (含 `writing.md`). Spec Readiness 角色列出下面 L6, L11 之后的文档清单.
2. L6: `docs/agents/writing.md` 的 Specification design presentation 节移到新文档 `docs/agents/specification-presentation.md`, Repository terminology 节移到新文档 `docs/agents/repository-terminology.md` (两份都是随分发的 managed 文档), Source Checkout 读者文档 节与 `docs/specs/arw-reader-documentation/spec.md` 重复的中英文维护说明删除, 只留读取该规范的触发与 Baseline 例外声明 (仍在 `writing.md`). `writing.md` 在原位置各留一条触发, `to-spec` Skill 的引用改指新文档. `lib/reviewer-capability-setup.mjs` 的 `INSTRUCTIONS` 列表同步: 场景仓库带上新文档, 去掉不再被任何角色引用的 `agent-writes.md`.
3. L10: Spec Readiness 角色首次核实问题时不再读 `../agent-writes.md` (该文档管 Main 与 subagent 的写入分工, 指错方向).
4. L11: Spec Readiness 角色对 `issue-tracking` 只读 Issue structure 节, 对 `writing.md` 只读 Minimal sufficient contracts 节, 并读 `specification-presentation.md`; `domain-modeling` 仍只读 Long-term specification boundary.
5. L12 (R6, R7, R9, R10): R6 `commit` 实施工作流的台账一条只留 Main 侧格式, Reviewer 侧语义以 `reviewer.md` 的 Re-review 节为准. R7 "每轮抽查" 只在 `reviewer-launch` 的 Review rounds 节写一次 (提交审核加回归抽查), `commit` 与 `spec-readiness` 改为指向它. R9 删除 `code-standards-reviewer.md` 与 `spec-readiness-reviewer.md` 中重述 `reviewer.md` 的 Single-agent, Communication, Report 节的段落. R10 删除 `spec-readiness-reviewer.md` 中与 `reviewer.md` Report 节逐字相同的 `ready` 与 `incomplete` JSON 格式. R8 不做 (场景仓库没有根 `AGENTS.md`); `requirements-reviewer.md` 的 R10 部分不做 (不为约 50 字符再加测 commit-audit 场景).
6. C1: `docs/agents/subagent-findings.md` 的 Verify findings 节第二段只管 `code-review` 的普通代码审核问题; 提交审核与就绪审核的问题处置按 `commit`, `spec-readiness` 和 `rule-and-design-changes` 的 Reviewer-proposed changes 节.
7. C8a (用户 2026-11-05): `reviewer-capability` Skill Run 第 1 步把 A/B 与回归的比较模型由 Claude `haiku` `high` 改为 Codex `gpt-6-luna` `xhigh`, 旧理由 (luna 波动过大) 换成新理由: 两阶段 A/B 本来就要跑足够多的次数吸收波动, 且 ARW 用户多数运行 Codex, 比较应当测量 Codex Reviewer. 盲裁裁判仍至少 sonnet high. 这只改测试模型, 不改 Reviewer 行为和复审处置.

测试: 一轮 A/B (Codex `gpt-6-luna` `xhigh`, 盲裁 sonnet high). 对照是本批前的 HEAD `e533841`, 候选是本批改动后的版本, 场景 `spec-readiness-reviewer/spec-readiness` 和 `code-standards-reviewer/code-standards`, 按 `reviewer-capability` Skill 的两阶段规则逐场景判定; 被拒绝的场景把改动对半拆开重测. C1, R6, R7 套件没有复审或处置场景, 不做 A/B, 提交说明写明.

预算: 代码净增不超过 2 行 (`INSTRUCTIONS` 列表), 文档字符净增 (源文件 `docs/` 与 `.agents/`, 不含 `distribution/` 与 `.claude/skills` 的生成副本) 不超过 0 (去重与移到按需文档, 新增触发与新文档开头抵消一部分), 测试 0 行.

## Acceptance criteria

- [x] 上述 1 到 7 项在源文件, `distribution/` 副本和 `.claude/skills` 投影中一致; 没有断链的引用.
- [x] A/B 结果表写在 `## Validation`, 两个场景都未被拒绝; 被拒绝时已按规则拆分重测, 或按 `AGENTS.md` 提交用户决定.
- [x] `node scripts/sync-workflow-distribution.mjs`, `check-workflow-distribution`, `project-claude-skills --check`, `generate-install-arw --check`, `pnpm typecheck`, `pnpm test`, `node arw.mjs text check`, `git diff --check` 通过.
- [x] 加载量新行记入任务记录.

## Blocked by

- None - can start immediately

## Comments

用户 2026-11-02 已确认这类不含设计决定的合并 issue 不需要治理设计 (就绪记录 `not-applicable`). Main 授权本批自主实施; 规则与设计文档的改动确认按 `AGENTS.md` Source Checkout Baseline 例外由 Main 确认, 维护者按实施 issue 复核整体 diff.

文档字符预算的范围与结果: 预算按源文件 (`docs/`, `.agents/`) 计, 不含 `distribution/` 与 `.claude/skills` 下逐字复制源文件的生成副本; Main 2026-11-05 指示超出预算时在 Comments 写明原因并删去重复, 本条是该决定的记录. 计数方法: `commit-audit prepare` 标准错误按文件列出字符增减, 对 `docs/` 与 `.agents/` 开头的行求和. 结果: 源文件净增 -18 (已删去与 reader-documentation spec 重复的 Source Checkout 读者文档段落, 并缩短新增的触发句和指针句), 含生成副本的总数为正, 因为新增的 managed 文档被 `distribution/` 复制; 代码净增 0 行, 测试 0 行. 预算句已在 What to build 写明按源文件计. 加载量见 `.tasks/ARW/ruletidy/README.md` 的加载量表和下面 Validation 的加载量.

A/B 中的运行情况: `control-sr-1` 的 `agent.json` 缺快照 (Reviewer 已退出), inspect 返回 `blocked`, 按 Skill 作废并以 `control-sr-1b` 重跑. `control-sr-2`, `control-sr-3` 和 `cand-cs-4`, `cand-cs-7`, `control-cs-5`, `control-cs-6` 的 inspect flags 只是消息文本里的 `/`, 保留. `cand-cs-6` 的 flag 是 `rg --files ... ..` 列出了自己 run 目录的文件名, 没有读其他实例或答案键, 保留. Code Standards 的 Reviewer 在两臂都常返回 `completion=incomplete` (缺少预估净增行数等), 但报告非空时照常计分; `control-cs-7` 的报告为空 (0 字节), 按 Skill 记为模型失败, 分数 0, 计入 control.

## Validation

比较模型 Codex `gpt-6-luna` `xhigh`, 盲裁 sonnet high (`code-standards` 盲裁分 5 池, `spec-readiness` 分 2 池, 锚点一致率均为 1, 合成对照全对). 对照 HEAD `e533841`, 候选为本批改动后的工作树. 汇总命令 `reviewer-capability.mjs summary --compare control cand`.

| 场景 | 阶段 | n (对照/候选) | 对照均值 | 候选均值 | 差值 (候选减对照) | 95% 区间 | 判定 |
|---|---|---|---|---|---|---|---|
| `spec-readiness` | 1 | 3/3 | 0.637 | 0.667 | +0.030 | -0.162 到 0.223 | 接受 (候选均值不低于对照) |
| `code-standards` | 1 | 3/3 | 0.583 | 0.539 | -0.044 | -0.205 到 0.117 | 不拒绝, 候选均值较低, 进阶段 2 |
| `code-standards` | 2 | 10/10 | 0.499 | 0.592 | +0.093 | -0.049 到 0.235 | 接受 (区间不全在 0 以下, 候选均值高于对照) |

`code-standards` 对照均值含 `control-cs-7` 的 0 分; 去掉它后对照均值为 0.554, 候选仍高于对照. 实例耗时: `code-standards` 对照/候选平均 692 s / 685 s; `spec-readiness` 对照/候选平均 1900 s / 1311 s (对照 `control-sr-3` 2783 s 受并发影响, 不作速度结论). C1, R6, R7 没有复审或处置场景, 不做 A/B.

验收命令结果 (均在候选树上运行): `node scripts/sync-workflow-distribution.mjs` 完成; `node scripts/check-workflow-distribution.mjs` 通过; `node scripts/project-claude-skills.mjs --check` 通过; `node scripts/generate-install-arw.mjs --check` 通过; `pnpm typecheck` 通过; `pnpm test` 906 项通过, 0 失败; `node arw.mjs text check` 通过 (972 个文件); `git diff --cached --check` 通过.

加载量 (字符, report-1105 第 3 节口径, 基线 `e533841` 到候选): 常驻 B 8156 到 8156; P1 实施 29943 到 28324; P2 提交审核 28620 到 28812; P3a 就绪 (无问题) 23559 到 23650; P3b 就绪 (修一轮) 35582 到 34146; P4 非实施 24640 到 23021, 含编辑 32049 到 30430.

台账: `docs/agents/roles/code-standards-reviewer.md:24` 的适用范围与根 `AGENTS.md:49` Output Text 指向 `docs/agents/writing.md` 的关系 冲突裁决 要求符合审核按本 issue What to build 第 1 项要求 Code Standards 不另读它们指向的其他文档 (含 `writing.md`), Code Standards 要求把 `writing.md` 列为适用指令; 取前者, 因为这是本 issue 要建立的读取范围, 仓库文本的格式由 `node arw.mjs text check` 机械检查.
