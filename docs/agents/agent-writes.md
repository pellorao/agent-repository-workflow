<!-- arw:managed:start -->
# Agent 写入与恢复

## Scope

所有 Agent 文件写入都使用本规则, 包括代码, 测试, 文档, 新建文件和临时产物. 各运行环境的 Main Agent 负责其授权范围内的可恢复基线, 写入分配和交接; 与用户沟通的 Main Agent 独占 Git 写入及 Git 恢复责任. 自己写入时也遵守同一责任边界. 任务委派和实例复用遵循 [Subagent 分配](subagent-allocation.md).

本规则管理 Agent 的写入分工, 不替代 ARW Engine 各操作已有的事务与恢复合同. 独立 Reviewer 按 [Reviewer 单 Agent 执行与报告写入规则](reviewer.md#single-agent-execution) 只写调用方指定的绑定报告, 不分配子 Agent 写入范围或维护协作文件, 保留独立判断和准确字节提升要求.

## Prepare the baseline

各运行环境的 Main Agent 在开始自己的写入或分派写入任务前, 检查目标现状并确认可恢复基线. 正常基线使用已提交或已暂存的准确内容.

目标包含已有修改时, 先确认内容归属和适用的暂存授权. 条件满足后, 由与用户沟通的 Main Agent 将准确内容暂存为基线. 条件尚未满足时, 先解决这些前提, 再开始该范围的写入.

新文件以写入前不存在为恢复起点, 所属运行环境的 Main Agent 在已有授权内明确允许创建的路径范围. 只有确实无法先暂存再工作时才允许保存副本作为例外. 恢复能力不得依赖承担任务的 Agent 没有犯错.

受保护文档的用户确认遵循 `rule-and-design-changes` Skill. 其专门确认范围不因本规则适用于所有文件而扩大. 基线准备不自行授予暂存, 提交, 删除或丢弃修改的权限.

## Assign and hand off

各运行环境的 Main Agent 按精确文件或目录分配互不重叠的写入范围, 检查目录包含关系, 并把自己正在写入的范围纳入协调. 同一文件同一时间只有一个写入者. 不按不同函数或区域并发分配.

分派时交代任务要求, 允许写入的范围, 恢复基线, 所需定向验证和应返回的证据.

承担任务的 Agent 发现需要修改分配范围之外的文件, 或遇到尚未解决的重要决定时, 先向所属运行环境的 Main Agent 报告. 与用户沟通的 Main Agent 协调写入范围, 或按重要决定规则提交用户确认. 独立 Reviewer 不分配写入任务; 缺少必要输入或授权时, 按 [Reviewer 的通信与输入不足处理规则](reviewer.md#communication-and-observation) 返回不完整状态并说明原因. 在此之前, 不执行依赖该协调或决定的修改.

共享文件由所属运行环境的 Main Agent 在授权范围内安排串行修改. 该 Main Agent 也可以先确认原写入者停止并交接当前结果, 再转交文件, 让接收者明确当前内容和基线. 不引入文件锁或任务领取命令.

## Issue concurrency

默认串行: 同一时间只实施一个 issue, 在主工作区进行. 上一个 issue 提交后, 或停在不留未提交修改的状态后, 再开始下一个. 不写已跟踪文件的工作 (研究, 审核, 测量, 以及日常检查等非 issue 任务中不写已跟踪文件的部分) 可以与之并行, 有空余额度和名额时应当并行. 相关且改动范围相近的小 issue 可以合并为一个 issue 一起实施, 以减少审核轮次; 开始下一个 issue 前检查待办中是否有可合并的 issue.

用户可以把默认改为并行实施多个 issue. 并行时:

- 每个 issue 使用一个独立的 Git worktree, 一个 worktree 只承载一个 issue. worktree 由与用户沟通的 Main Agent 创建, 合并和删除.
- 各 worktree 内的写入, 测试和提交审核只针对本 issue. Git 写入, 包括 worktree 内的暂存, 提交和合并回主分支, 仍只由与用户沟通的 Main Agent 执行.
- 预计改动同一文件的 issue 尽量不并行. 合并冲突由该 Main Agent 解决, 合并后在主分支重跑完整验证.
- 删除 worktree, 仓库或其 `.tmp` 前, 用 `arw list background-agents` 的 `Workspace` 列找出引用该目录的加载中后台 Agent, 对每个所属本 Main 的运行用 `arw background-agent` 的 `unload_agent` 卸载, 再次确认列表中不再出现该目录后才删除. 否则其恢复记录随目录丢失, 该运行此后无法被回收而占满名额. 属于其他 Main 或卸载失败 (忙碌) 的运行不删除目录, 告知用户.
- 并行不提高 Reviewer 和后台 Agent 的容量上限, 名额不足时排队等待.

## Git and recovery

所有 Git 写入命令, 包括 `git add`, 取消暂存和恢复, 都只由与用户沟通的 Main Agent 执行, 子 Agent 和独立 Reviewer 也不得通过脚本或其他工具间接改变实际仓库的 Git 状态. 必要的只读 Git 操作允许 subagent 执行, 包括获取历史内容和准确的审查比较; subagent 不承担仓库状态管理职责.

与用户沟通的 Main Agent 集中管理 Git 写入, 使 subagent 不会自行改变恢复和用户审核的依据.

发生错误时, 所属运行环境的 Main Agent 先停止受影响的写入, 再按适用授权恢复相应范围, 包括错误修改, 删除和新增文件. 涉及 Git 写入的恢复仍只由与用户沟通的 Main Agent 执行. 恢复不得丢失用户已有修改或其他任务成果, 不扩大到无关范围.

## Delivery and review

承担任务的 Agent 完成范围内交付和定向验证, 向所属运行环境的 Main Agent 返回修改结果, 验证证据及未解决的问题. 所属运行环境的 Main Agent 核对子 Agent 交付的结果; 与用户沟通的 Main Agent 组织最终集成验证, 管理正式完成记录和状态, 并按适用工作流组织实施前与提交前审查.

独立 Reviewer 的结果由与用户沟通的 Main Agent 按 [Subagent 问题处理](subagent-findings.md) 独立核对, 完成必要的用户决定后再分派修复. 交接前重新确认范围和基线. 实现者不组织这些审查, 不审核自己的候选内容. 提交只在用户请求后按 `commit` Skill 进行.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->
