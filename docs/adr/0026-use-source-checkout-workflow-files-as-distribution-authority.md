# 使用源码仓库实际工作流文件作为 Workflow Distribution 权威来源

## Context

ARW 源码仓库同时保存实际使用的工作流文件和 `distribution/` 中的安装载荷.

过去, Workflow Distribution 清单, 分类目录, 平台事实文件, 带版本号的语法配置, 证据和来源信息都被当作编写来源. 因此, 普通开发必须同步修改实际文件和分发副本, Upstream Sync 也把 Workflow Distribution 当作 Ours. 这些路径可以在不同时间包含不同字节, 没有一个单一位置能够说明当前分支实际使用什么.

Workflow Distribution 的大部分清单数据可以从安全固定目录树或生产代码直接推导. 两个平台当前需要的差异也可以由同一个小型映射配置表达.

继续保存逐文件清单, 平台环境证据和重复版本会扩大用户审核范围, 并为同一事实建立多个权威来源.

## Decision

源码仓库实际使用的共享工作流文件是唯一编写来源, 包括实际 Skill, 受管理的 Agent 文档区域, 规范 Role 和 ARW 许可证文件. 普通开发直接修改这些位置, 不要求 `distribution/` 实时同步.

源码仓库实际 Skill 视图中的 `$reviewer-capability` 是能力测试操作的唯一权威, 仅供 Source Checkout 使用. 发布前同步在源码选择阶段排除该 Skill, 使它不进入 Workflow Distribution. 这一选择使完整安装载荷已经满足源码限定边界, 避免安装或平台投影另行维护能力测试 Skill 的排除规则. 显式调用政策由 [ADR 0015](0015-use-versioned-skill-package-grammars.md#decision) 拥有.

发布前, 独立的发布前同步从实际文件形成 Workflow Distribution. 这套完整安装载荷经用户审核并授权写入后, 发布, 安装和目标仓库工作流只消费已经形成的载荷, 不反向修改实际来源, 也不重新决定转换内容.

Workflow Distribution 不再使用完整的带类型清单, 也不再分别保存两个平台的事实和发布证据. 固定安全目录树直接给出载荷清单.

精简的 Workflow Distribution 配置只记录两类内容: 仓库自有初始文件, 以及需要提供可调整参数的 Workflow Distribution 专有验证. 另一份精简的投影配置只记录统一格式到支持平台的映射.

配置, 生产代码和载荷由同一 Git 修订版本绑定. 如果数据不承担旧格式升级责任, 就不再为它单独保存重复的版本信息.

Upstream Sync 的 Ours 是源码仓库实际使用的 `.agents/skills/`. Base 与 Theirs 仍来自固定上游提交, 并继续经过用户审核的语义三方合并.

Upstream Sync 只更新实际 Skill, 许可证目标和来源自身的配置与采用记录 (原 `finalize` 已随旧引擎删除, 见 [ADR 0011](0011-use-source-only-human-reviewed-upstream-sync.md)). Workflow Distribution 在后续独立的发布前同步中派生, 不进入 Upstream Sync 的批准或恢复状态.

## Rejected alternatives

- 不继续把 Workflow Distribution 作为日常编写来源. 源码仓库当前实际使用的文件仍会形成第二份需要同步的内容.
- 不要求普通开发每次同时更新实际文件与 Workflow Distribution. 这会保留双写责任, 并使小改动也必须审核完整载荷.
- 不在代码中硬编码全部平台映射. 用户仍需要直接审核平台目标与引用语法差异.
- 不保留完整清单只作为证据. 对同一目录树再保存清单, 摘要证据或来源信息会形成可以漂移的第二事实来源.
- 不让 Upstream Sync 直接更新 Workflow Distribution. 采用上游内容与形成发布载荷是两个具有不同输入, 授权和恢复方式的生命周期.

## Consequences

当前分支实际行为只有一个编写权威来源. Workflow Distribution 可以在发布前完整重建和审核, 普通开发不承担实时双写.

用户需要审核的配置显著缩小, 但固定目录布局本身成为公开契约. 发布前必须成功完成发布前同步; Upstream Sync 完成后, 还要单独运行发布前同步, 才能让采用的上游变化进入待发布的 Workflow Distribution.
