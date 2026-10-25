---
description: 在设计时构建并细化项目的领域模型. 当用户希望统一领域术语及其含义, 记录架构决策, 或其他技能需要维护领域模型时使用.
name: domain-modeling
---

# 领域建模

在设计过程中主动构建并细化项目的领域模型: 质疑术语, 构造边界情景, 并将用户明确确认的术语和决策记录到适用文档. 此技能用于改变模型; 仅为查阅术语而阅读上下文文件不属于这项工作.

## File structure

大多数仓库只有一个上下文:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

如果根目录存在 `CONTEXT-MAP.md`, 仓库就有多个上下文. 该映射指出每个上下文的位置:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← 系统范围的决策
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← 上下文专属的决策
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

ARW 仓库已经有选定的领域布局: 根目录的 `CONTEXT.md`, 或由其条目指出上下文文件的根目录 `CONTEXT-MAP.md`. 在第一个术语得到确定前, 上下文文件的 `## Language` 章节可以为空. 如果选定的布局缺失, 报告仓库设置缺口, 而不选择布局或创建上下文文件. 在首次需要 ADR 时, 再按需创建 `docs/adr/`.

## During the session

### Challenge against the glossary

当用户使用的术语或其含义与适用上下文文件中已登记的术语及其含义冲突时, 立即指出. "你的术语表把 '取消' 定义为 X, 但你似乎指的是 Y. 两者中是哪一个?"

### Sharpen fuzzy language

当用户使用模糊或一词多义的术语时, 提出精确的规范术语. "你说的是 '账户'. 你指的是客户还是用户? 它们是不同的概念."

### Discuss concrete scenarios

讨论领域关系时, 用具体情景检验它们. 构造探查边界情况的情景, 促使用户精确说明概念之间的边界.

### Cross-reference with code

当用户说明某项工作方式时, 检查代码是否一致. 如果发现矛盾, 指出它: "你的代码会取消整个订单, 但你刚才说可以部分取消. 哪一个是正确的?"

### Update the applicable context file inline

术语得到确定且用户明确确认后, 准备适用上下文文件的相应修改. 不要批量积压. 写入前遵循 [Agent 文件写入](../../../docs/agents/agent-writes.md) 和 [受保护文档审查](../../../docs/agents/rule-and-design-changes.md). 使用 [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md) 中的格式.

上下文文件不得包含实现细节. 不要把它当作规范, 草稿本或保存实现决策的位置. 它只是术语表.

### Offer ADRs sparingly

只有同时满足以下三项时, 才提出创建 ADR:

1. **难以撤销** - 日后改变主意的代价不可忽略.
2. **没有上下文就会令人意外** - 未来读者会问: "他们为什么这样做?"
3. **真实取舍的结果** - 存在真正的替代方案, 并因具体理由选定其中一个.

缺少任意一项时, 不创建 ADR. 使用 [ADR-FORMAT.md](./ADR-FORMAT.md) 中的格式.
