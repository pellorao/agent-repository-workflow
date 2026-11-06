# 修复 Commit Audit 元数据, 错误累积和固定树排除规则

Status: completed

## What to build

处理分流清单 D 组的 #584, #585, #586. Commit Audit 复用规范 issue 读取逻辑解析 Type 和 Status, 不再维护独立正则语法. 验证时按路径累积 issue 解析和受审树读取错误, 保留已发现的问题. Code Standards 的路径排除依据固定受审树中的 .arwignore 和各级 .gitignore, 不受未暂存编辑影响.

用户已明确授权这些行为修复, 并确认无需治理设计. 不改 lib/background-agent/**, 不扩大公开合同或持久状态. 不改审核规则或交接格式, 只修正既有路径筛选的数据来源.

体积预算: 非测试代码净增不超过 100 行, 预计代码改动 120 行, 测试改动 140 行, issue 文本 45 行; 本轮总改动目标不超过约 1000 行. 预期验证为定向 Commit Audit 测试, 全部 Source Checkout 检查, Spec Readiness 例外核对和双 Reviewer Commit Audit.

边界包括 Status 前后额外空格, Comments 围栏中的 Status, 加粗 Type, prepare 后 issue 改名, 同时存在 HEAD 变化和读取失败, 未暂存的根及嵌套忽略文件编辑, 以及真实暂存的忽略规则变化.

## Acceptance criteria

- [x] 使用规范读取逻辑处理元数据, 空格与围栏不造成误判, 加粗 Type 不绕过实施状态校验.
- [x] issue 解析和受审路径读取失败按路径报告, 且保留之前和之后的独立诊断.
- [x] 相同受审树的审核路径不因未暂存忽略文件编辑变化, 暂存后的规则变化生效.
- [x] 定向回归测试和完整 Source Checkout 验证通过, Spec Readiness 记录为 not-applicable, 双 Reviewer 审核通过后提交.

## Blocked by

- None - can start immediately

## Validation

- `node tests/commit-audit/cli.test.mjs`: 25 个案例通过. 元数据案例覆盖空格和围栏, 拒绝加粗 Type 配合非法实施状态; 改名与解析失败案例保留 HEAD, 路径和报告诊断; 忽略规则案例同时覆盖 Codex 和 Claude Code, 未暂存编辑不改变固定树路径, 暂存后生效.
- `pnpm test`: 912 个测试全部通过. `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 均通过.
- `node --check` 已检查本次五个 JavaScript 文件. `git diff --check` 通过. 工单语言检查符合中文文档约定.
- `node arw.mjs spec-readiness verify --issue issue:0095:01` 通过, 例外结果为 not-applicable.
- 当前实测净增: code: +32 lines; tests: +75 lines; documents: 0 characters. 预计改动行数为代码 120, 测试 140, 工单文本 45; 当前代码改动 160 行, 测试改动 105 行. 工单文本最终 45 行, 就绪记录 13 行, 合计 58 行.
- 新增测试回调实测为 122.59, 85.29, 88.97 和 144.33 毫秒. 超过 100 毫秒的案例包含真实 Git 进程; 按 Source Checkout 例外保留, 不为缩短测试修改生产代码.
- `node arw.mjs text check` 与 `node arw.mjs terms check --include .scratch/0095-commit-audit-correctness/` 通过. 完整套件在沙盒中曾因本机 HTTP 监听被拒绝而失败; 在沙盒外原样复跑 `pnpm test` 后 912 个测试全部通过. 双 Reviewer 第二轮均正常结束, 报告均为 No problems. 审核记录位于当前会话 _commit-audit/2/ 下.

## Comments

Claude 已确认清单中的明确行为修复授权优先于初始行为保持约束. 规范读取逻辑的复用和固定树规则均为缺陷修复, 无新增设计决定. Engine 要求例外 effort 恰好包含一个实施 issue, 因此 D 和 E 分别使用 effort 0095 和 0096, 按同一轮清单串行完成.

首轮 Code Standards 指出重复的 Git 忽略规则调用. 已将既有 runCheckIgnore 和错误构造逻辑移至 lib/common/git-process.mjs, 两处复用, 保留 Commit Audit 既有失败消息. 修正后完整 912 个测试与类型检查通过.

Main Agent 抽查: Gate 1 仍覆盖终态转换, Gate 2 仍从 effort 起点派生且本轮无治理文档差异; 新增忽略规则用例验证两个平台及真实暂存变化. 共享辅助逻辑的移位保留原退出码和错误码处理, Commit Audit 保留既有失败消息. 最终仅补充记录, 不更改 Status 或审核对象.

台账: lib/common/git-process.mjs 新增的 failedGitRead 和 runCheckIgnore 冲突裁决 本 issue 首轮 Code Standards 要求把重复的 Git 忽略调用移入该模块并两处复用, 后一轮审核要求撤回, 按首轮裁决保留.
台账: lib/commit-audit/commit-audit.mjs standardsPaths 临时仓库求值机制 转入后续 issue 抽取为 repository-state-inspector 的共用函数属纯结构调整, 不影响行为.
