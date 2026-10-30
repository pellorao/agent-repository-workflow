---
description: 设计深模块 (deep module) 的共享词汇. 当用户想设计或改进模块的 Interface, 寻找加深 (deepening) 机会, 决定 Seam 放在哪里, 让代码更易测试或更便于 AI 导航, 或其他 Skill 需要深模块词汇时使用.
name: codebase-design
---

# 代码库设计

设计 **深模块** (deep module): 小 Interface 背后承载大量行为, 放在干净的 Seam 上, 并可通过该 Interface 测试. 设计或重构代码时都使用这套语言和原则. 目标是让调用方获得 Leverage, 让维护者获得 Locality, 让所有人获得可测试性.

## Glossary

严格使用这些术语, 不要用 "component", "service", "API" 或 "boundary" 替代. 语言一致是这套词汇的全部意义.

**Module** (模块): 任何带有 Interface 和实现的东西. 刻意不限定规模: 可以是函数, 类, 包, 或跨层的切片. _避免使用_: unit, component, service.

**Interface**: 调用方正确使用该 Module 必须知道的一切, 包括类型签名, 也包括不变量, 顺序约束, 错误模式, 必需的配置和性能特征. _避免使用_: API, signature (过窄, 只指类型层面的表面).

**Implementation** (实现): Module 内部的东西, 即它的代码主体. 与 **Adapter** 不同: 一个东西可以是实现很大的小 Adapter (如 Postgres 仓库), 也可以是实现很小的大 Adapter (如内存中的假实现). 讨论 Seam 时用 "adapter", 其余情况用 "implementation".

**Depth** (深度): Interface 处的 Leverage, 即调用方 (或测试) 每学习一单位 Interface 能调动的行为量. 大量行为位于小 Interface 之后时 Module 是 **深** 的, Interface 几乎与实现一样复杂时是 **浅** 的.

**Seam** _(Michael Feathers)_: 无需在该处编辑就能改变行为的地方, 即 Module 的 Interface 所在的 _位置_. Seam 放在哪里本身是一项设计决定, 与它背后放什么相互独立. _避免使用_: boundary (与 DDD 的限界上下文含义冲突).

**Adapter**: 在 Seam 处满足某个 Interface 的具体事物. 描述的是 _角色_ (它填的是哪个位置), 不是实质 (里面是什么).

**Leverage**: 调用方从 Depth 中得到的东西: 每学习一单位 Interface 获得更多能力. 一份实现可以在 N 个调用点和 M 个测试中回本.

**Locality**: 维护者从 Depth 中得到的东西: 变更, 缺陷, 知识和验证集中在一处, 而不是散落在各个调用方. 修一次, 处处生效.

## Deep vs shallow

**深 Module** = 小 Interface + 大量实现:

```
┌─────────────────────┐
│   小 Interface      │  ← 方法少, 参数简单
├─────────────────────┤
│                     │
│  深层实现           │  ← 复杂逻辑被隐藏
│                     │
└─────────────────────┘
```

**浅 Module** = 大 Interface + 很少的实现 (应避免):

```
┌─────────────────────────────────┐
│       大 Interface              │  ← 方法多, 参数复杂
├─────────────────────────────────┤
│  薄实现                         │  ← 只是透传
└─────────────────────────────────┘
```

设计 Interface 时问自己:

- 能否减少方法数量?
- 能否简化参数?
- 能否把更多复杂性藏到内部?

## Principles

- **Depth 是 Interface 的属性, 不是实现的属性.** 深 Module 内部可以由小的, 可 mock 的, 可替换的部分组成, 只是它们不属于 Interface. Module 可以有 **内部 Seam** (实现私有, 供自己的测试使用), 也有位于其 Interface 处的 **外部 Seam**.
- **删除测试.** 想象删掉这个 Module. 复杂性消失, 说明它只是透传; 复杂性重新出现在 N 个调用方中, 说明它物有所值.
- **Interface 就是测试面.** 调用方和测试穿过同一个 Seam. 想要越过 Interface 去测试, 多半说明 Module 的形状不对.
- **一个 Adapter 意味着假想的 Seam, 两个 Adapter 才是真正的 Seam.** 除非确实有东西在其两侧变化, 否则不要引入 Seam.

## Designing for testability

好的 Interface 让测试变得自然:

1. **接受依赖, 不要自己创建.**

   ```typescript
   // 易于测试
   function processOrder(order, paymentGateway) {}

   // 难以测试
   function processOrder(order) {
     const gateway = new StripeGateway();
   }
   ```

2. **返回结果, 不要产生副作用.**

   ```typescript
   // 易于测试
   function calculateDiscount(cart): Discount {}

   // 难以测试
   function applyDiscount(cart): void {
     cart.total -= discount;
   }
   ```

3. **表面积要小.** 方法越少, 需要的测试越少. 参数越少, 测试准备越简单.

## Relationships

- 一个 **Module** 恰好有一个 **Interface** (它向调用方和测试呈现的表面).
- **Depth** 是 **Module** 的属性, 相对其 **Interface** 衡量.
- **Seam** 是 **Module** 的 **Interface** 所在之处.
- **Adapter** 位于 **Seam** 处, 满足该 **Interface**.
- **Depth** 为调用方带来 **Leverage**, 为维护者带来 **Locality**.

## Rejected framings

- **把 Depth 定义为实现行数与 Interface 行数之比** (Ousterhout): 会奖励堆砌实现. 这里改用 Depth 即 Leverage.
- **把 "Interface" 理解为 TypeScript 的 `interface` 关键字或类的公开方法**: 过窄, 这里的 Interface 包含调用方必须知道的每一项事实.
- **"Boundary"**: 与 DDD 的限界上下文含义冲突. 应说 **Seam** 或 **Interface**.

## Going deeper

- **在已知依赖的前提下加深一组 Module**: 见 [DEEPENING.md](DEEPENING.md), 内容为依赖类别, Seam 纪律, 以及替换而非叠加的测试策略.
- **探索备选 Interface**: 见 [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md), 并行启动多个 sub-agent, 用几种截然不同的方式设计该 Interface, 再按 Depth, Locality 和 Seam 位置比较.
