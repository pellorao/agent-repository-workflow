# 在配置中显式登记 Skill 分发

本决定取代 `./0026-use-source-checkout-workflow-files-as-distribution-authority.md` 中 "发布前同步在源码选择阶段排除该 Skill, 使它不进入 Workflow Distribution." 一句, 以及 "精简的 Workflow Distribution 配置只记录两类内容" 一段对配置内容的限定; 0026 的其余决定不变.

## Context

哪些实际 Skill 不进入 Workflow Distribution 曾硬编码在发布前同步的代码里, 是一份黑名单. 新增的 Skill 默认被分发, 没有任何环节要求维护者判断它是否应该安装到使用 ARW 的仓库. 依赖 Agent 记住 "新 Skill 要问是否分发" 的规则不可靠.

## Decision

`distribution/config.json` 增加 `distributedSkills` 与 `sourceOnlySkills` 两个列表, 只有前者中的 Skill 进入 Workflow Distribution. `.agents/skills/` 下每个 Skill 必须恰好出现在其中一个列表, 未登记的 Skill, 同时出现在两个列表的名字和名单中已不存在的名字都使发布前同步与源码仓库的生产检查失败, 并提示先由维护者判断是否分发. 两处调用同一个检查, 失败发生在删除之前. 采用上游新 Skill 时, `upstream-sync` Skill 一并询问是否分发并登记. 实际 Skill 仍是唯一编写来源, 配置只记录分发归属.

## Rejected alternatives

- 保留代码中的黑名单: 新 Skill 默认被分发, 没有强制判断.
- 只警告不阻断: 警告会被忽略, 没判断过的 Skill 仍按默认行为处理.
- 由 Agent 规则要求登记: 没有程序强制, 遗忘时不会被发现.
- 只保留白名单不要 `sourceOnlySkills`: 无法区分 "已判断为不分发" 与 "尚未判断".

## Consequences

每个新 Skill 在登记前都使同步和生产检查失败, 多一步登记. 名单错误由提交审核和 Git 发现与恢复; 目标仓库和安装载荷格式不受影响.
