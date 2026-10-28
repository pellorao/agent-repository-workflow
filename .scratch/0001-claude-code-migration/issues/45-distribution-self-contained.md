# 规则文档矛盾收口与分发文档自包含: 例外声明, 内部引用清理, 生产检查

Status: completed

## What to build

用户批准的待办 (2026-10-29): 合并 Strata 复核 T1 (规则文档间的矛盾与漂移) 和 "分发到目标仓库的文档不得引用 ARW 内部文档". 每项已对当前代码核实, 源码副本与 `distribution/` 副本同步修改 (被改的分发文件整份取自源码副本):

- 自治模式与基线规则的矛盾: `docs/agents/agent-writes.md` 的 Repository-owned 区域声明 Baseline 例外 (实施 issue 完成后 Main Agent 不等用户请求即提交; 提交审核期间可开始不依赖它的下一个实施 issue); 根 `AGENTS.md` 中非实施提交一条补 Baseline 例外标记; "ticket" 统一改称 "实施 issue" (`AGENTS.md` 自治模式段, `subagent-findings.md`, 提交说明可保留 "ticket NN"); `subagent-allocation.md` 的 Repository-owned 区域补一句重要决策分析 Agent 不低于 Main Agent.
- 语言检查例外: `AGENTS.md` 中 "分发副本的语言只由发布流程检查" 移到 `docs/agents/writing.md` 的 Repository-owned 区域, 声明为 Baseline 例外, 同处写明分发副本必须自包含的规则.
- 验证命令漂移: `source-checkout-validation.md` 与根 `AGENTS.md` 补 `node scripts/project-claude-skills.mjs --check` 与 `node scripts/generate-install-arw.mjs --check`; `AGENTS.md` 补 Skill 中 `arw workflow verify` 回退在本仓库不适用, 并写入非实施分类另含 `distribution/` 副本与根 `README.zh-CN.md`.
- 分发文档中的内部引用 (目标仓库读到会悬空或困惑): `commit` Skill 去掉 `distribution/`, `README.zh-CN.md` 和两个 ARW 专用脚本; `issue-tracking` Skill 删除 `readIssueRequirement` 说明, `module-correction.md` 与 `result-reuse.md` 改为相对链接; `writing.md` 的 "Workflow Distribution", "Source Checkout", "Upstream" 改写为目标仓库可读的措辞; `arw-commands` 与 `code-maps` Skill 的 "Workflow Distribution" 改写.
- 其余小漂移: `AGENTS.md` 体积预算写 "写进 issue 的 `## What to build`" (分发副本同); `arw-commands` 的写入命令列表补 `arw spec-readiness prepare`; `commit` Skill 的 Gate 2 跳过条件补 "并集非空且"; `spec-readiness-reviewer.md` 的 Module Design 格式判断与 ARW spec `Document content boundaries` 对齐 ("正式运行时代码", 并把 "只改说明文字而含义不变的值不属于此类" 补进 spec).
- 生产检查防回归: `workflow-distribution.mjs` 新增纯函数 `checkDistributionSelfContained(payload)`, 对载荷中每份 Markdown (按安装路径映射, `baseline/` 去前缀, `skills/` 映射到 `.agents/skills/`) 检查: 行内链接 `[文本](目标)` (围栏外, 外部 URL 与纯锚点除外) 和以 `docs/agents/`, `.agents/skills/`, `.claude/skills/` 开头的反引号路径 (含 `<`, `>`, `*`, `{`, `}` 或空白的视为占位符而不检查) (`.claude/skills/` 视同 `.agents/skills/`) 须在载荷内解析, 参考式链接和 HTML 不检查, 目标仓库自有约定 (`AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/adr/`, `docs/specs/`, `.scratch/`) 除外; 全文 (含围栏内) 不得含 `distribution/`, `node scripts/`, `Source Checkout`, `readIssueRequirement`, `Workflow Distribution`, `README.zh-CN.md`. `scripts/check-workflow-distribution.mjs` 在构建载荷成功后调用它, 有诊断即失败; `buildWorkflowDistribution` 不变. 围栏内的链接和路径不检查, 围栏识别复用 `findUnfencedLineIndexes`. 它是直接值操作: 返回稳定排序的诊断数组, 空数组表示通过. 诊断码 `distribution-internal-reference` 与 `distribution-reference-unresolved`.

spec 文字: development spec 的 `Workflow Distribution` 补自包含要求一段, `Validation strategy` 补一句内存载荷覆盖; ARW spec `Document content boundaries` 补一个括号说明.

预估净增 (代码 / 测试 / 文档): 代码约 +40, 测试约 +35, 文档与 spec 约 +40, 总约 +115 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-development/spec.md#workflow-distribution`
- `docs/specs/agent-repository-workflow-development/spec.md#validation-strategy`
- `docs/specs/agent-repository-workflow/spec.md#document-content-boundaries`

## Acceptance criteria

- [x] `checkDistributionSelfContained` 对可解析的行内链接, 目标仓库自有路径和代码围栏内的示例链接不报诊断; 对悬空链接, 悬空 `docs/agents/` 路径和每个内部名称 (含围栏内出现的) 各报一条诊断. 观察: `tests/workflow-distribution/workflow-distribution.test.mjs` 新增两个内存载荷用例.
- [x] `node scripts/check-workflow-distribution.mjs` 在构建成功后运行该检查并通过; 当前 `distribution/` 无内部名称. 观察: 命令输出 `Workflow Distribution production check passed.`; `grep -rnE 'distribution/|node scripts/|Source Checkout|readIssueRequirement|Workflow Distribution|README\.zh-CN\.md' distribution --include=*.md` 无输出.
- [x] `agent-writes.md` 与 `writing.md` 的 Repository-owned 区域声明对应 Baseline 例外, `AGENTS.md` 不再单独陈述分发副本语言规则, 自治模式段不再使用 "ticket". 观察: `grep -n ticket AGENTS.md docs/agents/subagent-findings.md` 无输出.
- [x] 两个 `--check` 脚本列入 `source-checkout-validation.md` 的验证命令; `commit` Skill 的非实施检查只要求 `arw text check` 与自查. 观察: 对应文件文字.
- [x] 被改的分发文件与其源码副本一致 (Skill 整份相同, 基线文档除 Repository-owned 区域外相同), `.claude/skills/` 投射一致. 观察: `node scripts/project-claude-skills.mjs --check` 退出 `0`, 对应 `diff`.
- [x] `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `arw text check`, `arw terms check`, `git diff --check` 通过; 新增测试回调均小于 100 毫秒.

## Blocked by

- None - can start immediately

## Validation

- Spec Readiness: 3 轮 haiku high. 前两轮问题: 豁免集合与 spec 不一致, 围栏内名称与链接语义, `.claude/skills/` 映射, 链接语法范围, 直接值操作与诊断码缺合同, 编排归属, 载荷路径映射, 自包含检查与 Markdown 结构责任, 设计理由, ADR 评估, 占位符定义, 围栏规则不在输入中; 处理: development spec 补全自包含合同 (映射, 豁免, 检查范围, 直接值 Interface, 理由, ADR 结论, 围栏规则), 复用 `findUnfencedLineIndexes` 而不是自写围栏正则, 并把 `issue-documents.mjs` 加入输入. 第 3 轮 `No problems.`, `arw spec-readiness verify --issue issue:0001:45` 退出 `0`.
- `pnpm test` 792 项, 791 通过 (1 项既有跳过), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `git diff --check` 通过; `arw terms check --include .scratch/0001-claude-code-migration/` 只剩既有的 3 条 `Artifact` 发现 (issue 42, effort spec 141 行, ARW spec 861 行). `distribution/` 下对内部名称的 grep 无输出.
- 新增两个测试只用内存载荷, 回调均小于 1 毫秒.
- 偏离: 自包含检查最初用自写围栏正则, 就绪审核后改为复用 `findUnfencedLineIndexes`; `agent-writes.md` 的 Repository-owned 区域不进入分发, 故该分发文件未改; `spec-readiness-reviewer.md` 对齐时把括号说明补进 ARW spec 而不是从 Reviewer 规则删除. 分发的 `commit` Skill 整份取自源码副本 (含此前落后的自查与 verify 步骤).
- 净增 (`git diff --numstat` 的新增减删除, 含 `.claude/skills` 投射副本, 不含 issue 与就绪记录): 约 +91 (估算 +115, 在两倍预算内): 代码 +49/-2, 测试 +29/-1.

## Comments

- 后续待办 (提交审核第 1 到 3 轮记录, 既有缺口): 自包含检查复用的 `findUnfencedLineIndexes` 对任意三反引号或波浪号行切换围栏, 与 `lib/common/markdown-visible-text.mjs` 的围栏闭合规则 (相同字符且不短于开栏) 不一致, 四反引号围栏内出现三反引号行时会提前退出围栏. spec 已按 "成对切换" 写明当前行为, 分发文档中没有此类嵌套. 若要统一, 把围栏识别移到 `lib/common/` 由 issue 文档与分发检查共同导入.
- 提交审核: 3 轮 haiku high. 第 1 到 2 轮的有效问题已修 (链接目标 `.claude/skills/` 映射, 带标题与尖括号的链接形式, 注释与命名, 删除 `path:line` 分支, writing.md 豁免清单改为引用 spec, AGENTS.md 分类补充措辞); 第 3 轮 requirements `No problems.`, code-standards 只重复已处理的 3 项 (脚本验证集合属 Repository-owned 对 Baseline 的收紧; 围栏函数位置见上; 安装根映射由 spec 规定).
