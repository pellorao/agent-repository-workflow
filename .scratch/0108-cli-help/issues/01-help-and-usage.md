# CLI 帮助和用法错误输出

Status: completed

## What to build

实施本轮分流 H1 至 H4 的已确认行为. `arw help`, `arw --help`, `arw -h` 向标准输出写入完整用法并返回 0, 不要求配置或 Git 仓库. 用法先列日常命令, 再列 Agent 内部命令, 两组均有简短标题. 其他用法错误只向标准错误写入一行具体错误和一行运行 `arw help` 的提示, 保留退出码. 更新旧输出断言和规范, 中英文读者文档中的用法说明, 不改变其他行为.

体积预算: 非测试代码净增不超过 20 行; 测试预计净减 10 行; issue 和文档预计净增 2,000 字符, 约 45 行. 完成记录另列代码, 测试, issue/文档的预计和实际改动行数.

预期验证: CLI 定向测试及回调耗时, 完整 Source Checkout 验证, text/terms 检查, Spec Readiness 例外验证和双 Reviewer Commit Audit. 边界包括无配置且位于 Git 仓库外的三个帮助入口, 无参数, 未知命令, 重复选项, 缺失值, 子命令参数错误; 帮助额外参数仍按用法错误处理.

## Acceptance criteria

- [x] 三个准确帮助入口均返回 0, 只输出到标准输出, 两组顺序正确且覆盖原有命令.
- [x] 所有其他用法错误保留退出码和具体错误, 只输出错误行和帮助提示行.
- [x] 更新旧断言及用法输出相关规范和双语文档, 完整验证成功.

## Blocked by

- None - can start immediately

## Validation

- `node tests/arw-entry.test.mjs`, `node tests/arw-common/document-language-cli.test.mjs`, `node tests/document-terms/document-terms-cli.test.mjs`, `node tests/arw-common/agent-cli.test.mjs`, `node tests/arw-common/artifact-cli.test.mjs` 通过. 新帮助回调 0.64 毫秒; 修改的错误回调分别为 3.81, 0.89, 11.08, 10.67, 1.11, 3.94 毫秒, 均低于 100 毫秒.
- `pnpm typecheck` 通过; `pnpm test` 在允许回环监听的环境中通过, 935 项测试, 0 失败. 首次沙箱运行中的本地监听返回 EPERM, 未据此修改产品或放宽测试.
- 三项 Source Checkout 分发/投影/安装生成检查通过; 全部受影响 JavaScript 的 `node --check` 通过.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0108-cli-help/`, `git diff --check` 通过; 文档语言检查符合各自语言. Code Map roots 为 none.
- `node arw.mjs spec-readiness verify --issue issue:0108:01` 通过, 结果为 `not-applicable`.
- 帮助测试验证三个入口在无配置且位于 Git 仓库外成功, 只输出标准输出, 分组顺序一致. 错误矩阵验证具体错误加帮助提示, 退出码保持 2. 现有 Agent 参数透传和 ARW Artifact 过滤测试仍通过.
- 预计净改动: 代码 +20 行以内, 测试 -10 行, issue/文档约 +45 行 (约 +2,000 字符). 实际代码 +20/-10, 净 +10 行; 测试 +34/-47, 净 -13 行. issue/文档为 +70/-6, 净 +64 行 (本记录完成时统计, 不含 JSON 工作流记录).

## Comments

本轮用户和 `.tmp/triage.md` 已确认不需要治理设计, 通过 Exception workflow 使用单 issue effort 和 `not-applicable` 记录. 行为变化及用法说明修订已获明确授权. Main Agent 确认仅修订相关用法输出句子, 不修改其他规则或设计.

旧整块用法常量和 terms 错误中的完整语法断言原来守护错误附带完整帮助的目标; 该目标已由 H2 明确替换. 新断言守护两行错误, 帮助入口测试守护分组帮助输出, 其余既有覆盖保留.

Commit Audit prepare 第 2 轮最终候选实测摘要 (同一次提交, 取代第 1 轮统计):

```text
code: +10 lines (files: 1)
  lib/arw.mjs +10
documents: +243 characters (files: 4)
  README.md +5
  README.zh-CN.md +1
  docs/specs/agent-repository-workflow-application-jira/spec.md +24
  docs/specs/agent-repository-workflow/spec.md +213
tests: -13 lines (files: 5)
  tests/arw-common/agent-cli.test.mjs 0
  tests/arw-common/artifact-cli.test.mjs 0
  tests/arw-common/document-language-cli.test.mjs 0
  tests/arw-entry.test.mjs -13
  tests/document-terms/document-terms-cli.test.mjs 0
next ADR number: 0041
```

文档预算实际净增 3548 字符, 比 2,000 字符预算超出 1548 字符; 行数实际净增 64 行, 比约 45 行超出 19 行. 原因是保存必需的分项验证证据和 Commit Audit 原始体积摘要, 已合并重复验证命令叙述. 代码和测试未超预算.

提交审核第 1 轮: Code Standards 无问题. 要求符合审核发现内部帮助漏列机器入口, 以及参数中的 CR/LF 破坏两行错误输出. Main Agent 核对后均接受, 补列 `background-agent [--wait]`, 在 `UsageError` 生成错误行时转义 CR/LF, 并补充最终输出断言. 此处落实既有完整帮助和单行错误要求, 不改变 subject 或扩大范围.

审核修复后 `node tests/arw-entry.test.mjs` 通过, 帮助/错误回调分别 0.56/0.89 毫秒; `pnpm typecheck` 和完整 `pnpm test` 再次通过 (935 项, 0 失败), 三项分发/投影/安装生成检查与 text/terms 检查再次通过.

提交审核第 2 轮: 要求符合报告为 `No problems.`; Code Standards 仅发现预算记录缺少超出量, Main Agent 核实后在本节补齐准确数值. 抽查确认机器入口在内部命令组, CR/LF 被转义且退出码仍为 2, 原有命令行全部保留, Agent 参数透传测试保持通过. 最终差异仅为 `## Validation` 和 `## Comments` 记录, 按完成记录例外无需复审.
