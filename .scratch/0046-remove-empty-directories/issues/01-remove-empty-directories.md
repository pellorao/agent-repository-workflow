# workflow remove 删除自己删空的目录

Status: completed

## What to build

按 `.scratch/0046-remove-empty-directories/spec.md` 的 Behavior 与长期规范 `docs/specs/agent-repository-workflow/spec.md` 的 Init, update, verify, and remove 节, 在 `lib/repository-workflow/workflow.mjs` 的 `runRemove` 中, `applyOperations` 成功之后 (最终验证之前) 增加目录清理: 收集所有 `delete` 与 `delete-lock` 操作路径的祖先目录 (不含仓库根), 去重后按深度从深到浅, 对每个目录调用已有的 `filesystem.listDirectory`, 无任何条目时调用已有的 `filesystem.removeEmptyDirectory`, 否则保留. 每个目录先 `inspectPath`: 已不存在 (如之前的清理已删除) 时跳过, 不算残留; 不是普通目录 (如符号链接) 时不删除并记为残留; 是目录则 `listDirectory`, 仍含条目时正常保留 (不算残留), 为空则 `removeEmptyDirectory`. 检查, 列举或删除抛出时该目录不删除并记为残留, 其余目录继续处理. 操作仍成功 (`applied: true`), 结果带 `leftoverDirectories` (排序的仓库相对路径, 无残留时省略字段), 不产生失败诊断, 不回滚; 这是长期规范 `remove` 一节所述对写入失败规则的限定例外, 细节见 effort spec 的 Failure boundary 节. CLI (`lib/arw.mjs` 的 `readWorkflowResult` 与 `runWorkflowCommand` 末尾) 读取该字段, 向标准输出在 `workflow remove` 全部现有输出之后写一空行, 一行准确的 `These directories could not be removed and were left in place:` 和每个路径一行 `- <path>`, 退出状态不变, 无残留时输出与现状逐字节相同. 不改变计划, 摘要, 授权, 规范 JSON 和状态摘要; `arw.config.json` 与 `.codex/config.toml` 不在删除计划中, 行为不变.

体积预算: 非测试代码净增约 +22 行.

预期验证: `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check`. 在 `tests/repository-workflow/workflow.test.mjs` 用已有的 mock Git 仓库辅助函数增加测试 (不启动真实进程, 不新增 lib 模块): init 后 remove, 受管文件的整棵空目录树被删除; 受管目录中的用户文件使其目录链保留; 事先存在的空目录保留; `.codex/config.toml`, `arw.config.json` 及其目录保留; 用文件系统替身让一个目录是符号链接 (或删除失败), 结果 `applied` 为真, 该目录未被删除且 `leftoverDirectories` 列出它, 其余目录照常清理; 在 CLI 测试中观察残留时的提示与退出 0, 无残留时输出不变.

## Acceptance criteria

- [x] 非交互与交互 `workflow remove` 成功后, 因删除文件而变空的目录自下而上被删除, 到仓库根为止 (根不删); 有测试覆盖整棵空树被清理, 以及同一目录下删除多个文件时目录只处理一次, 已被删除的父级候选被跳过且不算残留.
- [x] 删除前就已为空的目录, 以及仍含任何条目 (用户文件, 保留的仓库自有文件) 的目录保持不变; 有测试覆盖这两种情形.
- [x] `arw.config.json` 和 `.codex/config.toml` 及其所在目录保持不变; 有测试观察.
- [x] 某个目录是符号链接, 或检查, 列举, 删除失败时, 该目录不被删除, 操作仍 `applied` 为真, 结果 `leftoverDirectories` 列出它, 其余目录照常清理, 仍含条目的目录不算残留; CLI 在全部现有输出之后向标准输出输出准确的提示行和路径列表且退出 0, 无残留时输出逐字节不变; 有模块测试和 CLI 测试观察.
- [x] 上述验证命令通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` (857 通过 / 0 失败), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check`, `git diff --check` 通过; `node arw.mjs spec-readiness verify --subject-only --issue issue:0046:01` 退出 0. `pnpm typecheck` 对本 issue 的文件无错误; 仅报告工作区中他人未提交改动 `scripts/release-guest-check.mjs` 的一处错误 (Expected 2 arguments), 与本 issue 无关.
- `tests/repository-workflow/workflow.test.mjs` 新增 2 个测试 (整棵空树清理, 每个目录只尝试删除一次, 用户文件, 事先存在的空目录, `arw.config.json` 与 `.codex/config.toml` 保留; 底层拒绝 (符号链接代码) 与删除失败的目录进入 `leftoverDirectories` 而 `applied`, `verified` 为真), `cli.test.mjs` 新增 2 个测试 (无残留时输出以 `Workflow remove completed.` 结尾且目录被删, 有残留时提示在标准输出且退出 0). 均为 mock Git 与内存替身, 不启动真实进程, 每个测试不到 100 ms.

## Comments

- 提交审核第 1 轮处置: (1) 与 `removeEmptyManagedDirectories` 重复的祖先收集与删除算法: 已修, 抽成 `lib/common/filesystem.mjs` 的 `removeEmptyParentDirectories`, installation 与 workflow 各自保留策略 (installation 抛出, workflow 记为残留); (2) 冗余的 `inspectPath` 与 `listDirectory` 预检查: 已修, 改用底层非递归 `remove` 的结果 (不存在则成功, 非空视为正常保留, 其余拒绝记为残留), 可观察行为与 subject 描述一致, 上文 What to build 中对 `inspectPath`, `listDirectory` 的措辞只是旧实现步骤, 按 Spec Readiness 的措辞一致性规则只在此记录, 不修改 subject; (3) 净增数字: 已削减并更正, 非测试代码相对基线合计 +55 / -30, 净 +25 (含 installation 被替换旧算法的删除), 超出预算 +22 共 3 行, 原因: 共享 helper 的文档注释与适配器对非目录的拒绝 (见第 2 轮); 剩余超出由提交审核判断; (4) ADR 编号: 审核建议改 0040, 经 Main 裁决保持 0038 (见下条台账); (5) 检查, 列举失败分支无测试: 已修, 预检查删除后该分支不复存在, 底层拒绝与删除失败由新测试观察; (6) 目录只处理一次无观察: 已修, 测试断言每个目录只尝试删除一次; (7) `arw.config.json` 保留无观察: 已修, 测试断言其字节不变; (8) effort spec 称 `readWorkflowResult` 只接受字符串数组与代码不符: 已修, spec 改为元素按字符串规范化.
- 台账: docs/adr/0038 冲突裁决 已提交的 0047 占用 0039 并约定 0038 由 0046 补上, 保持 0038 使历史连续.
- 关于第 (2) 条: 符号链接, 目录联接和越界路径仍由底层 `remove` (`inspectExistingChain`) 拒绝, 不会被删除, 并作为残留报告; 测试以底层拒绝代码 `filesystem-link-unsupported` 的替身覆盖残留报告, 底层拒绝由 `tests/common/filesystem.test.mjs` 的链接测试 (现含 `remove` 断言, 链接目标未被删除) 覆盖.
- 提交审核第 2 轮处置: (1) 净增超预算 已更正数字并削减 (去掉 workflow 里的 try/catch 伪结果转换, 适配器 `removeEmptyDirectory` 改为返回文件系统结果), 剩余超出 3 行见上; (2) 清理不再调用 `inspectPath`/`listDirectory` 与 subject 措辞不符: 记录不修, subject 不改: 非空由底层非递归 `rmdir` 原子判定 (避免列举后再删的竞态), 不存在, 非目录与链接的判定移入适配器 `removeEmptyDirectory`, 可观察行为与验收一致, 属实现步骤措辞; (3) 普通文件作为祖先时会被底层 `remove` 删除: 已修, 适配器先 `inspect`, 非目录或链接一律拒绝并记为残留, 新测试用真实临时目录观察普通文件保留; (4) 安装卸载改为失败后继续: 已修, helper 增加 `stopOnFailure`, 安装侧保持首个失败即抛错且消息不变.
- 台账: .scratch/0046-remove-empty-directories/issues/01-remove-empty-directories.md:7 记录不修 What to build 中 `inspectPath`, `listDirectory` 的旧实现措辞, 理由同上第 (2) 条, 可观察行为不变.
- 台账: lib/repository-workflow/workflow.mjs:2136 记录不修 第 3 轮起只修行为缺陷, 内联不改变行为.
- 台账: lib 记录不修 非测试净增 +25 超预算 22 共 3 行, 原因: 非目录拒绝和 stopOnFailure 为第 2 轮真实缺陷所需, Main 接受.
- 台账: issue What to build 冲突裁决 非空判定交给底层原子 rmdir, 比先 list 再删少一次竞态, 行为与 spec 结果一致; issue 措辞保留以免使就绪记录失效.
- 台账: issue Acceptance criteria 第 4 条 记录不修 实施已无列举步骤; inspect 失败分支只原样返回 ScopedFilesystem 的结果, 由其自身测试覆盖; 第 3 轮起只修行为缺陷.
