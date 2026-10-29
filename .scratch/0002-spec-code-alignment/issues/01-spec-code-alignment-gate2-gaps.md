# spec 与代码对齐: effort 0001 Gate 2 缺口收口

Status: completed

## What to build

背景: effort 0001 的 Gate 2 分片审核 (`docs/specs` 全文对照代码) 发现若干处代码与 spec 不一致, 以及可删的死代码和重复实现. spec 侧的文字对齐已作为独立的纯文档改动提交 (`348a153`, 当前 `docs/specs/**` 为准); 本 issue 改代码和测试, 外加主规格一句措辞修正 (见 "阶段汇总" 一项). 所有条目合并为一个 issue 一起实施, 依次是:

JIRA 与 Application (`lib/application-jira/`, `lib/arw.mjs`):

- C3: `jira-client.mjs` 的附加字段规范化只在字段 schema 为 `{type: 'user'}` 时转换用户. JIRA 的多用户自定义字段 schema 是 `{type: 'array', items: 'user'}`, 目前原样输出. 改为 `type === 'user'` 或 `type === 'array' && items === 'user'` 时都按 `{key, name, displayName}` 规范化 (数组逐项, 单值直接). 依据 `#printing-issue-details` 中 "被 JIRA 结构标记为 `user` 的值都使用该结构".
- C4: `application-association.mjs` 的 `association-module-effort-mismatch` 检查遍历全部 Application issue, 把其他 Application effort 对同一 Module 的关联也算进来. 改为只考虑与待关联 Application issue 同一个 Application effort 的已有关联 (用 `issueIdentity(...).effort` 比较). 依据 `#association-input` 中 "同一个 Application effort 在同一个 Module 中的所有关联必须使用第一次关联确定的同一个 Module effort".
- C5: 成员仓库 (`role === 'member'`) 运行 `arw submodule switch-branch` 或 `arw ssb` 时, `application-jira-cli.mjs` 的成员门禁目前返回 `Application configuration is required for submodule switch-branch.` 与退出码 `1`. 改为成功: 不执行任何 Git 操作, 输出现有的 `No configured Application Modules.` (见 `runSubmoduleSwitchBranchCommand` 的无 Module 分支) 并返回 `0`; 门禁文案里不再出现 `submodule-switch-branch`. 依据 `#submodule-branch-switching`. 实现时可让成员上下文直接走该无 Module 输出, 不新增分支文案.
- C6: `jira-convergence.mjs` 对下层返回的失败结果用 `'stage' in result ? result.stage : undefined) ?? '<本层阶段>'`, 即沿用下层 `stage`. spec 要求每层写自己的阶段: `issue-read`, `comment-read`, `transition-read`, `comment-create`, `transition`, `final-verification`. 改为这些失败分支直接写本层 `stage`, 不再读取下层的 `stage`. 依据 `#interfaces` 的 JIRA Convergence Interface.
- C7: `application-association.mjs` 重写早期 External dependency 时, 对 Module issue 的整份文本做全局正则替换, 会误改 `## Blocked by` 以外 (例如正文说明) 恰好匹配的行. 改为只在唯一的 `## Blocked by` 章节内替换 (章节边界与 `replaceBlockerSection` 现有定位完全一致, 不新增围栏识别). 章节定位复用 `replaceBlockerSection` 已有的逻辑 (按 EOL 拆行, 找唯一 `## Blocked by` 标题, 到下一个 `## ` 标题为止), 抽成一个定位函数供两处使用, 不复制第二份. 依据 `#blocker-projection`: External dependency "出现在 `Blocked by` 章节", 早期 External dependency 改写也只发生在该章节.

清理 (净删除):

- 13.6: `lib/common/configuration-conversion.mjs` 的成功结果里 `changes`, `sourceVersion` 和 `targetVersion` 三个键没有调用方 (`lib/installation/installation.mjs` 只用 `changed`, `bytes`, `unknownPaths`), spec 已不含这三项. 删除它们, 以及只为生成 `changes` 而存在的 `convertStep` 的 `entries` 计算 (`removed` 与 `targetEntries` 那段); `tests/common/configuration-conversion.test.mjs` 中的相应断言和只为它们存在的用例一并删除或改写, 保留对 `changed`, `bytes`, `unknownPaths` 的断言.
- C8: `REVIEWER_GIT_COMMANDS` 从 `lib/reviewer-runtime/reviewer-native-policy.mjs` 移到 `lib/arw-common/reviewer-configuration.mjs` 并从那里导出; `reviewer-native-policy.mjs` 与 `lib/background-agent/claude-sessions.mjs` 都从 `arw-common` 导入. 结果是 `lib/background-agent/` 不再导入 `lib/reviewer-runtime/`. 依据 `docs/specs/agent-repository-workflow-development/spec.md#source-checkout-layout` 中 "通用运行模块可以按 `lib/arw-common/` 中的 Reviewer 角色清单与共享常量执行这些运行约束, 但不导入 `lib/reviewer-runtime/`".
- 8.7: `lib/workflow-distribution/workflow-distribution-sync.mjs` 的 `readFilesUnder` 对 `kind !== 'file'` 的条目一律 `continue`, 因此符号链接和目录联接 (`kind === 'link'`) 被静默跳过. spec 要求这类条目关闭式失败. 改为: `link` 返回 `blocked` 与诊断 `filesystem-link-unsupported`, 诊断码和文案沿用 `lib/workflow-distribution/workflow-distribution.mjs` 与 `lib/common/filesystem.mjs` 已有的, 并带条目 `path`; 其他非 `file` 条目 (`directory`, 其内文件已由递归枚举单独给出) 仍 `continue`. 非常规文件 (`kind === 'other'`) 不需要分支: `lib/common/filesystem.mjs` 的 `list` 对每个非 link 子条目调用 `inspectExistingChain`, 它对 `other` 返回 `filesystem-entry-unsupported` 阻断, `list` 原样返回该结果, `readFilesUnder` 已在 `listed.status !== 'succeeded'` 时返回, 所以 `other` 条目从不出现在 `entries` 中. 新增测试用例: 枚举结果含 `link` 条目 (注入 `list` 结果) 时同步返回 `blocked` 且无写入; 源树中有真实非常规文件 (Unix 域套接字, Windows 跳过) 时同步返回 `blocked` 与 `filesystem-entry-unsupported`, 不加生产代码, 用来观察 `other` 已被关闭式失败. 依据 `#layout`.

阶段汇总 (`lib/reviewer-runtime/reviewer-measurement.mjs` 与一句 spec 措辞):

- 主规格 `#model-phase-measurement` 要求输入和输出各自汇总全部有效配对样本, "不按来源或精度拆成不同指标". 代码的 `aggregateReviewerPhaseGroups` 却按 `source` 建 Map 分组, 而 `responsePhases` 只会产生 `existing-events` 一种来源 (`PhaseSource` 的另外五个取值没有生产者), 分组实际永远只有一组, 是死代码, 且与规格措辞相左. 删除按 `source` 的分组: 汇总结果仍是长度为 0 或 1 的数组 (形状不变, 没有样本时为空数组), 唯一的一组累加 `tokens`, `durationMs`, `measuredRequests`, 合并 `estimated` 与 `basis`. 汇总结果因此不再有 `source` 键: 来源不是汇总的维度, 汇总不另设来源标注 (`PhaseGroup` 类型, `PhaseSource` 类型和 `phase()` 的 `source` 参数随之删除; 这些只在本文件内使用). 响应记录里的 `source` 字段 (生产者 `codex-app-server.mjs`, `claude-sessions.mjs`, `native-measurement.mjs` 类型, `reviewer-session-record.mjs` 校验) 保留不动: 规格把来源列为计量保留的事实, 并要求历史来源值继续可读, 所以只删除分组与汇总上的来源键, 不删除响应记录里的来源.
- 规格措辞: 同一句把汇总写成 "以所有有效配对样本的 `sum(tokens) / (sum(durationMs) / 1000)` 汇总", 但代码的汇总结果是 `tokens` 与 `durationMs` 两个和 (加 `measuredRequests`, `estimated`, `basis`), 没有计算速度. 只改这一处措辞: 把该短语改为 "分别汇总所有有效配对样本的 `tokens` 与 `durationMs` 之和, 速度为 `sum(tokens) / (sum(durationMs) / 1000)`, 由读取方从这两个和得到". 该段其余文字 (包括 "不按来源或精度拆成不同指标" 和 "估算来源和精度只影响 `estimated`, `basis` ...") 不变.

体积估算 (非测试代码净增行数; 按 `AGENTS.md` 的 `Efficiency First` 第 7 条, 测试与文档不计入预算): 约 -30. 删除 13.6 的 `entries` 计算与阶段汇总分组为主, 各修复条目近似持平. 测试按需增删 (13.6 的断言与用例删除或改写, 8.7, C6 表驱动, C3, C4, C5, C7 的用例; 能改既有用例夹具的优先改), 不计入预算. spec 措辞约持平. 非测试代码实际净增大于 0 时按该条停下说明.

不做:

- Gate 2 条目 1.6 (`run` 中 `loadConfig` 与 `parseCommand` 的顺序): 不是缺口, 代码已符合主规格 `arw agent start` 合同 "读取并完整验证全局配置, 解析公开命令" 的固定顺序.
- Gate 2 条目 5.4 (拒绝 JIRA 键 `.` 与 `..`): 极不可能出现的输入, 且需要补 spec 文字, 按 `AGENTS.md` 的 `Efficiency First` 第 5 条不做.
- Gate 2 条目 14.2 (用 `lib/common/json.mjs` 的 `sha256` 替换其他模块中的重复摘要): 节省约 3 行, 且需要补一句 spec 说明该字节摘要导出, 不做. 其他位置的 `createHash` 公共化同样不做.
- 不改 spec 中除 `#model-phase-measurement` 那一句措辞以外的文字 (其余已对齐的 spec 文字在独立提交 `348a153` 里).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-application-jira/spec.md#printing-issue-details`
- `docs/specs/agent-repository-workflow-application-jira/spec.md#association-input`
- `docs/specs/agent-repository-workflow-application-jira/spec.md#blocker-projection`
- `docs/specs/agent-repository-workflow-application-jira/spec.md#submodule-branch-switching`
- `docs/specs/agent-repository-workflow-application-jira/spec.md#interfaces`
- `docs/specs/agent-repository-workflow-development/spec.md#source-checkout-layout`
- `docs/specs/agent-repository-workflow-development/spec.md#layout`
- `docs/specs/agent-repository-workflow-development/spec.md#versioned-json-configuration-conversion`
- `docs/specs/agent-repository-workflow/spec.md#model-phase-measurement`

## Acceptance criteria

- [x] C3: 多用户字段规范化. 观察: `tests/application-jira/jira-client.test.mjs` 增加或修改用例, 附加字段 schema 为 `{type:'array', items:'user'}` 时输出 `[{key, name, displayName}, ...]`, 单用户字段行为不变.
- [x] C4: 其他 Application effort 对同一 Module 的关联不再触发 `association-module-effort-mismatch`, 同一 Application effort 内关联到另一个 Module effort 仍触发. 观察: `tests/application-jira/application-association.test.mjs` 两个断言.
- [x] C5: 成员仓库的 `arw submodule switch-branch <branch>` 与 `arw ssb <branch>` 输出 `No configured Application Modules.` 并返回 `0`, 不调用 Git 适配器; 其他命令的成员门禁文案与退出码 `1` 不变. 观察: `tests/application-jira/cli.test.mjs` 的成员用例.
- [x] C6: 下层返回带不同 `stage` 的失败结果时, `convergeJiraIssue` 的结果 `stage` 仍是本层阶段名, 并带 spec 规定的影响. 观察: `tests/application-jira/jira-convergence.test.mjs` 增加一个表驱动用例, 对 `issue-read`, `comment-read`, `transition-read`, `comment-create`, `transition`, `final-verification` 六个失败点各让对应适配器方法返回带其他 `stage` 的 `failed`, 断言结果 `stage` 为本层阶段, `commentAction` 与 `statusAction` 依次为: `issue-read`, `comment-read`, `transition-read` 为 `none` 与 `none`; `comment-create` 为 `unknown` 与 `none`; `transition` 为已发生的评论动作与 `unknown`; `final-verification` 为已发生的评论动作与状态动作. `grep -n "'stage' in" lib/application-jira/jira-convergence.mjs` 无输出.
- [x] C7: `## Blocked by` 章节之外匹配的 `- External dependency:` 行不被改写, 章节内的仍被改写. 观察: `tests/application-jira/application-association.test.mjs` 断言; 章节定位只有一份实现 (`grep -n "'## Blocked by'" lib/application-jira/application-association.mjs` 只出现一处定位代码).
- [x] 13.6: 成功结果的键集合与顺序为 `status, diagnostics, changed, bytes, unknownPaths`, 失败结果不变. 观察: `tests/common/configuration-conversion.test.mjs` 对升级和当前版本两种成功结果的 `deepEqual` 断言只含这五个键; `grep -n "changes" lib/common/configuration-conversion.mjs` 无输出 (校验函数内读取来源版本的局部变量 `sourceVersion` 与 `targetVersion` 可保留).
- [x] C8: `grep -rn "reviewer-runtime" lib/background-agent` 无输出; `REVIEWER_GIT_COMMANDS` 只在 `lib/arw-common/reviewer-configuration.mjs` 定义; `tests/source-layout.test.mjs` 通过.
- [x] 8.7: 新用例对枚举结果含 `link` 条目断言 `status === 'blocked'`, 诊断含 `filesystem-link-unsupported` 及该条目路径, 无文件写入; 另一个新用例在源树 `.agents/skills` 下创建真实 Unix 域套接字 (Windows 跳过), 断言 `status === 'blocked'`, 诊断含 `filesystem-entry-unsupported` 及该条目路径; `lib/workflow-distribution/workflow-distribution-sync.mjs` 中没有 `kind === 'other'` 分支; `tests/workflow-distribution/workflow-distribution-sync.test.mjs` 通过.
- [x] 阶段汇总: 观察: `aggregateReviewerPhaseGroups` 不再建 Map 或按 `source` 分组, 多个样本累加为一组, 汇总结果无 `source` 键 (`grep -n "source" lib/reviewer-runtime/reviewer-measurement.mjs` 只可能出现于响应数据相关代码, 不再出现 `PhaseSource`); `tests/reviewer-runtime/reviewer-measurement.test.mjs` 把 `group.source` 断言改为 `source` 键不存在, 现有的 `tokens`, `durationMs`, `measuredRequests`, `estimated`, `basis` 断言仍通过; `tests/reviewer-runtime/reviewer-runtime.test.mjs` 中无样本时 `input` 与 `output` 为空数组的断言仍通过; `git diff --stat` 不含 `codex-app-server.mjs`, `native-measurement.mjs`, `reviewer-session-record.mjs`, 且 `claude-sessions.mjs` 的改动只有 C8 的 import 迁移.
- [x] 规格措辞: `docs/specs/agent-repository-workflow/spec.md#model-phase-measurement` 中 `sum(tokens) / (sum(durationMs) / 1000)` 那个短语已按 "规格措辞" 改写, 与 `modelPhaseResult` 返回的两个和一致; `git diff -- docs` 对该文件只有这一处改动, 其余句子不变.
- [x] 验证与体积: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过; 新增或语义修改的测试用例回调耗时低于 100 毫秒 (见 `test-performance-optimization` Skill); 非测试代码净增不大于 0. 观察: `git diff --numstat -- lib` 的合计 (测试与文档不计入).

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 801 个测试, 800 通过, 1 跳过, 0 失败 (跳过项为既有).
- `pnpm typecheck`: 通过.
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`: 通过.
- `node arw.mjs text check`: 703 个文件通过. `git diff --check`: 通过.
- 观察命令: `grep -n "'stage' in" lib/application-jira/jira-convergence.mjs`, `grep -n "changes" lib/common/configuration-conversion.mjs`, `grep -rn "reviewer-runtime" lib/background-agent`, `grep -n "source" lib/reviewer-runtime/reviewer-measurement.mjs` 均无输出; `grep -n "'## Blocked by'" lib/application-jira/application-association.mjs` 出现一处; `git diff --stat` 不含 `codex-app-server.mjs`, `native-measurement.mjs`, `reviewer-session-record.mjs`; `git diff -- docs` 只有 `#model-phase-measurement` 一处一行.
- 响应记录的 `source` 字段 (生产方, 类型, 校验) 保持不变: spec 保留来源且要求历史来源值继续可读; 只删除了汇总分组和 `PhaseGroup.source`. `claude-sessions.mjs` 的改动只有 C8 的 import 迁移.
- Spec Readiness: `arw spec-readiness verify --issue issue:0002:01` 退出 0 (最终复审 No problems.).
- 体积 (`git diff HEAD --numstat -- lib`): +52 / -74, 非测试代码净 -22, 不大于 0 (预算按 `AGENTS.md` 的 `Efficiency First` 第 7 条只计非测试代码). 参考: tests 与 docs 不计入预算.
- 8.7: `other` 不需要分支 (`list` 经 `inspectExistingChain` 已对其返回 `filesystem-entry-unsupported` 阻断); `grep -n "kind === 'other'" lib/workflow-distribution/workflow-distribution-sync.mjs` 无输出.

## Comments

- 提交审核第 55 轮, Code Standards 报告 `readFilesUnder` 的 `link` 诊断字面量与 `lib/workflow-distribution/workflow-distribution.mjs` 的 `validateWorkflowDistributionLayout` 和 `lib/common/filesystem.mjs` 的 `inspectExistingChain` 重复 (第三处). 处置: 接受, 不提取辅助函数 (为一条单行诊断新增代码, 得不偿失); 复审不再重新分流.
- 同一轮报告 `other` 分支不可达 (`list` 已阻断): 已采纳, 删除 `other` 分支与相应测试用例, 见 `## What to build` 的 8.7 条目.
- 提交审核第 56 轮处置 (Main, 2026-10-29): 要求符合审核指出 8.7 的收窄没有用户批准记录. 收窄由 Main 按根 `AGENTS.md` 的自主工作模式决定 (原决定的前提有误: `list` 已经以 `filesystem-entry-unsupported` 拒绝非常规条目, POSIX 上的真实套接字用例覆盖这一点), 用户在状态页事后复核. Code Standards 再次报告的 `link` 诊断字面量重复, 维持上述接受的处置.
