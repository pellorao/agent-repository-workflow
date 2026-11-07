# 为代码式诊断补充可操作说明

Status: completed

## What to build

按本轮已确认的 I 范围, 为 `invalid-managed-region` 补充说明: 受管理区域必须位于文件开头, 后接唯一的仓库自有区域, 后者必须在文件末尾结束, 结束标记之后的文字应移入区域内. 验证初始化后向 `AGENTS.md` 追加一行时, `workflow verify`, `workflow update` 和 `workflow remove` 显示该说明.

为 `lib/document-terms/document-terms.mjs` 中 `global-terms-section-invalid`, `source-read-failed`, `unsupported-source-entry`, `unsupported-source-type` 和 `lib/arw-common/text-policy.mjs` 中 `unsupported-text-entry` 补充一句说明, 并在命令输出中显示. 只改变消息文本, 保留诊断代码, 退出状态和其他行为. 不改动 `lib/background-agent/**` 或 Agent 规则.

复用现有测试边界, 为损坏区域增加命令层回归测试, 对其他目标路径断言消息. 执行定向测试及完整 Source Checkout 验证. 预计净增代码至多 30 行, 测试至多 100 行, issue 文本约 45 行 (约 1800 字符).

## Acceptance criteria

- [x] 初始化后在 `AGENTS.md` 的仓库自有区域结束标记后追加一行, 三个工作流命令均输出布局要求及移动文字的说明, 并保持失败退出状态.
- [x] 五种其他指定诊断有一句可读说明, 对应测试验证消息, 命令格式显示消息.
- [x] 诊断代码和其他行为不变, 必要验证通过, 记录预计及实际代码, 测试和文档变化量.

## Blocked by

- None - can start immediately

## Validation

- `tests/repository-workflow/cli.test.mjs` 的新增用例验证初始化后追加文字, 三个命令均返回 `1`, 显示布局说明且保留文件字节.
- `tests/document-terms/document-terms.test.mjs` 验证四种目标诊断及其序列化消息; `tests/arw-common/text-cli.test.mjs` 验证目标诊断消息, 两个操作均返回 `1`, 不读取或写入条目.
- 三个定向文件共 37 项通过. 修改的回调耗时为 0.87, 12.12, 26.35 和 73.70 毫秒. 修复共享文案后 `pnpm test` 全部 938 项通过, 日志在本轮临时工作区 `0108_01/validation/full-tests-final.log`.
- `pnpm typecheck`, 三项分发与生成检查, 七个 ESM 文件的 `node --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0109-diagnostic-messages/`, `git diff --check` 均通过. `language inspect` 确认中文文档.

## Comments

用户确认 I 不需要治理设计, 单 effort 单 issue 使用就绪例外, 确认时间为 2026-11-07T18:44:21Z, 早于实现修改. 完整测试首次遇到沙箱回环监听 `EPERM`, 提权原样重跑通过.

首轮审核后统一公共条目说明, 补齐实际文档量. 第二轮要求符合报告为 `No problems.`; 按 Code Standards 第二轮报告压缩重复记录. 以下复制最终引擎总量:

```text
code: +10 lines (files: 4)
documents: 0 characters (files: 0)
tests: +61 lines (files: 3)
```

预计代码至多 30 行, 测试至多 100 行, issue 约 45 行及 1800 字符. 实际代码和测试见上; issue 净增 44 行, 2129 字符, 就绪 JSON 另计 13 行及 419 字符, 长期文档为 0. 文本已压缩, 仍超预算的部分用于必要验收证据和审核处置.

台账: `.scratch/0109-diagnostic-messages/issues/01-explain-diagnostics.md:27,32,34,42` 记录不修 第三轮报告仅要求压缩重复记录; 按实施提交流程第三轮起的文档去重处置规则保留必要证据及本台账, 不再开启修复轮.
