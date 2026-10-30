# 发布前同步的引用审核与写入授权由 Main Agent 完成

[ADR 0026](0026-use-source-checkout-workflow-files-as-distribution-authority.md) 的 Decision 中 "经用户审核并授权写入" 这一条被本决定取代, ADR 0026 的其余决定保持不变.

## Context

发布前同步原先要求用户在编辑器中删除两个候选文件中的非 Skill 行, 并批准 `apply` 前的 `planDigest`. 人工编辑器步骤只增加等待, 曾使无人值守运行永久阻塞. 运行发布前同步的 Main Agent 有足够上下文判断某个标记是否 Skill 引用, `planDigest` 的用户批准也不提供 Agent 无法完成的判断.

## Decision

发布前同步的引用审核与写入授权主体由用户改为运行发布前同步的 Main Agent (与用户沟通, 负责 Git 写入的 Main Agent). `review` 只写入两份完整候选文件并输出路径, Main Agent 逐行判断并只做删除式编辑, `review --complete` 机械验证删除结果并写入 `completed-review.json`. Main Agent 检查 `prepare` 的结果后自行以同一 `planDigest` 调用 `apply`; `planDigest` 继续把 `apply` 绑定到已检查的计划输入. 判断工作可按 [ADR 0013](0013-use-main-agent-single-writer-orchestration.md) 的普通分工分派给子 Agent. 持久格式, 信任根和分发边界不变.

## Rejected alternatives

- 不保留用户审核. 理由同上, 且它阻塞无人值守运行.
- 不只去掉编辑器而保留 `apply` 前的用户授权. 仍会阻塞无人值守运行, 而生成范围可由 Git 暂存区完整恢复, 误写可撤销.
- 不让 Agent 直接写最终配置. 两份文件加删除式校验继续以完整候选为基准机械拒绝新增或改写的行.
- 不在本次移除 `reviewEditor`. 删除 v3 必需字段会使旧版本 ARW 读取新配置时关闭式失败, 升级配置版本的成本大于保留一个无使用者字段.

## Consequences

Agent 误判的身份会被转换或保持原文, 未修改即整体确认; 这些结果进入普通 Git 提交, 由提交审核和用户复核 diff 发现, 恢复靠 Git. 逐行判断的语义正确性由该 Main Agent 负责, 程序只做机械校验. `reviewEditor` 暂时保留为无使用者字段, 移除留到下一次配置版本升级.
