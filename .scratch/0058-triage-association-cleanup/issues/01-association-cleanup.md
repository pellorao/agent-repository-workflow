# 修复关联冻结解析并精简 Application 内部实现

Status: completed

## What to build

本 effort 只有本 issue, 范围以以下逐项要求为准, 合并实施. 除明确授权的 f1 外, 保持 CLI 输出, 公开 Interface 和持久状态行为不变.

- f1: 在 `lib/application-jira/application-jira-cli.mjs` 中读取关联 issue 所在 effort 目录的已提交 issue 文档, 按 effort 一起传给 `readIssueDocuments`, 解析本地兄弟阻断关系. HEAD 文档只用于确定哪些路径已经提交有效关联, 解析结果不传给 Association Interface, 也不参与阻断投射. 继续以当前 inventory 快照形成关联替换. 两侧仅按相同仓库相对路径匹配冻结资格, 不合并 HEAD 与当前记录. 这是恢复既有 HEAD 冻结规则所需的解析上下文, 不是更换阻断投射的数据源. 冻结集合仍只包含已关联 issue, 不冻结未关联兄弟或其他 effort.
- F2: 在 `tests/uninstall-entry.test.mjs` 注入交互输入, 验证多次提问只创建一次 readline 并由 finally 关闭, 隔离卸载逻辑或使用临时 HOME, 不执行真实卸载. 新增测试超过 80 行则跳过并记录.
- f3-1: HEAD 快照不再构造未使用的 baselines, 保留索引基线.
- f3-2: issue 路径只解析一次, 删除不可达分支和重复身份覆盖.
- f3-3: 删除五处内部文本 Map 的空串后备, 类型检查只允许局部非空断言式转换, 否则跳过该处.
- f3-4: 删除三个内部查找的不可达 throw, 类型检查只允许局部非空断言式转换, 否则跳过该处.
- f3-5: 复用已解析 issue 路径的 effort, 删除重复正则和不可达检查.
- f3-6: 删除不可达的 JIRA 同步 Git runner throw, 保持其他命令不创建 Git runner.
- f3-7: 在 `lib/application-jira/application-completion.mjs` 删除已验证 URL 的重复 try/catch.
- f3-9: 在 `lib/application-jira/application-association.mjs` 合并相同的关联过滤和坐标解析遍历.
- L2: 复用现有 Canonical ID 解析和格式化能力来减少本地与限定坐标转换重复; 如需改变公开 Interface 则跳过并记录.
- L4: 将解析器保证存在的 blockerRecords, title, number 类型标为必填, 删除冗余后备判断.

体积预算: 非测试代码净增不超过 0 行. 预计改动行数 (新增加删除): 代码 170, 测试 90, issue 文本 50, Spec Readiness 生成 JSON 190, 合计约 500. 若估算超过 600 行先移除 L2, 不为凑数添加内容.

## Acceptance criteria

- [x] `tests/application-jira/cli.test.mjs` 断言 f1: 已提交且含本地兄弟阻断项的关联 issue 保持冻结; 未提交且含本地兄弟阻断项的关联 issue 仍将匹配的 External dependency 归一化为本地 issue 编号, 未关联兄弟不进入冻结集合, 无关联 effort 不影响解析.
- [x] `tests/uninstall-entry.test.mjs` 断言 F2: 测试隔离真实卸载, 多次提问复用 readline, 正常或异常结束均关闭; 超过 80 行时记录跳过原因.
- [x] `git diff` 核对其余完成项保持既有成功, 失败, 输出和恢复行为, 不扩展公开 Interface; 不满足条件的项逐条记录跳过原因.
- [x] `node --test --test-reporter=tap tests/application-jira/*.test.mjs tests/uninstall-entry.test.mjs` 通过, 新增或语义修改回调实测不超过 100 毫秒.
- [x] 按 `docs/agents/source-checkout-validation.md` 命令清单完成完整 Source Checkout 验证: pnpm test, pnpm typecheck, 三个分发检查脚本, 受影响文件 node --check, text check, terms check, git diff --check.
- [x] 通过 `node arw.mjs spec-readiness verify --issue issue:0058:01` 的一次整体 Spec Readiness 流程与正常 Commit Audit 两个内置 Reviewer 的关卡均满足, 完成记录给出代码, 测试, issue 文本实际改动行数, 单列生成 JSON 行数.

## Blocked by

- None

## Validation

- f1: `tests/application-jira/cli.test.mjs` 的新增冻结回归用例通过, 观察已提交关联保持原字节, 含兄弟阻断项的未提交关联仍归一化, HEAD 未关联的兄弟未被冻结, 无关联 effort 的无效 HEAD 文档不影响命令. 同时核对索引没有被关联命令改写.
- F2: `tests/uninstall-entry.test.mjs` 的取消和 EOF 路径通过, 注入迭代输入, 临时 HOME, 每轮只创建一次并准确关闭一次, 新增 50 行, 不执行真实卸载.
- `node --test --test-isolation=none --test-reporter=tap` 定向测量: f1 有效文档 67.12 毫秒, 无效 HEAD UTF-8 35.45 毫秒, F2 7.14 毫秒, 调整必填字段的 9 个 Association 回调最高 2.46 毫秒, 均低于 100 毫秒. 测量日志位于本会话 issue 工作区.
- `pnpm test` 在允许本地监听的环境通过, 870 项通过, 0 失败; 沙盒首次运行因本地 HTTP 的 listen EPERM 失败, 不作为有效通过结果.
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 均通过.
- 六个受影响 JavaScript 文件的 `node --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0058-triage-association-cleanup/`, `git diff --check` 通过. 文档语言检查符合中文正文约定.
- 整体 Spec Readiness 第二轮为 No problems., 已提升 satisfied 记录并在实施前完整 verify 通过. 抽查 HEAD 冻结依据与解析器必填字段保证.
- 预计改动为代码 170, 测试 90, issue 文本 50, JSON 190 行. 当前代码 148, 测试 134 行; 就绪 JSON 单列 56 行. issue 文本为 56 行, 非生成内容合计 338 行, 含 JSON 总计 394 行. 低于估算主要因为生成 JSON 从预计 190 行缩至 56 行, 不为凑数扩充交付. 代码净减 32 行, 满足净增 0 行预算.
- Commit Audit 第二轮两轴均为 No problems., Gate 1 覆盖本 issue, Gate 2 无治理文档变更. Main Agent 独立回归抽查 f1 冻结集合与原有 Application 同步的索引关联保护及事务恢复基线, 未发现漏检. 完成标记调整后第三轮要求符合复核为 No problems., Code Standards 结论按完成记录规则复用.

## Comments

- 用户明确授权创建本 effort 和唯一 issue, 自主实施与提交; 本会话再次确认 f1 行为修复例外. 不启动普通 subagent, 只运行 ARW Reviewer.
- 基线为干净的已提交工作树, 新 issue 创建前不存在; 写入范围为本 issue, 就绪记录, Application 三个实现文件, 必要的 lib/arw.mjs 和对应测试.
- 第一轮就绪问题处置: 补充 issue 解析器和 inventory 的实现证据, 明确 HEAD 文档仅供冻结资格解析, 不流入 Association 的阻断投射; 补充未提交且含本地兄弟阻断项的归一化观察. 不改变已有 Association Interface 或长期规范.
- L2: 完成内部 qualifyIssueId 的不可达检查删除; 跳过 lib/arw.mjs 的坐标解析合并, 因复用返回 null 的解析器会把无效参数原有 Canonical ID 诊断改成另一条 CLI 诊断. 不创建新公开 Interface 来绕过该限制. 其他确认项已完成, 无额外范围.
- 提交审核第一轮 Code Standards 问题已核实并修复: f1 新读入的 HEAD 兄弟文档以严格 UTF-8 解码, 解码失败沿用现有已提交输入读取失败结果, 在任何替换前退出. 新用例验证错误诊断和 Module 与 Application 零写入. 该修正属于 f1 的新读取边界, 其余清理项保持原行为.
- 要求符合审核首轮仅指出实际 issue 文本行数和总数缺失, 已按本轮准确候选补齐. 提交审核第二轮两轴均通过; 修正后的完整套件为 870 项通过, 0 失败.
