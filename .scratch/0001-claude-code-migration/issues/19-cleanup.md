# 迁移遗留清理

Status: completed

## What to build

ticket 15 冒烟和审计发现的小问题:

- 长期 spec "Platform support" 一节过时 (仍写 Claude Reviewer 暂停执行).
- `arw terms check` 的 `Artifact` 术语失败, 以及 Skill 语言配置落后于已改写成中文的 Skill: 修正内容和配置; 7 篇术语密集文档的中文比例低于 80% 只作为信息性报告, 不改阈值, 内容也不为凑比例改写.
- `arw lba` 的 Main 标题取到注入的 "# AGENTS.md instructions for …": 跳过注入指令, 从用户消息取标题.
- 从源码运行需要手放 `config.json`: 源码运行时缺省使用默认值.
- ARW 管理进程中写死的 Strata 窗口 156584 和压缩点 100000 (`lib/background-agent/strata-models.mjs`, `strata-work-policy.mjs`) 改为 206584 / 150000 (只改数值, 摘要组合机制保持不变), 与 `qwen_strata` 2026-10-24 定的部署默认档一致 (用户 2026-10-26 确认).

预估改动: 约 60 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#document-terms`
- `docs/specs/agent-repository-workflow/spec.md#background-agent-listing`
- `docs/specs/agent-repository-workflow/spec.md#platform-support`
- `docs/specs/agent-repository-workflow/strata.md#runtime-parameters`
- `docs/specs/agent-repository-workflow/strata.md#compaction-support`
- `docs/specs/agent-repository-workflow-installation/spec.md#global-engine-configuration`

## Acceptance criteria

- [x] 上述各项修复, `arw terms check` 在本仓库通过; `arw lba` 跳过 `# AGENTS.md instructions for` 开头的注入消息取标题; 缺 `config.json` 时源码入口使用 `config.install.json`.
- [x] 长期规格同步: `Platform support` 一节反映两个平台的 Reviewer 都可执行; `background-agent-listing` 说明标题跳过注入的仓库指令; 安装规格 `Global Engine configuration` 说明源码入口的默认值; `strata.md` 的窗口与压缩点为 206584 和 150000.
- [x] 全量测试和分发检查通过.

## Blocked by

- issue:0001:15

## Validation

- `pnpm test`: 701 项, 700 通过, 1 跳过, 0 失败 (含新增的 `config.install.json` 缺省测试和 `# AGENTS.md instructions for` 标题测试). `pnpm typecheck` 无输出通过. `node scripts/check-workflow-distribution.mjs` 通过. `arw text check` 通过.
- 验收 1: `arw terms check` 与 `--strict` 退出码均为 0; `node arw.mjs lba` 在没有 `config.json` 的源码目录运行成功; 标题测试覆盖跳过注入消息.
- 验收 2: `spec.md` Platform support, `background-agent-listing`, 安装规格 `Global Engine configuration`, `strata.md` 的窗口与压缩点均已同步.
- 验收 3: 见上, 全量测试与分发检查通过.

## Comments

- 本 ticket 同时处理了 ticket 10 和 11 的记录: 两者 Status 都改为 `ready-for-human`. 11 剩一项需要用户实跑 `$upstream-sync`; 10 的 4 项验收均已勾选, 但它没有 Spec Readiness 记录且 `## Spec Requirement` 格式不合要求 (列表后有说明文字), 无法通过 Commit Audit 的新终态授权, 如何正式关闭由用户决定 (见 ticket 10 的 `## Comments`). 这两项是跟踪记录修正, 不在本 ticket 审核对象内 (Spec Readiness 第 4 轮指出长期规格没有规定它们的状态条件, 因此从 What to build 移出).
- 过程偏差 (协调者已接受): 先改了实现文件, 后跑 Spec Readiness, 违反 `implement` Entry 顺序. 原因是 Claude Reviewer 额度门禁曾暂停, 改动本身与审核结论无关.
- Spec Readiness 共 8 轮 (haiku high): 前几轮指出 `## Spec Requirement` 原先只引用迁移顺序一节, 没有覆盖交付内容, 已改为引用长期规格各节, 并把长期规格的同步写入验收条件; 之后对引用范围反复摇摆 (去掉安装规格得 "缺输入", 加入得 "既有 `backgroundAgent` 缺理由"). 后一问题按质疑规则指出它与本 issue 交付无关, 随后得到 `No problems.`.
- 7 篇术语密集文档 (ADR 0001, 0003, 0004, 0012, 0032, application-jira 规格, `upstream/sources/mattpocock-skills/adoptions.md`) 的中文比例仍为 69.6% 至 75%, `arw terms check` 只报告不失败, 由 ticket 20 取消语言门槛, 不再需要.
- 解析器对 Blocked by 的报错指出文件和值, 不含行号, 保持现状.

