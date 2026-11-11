# 确定 ARW 1.0 规范的归属与交付形式

Type: grilling
Status: resolved
Blocked by: issue:0099:04

##### Question

尚未实施的 ARW 1.0 规范放在哪个仓库或目录作为权威来源 (当前仓库的 `.scratch` 之外), 读者怎样区分拟议的 1.0 行为与当前生效的 ARW 规则? 规范定稿后的审查走 Spec Readiness 还是一次独立审查?

## Answer

用户 11-09 在三个候选中选了 "单独克隆的 `arw-1.0` 分支, 写在将来生效的位置" 加独立审查. 被放弃的两个候选: 放在 main 的新目录并标 "拟议" (容易被 Agent 和 Reviewer 当成现行规则), 放在本 effort 的 `spec.md` (以后实施的 effort 每次读它都要用户授权, 旧 effort 还可能被清理).

- 权威来源: ARW 1.0 规范写在 `arw-1.0` 分支上, 直接写在合并回 main 后应生效的位置 (长期规范, 治理文档), 合并时自然生效. 该分支放在 ARW 的单独克隆目录中, 不在主工作区切换分支 (理由见 [确定 ARW 1.0 首版覆盖的工作流与跨平台组合](17-decide-workflow-coverage-and-platform-mix.md)); Main Agent 11-11 已从 main `9fb4b5d` 建好该分支. 读者区分拟议与现行规则的方式是分支本身: main 上没有 1.0 的文字, 当前 ARW 的 Agent 和 Reviewer 不会读到它.
- 审查: Spec Readiness 针对的是授权单个实施 issue 的就绪审核, 不适合整份规范. 规范正文写完后整体走一次独立审查, 审查者的模型与推理强度不低于 Main Agent; 规范篇幅大, 按章分片审查, 最后做一次全局一致性审查. 审查通过即本地图的 Destination 达成.
- 之后: 规范通过后的每个实施 issue 照常走 Spec Readiness 和提交审核.
