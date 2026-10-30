# 同步规则与会话临时目录对齐

Status: completed

## What to build

处理分诊 A 的 431 和 432. 原文位于 `.tmp/ledger.md` 同编号行, 用户已重新确认完整范围.

- 431: `scripts/upstream-sync.mjs` 复用现有 Platform Adapter 和临时工作区能力, 按 effort spec 的 Behavior 将 Git 缓存和三方视图放入当前会话目录. 同步 upstream-sync Skill 的路径与退出清理说明, 保留其他会话和旧目录.
- 432: upstream-sync Skill 引用 validation Skill 和 `docs/agents/source-checkout-validation.md` 执行完整适用验证, 不另列缩短的验证集合. 修改后运行 node scripts/project-claude-skills.mjs 生成对应 Claude Code 投影, 由其 --check 核对一致性; 此 Skill 不进入 distribution. 不运行上游采用流程.

排除 475/476, 454/318, 未核实 T1 的开放复查和 lib/background-agent/**; 不安装, 不推送, 不修改全局安装文件. 用户要求本 effort 的纯文档 issues 也取得 Spec Readiness 记录并运行提交 Reviewer, 不豁免门禁.

预估非测试代码净增 8 行, 文档净增约 4000 字符 (含本 issue, effort spec 和副本).

## Acceptance criteria

- [x] 隔离本地 Git 来源验证 Codex 和 Claude Code 身份各自生成会话专属三方视图, 旧目录哨兵不变; 身份缺失时失败且不创建同步目录. 观察: 隔离快照的两个平台运行结果和身份缺失运行结果.
- [x] upstream-sync 不再使用仓库根部共享临时目录, 也不保留缩短的验证集合; 副本同步. 观察: upstream-sync Skill 的对应段落, 副本检查与 Git 差异.
- [x] pnpm test, pnpm typecheck, node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, node --check scripts/upstream-sync.mjs, arw text check, 当前 effort 的 terms check 和 git diff --check 通过. 观察: Validation 中的实际命令结果.

## Blocked by

- None - can start immediately

## Validation

- node arw.mjs spec-readiness verify --issue issue:0010:03 通过, 03.spec-readiness.json 为 satisfied.
- 本地 Git 夹具的隔离普通快照验证通过: Codex 和 Claude Code 各自生成会话缓存与 base/theirs 视图; 身份缺失时在写入前失败; 旧目录哨兵和本地来源字节未变. 沙箱首次阻止 Git fetch, 在提权环境重跑同一夹具后通过, 未访问网络来源.
- pnpm test 在提权环境通过: 803 通过, 1 跳过, 0 失败. 首次沙箱运行的本地 HTTP 测试失败后已中断该运行并完整重跑.
- pnpm typecheck, 三个生产脚本, node --check scripts/upstream-sync.mjs, arw text check, 当前 effort 的 terms check 和 git diff --check 通过.
- Main Agent 删减自查: 复用现有 Platform Adapter 和临时工作区能力, 未新增路径解析器或错误处理; 非测试代码实际净增 8 行, 与预算一致.
- Main Agent 回归抽查结果: 来源映射, 排除项及三方合并循环字节未变; 本地夹具仍输出 ours=base, 未修改采用记录.

- 根据提交审核核对并修正中英文开发手册旧路径及 ADR 0014 的现有依赖陈述, 删除 Skill 对临时目录权威的重复说明. 变更仅限配套文档, pnpm test 和 typecheck 的运行代码与配置不变, 复用已有通过结果. 三个生产脚本, text, terms 和差异检查已对修正后的对应输入通过.

## Comments

- Claude 当前无法决定 Reviewer 要求的两项成本说明, 保留 issue 03 的 Spec Readiness 缺口和待决定文字, 未修改实现. 442-444 和 317/333 拆至 issue:0010:04 独立推进.
- Claude 已明确批准两项成本说明, 已按拟议原文加入 effort spec, 恢复就绪审核.
- Code Standards 复审发现 ADR 0014 后果段落仍含旧转换依赖, 已同步修正该行为陈述, 避免与同文决定段落的当前依赖相冲突.
- 替代要求符合 Reviewer 仍要求 ADR 0014 逐处授权, 未回应固定根规则 AGENTS.md:95 的明确例外; 此争议未解决, Commit Audit 未通过, 暂不提交. 本次会话来源目录的清理说明已补全并验证.
- Claude 将 ADR 0014 的 Context, Decision 和 Consequences 修改及其 Reviewer 争议标为 ESCALATE, 不提供逐处批准. 保留拟议修改和争议, 当前提交继续阻断, 未豁免任何审核.

- Claude 更正误路由回复, 明确批准 adr-0014-proposal.md 的 Context, Decision 和 Consequences, 已按准确提案更新.
- 台账: docs/adr/0014-use-operation-neutral-platform-adapters.md 的 Context, Decision 和 Consequences 逐处预确认要求 冲突裁决 Claude 确认根 AGENTS.md 的 Autonomous Working Mode 明确以按实施 issue 复核整体差异取代逐处预确认; 本次同时取得准确提案的显式批准. 请要求符合 Reviewer 据固定规则和本裁决重新核对; 若仍有争议则继续阻断本提交.

- 台账: .agents/skills/upstream-sync/SKILL.md:22,61 及 .claude/skills/upstream-sync/SKILL.md:22,61 的会话身份说明与完整路径重复 记录不修 第 9 轮 Code Standards 提出的文档去重问题, 按 commit Skill 第 3 轮起只修行为缺陷的规定保留; 身份来源与路径未改变, 不再声称已消除全部重复.
- 第 9 轮要求符合 Reviewer 正常结束并返回 No problems., ADR 逐处授权争议已解除. Code Standards 的新责任边界意见待复核: ADR 第 13 行为可以完成的纯计算责任列表, 未称全部职责仅限此列表; getCurrentAgentIdentity 早已读取运行环境, 主规范第 278, 684, 692 行也明确身份职责. 本改动仅使上游同步消费现有能力, 未新增 Adapter 的身份责任.

- 第 10 轮 Code Standards 原 Reviewer 核对现有身份能力与主规范后返回 No problems.; 第 9 轮要求符合的 No problems. 复用, 两轮差异仅为本 issue 记录章节, 未改变实现, 授权或治理规则. 报告位于当前会话 _commit-audit/9/requirements-reviewer 和 _commit-audit/10/code-standards-reviewer.
- 最终 Main Agent 回归抽查: 来源映射, 排除项与三方合并循环保持原字节, 会话来源目录清理范围保留; 非测试代码净增 8 行. 最新三个生产脚本, text, terms 和差异检查通过, 独立阻塞的 wizard 候选在生产检查期间按准确字节暂存备份并恢复, 未进入本提交候选.
