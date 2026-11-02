# 剩余代码清理与局部故障修复

Status: completed

## What to build

按用户 2026-11-02 确认的约 1000 变更行实验, 合并 issue:0022:13 到 issue:0022:22 及 B1-B7 为本 issue. 保留原 issue 身份, 14-22 以 wontfix 记录合并. issue 12 仅补记早于重分组, 不重做实现. 本 issue 统一运行 Spec Readiness, 不使用行为保持重构例外.

- H66: 使用 entries 获取输入角色.
- H67: 直接返回 setup 失败结果.
- H68: 以 scratch 本身记录清理目标.
- H69: 同一文本先校验散列再解析.
- H70: spill 解码和散列复用一次读取字节.
- H71: refresh 使用具名 allowCompletion 选项.
- H72: 合并 observe 结果并内联 identityResult.
- H73: 合并延迟绑定 entry 的原生回调.
- H74: 合并任务测量回调.
- H75: 删除已知 Error 的不可达后备.
- H76: 复用 knownNumber.
- H77: 移除 phase 常量参数.
- H78: 移除多余过滤回调类型.
- H79: 删除 uninstall.mjs 中固定 decision 集合的守卫, 不改 pool override 的 DECISION.test.
- H80: 按 decision 查找询问文字.
- H6: 共享 jira-client.mjs 和 jira-convergence-adapter.mjs 的 JIRA 无效响应构造.
- H10: 展开 Codex 字节选择分支.
- H12: 共享 Git 文本执行且保留各调用处 trim.
- H16: 共享换行标准化并保留旧导出.
- H32: 共享 URL 附加部分谓词.
- H33: common/document-language.mjs 的 BodyFlow 及 document-language-inspection.mjs 的正文流输入仅保留 text, 保留 body 筛选; 不涉及 JIRA 响应正文.
- H34: 共享文件系统 diagnostic.
- H36: 共享 logicalPath.
- H45: 共享诊断消息连接.
- H57: workflow.mjs 内共享前置元数据结束定位, 保留 frontmatterBytes, demoteCodeMap 和 codeMapIdentity 各自的字节或字符索引与缺失分隔符行为.
- H59: 静态加载 readline 并使用 process.
- B1: 迁移检查标准化旧 spec 换行.
- B2: 缺失 blob 返回既有读取失败诊断.
- B3: 普通候选 blob 缺失时失败, gitlink 保持 null.
- B4: 枚举不可表示的反斜杠文件名返回 failed.
- B5: 跳过: 本地与正式来源的错误分类和消息不同.
- B6: 入口比较真实路径, 支持符号链接.
- B7: 按需创建 readline 并在 finally 关闭.

共享能力保持现有模块责任与依赖方向: runGitText(git, argv, label) 位于 common/git-process.mjs, 返回未 trim 的 UTF-8 stdout, 非成功时保留 label 与 trim 后 stderr; normalizeText 位于 common/text-policy.mjs, 仅把 CRLF 和 CR 转为 LF, 不剥离 BOM, issue-documents.mjs 保留旧导出. hasNoUrlExtras 位于 common/url.mjs, 只判断 userinfo, query 和 fragment; diagnosticMessages 位于 common/diagnostics.mjs, 保持消息顺序并以空格连接. 两个新文件登记在 release-manifest.json. diagnostic 和 logicalPath 从现有 filesystem.mjs 导出. JIRA 客户端导出 invalidJiraResponse(message), 现有调用传原消息. 不新增 Module, Adapter, 状态格式或外部命令, 所有共享操作无持久副作用.

前置元数据定位在 workflow.mjs 内使用 Buffer 或字符串各自的 indexOf, 保留字节和字符索引, 缺失开始或结束分隔符的各调用方行为保持原样. 原生通知回调通过 getter 读取延迟绑定 entry, 不捕获初始空值; 测量回调继续实时读取同一记录和时钟. H69 校验不符时优先返回现有 PoolError, 即使文本同时为无效 JSON. H70 保留缺失与 I/O 失败分类, 记录散列绑定实际解码字节.

B1 的迁移 Module Design 检查接受 LF, CRLF 和 CR; B2 缺失 spec 或 issue blob 返回 failed, stage 为 tree-read, 使用现有 committed-effort-read-failed 诊断, 无效 UTF-8 仍是 blocked/committed-effort-input-invalid; B3 普通文件或符号链接 blob 缺失时抛出读取错误, 不把它伪装为空内容, gitlink 仍允许 null. B4 对枚举取得而规范路径不能表达的名称返回 failed/enumerate/filesystem-io-failed, 根目录和递归枚举一致. B6 比较入口和 argv 脚本的真实路径, 导入不触发命令; B7 只有发出询问时创建 readline, 通过 finally 关闭, 非交互路径不创建. 除这些明确故障修复外, CLI 输出, 原有导出, 错误结果与持久状态不变. B5 两种分类并不相同, 本轮跳过; 其他需要类型收窄级联, 新诊断码或规范变更的条目也跳过并记录.

体积预算: 非测试源码净增不超过 100 行. 逐项估算已写入 `.tmp/triage.md` 的本轮记录; 合计预计代码 379 行, 测试 172 行, issue 和文档 400 行, 共 951 变更行 (新增加删除). 这是一个合并组, 不为凑行数增加实现或测试. 审核发现原地修复, 不再拆组. 不修改 lib/background-agent/**, 不运行安装, 不 push.

预期验证: 按现有模块测试覆盖清理, 为 B1-B4, B6-B7 和散列字节绑定补充最小回归覆盖; 语义修改测试测量回调耗时不超过 100 毫秒. 完成 pnpm test, pnpm typecheck, 三个 Source Checkout 脚本, node arw.mjs text check, node arw.mjs terms check --include .scratch/0022-triage-code-backlog/, git diff --check. Reviewer 运行规则和能力场景不变, 不运行能力基准; 原生会话和工作流平台测试覆盖 Codex 和 Claude Code.

## Acceptance criteria

- [x] 通过 git diff 核对全部所列发现的实施或跳过记录, 合并身份和 issue 12 的历史说明准确.
- [x] node arw.mjs spec-readiness verify --issue issue:0022:13 通过后交付共享实现及故障修复, 通过模块测试核对上述兼容边界.
- [x] pnpm test, pnpm typecheck 及所列 Source Checkout 验证通过; 通过 git diff --numstat 核对 Validation 中的各类预计和实际变更行数. 提交审核按既有工作流在完成实现后执行.

## Blocked by

无.

## Validation

- H66-H80, H6, H10, H12, H16, H32-H34, H36, H45, H57, H59 和 B1-B4, B6-B7 均已实施. B5 的原分类和消息不同, 按约定跳过. issue 12 只补记历史, 14-22 保留身份并记录合并去向.
- 实现前完整就绪验证通过, 对应提升的请求为 41583765-7fd0-4588-ba5a-78d812390749, 独立报告为 No problems. 自查 H79 仅删除卸载固定集合守卫, pool 的 DECISION.test 保留; H57 的三个调用方仍保留各自缺失分隔符行为和索引单位.
- pnpm test: 825 项通过, 0 失败; pnpm typecheck 和所有变更 JavaScript 的 node --check 通过. 完整套件包含 Codex 和 Claude Code 的原生会话及隔离工作流测试.
- node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0022-triage-code-backlog/ 和 git diff --check 均通过.
- 新增及修改测试以 node --test --test-isolation=none --test-reporter=tap 定向测量: B1 14.35 ms, B2 2.76 ms, B3 0.93 ms, B4 2.07 ms, B6 5.34 ms, B7 6.22 ms, H69 5.56 ms, H70 20.77 ms, H33 0.87 ms. 均低于 100 ms.
- 预计变更行数 (新增加删除): 代码 379, 测试 172, issue 和文档 400, 合计 951. 实际: 代码 339, 测试 140, issue 和文档 472, 合计 951; 含 13.spec-readiness.json, 按 git diff --numstat 统计. 非测试源码净增 29 行, 低于 100 行预算.

## Comments

- 就绪审核第 1 轮 incomplete: 已核实必读规则位于 rules/.agents/skills 隐藏目录并登记于 SHA256SUMS, 原线程重审. 第 2 轮报告三项 gap: 补入 H57, H6 和 H33 的实现证据; 明确 H79 的对象是 uninstall.mjs, 与 pool override 无关, 明确 H33 是文档语言正文流. 未修改治理规范或 Reviewer 规则. prepare 的相对引用警告已核对: ADR 和 strata.md 真实存在; distribution/manifest.json 是既有规范提及的旧路径, 本轮不改变或依赖该路径.
- 提交审核第 1 轮: 要求符合审核报告 No problems.; Code Standards 指出 B2 读取阶段确认完整 Map 后仍有两处不可达缺失检查. 独立核实后删除重复分支, 保留 tree-read 分类和 UTF-8 解码失败分类, 原地复审. 抽查 H57 保留索引单位与缺失分隔符行为, H79 保留 pool override 的 DECISION.test.
- 提交审核第 2 轮: 要求符合审核 (含 Gate 1 和 Gate 2) 与 Code Standards 均正常 ready, 完整报告均为 No problems. 独立回归抽查 B2 无效 UTF-8 仍由原 catch 返回 blocked/committed-effort-input-invalid, 缺失 blob 只在读取阶段失败; B6 通过符号链接执行且导入不存在的 argv 脚本时保持静默. 最终暂存树仅补充本记录和实际行数.
