---
description: 规划超出单个 Agent 会话容量的大型工作: 在本地跟踪器中建立由决定型 issue 组成的共享地图, 逐个解决直到通往目的地的路径清晰.
name: wayfinder
disable-model-invocation: true
---

一个模糊的想法到来了: 它太大, 一个 Agent 会话装不下, 又裹着迷雾, 从当前位置到 **目的地** 的路还看不见. Wayfinding 要找的是这条路, 而不是直接冲向目的地. 本 Skill 把路径绘制成一张 **共享地图**, 再逐个处理 **决定型 issue** (解决结果是一个决定, 而不是待执行的构建切片), 直到路线清晰.

目的地因 effort 而异, 命名目的地是绘图的第一步, 它决定每个 issue 的形态. 它可以是待移交并迭代的 spec, 规划开始前要锁定的决定, 或数据结构迁移这类就地完成的改动. 地图与领域无关.

地图, issue 的字段, 阻断, 领取, 回答位置和终态都遵循 `issue-tracking` Skill 的 `artifact-model.md` 中 Wayfinding 一节的规则, 本 Skill 不重复; 创建或更新地图或 issue 前先读它.

## Plan, don't do

Wayfinder 默认是 **规划**: 每个 issue 解决一个决定, 没有什么需要在动手前再决定时地图即完成. 想直接动手往往说明已到达地图边缘, 该移交了. effort 可以在 **Notes** 中改写此规则, 把执行并入地图; 否则只产出决定, 不产出交付物.

解决 Wayfinder issue 不产生 Gate 1 或 Gate 2. 用户要求 Git 提交时, 按 `commit` Skill 对候选分类.

## Refer by name

每张地图和每个 issue 都有 **名称**, 即其标题. 在人读的所有内容中 (包括叙述和 Decisions so far), 用名称指代, 不用裸 ID, 编号或 slug; 需要精确引用时, 在名称旁附链接.

## The map

地图是 **索引**, 不是仓库. 它列出已作出的决定并指向保存细节的 issue; 一个决定只存在于它自己的 issue, 地图只写要点和链接.

地图以低分辨率呈现整体, 每个会话加载一次. 未解决的 issue 不列入 Decisions so far, 当前前沿通过跟踪器查询.

```markdown
## Destination

走到这张地图尽头是什么样子: 本 effort 正在寻路前往的 spec, 决定或改动. 一两行; 每个会话选 issue 前先对准它.

## Notes

领域; 每个会话应参考的 Skill; 本 effort 的常设偏好.

## Decisions so far

- [<已解决的范围内 issue 标题>](链接): <一行答案要点>

## Not yet specified

范围内但还不能成为 issue 的迷雾; 随前沿推进而转为 issue.

## Out of scope

已裁定超出目的地的工作; 已解决, 永不转为 issue.
```

### Issues

每个 Wayfinder issue 属于地图所在的 effort, 按一个 Agent 会话的容量确定问题大小. 按 Ticket Types 节选择 `research`, `prototype`, `grilling` 或 `task`. 阻断它的 issue 全部解决时它即 **未阻塞**; **前沿** 是 effort 中未解决, 未阻塞, 未领取的 issue, 位于已知的边缘. 解决 issue 期间创建的资产从该 issue 链接.

## Ticket Types

每个 issue 要么是 **HITL** (人在回路, 与替自己发言的人一起处理), 要么是 **AFK** (Agent 独自推进). HITL issue 只能通过真实的交流解决, Agent 不替人回答他那一侧 (自问自答的追问就违反了这一点).

- **Research** (AFK): 阅读文档, 第三方 API 或本地资料来查明决定所等待的事实. 由 Main Agent 按 `docs/agents/subagent-allocation.md` 分配 `$research` 协作者 (subagent 向 Main Agent 申请), 发现保存到该 effort 的 `.scratch/<NNNN>-<effort-slug>/research/<name>/`. 需要当前工作目录之外的知识时使用. 同一会话创建的相互独立的 Research issue 可以在各自的协作者会话中并行.
- **Prototype** (HITL): 做一个廉价, 粗糙, 具体的东西让人对照着反应 (提纲, 草稿, 桩, 或通过 `$prototype` 得到的 UI 或逻辑代码), 把原型作为资产链接. 关键问题是 "应该长什么样" 或 "应该怎么表现" 时使用.
- **Grilling** (HITL): 通过 `$grilling` 和 `$domain-modeling` 按轮次沿当前前沿对话. 默认类型.
- **Task** (HITL 或 AFK): 在能作出 _决定_ 之前必须完成的手工工作, 例如注册服务以评估其 API, 开通权限, 搬迁数据以看清其形状. 这是唯一 _做事_ 而不是 _决定_ 的类型, 它的价值在于解除决定的阻塞, 而非交付目的地. 能独立完成的由 Agent 自己做 (AFK), 否则给人一份精确清单 (HITL). 完成后答案记录做了什么, 以及后续 issue 依赖的事实 (凭据位置, 新 URL, 行数).

## Fog of war

地图 _故意_ 不完整: 不绘制还看不见的部分. 在活动 issue 之外是 **迷雾**: 你能看出将要到来, 却因依赖尚未解决的问题而无法定形的决定和调查. 解决一个 issue 会驱散其前方的迷雾, 把现在能说清的部分转为新 issue, 一次一个, 直到路径清晰, 不再有 issue.

**Not yet specified** 记录这种模糊视野: 怀疑存在的问题, 以后再回看的区域. 它是通往目的地途中尚未发现的前沿, 都在范围内, 只是还不够清晰, 不能成为 issue. 可详可略, 也兼作协作者了解 effort 去向的路标.

**迷雾还是 issue?** 判断标准是现在能否精确陈述问题, _不是_ 现在能否回答.

- 问题已经清晰, 即使被阻塞暂时无法处理: 建 issue.
- 还无法这样清晰地表述: 放入 Not yet specified. 不要把迷雾预先切成 issue 大小的片, 它比 issue 粗, 一片迷雾转化时可能变成多个 issue, 也可能一个都不是.

Not yet specified 不含已决定的 (Decisions so far), 已是活动 issue 的, 或范围外的.

## Out of scope

迷雾只会朝目的地聚集. 目的地划定范围, 之外的工作是 **范围外**, 不是迷雾, 不属于 Not yet specified, 单独写入 **Out of scope**: 你有意排除在 _本_ effort 之外的工作. 决定它的是范围, 不是清晰度.

范围外的工作永不转为 issue, 只有重划目的地时才会回来, 且作为新 effort, 而非接续.

裁定范围外是划定范围的动作, 不是路线上的一步. 现有 issue 被发现位于目的地之外时, 把结论作为 `## Answer` 记录, 在 Out of scope 留一行要点, 理由和该 issue 的链接; 更新地图之后才把它的 `Status:` 设为 `resolved`. 它不进入 Decisions so far, 后者只记录实际走过的路线.

## Invocation

两种模式.

### Chart the map

用户带着模糊想法调用.

1. **命名目的地.** 通过 `$grilling` 和 `$domain-modeling` 确定这张地图要找的是什么 (spec, 决定或改动). 目的地决定范围, 所以先定它.
2. **绘制前沿.** 再次追问, 这次 **广度优先**: 铺开整个空间而不深挖任一线索, 找出待决事项和现在就能迈出的第一步. **如果没有发现迷雾** (路径已清晰, 整个旅程小到一个会话可完成), 就不需要地图, 停下来问用户如何继续.
3. **创建地图**: 填好 Destination 和 Notes, Decisions so far 留空, 把迷雾勾画进 Not yet specified.
4. **创建现在能说清的 issue**, 随后第二遍记录阻断 (issue 先要有编号才能互相引用), 由此分出前沿与被阻塞的; 说不清的留在迷雾中.
5. **启动 Research 协作者**, 为本会话创建的每个 Research issue 分配或复用协作者, 结果经跟踪器工作流记录.
6. 停止. 绘图是一个会话的工作, Research 协作者在各自的会话中解决自己的 issue.

### Work through the map

用户带着地图引用调用. issue 是 **可选** 的: 没有指定时由你选择下一个决定, 不是用户.

1. 加载 **地图** (低分辨率视图), 不加载每个 issue 正文.
2. 选择 issue. 用户指定了就用它, 否则取按顺序的第一个前沿 issue, 工作前 **先领取**.
3. 处理问题并 **按需放大**: 随时读取相关或已关闭 issue 的完整正文; 调用 `## Notes` 点名的 Skill; 拿不准时用 `$grilling` 和 `$domain-modeling`.
4. 完成 issue. 位于路线上时记录 `## Answer`, **在地图的 Decisions so far 追加上下文指针**, 再把 `Status:` 设为 `resolved`; 位于目的地之外时改按 Out of scope 节.
5. 添加新浮现的 issue 并记录其阻断; 把答案已使其能说清的迷雾转为 issue, 并从 Not yet specified 中清除, 使它只以新 issue 的形式存在. 答案若显示另一个 issue 位于目的地之外, 留给单独的会话处理; 决定若使地图其他部分失效, 更新受影响的 issue.

用户可能并行运行未阻塞的 issue, 因此其他会话可能同时在编辑跟踪器.
