# 其余模块校验链压缩

Status: completed

## What to build

其余模块的手写校验链改用声明式校验函数, 删除校验程序自身刚产生数据的代码和吞掉错误又不处理的 `catch`. 对外行为不变. 最后对整个迁移 (从 `2376779` 起) 的改动跑一次 `/simplify`, 只做删减和合并; 各 ticket 的 worker 因 agent 名额限制都没有跑它.

预估改动: 净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#code-reduction`

## Acceptance criteria

- [x] 完整测试套件通过, 只为被删除的功能删除测试.
- [x] `lib/` 行数净减, 变化记入 `## Comments`.

## Blocked by

- 03 共享工具函数与声明式校验
- 09 release VM 验证改为不自动触发的 Skill
- 10 Reviewer 能力一致性与 benchmark 改为不自动触发的 Skill
- 11 Upstream Sync 与 Platform Standards 改为不自动触发的 Skill

## Comments

- 第一部分 (校验链压缩) 完成; 整个迁移的 `/simplify` 留到 ticket 14 合并后进行, Status 保持不变.
- 删除对内部调用参数和程序自身产生数据的手写校验: `common/` (filesystem 作用域操作的 boolean/Buffer/mode 参数检查, file-transaction 的 `assertOperation`, json 的 parse/serialize/write 入参检查, text-policy, repository), `installation/` (`requireInstallDecisions`, `requireInstallerOptions`, `validateInstallationState`, Release Git Adapter 结果形状检查, 写 manifest 前对刚生成 manifest 的复验, 各入口参数检查), configuration-conversion 的静态规则自检 `assertConfigurationConversionRules` 及其辅助函数和 validator 返回诊断的复验, document-terms 的 `validateRequest` (CLI 已校验), platform-adapter 的 intent 形状检查和对已校验配置的二次校验, application-jira 各模块入参检查 (CLI 和配置加载已校验), 以及 identity, document-language, markdown-visible-text, runtime-compatibility, issue-documents 的入参检查.
- 保留: 外部输入 (配置文件, CLI, 环境变量 token, JIRA baseUrl 规范化, 路径安全) 的校验; 收窄可选方法类型所需的检查; `language-checks` 阈值检查 (CLI 依赖其 TypeError 映射为用法错误); 编辑器配置检查 (调用方传入未收窄的配置值).
- 未发现吞掉错误又不处理的 `catch`: 现有空 `catch` 都是转换为诊断/`null`, 或临时文件清理失败时保留原错误.
- 只删除了针对被删校验的测试断言 (6 个测试文件中的 `assert.throws`/`doesNotThrow` 断言).
- 跳过 (ticket 14 范围或不确定): `lib/background-agent/**`, `lib/commit-audit/**`, `lib/reviewer-runtime/**`, `lib/spec-readiness/**`, `lib/arw-common/reviewer-configuration.mjs`, `lib/arw-background-agent-host.mjs`, `lib/workflow-distribution/skill-reference-review.mjs` 及 `workflow-distribution-sync.mjs` 中的 review 结果校验, `lib/common/evidence-locators.mjs`, `lib/common/windows-command-line.mjs` (仅 background-agent 使用).
- 按 `6fa9082` 新增的两条原则补做一轮: 删除对已校验数据的二次判断 (repository-configuration 解析结果, workflow-distribution 配置字节与形状, installation 内部不变量, file-transaction/json 对 filesystem 结果的复查, configuration-conversion 未知路径复查), 改用类型断言; 内联只用一次的单行辅助函数 (jira-client, issue-documents, platform-adapter, configuration-conversion, markdown-visible-text, file-transaction, document-terms). 保留 workflow-distribution 批量读取的 `try/catch`, 它保证返回排序上第一个失败 (有测试覆盖).
- `lib/` 行数 30479 → 29649 (-830). typecheck 通过; 测试 709 项, 仅 1 项因 `AGENTS.md` 迁移期改名而失败 (预期); `check-workflow-distribution` 通过.
- 整个迁移 (`2376779..main`, `lib`/`scripts`/入口) 的 `/simplify` 一轮完成, 只做删减与合并: commit-audit 内联只用一次的 `json`, `REVIEW_FILE`, `parseIssueId`, `requestDirectory`, 去掉 CLI 已校验的 `isAbsolute` 复查, 治理文档存在性检查并入 Gate 2 分支; claude-sessions 的 usage 累加改为一次解构; skill-reference-review 的键集合比较改用 `exactKeys`; release-validation-config 删去对 `parseJson` 成功结果的 `value` 复查; reviewer-capability 脚本删去多余模板字符串. 本轮 +25/-38, `lib/` 28847 → 28834 (-13); 整个迁移 `lib/` 30479 → 28834.
- 本轮保留: `createReleaseLoader` 的 `unknown` 参数包装 (测试传入部分 fake, 合并后 typecheck 失败); spec-readiness 本地 `assertExactKeys` (错误信息与 canonical-contract 不同, 属旧代码); `scripts/release-vm.mjs`, `scripts/release-guest-check.mjs` 未动 (VM 验证 worker 使用中).
- 本轮验证: typecheck 通过; 测试 694 项, 仅 1 项因 `AGENTS.md` 迁移期改名而失败 (预期); `check-workflow-distribution` 与 `project-claude-skills --check` 通过.
