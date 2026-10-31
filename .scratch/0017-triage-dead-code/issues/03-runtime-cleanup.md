# 命令及运行时冗余清理

Status: completed

## What to build

本 issue 属于同一 effort 的三组死代码和重复删除任务. 处理 triage 的 Issue C (#121, #127, #199, #261, #75): 删除 workflow init/remove 不可达 dry-run 分支, 复用 escapeText, 删除重复 inventory 空值检查和测量中的无效赋值, 在语言检查的既有非法来源分支识别 invalid-utf8 并删除重复异常诊断路径.

预计非测试代码净减少约 20 行, 净增预算为 0 行. 仅修改清单列出的实现及必要测试. 行为保持不变; 发现会改变 CLI 输出, 公开接口或持久状态的条目时跳过并记录. 不修改 lib/background-agent/**, 不安装, 不推送, 不访问克隆之外的工程或安装文件.

预期验证: 定向测试 tests/arw-common/document-language-inspection.test.mjs, 新增或语义修改测试的回调不超过 100 毫秒, 完整 Source Checkout 验证 (pnpm test, pnpm typecheck, 三个分发生产检查脚本, 受影响文件 node --check, text check, terms check, git diff --check), Spec Readiness 和 Commit Audit.

相关边界: 覆盖 workflow init 和 remove 带 --dry-run 时退出码为 2 且诊断含 inapplicable option; 保留诊断转义, 非法 UTF-8 拒绝, 库存成员验证及已结束测量结果.

## Acceptance criteria

- [x] 通过 git diff 核对清单范围内的安全删除, 在 Validation 记录跳过项及理由, 行为和既有合同保持不变.
- [x] 运行 What to build 中指定的边界测试和完整 Source Checkout 验证并记录通过结果, 测量新增或语义修改回调的耗时.

## Blocked by

无.

## Validation

全部五项安全清理已完成, 本组无跳过项. 非测试代码净减少 13 行. 自查仅做删减与合并, 无额外范围. 抽查确认 allowlist 仍先于 CLI 执行拒绝 dry-run, 非法 UTF-8 仍返回相同诊断, escapeText 的四项转义与原实现一致.

完整 Source Checkout 验证通过: pnpm test (沙盒外, 806/806), pnpm typecheck, node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, 受影响五个文件 node --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0017-triage-dead-code/, git diff --check. 初次沙盒内完整测试因 loopback listen EPERM 失败, 沙盒外完整重跑通过.

定向运行 node tests/repository-workflow/cli.test.mjs (10/10), 新增 dry-run 参数案例回调 1.283 毫秒; node tests/arw-common/document-language-inspection.test.mjs (4/4), node tests/document-terms/document-terms-repository.test.mjs (9/9), node tests/reviewer-runtime/reviewer-measurement.test.mjs (3/3), 全部通过.

Commit Audit 第 1 轮的 Code Standards 和要求符合审核均为 No problems. Main Agent 回归抽查确认诊断转义保持四项相同规则, 非法 UTF-8 仍在产生表格前拒绝并返回相同 code, message 和 path. 本 effort 没有规范改动, Gate 2 无规范差异.
