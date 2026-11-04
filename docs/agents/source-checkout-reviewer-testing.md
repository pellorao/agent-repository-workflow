# Source Checkout Reviewer 能力测试

Reviewer 能力测试在维护者显式调用 `$reviewer-capability` Skill 时进行; 改动 Reviewer 规则 (Reviewer 角色指令, `docs/agents/reviewer.md`, Reviewer 交接与 Request 内容, 各 Skill 中约束 Reviewer 行为或复审处置的规则, Reviewer 运行时 (原生工具, 权限, 沙盒, 上下文, 默认模型与设置)) 时, 也视同维护者已调用: 用受影响角色的能力场景对比改动前后, 接受或拒绝按 `reviewer-capability` Skill 的 A/B 判定规则. 速度提升很大, 而该规则拒绝或候选均值低于对照时, 交用户决定. Reviewer 运行时改动频繁时可以减轻测试: 只用受影响角色的一个场景, 或把几次改动合并为一次测试 (对比最早一次改动前与最后一次改动后). 只删除重复表述或改为引用, 不改变任何规则含义的改动不做能力测试.
