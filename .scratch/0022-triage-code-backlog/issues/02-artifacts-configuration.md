# 制品与配置重复清理

Status: completed

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H7-H9 和 H11. 用户已确认本范围, H6 和 H10 移至 issue:0022:17, 本轮不实施.

- H7: 在 `lib/arw-common/artifacts.mjs` 提取共享符号链接诊断文字常量. 非普通文件和读取失败的文字因制品类型而异, 保留原结果.
- H8-H9: 删除 `issuesRelativePath` 别名, 直接使用 `issuesPath`; 合并 map 与 spec 查询分支, 使用 `inventory.records[kind]`.
- H11: 核对 `lib/arw-common/issue-documents.mjs` 的路径匹配分支. 多路径输入下两个分支的优先级不等价, 保留原实现, 将该发现记录为不适用.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不运行 Spec Readiness, 提交审核照常运行.

体积预算: 非测试源码净增不超过 0 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/arw-common/artifacts.test.mjs tests/arw-common/issue-documents.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 符号链接, 非普通文件, 读取失败, map/spec 缺失, 路径标题和跨 effort issue 路径.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.

## Validation

- H7-H9: `lib/arw-common/artifacts.mjs` 共享四处相同的符号链接诊断文字, 删除路径别名, 合并 map/spec 查询. 原非普通文件和读取失败结果未变. `tests/arw-common/artifacts.test.mjs` 继续覆盖登记, 查询和符号链接诊断.
- H11: 经公开 `migrateIssueDocuments` 核对反例, 删除分支时 `issues/99-decoy.md - Decoy title .scratch/0001-matrix/issues/01-target.md - Target title` 迁移为 issue 99, 原实现迁移为 issue 01. 已恢复与 HEAD 完全相同的源码字节. `tests/arw-common/issue-documents.test.mjs` 中旧路径迁移, 反引号路径, 路径标题及跨 effort 拒绝继续通过.
- 定向命令 `node --test tests/arw-common/artifacts.test.mjs tests/arw-common/issue-documents.test.mjs` 退出码为 0, 两个文件均通过. 未新增或语义修改测试.
- `pnpm test` 通过: 814 个测试, 0 个失败. `pnpm typecheck` 通过.
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 均通过.
- 修改的 `lib/arw-common/artifacts.mjs` 经 `node --check` 通过. `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/`, `git diff --check` 均通过.
- `node arw.mjs language inspect` 检查 issue:0022:02 和 issue:0022:17, 两份文档均以中文为主要语言, 英文为路径, 标识符和固定字段等精确文字.
- 非测试源码新增 12 行, 删除 14 行, 净减少 2 行, 满足净增不超过 0 行预算. H11 因不等价而跳过; H6 和 H10 已按用户决定移至 issue:0022:17.

## Comments

- 2026-11-01: 已核对 H7-H9 和 H11 的源码及调用方, 均未修复. 用户选择拆分: H6 涉及共享导出和模块依赖, H10 为条件表达式改写, 二者另建 issue:0022:17 并走 Spec Readiness. 本 issue 不扩大公开边界.
- 提交审核第 1 轮: Code Standards 报告 `No problems.`; 要求符合 Reviewer 指出 H11 多路径匹配优先级回归. Main Agent 通过公开迁移函数确认反例, 恢复原分支并收窄 H11 为核对后保留. 原始 H11 发现不成立, 不是死代码删除机会.
- H11 恢复后的定向测试, 三项分发检查, 文本和术语检查通过. 完整套件在沙盒中复跑出现 JIRA 本地 HTTP 测试失败; 使用 `node --test --test-isolation=none --test-reporter=spec tests/application-jira/jira-request.test.mjs` 定位为 `listen EPERM: operation not permitted 127.0.0.1`, 属沙盒监听限制. 经提权运行 `pnpm test && pnpm typecheck` 通过: 814 个测试, 0 个失败. 已停止受阻的旧测试进程, 未修改 JIRA 源码或测试.
- 提交审核第 2 轮: 要求符合 Reviewer 和 Code Standards Reviewer 均正常结束, 报告均为 `No problems.`. Main Agent 抽查符号链接诊断文字替换与 map/spec 查询分支的等价性, 并回归核对 H11 源码与 HEAD 完全相同, 原路径解析优先级保留.
