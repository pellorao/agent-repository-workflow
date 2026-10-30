# 发布前同步改为单步命令

Status: ready-for-agent

## What to build

按用户 2026-10-31 的决定, 实现 [spec:0016](../spec.md): `node scripts/sync-workflow-distribution.mjs` 改为无子命令的单步同步, 已知身份的终止符错误使命令 `blocked`, 未知身份作为提示输出, 同步只读 `distribution/projections/config.json`. 涉及 `scripts/sync-workflow-distribution.mjs`, `lib/workflow-distribution/workflow-distribution-sync.mjs`, `lib/arw-common/platform-adapter.mjs` 的 `analyzeSkillReferences`; 删除 `lib/workflow-distribution/skill-reference-review.mjs`. `skillReferenceNormalizations` 字段, 其安装投影处理和 `reviewEditor` 不变, 不升级配置版本.

新增 `docs/adr/0036-*.md` 取代 ADR-0034; ADR-0034 改为只说明取代关系并链接 0036; ADR-0026 Decision 中指向 ADR-0034 的括注改为指向 0036; ADR-0015 `## Rejected alternatives` 中 "当前引用审核负责确定范围外的真实引用和需要规范化的位置" 改为指向 0036.

同步更新长期文档, 每个事实只在拥有它的文档中陈述, 只改与本行为相关的句子:

- `docs/specs/agent-repository-workflow-development/spec.md`: `## Scope` 中 "Skill 引用审核"; Analysis and conversion 中终止符段的 "供审核判断", `skillReferenceNormalizations` 段 (改为说明同步不再产生该字段, 安装投影处理保留到下次配置版本升级), 候选集合段和 "分析可以递归发现候选" 段; `### Reference review` 整节改写为引用检查, 并作为 spec:0016 Main Agent judgment 程序 (提示判断, 配置修改后暂存重跑, 有提示时提交前独立 Agent 复核) 的唯一权威; Entry point and lifecycle 的封闭调用, 交接步骤, `planDigest` 段和重建范围段中 "`distribution/projections/config.json` 在重建中替换" 及 "只接受绑定同一 `planDigest` 的一次 `apply`"; State and recovery 的写入顺序, 失败位置表和恢复第 3 步; `## 设计理由` 中审核文件与 "引用审核, 计划和持久应用保持分离" 两段; Modules 中 Workflow Distribution Sync Module 的责任句; Interfaces 的 `#### Reference review and distribution sync` 整节; Seams and Adapters 中外部授权参与者与 "引用审核不依赖进程启动 Seam" 两句; Dependencies and Data Flow 的流程图审核与授权节点, 权威来源表中实际文件, 配置, 全局配置, 审核文件, 计划授权和完整字节六行; ADR Evaluation 中 ADR-0013 段 "发布前同步的授权主体见 ADR-0034" 与 ADR-0034 段; `## Validation strategy` 中引用审核入口的覆盖说明.
- `docs/specs/agent-repository-workflow-installation/spec.md`: `reviewEditor` 用途句中 "源码仓库引用审核不再打开编辑器" 改为不提已删除的审核流程.
- `CONTEXT.md` Workflow Distribution 定义中 "并经过人工审核和授权写入".
- `docs/manuals/development.md` 与 `docs/manuals/development.zh-CN.md`: 发布前同步命令清单改为单条命令并链接开发长期规格的引用检查; 维护入口表中 `scripts/sync-workflow-distribution.mjs` 的说明.
- `.agents/skills/upstream-sync/SKILL.md` 第 5 节第 3 步 "运行 ... 的各子命令" 改为运行单步命令并按开发长期规格处理提示; `.agents/skills/platform-standards/SKILL.md` `## Skill references` 中 "用户审查" 与 "两个临时逐行文件" 的段落改为引用开发长期规格; 之后运行 `node scripts/project-claude-skills.mjs` 更新 `.claude/skills/`.

验证: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0016-single-step-distribution-sync/`, `git diff --check`. 测试覆盖按 spec:0016 Testing Decisions: `analyzeSkillReferences` 对分发 Skill 与 `additionalSkillReferences` 身份的终止符错误返回 `blocked` 并列出每个位置, 四种终止符通过, 未知身份成为 `unknownReferences`; `syncWorkflowDistribution` 在输入不干净, 终止符错误和过期 `skillReferenceNormalizations` 时写入前 `blocked` 且 `distribution/` 不变, 成功时完整替换生成范围, 保留受保护路径, Projection 配置字节不变, 有未知身份时仍成功并返回来源路径的 `notices`, 删除后失败返回对应 `stage`; CLI 任何参数退出 2 且不调用同步, 成功时 `stderr` 输出提示行, `blocked` 诊断含 `path:line:column`. 删除只覆盖候选文件, 删除式校验, 哈希, `completed-review.json`, `planDigest` 与授权的测试. 新增或语义修改测试后按 `test-performance-optimization` Skill 测量回调耗时. 实施后在本仓库真实运行一次 `node scripts/sync-workflow-distribution.mjs` 确认退出 0 且 `git status -- distribution` 无变化 (当前无提示, 有提示时按新程序处理). 不安装, 不推送, 不修改 `lib/background-agent/**`.

预估非测试代码净增约 -650 行 (删除 `skill-reference-review.mjs` 约 -290, 入口约 -230, 同步模块约 -140, Platform Adapter 约 0); 测试净增约 -400 行; 文档净增约 -3000 字符 (含新 ADR).

## Acceptance criteria

- [ ] `node scripts/sync-workflow-distribution.mjs` 无参数时一次完成状态检查, 读取验证, 引用检查, 重建和双平台验证; 任何参数为用法错误退出 2; 旧子命令, 候选文件, `completed-review.json`, `planDigest` 与授权代码全部删除. 观察: 入口与模块代码差异, CLI 测试.
- [ ] 已知身份 (分发 Skill 与 `additionalSkillReferences`) 后接非终止符时命令 `blocked`, 零写入, 列出全部 `path:line:column`. 观察: Platform Adapter 与同步测试.
- [ ] 未知身份作为 `notice skill-reference-unknown ...` 行写到 `stderr`, 退出 0, 分发内容保留原文. 观察: 同步与 CLI 测试.
- [ ] 同步不写 `distribution/projections/config.json`; `skillReferenceNormalizations` 与 `reviewEditor` 的配置和安装行为不变. 观察: 同步测试与 `lib/arw-common/config.mjs`, 投影代码无差异.
- [ ] 提示判断与有提示时提交前独立 Agent 复核的程序只在开发长期规格引用检查一节陈述, 手册与 `upstream-sync` Skill 引用它, 不依赖 `arw background-agent`. 观察: 文档差异.
- [ ] ADR 0036 取代 ADR-0034, ADR-0026, ADR-0015 和开发长期规格 ADR Evaluation 指向 0036. 观察: 文档差异.
- [ ] 完整验证命令通过, 真实同步运行退出 0 且 `distribution/` 无变化. 观察: Validation 的实际命令结果.

## Blocked by

- None - can start immediately
