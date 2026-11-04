---
description: 用户要求 Git 提交后使用: 对已暂存候选分类, 执行实施 issue 提交 (要求符合审核与 Code Standards 两个并行 Reviewer, Gate 1 和 Gate 2 范围) 或非实施机械提交, 并编写提交说明. 完成或解决 issue 本身不触发.
name: commit
---

# 提交

只有用户要求 Git 提交后才使用. 完成或解决 issue 本身不启动审核, 暂存或提交验证.

## Select the workflow

- 每个提交只包含一个 effort, Main Agent 只暂存该 effort 的内容. 共享文件中的改动按实际语义归属判断, 不按路径猜测.
- 检查精确的已暂存路径集合. 每一项都符合 `./non-implementation-workflow.md` 的条件时使用非实施工作流, 并读取该文件; 任何一项属于当前仓库的实施工作时, 对完整候选使用实施工作流, 并读取 `./implementation-workflow.md` (含 Commit Audit); 某项无法分类时先停止并解决归属, 不推断它是实施工作.
- 只改 Agent 规则与文档 (`AGENTS.md`, `docs/**`, Skill 及其 `.claude/skills` 投影中的 Markdown, 以及仓库根目录的 `README.md`, `CONTEXT.md`, `CLAUDE.md`) 的候选属于非实施分类, 不要求 effort. 代码仍是实施工作.
- 同一实施授权覆盖完整候选时, 符合条件的非实施内容可以与实施工作保留在一起, 不因一项原子变更同时更新规划记录或仓库状态而拆分它. 授权范围外的内容先取得自己的授权, 才能加入候选.

## Commit messages

遵循 Conventional Commits 1.0.0, 标题使用 `<type>[optional scope][!]: <description>`. 用户可见功能使用 `feat`, 缺陷使用 `fix`; 常用辅助类型是 `docs`, `test`, `refactor`, `style`, `build`, `ci`, `perf` 和 `chore`. 破坏性变更在冒号前加 `!`, 或使用 `BREAKING CHANGE: <description>` 尾注. 描述简短并使用祈使语气; 只有理由, 迁移说明或取舍不明显时才写正文.

## Failure

任何关卡失败, 必要 Input 不可用, Reviewer 报告的问题未处理, 或 Reviewer 返回 `incomplete` 时, 在提交前停止.
