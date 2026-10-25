# 使用规范的 Workflow Distribution 锁文件契约

## Context

目标 Git 仓库需要本地状态记录, 用于证明所选 Repository Profile, ARW 拥有的 Managed Content 和仓库自有种子结构. 旧锁文件还复制了 Workflow Distribution 清单, 摘要, 来源版本, 最低 Engine 版本和投影契约版本. Workflow Distribution 改由当前安全目录树和投影配置直接构建后, 这些字段不再表达独立事实, 反而为同一事实建立多个权威来源.

锁文件仍然跨 Engine 更新长期存在. 现有 v1 仓库需要确定性迁移, 而未来无法识别的结构必须关闭式失败. 因此锁文件自己的结构版本仍有兼容责任, 不能因为 Workflow Distribution 配置与代码属于同一 Git 修订版本就删除.

## Decision

`arw-lock.json` 是机器维护的仓库本地状态记录, 不是 Workflow Distribution 清单或安装内容表的副本. 当前写入者使用 `lockSchemaVersion: 2`.

v2 锁文件只保存:

- `lockSchemaVersion`;
- Repository Profile, 包括所选平台, 领域文档布局和 Code Map 配置;
- 每个受管目标的路径, 归属, hash 和需要时的 `documentOwnership`;
- 仓库自有种子的结构策略.

v2 锁文件不保存 Workflow Distribution 版本, 投影契约版本, `sourceArwVersion`, `minimumArwVersion`, 清单摘要, 清单内容表, 清单来源元数据, 来源配置或 Upstream Sync 状态. 目标字节与归属已经足以支持 `verify`, `update` 和 `remove`; 无法从这些事实重建的其他产品数据由各自负责人保存.

受管文件或完整受管区域的 hash 只覆盖 ARW 拥有的字节. 合法的仓库自有 Overlay, `.arwignore` 条目和仓库自有平台种子内容不进入 Managed Content hash. 区域记录的 `documentOwnership: "repository-major" | "baseline-major"` 继续决定准确标记语法和保留内容边界.

Engine 只提供一种从 v1 到 v2 的确定性迁移. 它保留可直接证明的 Profile, 受管目标, 归属, hash, `documentOwnership` 和种子结构策略, 删除已失去意义的 Workflow Distribution, 投影, 版本和清单字段. 无效, 有歧义或未知的 v1 内容不做部分迁移. 版本 0, 高于当前版本和其他未登记结构均关闭式失败.

迁移只在明确获准的 `workflow init` 或 `workflow update` 事务中持久化. `workflow verify` 可以报告需要迁移, 但不写锁文件. 锁文件始终是仓库工作流成功事务的最后写入点.

ARW 依赖锁文件判断归属和完整性, 并依赖 Git 审核保护锁文件变更. 锁文件不使用自身 hash 或伪签名证明协同篡改没有发生.

## Rejected alternatives

- 不保留旧 Workflow Distribution 摘要和清单内容表. 它们会复制已安装载荷, 并在发布前同步或目录枚举改变时产生第二权威来源.
- 不删除 `lockSchemaVersion`. 锁文件跨 Engine 修订版本持久存在, 并且 v1 仓库需要明确迁移.
- 不从目标路径或当前 Workflow Distribution 猜测旧归属. 当前载荷可能已经变化, 猜测会把无法证明的字节变成 Managed Content.
- 不为从未发布的结构建立兼容路径. 没有用户状态需要的迁移不产生长期责任.

## Consequences

锁文件更小, 只保存目标 Git 仓库生命周期真正需要的持久事实. Workflow Distribution 与投影可以在不重复更新锁文件元数据结构的情况下演进. 代价是 Engine 必须维护准确的 v1 到 v2 迁移, 并且旧锁文件中无法直接证明的状态会要求用户重新初始化或修复, 而不是被猜测采用.
