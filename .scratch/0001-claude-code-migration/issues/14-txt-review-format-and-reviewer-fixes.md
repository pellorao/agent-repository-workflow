# Reviewer 改用自然语言 txt 格式并修复实测缺陷

Status: completed

## What to build

按 10 的实测结论, 要求符合审核, Gate 2 和 Spec Readiness 的 Reviewer 输出改为最轻一档: Reviewer 只把找到的问题用自然语言逐条写进一个 txt 文件, 没有问题时写明无问题. 提交门禁改为 "Reviewer 正常结束且问题都已处理", 程序不再生成逐条要求清单和逐条记录; Main Agent 每轮抽查一两处 Reviewer 声称已检查的内容. 同时修复 10 实测中发现的三个缺陷:

1. `prepare` 预写清单与 "新审核报告必须为空" 冲突, 导致提交流程启动不了 requirements-reviewer (改用 txt 后清单不再预写, 确认问题消失).
2. Claude 后端 Reviewer 没有 Bash, 读不到 Git 索引, 工作区与索引不一致时会审错版本: 只放行读取 Git 对象所需的只读 git 命令.
3. Reviewer 返回 `incomplete` 后运行时无限续派: `incomplete` 结束本轮并交回 Main Agent.

预估改动: 净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#review-workflow`

## Acceptance criteria

- [x] 三种 Reviewer 输出为自然语言 txt, 相关规则, Skill, 角色文件和引擎代码一致, 被替代的清单生成与逐条校验代码已删除.
- [x] 在 Claude Code 中用 `arw background-agent` 实际跑通一次要求符合审核.
- [x] Claude Reviewer 能读取暂存版本, 且不能执行写操作的 git 命令.
- [x] `incomplete` 不再触发续派, 有测试覆盖.
- [x] 全量测试和分发检查通过.

## Blocked by

- 10 Reviewer 能力一致性与 benchmark 改为不自动触发的 Skill

## Comments

- 改动: 45 个文件, +301 / -1844, 净减 1543 行 (含本 ticket 记录). 删除 `commit-audit generate`, 逐条清单与 Gate 1/Gate 2 记录, `lib/common/evidence-locators.mjs` 及其测试; Spec Readiness 草稿改为 txt, 记录升为模式版本 7, 不含 checks, `No problems.` 记为 `satisfied`, 其他非空报告记为 `gap`.
- 缺陷 1: `prepare` 只写 `request.json` 和空的 `reports/review.txt`, 实跑中 Reviewer 正常启动.
- 缺陷 2: Claude 后端放行 `Bash(git show|diff|log|ls-files|cat-file:*)`, 禁止 `Bash(git *--output*)`. 直接用 haiku 验证: `git show :a.txt` 可用, `git diff --cached --output=...`, `git add`, 重定向写文件均被拒绝, 索引不变.
- 缺陷 3: 最终状态为 `incomplete` 时运行层不再续派, `tests/background-agent/host.test.mjs` 新增测试 (修复前失败, 修复后通过). 原 `reviewer-runtime` 混合报告目录测试的 "交付时拒绝" 改用 `ready` 交付验证.
- 实跑: Claude Code 中经源码 `arw background-agent` (Claude 后端, haiku high) 对 `rate-limiter` 场景跑一次 requirements review, 约 70 秒返回 `ready`, 报告 9 条, 命中预期 6/6, 无 Clean 项误报; 另有一条 `clientIdOf` 超范围选项和若干测试覆盖细分. Reviewer 用 `git show :<path>` 读取暂存字节.
- 遗留: 源码管理进程使用用户级状态目录 `~/.agent-repository-workflow/background-agent-state` (按设计为用户级单例), 实跑在其中的 `messages.sqlite` 留下记录. 历史 ADR 0023 等未改写. `reviewer-launch` Skill 第 13 行 "Claude Code 只支持 Codex" 的说法未在本 ticket 范围内修改.
