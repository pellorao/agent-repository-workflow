# Reviewer 改用自然语言 txt 格式并修复实测缺陷

Status: ready-for-agent

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

- [ ] 三种 Reviewer 输出为自然语言 txt, 相关规则, Skill, 角色文件和引擎代码一致, 被替代的清单生成与逐条校验代码已删除.
- [ ] 在 Claude Code 中用 `arw background-agent` 实际跑通一次要求符合审核.
- [ ] Claude Reviewer 能读取暂存版本, 且不能执行写操作的 git 命令.
- [ ] `incomplete` 不再触发续派, 有测试覆盖.
- [ ] 全量测试和分发检查通过.

## Blocked by

- 10 Reviewer 能力一致性与 benchmark 改为不自动触发的 Skill
