# 为安装和卸载命令提供帮助输出

Status: completed

## What to build

实施分流 L 项: 安装和卸载命令在单独传入 --help 或 -h 时, 向标准输出打印完整用法, 每个可接受选项单独一行, 并返回退出码 0. 帮助不执行安装或卸载, 不读取配置, 不询问和写入持久状态. 与普通 arw 帮助行为一致, 混合其他参数不被当作帮助请求.

其他参数错误保留原错误消息和退出码 2, 追加一行指向 --help 的提示. 卸载参数错误不再打印完整用法, 原有非交互卸载确认说明保留在帮助中. 同步修改中英文开发手册中的安装和卸载入口说明句子. 不改变正常安装和卸载行为, 不运行真实安装, 不修改 lib/background-agent.

预估净增: 非测试代码 35 行, 测试 50 行, issue 和文档文字 45 行. 用户已确认本项不需要新治理设计, 单 effort 单 issue, 使用 Spec Readiness not-applicable 例外. K 的未提交候选已完整保存到 Git stash, 本项从干净基线开始.

## Acceptance criteria

- [x] 两个模块的 CLI 入口均支持单独使用 --help 和 -h, 完整选项逐行出现在标准输出, 返回 0 且无副作用.
- [x] 未知, 重复或不完整参数保留原有错误结果及退出码, 并输出单行帮助提示; 混合帮助参数仍是错误.
- [x] 双语开发手册准确说明帮助输出和参数错误提示.
- [x] 定向测试和完整源码仓库验证通过, 完成记录分列代码, 测试和 issue/文档的预估及实际净增行数.

## Blocked by

- None - can start immediately

## Validation

- `node --test --test-reporter=tap tests/installation/installation.test.mjs tests/installation/uninstallation.test.mjs`: 74 项通过. 帮助入口测试分别耗时 0.41 与 0.39 毫秒, 检查 stdout, 退出码, 逐行选项及帮助路径不访问文件, 不询问和不取得维护控制. 原有参数错误测试继续检查零写入及新增帮助提示, 耗时 1.0 与 14.5 毫秒.
- `node --test --test-reporter=tap tests/runtime-entries.test.mjs`: 4 项通过, 修改的入口回调耗时 39.0 毫秒. `pnpm test`: 944 项全部通过. 仅在隔离测试夹具中验证, 未运行真实安装或卸载.
- `pnpm typecheck`, 5 个受影响 JavaScript 文件的 `node --check`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `git diff --check` 通过.
- `node arw.mjs terms check --include .scratch/0112-installation-help/` 通过. issue 的语言检查符合中文记录要求, 双语开发手册的帮助与错误说明已相互核对.
- 要求符合审核第 3 轮正式返回 ready, 报告精确为 `No problems.`. Main 抽查帮助在安装文件访问及询问前返回, 参数错误保留解析拒绝且未进入正常安装和卸载路径. Code Standards 在新会话第 1 轮返回 ready, 最终报告精确为 `No problems.`. 两轴均无未解决问题. 新会话复核文本, 术语和暂存空白检查通过; 实现未变化, 复用已完成的全套验证.
- 预估/实际净增行数: 代码 35/20, 测试 50/47, issue 和文档文字 45/53; 就绪 JSON 另计 13 行工作流记录.

```text
code: +20 lines (files: 2)
  lib/installation/installation.mjs +12
  lib/installation/uninstallation.mjs +8
documents: +284 characters (files: 2)
  docs/manuals/development.md +196
  docs/manuals/development.zh-CN.md +88
tests: +47 lines (files: 3)
  tests/installation/installation.test.mjs +24
  tests/installation/uninstallation.test.mjs +23
  tests/runtime-entries.test.mjs 0
next ADR number: 0041
```

## Comments

用户明确授权在 K 等待规则裁决时继续独立的待办工作. K 的完整候选保存于 stash 33436534ef5c63e1796fad2824c2aa6364a60a4f, 本项不包含 K 的实现或记录, 不修改治理规则.

交接的 Main 裁决明确: Reviewer 本轮报告写入由角色直接授权, 无需读取 agent-writes.md. 本轮已将该操作指示交给 Code Standards Reviewer. Reviewer 草稿提出抽取帮助条件表达式, Main 按现有接受集合差异和抽象成本请求独立复核, Reviewer 完成后撤回, 最终报告无问题.

要求符合审核复用前会话第 3 轮原报告, 原始位置为 `.tmp/codex/01a1bc7c-e7d9-7441-86a3-da914bb9a7cb/_commit-audit/3/requirements-reviewer/review.txt`. 已核对原受审树 50eb3f2024b202bff9b6be4dc7cadd40ced2e40d 与本轮树 b88c4c39c5d22226e7d824a6315f0cedf37cb0e7 之间仅有本 issue 的 Validation 记录差异, 指令与实现未变. 原报告逐字复制至本轮同轴报告位置, 保留独立结果而不重写判断.
