# 保留 Claude 回合失败原因

Status: completed

## What to build

按本轮分流记录的 K 项, 在 Claude 回合失败时把 result.result 错误文本, 或缺失文本时的退出代码或信号, 保存在现有 turnError 中, 并传到 Reviewer 完成原因, 保留固定前缀 `The native Reviewer turn failed.`. 不改变成功, 中断和后续回合的行为.

在 README 的 Claude 后端说明中同步添加中英文各一句, 说明回合继承启动管理进程的客户端环境, 因而 ANTHROPIC_API_KEY, CLAUDE_CONFIG_DIR 和登录状态来自该客户端, 并受角色 env 覆盖.

预估净增: 非测试代码 20 行, 测试 60 行, issue 和文档文字 45 行. 不新增规范或设计决定, 使用用户已确认的 Spec Readiness not-applicable 例外. 仅修改 claude-sessions.mjs 及其测试, reviewer-runtime 及其测试, 双语 README 和本 effort 记录.

## Acceptance criteria

- [x] 失败回合的 result.result 文本进入 Reviewer 完成原因, 固定前缀保留.
- [x] 没有错误文本时报告非零退出代码或终止信号; 后续回合不沿用旧错误.
- [x] 双语 README 准确说明 Claude 回合环境来自启动管理进程的客户端.
- [x] 定向测试覆盖错误文本和仅有非零退出代码, 且完整源码仓库验证通过; 完成记录列出预估及实际代码, 测试和 issue/文档净增行数.

## Blocked by

- None - can start immediately

## Validation

- Claude 原生回合测试覆盖 result.result 文本, 非零退出代码, SIGTERM, 无成功结果的零退出代码和下一轮清除旧错误; 回调耗时分别为 47.2, 44.9, 43.9, 44.0 毫秒. Reviewer 运行时测试验证原因进入 incomplete 完成结果及固定前缀, 并覆盖缺失原因时的原有输出, 耗时 3.6 毫秒.
- `node --test --test-reporter=tap tests/background-agent/claude-sessions.test.mjs tests/reviewer-runtime/reviewer-runtime.test.mjs`: 47 项通过. `pnpm test`: 946 项全部通过. 沙箱内出现进程输出异常及本地服务测试失败, 沙箱外原样完整重跑通过.
- `pnpm typecheck`, 5 个受影响 JavaScript 文件的 `node --check`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 通过.
- `node arw.mjs terms check --include .scratch/0111-claude-failure-reason/` , `node arw.mjs text check` 与 `git diff --check` 通过. issue 的语言检查符合中文记录要求. 双语 README 已核对环境继承和角色 env 覆盖与实际实现一致.
- 预估/实际净增行数: 代码 20/6, 测试 60/29, issue 和文档文字 45/60; 就绪 JSON 另计 13 行工作流记录.

```text
code: +6 lines (files: 2)
  lib/background-agent/claude-sessions.mjs +5
  lib/reviewer-runtime/reviewer-runtime.mjs +1
documents: +371 characters (files: 2)
  README.md +253
  README.zh-CN.md +118
tests: +29 lines (files: 3)
  tests/background-agent/claude-sessions.test.mjs +9
  tests/fixtures/fake-claude.mjs +4
  tests/reviewer-runtime/reviewer-runtime.test.mjs +16
next ADR number: 0041
```

## Comments

用户在本轮明确授权 K 项, 含 lib/background-agent/claude-sessions.mjs, lib/reviewer-runtime 和环境说明句子, 并确认无需治理设计. 本 effort 不包含规范, 不读取其他 effort 的内容.

审核进展: 第 2 轮 Code Standards 返回 incomplete, 原因为根 AGENTS.md 的报告写入前读取 docs/agents/agent-writes.md 义务与角色规则禁止读取 AGENTS.md 引用文档冲突, 等待用户裁决. 要求符合审核正式返回 ready, 报告指出无成功结果的零退出代码诊断不准确; Main 已独立核对并修正为明确诊断, 增加回归测试, 尚待下一轮正式审核.

本轮恢复: 按分流记录中的 Main 裁决, Reviewer 写入自己的 reportPath 已由角色规则授权, 不触发读取 docs/agents/agent-writes.md 的要求, 无需额外读取例外. 上轮诊断修复影响实现, 本轮重新运行两个审核轴.

恢复后的当前候选验证: `pnpm test` 949 项全部通过; `pnpm typecheck`, 三项源码检查, 五个 JavaScript 文件语法检查, text, terms 和暂存空白检查全部通过. 非测试代码及测试净增为 6 和 29 行. 最终 Commit Audit 错误列表为空, subject-only 就绪核对通过; 相对受审树只有 Comments 记录变化.

第 1 轮要求符合审核发现成功结果文本可能遮盖异常退出原因, Main 独立确认并修复: 仅 is_error 结果提供错误文本. 新增 fail-success-result 回归案例耗时 46.4 毫秒, 48 项定向测试通过. Code Standards 本轮正常完成且报告 No problems.; 修复后两个轴复审. 第 2 轮 Standards 指出错误标记需精确为 true, Main 已核对并修复, 全套 949 项再次通过; 要求符合审核指出记录中的旧测试数字 28, 已统一为 29. 第 3 轮两个审核轴均 ready 且报告 No problems., 报告目录为 `.tmp/codex/01a1bcbd-b161-71d3-aff0-158232b45e02/_commit-audit/3/`. Main 抽查精确错误标记, 非零退出和下一轮清除错误路径, 固定前缀及原有中断分支均保持正确. 文档记录净增超出预估 15 行, 原因为实际验证证据与跨会话审核处置记录.
