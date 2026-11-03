# 文本策略重复清理

Status: completed

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H13-H15. 用户已确认本范围, H12 和 H16 移至 issue:0022:18, 本轮不实施.

- H13: 在 `lib/arw-common/text-policy.mjs` 提取本地错误抛出函数, 合并四处完全相同的诊断文字与 blocked/failed 错误码构造.
- H14: 在筛选修复目标时保存非空修复字节, 删除循环内不可达的缺失目标和空字节守卫, 保留排序及部分失败结果.
- H15: 核对 `validateText` 的调用方和规范责任. 虽然没有当前调用方, 但开发规范的 Text and language analysis 节要求该验证 Interface, 因此保留原实现, 将发现记录为不适用.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不运行 Spec Readiness, 提交审核照常运行.

体积预算: 非测试源码净增不超过 0 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/common/text-policy.test.mjs tests/arw-common/*.test.mjs tests/commit-audit/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 部分修复失败的已更改和未更改路径, blocked/failed 错误码, 无修复目标, CRLF, CR, LF.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

- None - can start immediately

## Validation

- H13: 四处失败路径共享本地 `fail` 函数, 保留诊断消息以空格连接及 blocked 对应 EINVAL, failed 对应 EIO. 类型检查通过; 没有新增导出或依赖.
- 通过公开 `createNodeTextPolicyFilesystem` 将缺失根目录, 缺失文件, 越界路径和缺失替换目标四种失败的消息及错误码与 HEAD 逐项比较, 结果完全一致.
- H14: 修复目标在筛选时保存非空字节, 通过 entries 遍历保留索引和原有排序. `tests/arw-common/text-policy.test.mjs` 的批量检查与修复, 重复修复无目标, 无效 UTF-8 零写入, 部分 I/O 失败精确恢复边界继续通过.
- H15: 要求符合 Reviewer 发现开发规范的 Text and language analysis 节仍要求验证 Interface. Main Agent 独立核对后恢复 `lib/common/text-policy.mjs` 的 HEAD 准确字节, 原验证导出保持可用. H15 不属于死代码删除机会.
- `node --test tests/common/text-policy.test.mjs tests/arw-common/*.test.mjs tests/commit-audit/*.test.mjs` 通过, 共 21 个测试文件. 未新增或语义修改测试.
- 最终源码的 `pnpm test` 和 `pnpm typecheck` 通过: 814 个测试, 0 个失败. 一次沙盒复跑的 JIRA 本地 HTTP 测试失败, 沙盒外复跑全部通过, 受阻旧进程已停止.
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 均通过. 最终修改的源码文件经 `node --check` 通过.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/`, `git diff --check` 均通过. `node arw.mjs language inspect` 检查本 issue 和 issue:0022:18, 均以中文为主要语言, 英文为路径和标识符等精确文字.
- 非测试源码新增 17 行, 删除 24 行, 净减少 7 行, 满足预算. H12 和 H16 按用户决定移至 issue:0022:18.

## Comments

- 2026-11-01: 用户确认 H13-H15 按行为保持重构例外实施. H12 的共享 Git 文本执行需保留调用方不同的 stdout trim 行为; H16 需新增共享导出与模块依赖. 二者另建 issue:0022:18 并走 Spec Readiness. 用户授权后续同类拆分直接按此方式执行, 无需重复询问.

- 提交审核第 1 轮: Code Standards 报告 `No problems.`; 要求符合 Reviewer 指出 H15 删除了开发规范仍要求的验证 Interface. Main Agent 核对规范与公开导出后恢复原实现, 将 H15 收窄为核对后保留.
- 提交审核第 2 轮: 两个 Reviewer 均正常结束, 报告均为 `No problems.`. Main Agent 抽查四处错误构造与修复循环的排序和部分失败恢复路径, 并确认 `lib/common/text-policy.mjs` 与 HEAD 完全一致, 规范要求的验证导出保留.
