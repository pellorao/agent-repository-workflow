# Skill 机制

[`writing-for-agents`](SKILL.md) 中针对 Skill 的分支: 当文档是 Skill 时有什么不同, 即 frontmatter, 调用方式的选择, 以及路由 Skill. 其余关于如何编写的内容都是 `SKILL.md` 中的通用参考.

## Invocation

两种选择, 在两种负载之间取舍:

- **模型调用** (model-invoked) 的 Skill 保留 `description`, 使 agent 可以自主触发它, 其他 Skill 也能到达它. 你仍然可以键入它的名字: 模型调用总是 _包含_ 用户可达, description 只会增加 agent 的发现途径, 绝不会削减人的途径. description 是 Skill 的顶层上下文指针, 被迫始终保持加载, 以永久的上下文负载换取可发现性. 内容全是参考的模型调用 Skill 也是共享参考的一个落脚点: 另一个 Skill 可以调用它, 所以几个 Skill 都需要的参考放在一处. 做法: 省略 `disable-model-invocation`, 并写一份携带触发分支的面向模型的 description (`SKILL.md` 中关于指针的写法规则完全适用).
- **用户调用** (user-invoked) 的 Skill 把 description 从 agent 的触及范围中拿掉: 只有人键入它的名字才能调用, 其他 Skill 也不能. 上下文负载为零, 但花掉认知负载, 你就是必须记得它存在的索引. 做法: 设置 `disable-model-invocation: true`; `description` 变成面向人的一行摘要, 去掉触发列表.

只有当 agent 必须自主到达该 Skill, 或另一个 Skill 必须到达它时, 才选择模型调用. 如果它只会手动触发, 就做成用户调用, 不付上下文负载.

两个用户调用的 Skill 都需要的共享参考不能放在任何一个之中: 没有 description, 谁也无法触发对方. 把它推到 Skill 体系之外的普通文件中: 任何 Skill 都能指向的外部参考.

## Splitting by invocation

拆分的调用方式这一刀 (顺序这一刀在 `SKILL.md` 中): 当你有一个独特的引导词应当单独触发它, 即你在提示中实际使用的触发词, 或另一个 Skill 必须到达它时, 拆出一个模型调用的 Skill. 你要为新增的始终加载的 description 付出上下文负载, 所以这种独立的可达性必须值得.

## Router skills

当用户调用的 Skill 多到你记不住时, 累积的认知负载由 **路由 Skill** (router skill) 解决: 一个用户调用的 Skill, 列出其他 Skill 以及何时该用哪一个, 使人只需记住一个 Skill 而不是许多个. 它只能提示, 不能触发它们: 用户调用的 Skill 没有 description, 除了人以外谁也到达不了.
