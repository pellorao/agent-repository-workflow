# CONTEXT.md 格式

## Structure

```md
# {上下文名称}

{用一到两句话说明这个上下文是什么以及它为什么存在.}

## Language

**Order**:
{用一到两句话说明该术语.}
_Avoid_: Purchase, transaction

**Invoice**:
交付后向客户发出的付款请求.
_Avoid_: Bill, payment request

**Customer**:
下订单的个人或组织.
_Avoid_: Client, buyer, account
```

## Rules

- **允许空术语表.** 尚无已确定项目术语的上下文仍保留 `## Language` 标题, 但其下没有条目.
- **作出取舍.** 同一概念存在多个词语时, 选择最合适的一个, 并把其他词语列在 `_Avoid_` 下.
- **保持定义简洁.** 最多一到两句话. 定义它*是什么*, 而不是它*做什么*.
- **只包含此项目上下文专属的术语.** 即使项目大量使用, 通用编程概念 (超时, 错误类型, 工具模式) 也不属于这里. 添加术语前, 询问: 这是此上下文独有的概念, 还是通用编程概念? 只有前者属于这里.
- **在自然的聚类出现时, 按子标题分组术语.** 如果所有术语都属于一个连贯的领域, 使用平铺列表即可.

## Single vs multi-context repos

**单个上下文 (大多数仓库):** 仓库根目录有一个 `CONTEXT.md`.

**多个上下文:** 仓库根目录的 `CONTEXT-MAP.md` 列出各个上下文, 它们的位置以及彼此关系:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) - 接收并跟踪客户订单
- [Billing](./src/billing/CONTEXT.md) - 生成发票并处理付款
- [Fulfillment](./src/fulfillment/CONTEXT.md) - 管理仓库拣货和发运

## Relationships

- **Ordering → Fulfillment**: Ordering 发出 `OrderPlaced` 事件; Fulfillment 消费它们以开始拣货
- **Fulfillment → Billing**: Fulfillment 发出 `ShipmentDispatched` 事件; Billing 消费它们以生成发票
- **Ordering ↔ Billing**: `CustomerId` 和 `Money` 的共享类型
```

此技能使用仓库已经选定的结构:

- 如果存在 `CONTEXT-MAP.md`, 读取它以找到上下文
- 如果只有根目录 `CONTEXT.md`, 则为单个上下文
- 如果两者都不存在, 报告仓库设置缺口, 而不选择结构或创建上下文文件

存在多个上下文时, 判断当前主题与哪一个相关. 如果不明确, 询问用户.
