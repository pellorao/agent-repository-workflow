<!-- arw:managed:start -->
# 更改已跟踪文件前的要求

更改已跟踪文件前, 先确认有一个匹配的活动 issue, 或已经明确授权创建初始规划记录, 然后确认治理技能授权该更改.

## Issue discovery

首先使用当前对话中已经识别的 issue 路径或 ID. 把它解析为 `.scratch/<NNNN>-<effort-slug>/issues/<NN>-<issue-slug>.md`, 并验证已保存的 issue 仍然与所请求的工作匹配. 该路径语法覆盖实施, Application Source 和 Wayfinder effort.

如果对话没有识别目标, 或已保存的引用不再有效, 搜索当前仓库中的所有 issue 文件. 如果没有匹配项或存在多个合理匹配项, 请用户指定 issue. 不得代替用户选择或创建实施范围.

## Authorization

应用某个授权分支前, 确认所定位文件的结构符合 `issue-tracker.md`, 且其记录类型与所选的实施, Application Source 或 Wayfinder 工作流匹配.

implementation issue 只有在直接覆盖所请求的范围, 使用 `Status: ready-for-agent`, 且列出的每个阻断项都已经达到适用终态时, 才授权更改已跟踪文件. `Status: ready-for-human` 不授权 Agent 执行实施工作.

Application Source Issue 永远不授权本地 Agent 执行实施工作. 只有负责这些操作的 Application 和 JIRA 工作流可以修改关联和同步内容.

Wayfinder issue 遵循本地 map 生命周期. 只有在它以 `Status: claimed` 被领取, 且每个阻断项都达到 `Status: resolved` 后, 它才授权处理 issue 中记录的问题或任务. 不得把 `claimed` 或 `resolved` 当作 Implementation issue 状态.

初始规划记录授权只可创建或更新其治理技能授权的规划产物. 它不授权更改生产代码, 测试或无关文档.

如果完成活动实施 issue 所必需的机械性配套修改不增加行为, 规则, 公开合同或架构决定, 该修改可以保留在此 issue 内. 增加行为, 规则, 公开合同或架构决定的变更, 在实现前需要由更新后的 issue 或新 issue 授权.

不得默默扩大 issue. 实现新要求前, 通过已经配置的 issue 工作流记录该要求.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->
