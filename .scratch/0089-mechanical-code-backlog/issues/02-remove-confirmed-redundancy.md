# 清理已确认的重复实现与死代码

Status: completed

## What to build

按 `.tmp/triage.md` 的 Issue C 分组规则, 在一个 effort 中合并本轮仍适用的机械清理, 按模块处理. Application 和 JIRA 模块处理 #534, #535, #536, #538, #539, #541, #542; CLI 模块处理 #552, #553, #554, #556, #565; Reviewer 配置处理 #551 的角色对象赋值. 不修改 `lib/background-agent/**`, 不安装, 不发布或推送.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 本 issue 按 implement Skill 的行为保持重构例外实施, 不生成就绪记录; 同 effort 的 issue:0089:01 保留后续 Host 清理及能力对比要求.

预算: 预计代码变更 100 行, 测试变更 0 行, issue 与记录约 90 行, 总计约 190 行, 生产代码净增不超过 0 行. 约 1000 行是添加上限而非最低改动量; 克隆内没有附录之外的台账副本, 不读取克隆外的台账.

复用现有测试覆盖重复选项, 缺少选项, 工作流操作, 无效工件标识符, Application 关联与跨模块依赖, 完成声明缺失或重复, HEAD spec 缺失或不可读, 事务失败与回滚. 合并快照转换时保留仅同步流程中的 Application Source Issue 过滤, 其他三个调用点保留全部记录与原顺序. 不新增仅镜像实现的测试.

## Acceptance criteria

- [x] 上述适用项完成, CLI 输出, Interface, 错误与持久状态不变.
- [x] 完整 Source Checkout 验证通过, 包括类型, 完整测试, 三个分发检查, 受影响文件语法, 文本, 术语和空白检查.
- [x] 记录逐项筛选结果, 预计和实际变更行数分别列出代码, 测试, issue 与文档.

## Blocked by

- None - can start immediately

## Validation

- `pnpm typecheck`: 通过严格 JavaScript 检查.
- `pnpm test`: 最终候选 906 项通过, 0 项失败, 约 6.5 秒. 原沙箱运行因本地 HTTP 服务 listen EPERM 中止; 首次沙箱外运行 905 项通过, 1 项未改动的 Background Agent 认证超时, 后续完整重跑和最终候选均为 906 项通过. 原始日志位于本轮会话工作区的 0089_02/validation/tests-private-type.log.
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`: 均通过.
- 五个受影响的 .mjs 文件分别执行 `node --check`: 均通过.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0089-mechanical-code-backlog/`, `git diff --check`: 均通过. `node arw.mjs language inspect .scratch/0089-mechanical-code-backlog/issues`: 中文为普通叙述, 英文仅精确标识符与字段.
- 复用 `tests/application-jira/application-association.test.mjs`, `tests/application-jira/application-completion.test.mjs`, `tests/application-jira/cli.test.mjs` 的关联, 依赖归一化, 完成资格, Git 读取与事务恢复结果; 复用 `tests/spec-readiness/cli.test.mjs`, `tests/arw-common/artifact-cli.test.mjs`, `tests/repository-workflow/cli.test.mjs` 的 CLI 输出和错误断言. `tests/arw-common/config.test.mjs` 保持配置拒绝边界. 本轮没有更改测试案例.
- 人工核对 #534 的调用方已为全部配置模块构造数组, #535 与 #536 的正则捕获组必选, #538 的 tracked 成功分支只能携带已读取字节, #539 的已定义事务恢复字段来自数组构造; 保留这些既有边界, 不删除实际错误处理.
- 人工核对 #541 的四个调用点, 保留同步端 Application Source Issue 过滤与记录顺序; #552, #553, #554 保留已验证选项和操作集合; #556 的三个捕获范围仅能抛出 Error; #565 用现有 isJsonObject 保留 JSON 对象拒绝结果; #551 保留允许的角色集合和对象属性描述符.

## Comments

用户授权创建本 effort 和 Issue C, 并要求自主完成提交. 初始工作树干净, 基线为 b80408f. 当前 effort 为 0089. 本轮实施身份为 issue:0089:02; 用户指定的 issue:0089:01 保留给延后的 #543.

筛选: #537, #540, #544, #549, #550, #560 涉及导出函数或适配器的 Interface, 本轮跳过. #545 删除输入拒绝会改变错误结果, 跳过. #547 调整 inspect 次数会影响刷新与持久化副作用, 跳过. #546 和 #548 已由用户排除. #555 在当前代码中已不存在. #557, #558, #559, #562, #563, #564 涉及输出或错误行为, 跳过. #561 改变打印读取的数据来源及读取失败结果, 跳过. #551 保留字段校验中的 defineProperty, 只合并角色对象的等价赋值.

#566 的分支在有效命令上不可达, 但删除会令导出函数 runArw 的推断返回类型包含 undefined, 因此按 Interface 约束跳过. #539 使用已有属性的 undefined 检查保留类型收窄, 删除重复 Array.isArray; 生产返回形状保证这些已定义属性均为数组. #541 共享相同转换, 过滤仍只在原同步调用点执行.

预计变更行数: 代码 100 行, 测试 0 行, issue 与文档 90 行. 当前实际变更行数 (新增加删除): 代码 75 行 (新增 29, 删除 46, 净增 -17), 测试 0 行; issue 与文档 90 行 (含延后事项记录), 总计 165 行, 未达到约 1000 行上限.

提交审核 prepare 的净增摘要原文:

```text
code: -17 lines (files: 5)
  lib/application-jira/application-association.mjs -1
  lib/application-jira/application-completion.mjs +1
  lib/application-jira/application-jira-cli.mjs 0
  lib/arw-common/reviewer-configuration.mjs -3
  lib/arw.mjs -14
documents: 0 characters (files: 0)
tests: 0 lines (files: 0)
next ADR number: 0041
```

该摘要的 documents 不包含 .scratch 工单记录; 本轮总变更行数另按代码, 测试和 issue 文档分别统计. 首轮 prepare 没有 warning. 0089:01 仅记录用户明确要求的后续工作, 不包含 #543 的生产改动.

复核筛选结果: #542 仅为私有 readFrozenAssociationPaths 输入的 AssociationFreezeSnapshot 类型, 没有导出或外部消费者; 删除未使用的 number 要求, 保持导出函数的参数类型不变. 第二轮将复审此项与对应范围修正.

首轮两个 Reviewer 均正常结束为 ready, 报告均为 No problems. Main Agent 抽查快照转换的过滤条件和事务失败输出, 对照现有测试与调用方, 未发现漏检. #542 补入后 pnpm typecheck 与 pnpm test 再次通过, 完整套件 906 项通过, 0 项失败.

第二轮两个 Reviewer 均正常结束为 ready, 报告均为 No problems.; 两轮 prepare 净增摘要相同. Main Agent 抽查私有类型的唯一消费者, 以及快照过滤和事务恢复输出的既有要求, 未发现漏检. 最终收尾仅修改本 issue 的记录章节, 不修改 Status, 授权范围或验收勾选.
