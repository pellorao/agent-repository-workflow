<!-- arw:managed:start -->
# Subagent 分配

## Scope

本文件负责任务委派, 实例创建和复用, 以及非预定义 subagent 的模型和推理强度. 与用户沟通的 Main Agent 和其他非 Reviewer 运行环境的 Main Agent 管理各自的子 Agent. 独立 Reviewer 按 [Reviewer 单 Agent 执行规则](reviewer.md#single-agent-execution) 自行完成全部审核, 不创建或恢复子 Agent; 本文件以下的委派和模型映射规则不用于 Reviewer. 并发数量, 容量和空闲线程由 harness 与用户级配置管理. 其他预定义角色使用其已有完整配置.

## Delegation and reuse

各运行环境的 Main Agent 在不影响工作质量的前提下尽量把工作委派给合适的 subagent, 自己集中负责协调, 决策和必须亲自执行的操作. 适合独立交付的研究, 原型, 实现和文档编写默认交给 subagent 直接完成. 与用户沟通的 Main Agent 需要停下来向用户提问时, 已委派的独立工作仍可推进, 减少等待对整体进度的影响. 出现以下情况时可以自行执行:

- 需要频繁与用户互动.
- 无法合理拆分.
- 工作很小, 交接成本明显更高.

与用户沟通的 Main Agent 可以转发少量用户沟通, 不阻止普通任务委派. Reviewer 输入缺失或工作阻塞时, 按 [Reviewer 的通信与输入不足处理规则](reviewer.md#communication-and-observation) 交付不完整状态, 不向用户或与用户沟通的 Main Agent 提问.

各运行环境的 Main Agent 可以把会污染自身上下文, 无谓地大量占用上下文, 或不值得使用自身智力和努力程度处理的工作委派出去. 委派后, 该 Main Agent 负责协调, 由受派 Agent 完成执行过程; 同领域复用则保留已经获得的理解.

各运行环境的 Main Agent 统一创建和分配自身运行环境中的所有实例, 优先复用已经掌握同领域上下文的合适实例. 以下情况可以构成另建实例的理由:

- 工作要求独立审查.
- 现有实例的上下文已经混杂或过长.
- 工作确实需要并行执行.

独立 Reviewer 的身份, 初始上下文隔离和原线程复用遵循 `reviewer-launch` Skill, 结论有效性遵循 [Reviewer 报告交接规则](reviewer.md#review-handoff).

subagent 可以向所属运行环境的 Main Agent 申请协作者, 不自行创建下级实例. 该 Main Agent 提供获分配实例的标识和任务关系, 使双方可以直接沟通.

直接沟通不授予改变任务范围, 分配写入责任或决定重要问题的权限. 文件交付使用 [共同写入规则](agent-writes.md), 不要求 subagent 只返回建议再由 Main Agent 重写.

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

1. 读取 repository owned 区域的当前仓库配置. 尚未配置时, 先完成下述首次配置流程.
2. 根据任务的智力档位选择模型, 再根据努力档位选择该模型对应的推理强度. 所属运行环境的 Main Agent 的配置不作为参考.
3. 使用选定参数创建 subagent.

## Initial repository configuration

缺少仓库配置时, 所属运行环境的 Main Agent 调查当前可用的主流模型及其支持的推理强度, 拟定智力到模型, 努力到所选模型推理强度的映射. 提交方案前可以询问用户偏好. 该调查由创建非预定义 subagent 前的配置检查触发, 由所属运行环境的 Main Agent 完成.

向用户提交具体模型及其低, 中, 高努力档位的推理强度. 用户批准后, 将这些配置写入本文件的 repository owned 区域, 然后继续创建原定的 subagent. 审批前不使用候选映射. Codex 的创建 Interface 不能逐次设置 Fast, 因此本规则不把 Fast 状态作为可配置映射或创建承诺; Claude Code 通过 Agent 工具的 `model` 和 `effort` 参数传递所选映射.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
## Repository model mapping

本仓库使用以下 Codex 模型映射. 先按智力需求选择模型, 再按努力需求选择该行的推理强度.

| 智力需求 | 模型 | 低努力 | 中努力 | 高努力 |
| --- | --- | --- | --- | --- |
| 低 | `gpt-6-luna` | `low` | `medium` | `xhigh` |
| 中 | `gpt-6.1-sol` | `low` | `medium` | `high` |
| 高 | `gpt-6.1-sol` | `medium` | `high` | `xhigh` |

当前创建非预定义 subagent 的 Interface 不能逐次设置 Fast 参数. 表中的模型和推理强度是当前可传递的配置; Standard 主会话下的实际 Fast 状态由平台决定, 不属于本映射的承诺.
<!-- arw:repository-owned:end -->
