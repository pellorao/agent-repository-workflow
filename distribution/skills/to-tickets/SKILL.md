---
description: 将计划, 规范或当前对话拆分为一组纵向切片 issue, 每项声明阻断关系并写入当前 effort 的 issues 目录.
name: to-tickets
disable-model-invocation: true
---

# 任务拆分

将计划, 规范或当前对话拆分为一组纵向切片 issue, 每项声明阻断它的其他 issue. 编写前遵循 [Subagent 分配](../../../docs/agents/subagent-allocation.md) 与 [Agent 文件写入](../../../docs/agents/agent-writes.md).

## Process

### 1. Gather context

使用已在对话中的信息. 用户传入 spec 或 issue 路径时, 读取其完整正文.

### 2. Explore the codebase

尚未探索代码库时, 调查当前代码状态. issue 标题和正文使用项目术语表词汇, 并遵循所涉区域的 ADR. 先安排使实现更容易的预先重构, 再安排其余切片.

### 3. Draft vertical slices

- 每个切片覆盖数据模式, API, UI 和测试等各层的一条狭窄且完整的路径, 而不是只覆盖单层.
- 已完成切片可以独立演示或验证, 并适合在一个新的上下文窗口内完成.
- 粒度宁粗勿细. 每个实施 issue 都有自己的 Spec Readiness 与提交审核开销 (只改规则和文档的 issue 除外, 见 `implement` Skill), 太小的 issue 让审核开销超过改动本身. 合并规则见 [Agent 文件写入](../../../docs/agents/agent-writes.md#issue-concurrency); 只在超出一个上下文窗口, 或确需独立验证与独立回退时才拆开.

为每个 issue 给出其阻断关系, 即必须先完成的其他 issue. 没有阻断项的 issue 可以立即开始.

大范围重构是纵向切片的例外. 一次机械改动, 如重命名列或改变共享标识符的类型, 可能同时破坏遍布代码库的大量调用点, 使任何单个纵向切片都无法通过测试. 此时按以下顺序安排:

1. 扩展: 加入新形式并保留旧形式, 保证现有调用不受影响.
2. 迁移: 按影响范围分批迁移调用点, 例如按包或目录分批. 每批一个 issue, 依赖扩展步骤, 利用仍保留的旧形式使每批都能通过 `validation` Skill 要求的验证.
3. 收缩: 用一个依赖全部迁移批次的 issue, 在没有调用方使用旧形式后删除它.

如果某批迁移无法单独通过验证, 把它与相邻批次合并为一个 issue, 而不是推迟到最后一起验证.

### 4. Confirm with the user

以编号列表展示拟议拆分. 每个 issue 说明:

- **Title**: 简短描述标题.
- **Blocked by**: 必须先完成的 issue.
- **What it delivers**: 从用户视角交付的端到端行为.

询问用户粒度是否合适, 每条阻断关系是否确实阻断该 issue, 是否应合并或拆分. 迭代直到用户批准拆分.

### 5. Write the issues

issue 写入对话已建立的 effort; 需要新 effort 时按 `issue-tracking` Skill 创建. 每项一个文件, 路径, 编号和结构遵循 `issue-tracking` Skill, 按依赖顺序编号. 正文使用中文, H1 为中文标题, 下列 H2 保持英文, 内容避免 [to-spec](../to-spec/SKILL.md) 所禁止的文件路径和代码片段.

```markdown
# <issue 标题>

Status: ready-for-agent

## What to build

从用户视角说明此 issue 实现的端到端行为, 不按实现层次罗列.

## Acceptance criteria

- [ ] 标准 1
- [ ] 标准 2

## Blocked by

- <编号> - <标题>
```

没有阻断项时 `## Blocked by` 准确写 `- None - can start immediately`.
