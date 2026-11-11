# Artifact model 与 Wayfinding

## Artifact model

- effort 使用 `.scratch/<NNNN>-<effort-slug>/`, `NNNN` 从 `0001` 到 `9999`. 新 effort 使用当前最大编号加 1; `9999` 已被占用时停止.
- 实施 issue, Application Source Issue 和 Wayfinder issue 各使用一个 `.scratch/<NNNN>-<effort-slug>/issues/<NN>-<issue-slug>.md`, `NN` 从 `01` 到 `99`.
- 可选的 `.scratch/<NNNN>-<effort-slug>/spec.md` 是行为合同, 不是 effort 要求清单. 只有 Wayfinder effort 具有 `map.md`.
- 已注册的 ARW Artifact 类型是 `issue`, `map` 和 `spec`; 审计和就绪 JSON 是工作流记录. Local Canonical ID 是 `issue:<NNNN>:<NN>`, `map:<NNNN>` 和 `spec:<NNNN>`; Application 工作流可以使用限定引用 `issue:<application-or-module-name>:<NNNN>:<NN>`.
- 编号是稳定身份. 普通工作流中不删除, 重新编号, 更改类型或重用已提交的 issue, map 或 spec 身份; 编号不变时可以更改 slug. 描述性 slug 只出现在已注册目录和 issue 文件名及其精确路径中; 派生目录, 伴随文件, 记录键和持久身份字段只使用编号. issue 只通过适用终态退役.
- 受独立治理的旧 effort 清理只能删除最旧的连续编号前缀, 保留较新 effort 和当前最大值, 使编号无法重用. 读取不从已清理的 effort 回退到 Git 历史.
- 不为仅仅相关的工作重用已完成的 effort. 只有新工作精确修复原 issue 已要求的行为时才重新打开它; 否则使用下一个 effort 编号创建新 effort, issue 从 `01` 开始.
- 一个 effort 只承载一个主要目标; 不相关的目标另建 effort. 按 `docs/agents/agent-writes.md` 的 Issue concurrency 节为减少审核轮次合并实施的小 issue 不受此限.

## Wayfinding

Wayfinder map 包含 `Destination`, `Notes`, `Decisions so far`, `Not yet specified` 和 `Out of scope`. `Blocked by:` 中的全部标识符都引用已解决的 issue 时, 下级 issue 解除阻塞. 工作前领取一个最前沿 issue, 每个 Agent 会话最多解决一个, 附加 `## Answer`, 并更新 map 中的决定指针.
