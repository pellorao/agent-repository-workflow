---
description: "当需要解决进行中的 git merge/rebase 冲突时使用."
name: resolving-merge-conflicts
---

1. **查看 merge/rebase 的当前状态.** 检查 git 历史和有冲突的文件.

2. **找到每处冲突的一手资料.** 深入理解每项改动为什么这样做, 原本的意图是什么. 阅读提交说明, 查看 PR, 查看原始 issue 或工单.

3. **逐个解决每个 hunk.** 尽可能同时保留双方的意图. 无法兼容时, 选择符合本次合并既定目标的一方, 并记下取舍. **不要** 发明新的行为. 始终完成解决, 绝不 `--abort`.

4. 使用 `validation` Skill 选择并运行项目声明的 **自动化检查**. 修复合并造成的任何破坏.

5. **交接 Git 写入.** 如果你是 subagent, 向 Main Agent 报告已解决的路径, 检查结果和剩余的冲突状态. Main Agent 按 `docs/agents/agent-writes.md` 只暂存已获授权的路径. 继续 merge 或 rebase 可能产生提交, 因此由 Main Agent 在适用的 Git 授权下处理.
