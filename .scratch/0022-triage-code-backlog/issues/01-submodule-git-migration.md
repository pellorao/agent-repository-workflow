# 子模块 Git 与迁移清理

Status: completed

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H1-H5. 已逐项核对当前源码与调用方.

- H1: 在 lib/application-jira/submodule-git-adapter.mjs 内合并重复失败结果构造, 保留各调用点的 code, message, stage 和 state.
- H2: 依据 lib/common/git-process.mjs 的 code 与 failure 对应关系删除重复失败判断, 保留退出码 0, 1 和其他值的原有语义.
- H3: 将 restore 中可能保存 switch 或 reset 结果的 reset 变量改为 result.
- H4: 为 fetch, compareRemote 和 fastForward 的相同输入声明本地 RemoteInput 类型.
- H5: 删除 lib/artifact-migration/artifact-migration.mjs 私有 createUpdatePlan 的三个默认参数, 补全必填参数类型, 保留 inventoryFilesystem 未提供时的分支.

体积预算: 非测试源码净增不超过 0 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 因此不运行 Spec Readiness, 实施提交仍运行 Commit Audit.

预期验证: `node --test tests/application-jira/submodule-git-integration.test.mjs tests/application-jira/submodule-coordination.test.mjs tests/artifact-migration/cli.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: Git 成功, 非零退出, 进程失败, 超时, 引用缺失, 空 HEAD, 四种提交关系, 切换失败时不执行 reset, reset 失败与迁移文件系统注入和默认路径.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.

## Validation

- H1-H4: `tests/application-jira/submodule-git-adapter.test.mjs` 验证九个失败情境分别遇到非零退出, 进程失败和超时, 比较完整诊断, stage 和 state; 同时验证四种关系与缺失引用, restore 切换失败不会执行 reset. 现有真实 Git 子模块快进测试与协调器测试通过.
- H5: `tests/artifact-migration/cli.test.mjs` 通过, 唯一调用方仍显式传入四个参数, inventoryFilesystem 未提供时仍打开默认文件系统.
- `node --test tests/application-jira/submodule-git-adapter.test.mjs tests/application-jira/submodule-git-integration.test.mjs tests/application-jira/submodule-coordination.test.mjs tests/artifact-migration/cli.test.mjs` 通过.
- `node tests/application-jira/submodule-git-adapter.test.mjs` 单独测量新增回调, 分别为 2.44426 毫秒和 3.68377 毫秒, 均低于 100 毫秒.
- `pnpm test` 在沙盒外通过, 814 个测试, 0 个失败, 总耗时 2954.739304 毫秒. 沙盒内首次运行因本地 HTTP 服务监听触发 EPERM 而中止, 不作为通过证据.
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 全部通过.
- 两个修改源码文件与新增测试文件的 `node --check` 通过; `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/`, `git diff --check` 和 effort 文档语言检查通过.
- 日志目录: `.tmp/codex/01a194af-0c64-7241-a32e-934034df450b/0022_01/validation/`.

## Comments

- 非测试源码新增 28 行, 删除 56 行, 净减少 28 行, 符合净增 0 行预算. 无无关代码删除. 实际共合并八处相同失败结果构造, 沿用同一局部实现, 不改变调用方责任.
- 用户已授权全部分组规划. 同次交付创建本 effort 的其余 15 个规划 issue, 使用 needs-triage, 待各会话核对后才授权实施. H6 因跨文件依赖合并在第二组筛查, 尚未实施或跳过.
- 提交审核第 1 轮: 要求符合 Reviewer 报告 No problems.; Code Standards Reviewer 指出两个规划 issue 的普通英文用词, 已改为中文. 修改不改变实施范围和验收语义, 复用要求符合轴结果, 仅复审 Code Standards 轴.
- Main Agent 回归抽查: referenceExists 对 code 为 null 或其他非 0/1 值仍失败, 0/1 仍分别表示存在或缺失; createUpdatePlan 仍保留 inventoryFilesystem 为 undefined 时的默认文件系统分支, 唯一调用方提供四个参数. 未发现漏检.
- 提交审核第 2 轮: Code Standards Reviewer 确认英文用词已翻译, 仍指出中文词组空格和审核结果复用措辞问题. 以下逐项保留定位; 第 3 轮起按 commit 规则记录不修, 不因措辞再次修改候选.
台账: .scratch/0022-triage-code-backlog/issues/07-common-filesystem.md:11 中的 "临时文件 尽力清理" 记录不修 第 3 轮起只处理行为缺陷; 当前为空格与措辞问题, 不影响清理范围或行为.
台账: .scratch/0022-triage-code-backlog/issues/11-repository-workflow.md:10 中的 "前置元数据 结束定位" 记录不修 第 3 轮起只处理行为缺陷; 当前为空格与措辞问题, 不影响定位语义.
台账: .scratch/0022-triage-code-backlog/issues/11-repository-workflow.md:18 中的 "前置元数据 缺失和闭合" 记录不修 第 3 轮起只处理行为缺陷; 当前为空格与措辞问题, 不影响边界情境.
台账: .scratch/0022-triage-code-backlog/issues/01-submodule-git-migration.md:47 中的 "复用要求符合轴结果" 记录不修 第 3 轮起只处理行为缺陷; 当前为审核记录措辞问题, 要求符合审核的输入与实施语义未变.
- 提交审核第 3 轮: Code Standards Reviewer 正常结束并报告 No problems.; 要求符合审核复用第 1 轮通过结果. `node arw.mjs commit-audit verify` 返回 `errors: []`. 报告位于 `.tmp/codex/01a194af-0c64-7241-a32e-934034df450b/_commit-audit/` 的第 1 轮与第 3 轮目录.
- 最终抽查: 八个失败构造仍保留原有诊断代码, 消息, stage 与 state; 三个 RemoteInput 输入类型内容未变; 未修改命令输出, 公开 Interface 或持久状态. 相比第 3 轮受审版本只补充本章审核记录.
