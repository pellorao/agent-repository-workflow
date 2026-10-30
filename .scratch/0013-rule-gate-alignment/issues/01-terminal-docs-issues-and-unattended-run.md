# 纯规则 issue 终态走非实施提交, 新增 unattended-run Skill

Status: completed

## What to build

实现 [spec:0013](../spec.md) 的 Behavior, 处理 Strata 分诊 (fixdocs E) 与 codex20 2026-10-30 运行分析中尚未完成的条目.

代码: `lib/commit-audit/commit-audit.mjs` 非实施校验中拒绝终态转换的循环 (约 248-252 行) 改为只拒绝新进入 `completed` 且候选树中存在该 issue 就绪记录的情况; `wontfix` 不再拒绝. `lib/workflow-distribution/workflow-distribution-sync.mjs` 的 `sourceOnlyRoots` (约 145 行) 加入 `unattended-run`; 检索其他维护同一源码限定 Skill 列表的代码与检查并同样加入.

规则与文档 (精确新文本见 `.tmp/fixdocsE/check.py`, 先核对旧文本仍唯一存在):
- `.agents/skills/commit/SKILL.md` 非实施分类中终态转换的句子, `.agents/skills/implement/SKILL.md` 中只改规则和文档的 issue 不安排就绪审核的句子, `docs/specs/agent-repository-workflow/spec.md` 中非实施分类的两处对应表述: 改为上述行为.
- `.agents/skills/issue-tracking/SKILL.md` Issue record sections 中 "有效要求和替代决定写入..." 一句: 补充已开始实施后的措辞, 重复或一致性处置按 `spec-readiness` 的 Authorization timing 记入 `## Comments`.
- `.agents/skills/reviewer-launch/SKILL.md` 名额不足的处理: 用一次 `list_agents` 找出占用者, 用 `wait_agent` 等待而不反复轮询, 提交审核两个 Reviewer 只得到一个名额时串行运行.
- 新增 `.agents/skills/unattended-run/SKILL.md` 与 `.agents/skills/unattended-run/agents/openai.yaml` (草稿 `.tmp/fixdocsE/skill.md`, `.tmp/fixdocsE/openai.yaml`; 把示例中已不需要真人的 `planDigest` 批准换成仍需真人的步骤). 开发长期规格中源码限定 Skill 列表 (约 42 行) 加入 `$unattended-run`.
- 总长期规格实施 issue 行 ("每个 issue 都运行" Spec Readiness, 约 39 行) 注明交付只含非实施分类内容的实施 issue 不运行; 非实施分类的理由段 (约 858 行) 写入 spec:0013 Behavior 中的理由, 已知限制与被拒绝替代方案; 新增 `docs/adr/0035-*.md` 并在 ADR-0006 与 ADR-0023 的对应句处指向它, 总长期规格 ADR 评估段 (约 910 行) 改为引用 ADR 0035 (见 spec:0013 ADR Evaluation).

分发: 修改的分发 Skill (commit, implement, issue-tracking, reviewer-launch) 按开发手册的发布前同步路线 (`review`, Main Agent 判断后 `review --complete`, `prepare`, `apply`) 更新 `distribution/` 副本, 运行 `node scripts/project-claude-skills.mjs` 更新 Claude 投影.

验证: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0013-rule-gate-alignment/`, `git diff --check`. Commit Audit 测试覆盖: 非实施候选使无就绪记录的 issue 进入 `completed` 通过, 有就绪记录时拒绝, 进入 `wontfix` 通过. 分发测试或检查证明 `unattended-run` 不进入 Workflow Distribution. 新增或语义修改测试后测量回调耗时. 不安装, 不推送, 不修改 `lib/background-agent/**`. reviewer-launch 的改动只约束 Main Agent 的调度, 不改变 Reviewer 行为, 不做能力测试.

预估非测试代码净增约 6 行; 文档净增约 4500 字符 (含新 Skill 与 ADR).

## Acceptance criteria

- [x] 非实施提交对无就绪记录的实施 issue 新进入 `completed` 与任意实施 issue 新进入 `wontfix` 通过, 对有就绪记录的 issue 新进入 `completed` 拒绝. 观察: Commit Audit 测试.
- [x] commit, implement Skill 与总长期规格对该分类的表述一致, 总长期规格含理由, 限制与被拒绝替代方案; ADR 0035 存在, ADR-0006, ADR-0023 与总长期规格 ADR 评估指向它. 观察: 文档差异.
- [x] issue-tracking 与 reviewer-launch 的规则改动按上述内容落地, 分发副本与 Claude 投影已同步. 观察: 文档差异与三个生产检查脚本.
- [x] `unattended-run` Skill 存在, 关闭隐式调用, 不进入 Workflow Distribution, 开发长期规格列出它. 观察: 文件, 分发检查与测试.
- [x] 完整验证命令通过. 观察: Validation 的实际命令结果.

## Blocked by

- None - can start immediately

## Validation

- 代码: `lib/commit-audit/commit-audit.mjs` 非实施终态检查只拒绝候选树中有 `<NN>.spec-readiness.json` 的 issue 进入 `completed`, `wontfix` 放行; `lib/workflow-distribution/workflow-distribution-sync.mjs` 的 `sourceOnlyRoots` 加入 `unattended-run` (检索未发现其他源码限定 Skill 列表). 第 1 轮审核后改为遍历全部 issue, 有就绪记录的 issue 进入 `completed` 或从 `wontfix` 改为 `completed` 都拒绝; 新增 `lib/arw-common/artifact-identity.mjs` 的 `readinessRecordPath`, 供 spec-readiness, artifact-migration 和 commit-audit 共用. 第 2 轮后 `stagedIssueInventory` 记录一次 HEAD 状态 (`previousStatus`), 由它派生 `terminalTransitions` 与非实施检查, 终态到另一终态 (如 `wontfix` 改 `completed`) 也进入 Gate 1. 非测试代码净减约 1 行.
- 测试: `tests/commit-audit/cli.test.mjs` 新增无就绪记录 `completed` 与 `wontfix` 放行用例, 原拒绝用例补就绪记录并断言拒绝, 另加有就绪记录时 `wontfix` 改 `completed` 被拒绝的用例; `tests/workflow-distribution/workflow-distribution-sync.test.mjs` 断言 `unattended-run` 不进入载荷. `tests/commit-audit/cli.test.mjs` 另加 Gate 1 覆盖 `wontfix` 改 `completed` 的用例. 回调最慢约 54.5 毫秒.
- 规则与文档: commit, implement, issue-tracking, reviewer-launch 四个 Skill; 新增 `.agents/skills/unattended-run/` (`disable-model-invocation: true`, `allow_implicit_invocation: false`, 示例改为本机浏览器登录授权); 总长期规格实施 issue 行, 非实施分类理由与 ADR 评估; 开发长期规格源码限定 Skill 列表; spec-readiness 与 triage Skill 的豁免说明; ADR-0006, ADR-0023 (第 37 与 39 行改为由 `verify --non-implementation` 按 ADR 0035 检查) 指向新增的 `docs/adr/0035-allow-rule-only-issues-terminal-status-in-non-implementation-commits.md`.
- 分发: Main 按新流程运行 `review` (两份候选均为空), `review --complete`, `prepare` 与 `apply`, 第 1 轮修复后再同步一次, 共更新六个分发副本; `node scripts/project-claude-skills.mjs` 更新投影并新增 `unattended-run` 投影, 分发载荷不含它.
- `pnpm test`: 805 个测试全部通过; `pnpm typecheck`, 三个生产检查脚本, `node arw.mjs text check`, 本 effort 的 terms check 与 `git diff --check` 通过.

## Comments

- Spec Readiness 共 3 轮: 补就绪豁免范围, ADR 0035 (部分取代 ADR-0006 与 ADR-0023), 理由, 限制与被拒绝替代方案; `adoptions.md` 本地化记录归 Upstream Sync 维护, 移出本 issue, 留待下次上游采用一并提交.
- Commit Audit 第 1 轮 7 个问题全部修复: 有就绪记录的 `wontfix` 改 `completed` 漏检, ADR-0023 旧路由描述, spec-readiness 与 triage Skill 未提及豁免, JSDoc, 就绪记录路径重复拼接 (抽出 `readinessRecordPath`), 总规格重复表述改为引用 ADR 0035.
- Commit Audit 第 2 轮: 修复 Gate 1 漏掉终态到另一终态的转换 (既有缺口), 去掉重复的旧状态判断, `readinessRecordPath` 别名包装和测试名不符; 总长期规格恢复限制与被拒绝替代方案的简述并保留 ADR 0035 引用.
- 台账: `.scratch/0013-rule-gate-alignment/spec.md:5` 记录不修 理由与替代方案与 ADR 0035 重复, 但该 spec 是就绪审核所依据的短期设计记录, 改动会使就绪记录的治理 Input 失效, 长期权威已在 ADR 0035.
- 台账: `docs/specs/agent-repository-workflow/spec.md:858` 冲突裁决 第 3 轮 Code Standards 要求只链接 ADR 0035, 第 2 轮要求符合审核依据验收条件 "总长期规格含理由, 限制与被拒绝替代方案" 要求保留简述; 以已就绪的验收条件为准, 保留一句简述加 ADR 0035 链接.
- 台账: `lib/commit-audit/commit-audit.mjs:249` 记录不修 非实施循环可改为遍历 `terminalTransitions`, 属第 3 轮起的非行为建议, 现有判断结果相同.
