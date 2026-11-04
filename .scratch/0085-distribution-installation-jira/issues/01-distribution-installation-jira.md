# 分发, 安装与 Application JIRA 的已确认积压整理

Status: completed

## What to build

本 issue 是积压清单的 Issue B, 在 issue:0084:01 提交后执行. 只实施经代码复核仍成立的条目, 表中缺陷修复为 Claude 明确授权的缺陷修复, 其他条目保持 CLI 输出, 公开 Interface 和持久状态. 可从 .tmp/ledger.md 筛选并确认同模块的其他条目, 总改动约 1000 行时停止添加.

本 issue 不含设计决定. Claude 于 2026-11-04 明确确认不需要治理设计, 使用 Spec Readiness 的 not-applicable 例外.

体积预算: 非测试代码净减约 50 行; 新增与删除合计预计代码 500 行, 测试 400 行, issue 和文档 100 行, 合计约 1000 行. 筛选后在实施前细化预算.

| 来源 | 文件 | 经复核的交付 | 行为 |
|---|---|---|---|
| `[daily-1103]` 1 | `lib/workflow-distribution/workflow-distribution-sync.mjs` | 添加 Skill 目录身份检查, 无效名称报告 `skill-source-path-invalid`, 补回归覆盖 | 缺陷修复 |
| `[daily-1103]` 5 | `lib/installation/uninstallation.mjs` | 安装路径前缀列表只计算一次 | 保持 |
| `[daily-1103]` 6 | `lib/application-jira/git-upstream-proof.mjs` | 删除已注册 issue 路径解析后的不可达检查 | 保持 |
| `[daily-1103]` 7 | `lib/application-jira/jira-client.mjs` | 重复候选和 issue 响应消息改用常量 | 保持 |
| `[daily-1103]` 8 | `scripts/release-guest-check.mjs` | 使用 `INSTALLATION_DIRECTORY_NAME` 和 `backgroundAgentRuntimeDirectory` | 保持 |
| 缺失对象 | `lib/application-jira/git-upstream-proof.mjs` | 当前代码已区分缺失对象与无效 UTF-8, 复用已有测试 | 已修复 |
| CRLF 和默认值 | `lib/artifact-migration/artifact-migration.mjs` | 当前代码已归一化行尾并移除私有默认值, 复用已有测试 | 已修复 |
| L2 | `lib/application-jira/application-association.mjs`, `lib/arw.mjs` | 删除冗余的 issue 编号空值检查; 各转换承担不同校验与输出责任, 不强行合并 | 保持 |
| f3-10 | `lib/application-jira/application-jira-cli.mjs` | 四处 Git 清单与批量读取共用公共模块中的读取流程, 保留每个调用方的路径及模式过滤和诊断 | 保持 |
| L8 | `lib/common/git-content.mjs`, `lib/arw-common/repository-state-inspector.mjs` | 共用索引条目解析及对象 ID 去重, 调用方分别保留冲突阶段处理 | 保持 |
| 追加筛选 | `lib/installation/bootstrap.mjs` | 删除未指定版本的空字符串哨兵, 使用现有 `undefined` | 保持 |

筛选后预算: 非测试代码净增不超过 30 行, 改动行数预计代码 300 行, 测试 100 行, issue 和记录 120 行, 合计约 520 行. 已修复条目不重复实施, 不为达到约 1000 行而填充无价值改动. 不修改长期规范, Agent 平台标准或 `lib/background-agent/**`.

预期验证: 受影响模块的确定性测试与完整 Source Checkout 验证, 包括 pnpm typecheck, pnpm test, 三个 node scripts/ 检查, 受影响 JavaScript 语法检查, text check, terms check --include .scratch/0085-distribution-installation-jira/ 和 git diff --check.

边界: 无效 Skill 目录身份, 缺失 Git blob 与无效 UTF-8 分开诊断, CRLF 规范, 本地及限定 Canonical ID, 不同调用方的 Git blob 模式过滤保持不变.

## Acceptance criteria

- [x] 每个候选经当前代码复核, 成立条目完成, 不成立和越界条目记录原因.
- [x] 明确授权的三个缺陷修复具有回归覆盖 (已修复项复用现有测试), 其他改动保持可观察行为.
- [x] 完整 Source Checkout 验证和 Commit Audit 通过.
- [x] 完成记录分别列出代码, 测试, issue 和文档的预计与实际改动行数.

## Blocked by

- issue:0084:01

## Validation

- 完整 `pnpm test` 通过, 901/901, 失败 0. 沙箱内运行在本地服务测试失败且未结束, 已停止; 在允许本地服务的环境中原样重跑通过.
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 全部通过.
- 受影响 `.mjs` 的 `node --check` 和 `git diff --check` 通过. `node arw.mjs text check` 通过, 检查 926 个文本; `node arw.mjs terms check --include .scratch/0085-distribution-installation-jira/` 通过. 未配置 Code Map.
- 无效 Skill 名称由生产检查和同步事务测试覆盖, 同步失败保留原分发内容. 两个改动测试以 `node --test --test-isolation=none --test-reporter=spec --test-name-pattern='production check reports|sync blocks before deleting' tests/workflow-distribution/workflow-distribution.test.mjs tests/workflow-distribution/workflow-distribution-sync.test.mjs` 测得 36.2 毫秒和 51.9 毫秒, 均低于 100 毫秒.
- 缺失 spec 或 issue blob 的读取失败和无效 UTF-8 的输入阻断由 `tests/application-jira/git-upstream-proof.test.mjs` 覆盖. LF, CRLF 与 CR 的迁移识别由 `tests/artifact-migration/cli.test.mjs` 覆盖. 这些已有修复的实现与测试不重复修改.
- Git 读取合并保留 issue 路径过滤, 常规文件校验和索引冲突阶段拒绝, `readIndexBaselines` 仍不检查常规文件模式. Repository State Inspector 仍独立报告索引冲突; 现有批量读取, 候选文件模式和 Application CLI 测试随完整套件通过.
- 安装引导源码对应的 `scripts/install-arw.mjs` 已重新生成并通过一致性检查. 卸载路径只复用已计算的字符串, 不改变平台行为. 发布 guest 脚本只替换等值常量和路径函数, 本次未运行发布或真实安装.
- `node arw.mjs language inspect .scratch/0085-distribution-installation-jira/` 已检查, 普通正文统一使用中文, 英文保留命令和标识符.
- 预计改动行数: 代码 300, 测试 100, issue 100, 就绪记录 20, 文档 0, 合计约 520; 原始规划约 1000. 实际代码 206 (新增 114, 删除 92, 净增 22), 测试 3 (新增 2, 删除 1); issue 实际 67 行, 就绪记录实际 13 行 (均为新增), 文档实际 0 行, 合计 289 行. 已修复条目和复用覆盖使实际改动低于原预算, 不填充重复测试.
- Code Standards 第 2 轮为 `No problems.`; 要求符合第 3 轮确认分类统计已满足, 唯一保留项是审核后的计划收尾, 不阻断当前候选. 两位均以 `ready` 正常结束, `node arw.mjs commit-audit verify` 返回 `errors: []`. 据此完成本 issue 的状态和验收项, 终态转换随后单独复核.

## Comments

- 2026-11-04: Main Agent 复核当前 HEAD `0e38cb1`, 按 `.tmp/triage.md` 执行 B. A 已提交, 阻断项已满足, 不读取其他 effort.
- 缺失对象诊断, CRLF 迁移和私有默认值已经修复; `tests/application-jira/git-upstream-proof.test.mjs` 与 `tests/artifact-migration/cli.test.mjs` 已覆盖前两项. L2 的四种转换并非相同实现, 合并将增加参数与合同, 只移除可证明冗余的校验. 根 `arw.mjs` 是转发入口, 实际参数解析位于 `lib/arw.mjs`.
- 追加筛选只接受安装引导版本哨兵清理. 台账中的安装类型别名和引导失败映射已修复; 其他非相同实现合并, 公开诊断变化和治理去重不纳入本次.

- 第 1 轮 Code Standards 两项已核实并修复: `readListedBlobs` 迁入 `lib/common/git-content.mjs`, Git 上游证明复用 `uniqueObjectIds`. 业务路径过滤和诊断继续由原调用方承担. issue 的模块位置描述同步修正, 不改变交付行为或授权范围.
- 第 1 轮要求符合审核指出完成状态与待完成的审核验收项不一致, 实际记录统计也尚未完整. 已恢复 `ready-for-agent`, 审核通过后再完成状态转换; 实际统计已补齐, 后续记录变化在最终暂存前重新计算.
- 第 2 轮预计行数遗漏已修正: 文档预计 0 行, issue 预计 100 行, 就绪记录预计 20 行; 原合计 120 行的预算不变.
- 提交审核实测: `code: +22 lines (files: 12)`, `documents: 0 characters (files: 0)`, `tests: +1 lines (files: 2)`, `next ADR number: 0041`. 预算未超出, 没有无关冗余删除.
- 要求符合第 4 轮以 `ready` 结束, 报告为 `No problems.`; Code Standards 第 2 轮通过结果继续有效. Main Agent 抽查索引基线的模式处理和上游缺失 blob 诊断, 既有行为保留.

并入主仓库: 本 issue 并入 main 时 effort 由 0084 改为 0085, 阻断项由 issue:0083:01 改为 issue:0084:01, 代码差异不变. 因受审版本的 HEAD 与暂存树已变, 重新运行了 Commit Audit.

第 1 轮 (主仓库) 两个 Reviewer 均返回 ready. Code Standards 指出同一无效 Skill 目录下每个文件都生成一条相同的 `skill-source-path-invalid` 诊断, 绕过了 `skillNames` 的按身份去重, 核实为行为回归并已修复: 无效名称收集到 `invalidNames` 集合后每个身份只报告一次, 诊断构造抽为 `invalidPath`, 并在同步测试中为同一无效 Skill 写入两个文件且断言只有一条诊断. 要求符合审核指出的诊断码与长期规范冲突按台账记录:

- 台账: docs/specs/agent-repository-workflow-development/spec.md:87 记录不修 本 issue 的 What to build 明确要求无效身份目录报告 `skill-source-path-invalid`, 本 issue 不修改长期规范; 规范句 "未登记的 Skill 得到 `skill-unregistered`" 对身份无效的目录不再成立, 留待后续规范变更补充 (第 2 轮要求符合审核再次指出, 重新判断结果不变; Main Agent 可裁决是否另开 issue)

第 2 轮 Code Standards 指出同步测试按用例显示名分支断言, 以及上一段并入说明含只在本机成立的目录名, 均已修正 (计数断言改为对所有用例统一, 并入说明只保留仓库内可核对的事实); 要求符合审核重复指出规范诊断码问题, 台账结论不变. 第 3 轮两个 Reviewer 均返回 `No problems.`. 主仓库最终准备输出: `code: +26 lines (files: 12)`, `documents: 0 characters (files: 0)`, `tests: +2 lines (files: 2)`; 与第 1 轮相比代码多 4 行, 来自无效名称按身份去重.
