<!-- arw:managed:start -->
# Subagent 分配

## Scope

本文件负责任务委派, 实例创建和复用, 以及非预定义 subagent 的模型和推理强度. 与用户沟通的 Main Agent 和其他非 Reviewer 运行环境的 Main Agent 管理各自的子 Agent. 独立 Reviewer 按 `./reviewer.md` 的 Single-agent execution 节执行; 本文件以下的委派和模型映射规则不用于 Reviewer. 并发数量, 容量和空闲线程由 harness 与用户级配置管理. 其他预定义角色使用其已有完整配置; 共同决定 Reviewer 的 spec 修改意见的 subagent (`rule-and-design-changes` Skill) 是预定义角色, 使用与所属 Main Agent 相同的模型和推理强度.

## Delegation and reuse

各运行环境的 Main Agent 在不影响工作质量的前提下尽量把工作委派给合适的 subagent, 自己集中负责协调, 决策和必须亲自执行的操作. 与用户沟通的 Main Agent 需要停下来向用户提问时, 已委派的独立工作仍可推进, 减少等待对整体进度的影响. 与用户沟通的 Main Agent 可以转发少量用户沟通, 不阻止普通任务委派. Reviewer 输入缺失或工作阻塞时, 按 `./reviewer.md` 的 Communication and observation 节交付不完整状态, 不向用户或与用户沟通的 Main Agent 提问. 用户的新消息改变已委派工作的依据, 授权或顺序时, 与用户沟通的 Main Agent 及时通知受影响的 subagent.

各运行环境的 Main Agent 可以把会污染自身上下文, 无谓地大量占用上下文, 或不值得使用自身智力和努力程度处理的工作委派出去. 委派后, 该 Main Agent 负责协调, 由受派 Agent 完成执行过程; 同领域复用则保留已经获得的理解.

各运行环境的 Main Agent 统一创建和分配自身运行环境中的所有实例, 优先复用已经掌握同领域上下文的合适实例. 以下情况可以构成另建实例的理由:

- 工作要求独立审查.
- 现有实例的上下文已经混杂或过长.
- 工作确实需要并行执行.

新建的实例从全新上下文启动, 不 fork 创建者的上下文, 以免沿用其未经检验的假设.

独立 Reviewer 的身份, 初始上下文隔离和原线程复用遵循 `reviewer-launch` Skill, 结论有效性遵循 `./reviewer.md` 的 Review handoff 节.

subagent 可以向所属运行环境的 Main Agent 申请协作者, 不自行创建下级实例. 该 Main Agent 提供获分配实例的标识和任务关系, 使双方可以直接沟通.

直接沟通不授予改变任务范围, 分配写入责任或决定重要问题的权限. 文件交付使用 `./agent-writes.md`, 不要求 subagent 只返回建议再由 Main Agent 重写.

## Task assessment

分别评估任务的智力需求和努力程度. 智力需求衡量需要的判断能力, 努力程度衡量需要的推理投入.

| 档位 | 智力需求 | 努力程度 |
| --- | --- | --- |
| 低 | 按明确步骤查找, 提取或核对事实 | 少量直接推导即可完成 |
| 中 | 结合上下文判断, 分析局部问题 | 需要多步推导, 比较或交叉核对 |
| 高 | 处理歧义, 跨领域约束或开放式设计 | 需要深入探索多条路径, 检验假设和反例 |

文件数量和机械重复量不直接提高档位. 从大量文件提取明确字段可以只需低档判断和推理, 而简短的开放式架构问题可能需要高档判断和深入推理.

## Allocation

每次创建非预定义 subagent 前读取本文件, 按以下顺序选择参数:

1. 读取 repository owned 区域的当前仓库配置. 尚未配置时, 先按 `./subagent-model-setup.md` 完成首次配置.
2. 根据任务的智力档位选择模型, 再根据努力档位选择该模型对应的推理强度. 所属运行环境的 Main Agent 的配置不作为参考.
3. 使用选定参数创建 subagent. Codex 的创建 Interface 不能逐次设置 Fast, 因此本规则不把 Fast 状态作为可配置映射或创建承诺; Claude Code 通过 Agent 工具的 `model` 和 `effort` 参数传递所选映射.

Agent 默认不开启 Fast 模式. 可以设置服务层级的位置 (Reviewer 配置的 `serviceTier`, Codex 的 `service_tier`, Claude Code 的 `/fast`) 使用标准层级; 只有用户明确要求时才开启, 且只用于用户指定的范围.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
## Repository model mapping

本仓库使用以下 Codex 模型映射. 先按智力需求选择模型, 再按努力需求选择该行的推理强度.

| 智力需求 | 模型 | 低努力 | 中努力 | 高努力 |
| --- | --- | --- | --- | --- |
| 低 | `gpt-6-luna` | `low` | `medium` | `xhigh` |
| 中 | `gpt-6.1-terra` | `low` | `medium` | `high` |
| 高 | `gpt-6.1-sol` | `low` | `medium` | `high` |

Claude Code 使用以下映射; 用户级规则另有模型选择要求时以用户级规则为准.

| 智力需求 | 模型 | 低努力 | 中努力 | 高努力 |
| --- | --- | --- | --- | --- |
| 低 | `haiku` | `low` | `medium` | `high` |
| 中 | `sonnet` | `low` | `medium` | `high` |
| 高 | `opus` | `low` | `medium` | `high` |

作为 Baseline 例外, 本仓库不开启 Fast 模式: 上述位置一律使用标准层级, 不适用用户要求时开启的例外.
<!-- arw:repository-owned:end -->
