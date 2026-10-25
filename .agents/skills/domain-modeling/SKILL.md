---
description: 探索不熟悉的领域, 命名持久领域概念, 决定架构边界或编写长期规范前读取领域文档; 在设计中统一领域术语及其含义, 记录架构决策, 或其他技能需要维护领域模型时使用.
name: domain-modeling
---

# 领域建模

在设计过程中主动构建并细化项目的领域模型: 质疑术语, 构造边界情景, 并将用户明确确认的术语和决策记录到适用文档.

## Read domain documents

探索不熟悉的领域, 命名持久领域概念或决定架构边界前, 读取已有的持久领域文档: 根目录存在 `CONTEXT-MAP.md` 时从它开始, 沿每个适用的 `CONTEXT-MAP.md` 读取它为当前区域标识的每个 `CONTEXT.md`; 没有适用的映射覆盖当前区域时, 直接读取每个适用的根目录或领域内部 `CONTEXT.md`. 相应文档存在时, 还读取 `docs/adr/` 下的适用决定和 `docs/specs/<domain>/spec.md` 中的适用长期规范.

`CONTEXT.md`, `CONTEXT-MAP.md`, `docs/specs/**` 和 `docs/adr/**` 是领域文档, 按 `docs/agents/writing.md` 的语言规则编写, 不按当前读者或作者身份分类. 复用已建立的词汇. 在负责持久决定的文档中记录该决定并明确显示冲突, 不默默覆盖. 只在有需要保存的持久决定或长期行为时创建 ADR 或 `docs/specs/<domain>/spec.md`; 缺少它们不形成就绪缺口, 空占位符也不履行任何责任.

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

术语得到确定且用户明确确认后, 准备适用上下文文件的相应修改. 不要批量积压. 写入前遵循 [Agent 文件写入](../../../docs/agents/agent-writes.md) 和 `rule-and-design-changes` Skill. 使用 [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md) 中的格式.

上下文文件不得包含实现细节. 不要把它当作规范, 草稿本或保存实现决策的位置. 它只是术语表.

### Offer ADRs sparingly

只有同时满足以下三项时, 才提出创建 ADR:

1. **难以撤销** - 日后改变主意的代价不可忽略.
2. **没有上下文就会令人意外** - 未来读者会问: "他们为什么这样做?"
3. **真实取舍的结果** - 存在真正的替代方案, 并因具体理由选定其中一个.

缺少任意一项时, 不创建 ADR. 使用 [ADR-FORMAT.md](./ADR-FORMAT.md) 中的格式.

## Long-term specification boundary

长期规范必须能够独立阅读, 并保存持久的产品行为. 它记录实现, 调用方, 测试和 Reviewer 必须保留的内容:

- 产品边界和公开行为.
- 安全限制.
- 持久状态和状态转换.
- 必要顺序和失败语义.
- 跨文档责任关系.

不得在长期规范中放入实现文件导航, 辅助函数, 完整的依赖注入对象, 测试文件, 测试夹具细节, 穷尽式测试清单和载荷文件枚举.

把导航放入 README 或开发者指南, 把实现细节放入代码和测试, 把专门操作放入适用的 Agent 指引, 并把载荷身份放入其规范清单. 如果精确身份是稳定公开合同或安全合同的一部分, 规范仍可指明文件, 命令, 字段或结果.

如果产品提供命令行接口, 在适用的公开行为章节中定义一次其精确命令行合同, 不得在命令附录中复制它.

## Glossary removal

删除术语表条目时, 检查适用的 `CONTEXT-MAP.md`, 当前和历史 issue, 研究资料, ADR, 规范和审计证据, 找出仍把术语表当作决定权威的引用. 在实际负责仍然有效的决定的文档中保存该决定, 并在术语仍有用时在该文档中解释它.
