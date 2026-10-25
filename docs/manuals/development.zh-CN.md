# ARW 开发者手册

[English](development.md) | [简体中文](development.zh-CN.md)

这份手册面向已经克隆 ARW 源码仓库, 准备修改实现, 文档, 工作流分发载荷或发布候选的维护者. 使用 ARW 管理其他 Git 仓库时, 从 [根 README](../../README.zh-CN.md) 开始. 本手册只负责选择源码维护路线, 找到验证入口和按责任导航代码. 稳定产品行为由 [长期规格](../specs/agent-repository-workflow/spec.md) 及其引用的专门规格拥有, Agent 的具体操作要求由根 [AGENTS.md](../../AGENTS.md) 和 [docs/agents 规则](../agents/) 拥有.

## 选择源码维护路线

先根据要改变的权威来源和最终结果选择路线. 不要从某个熟悉的脚本出发, 再反推它是否适合当前任务.

ARW Artifact 指 `.scratch` 中登记的 issue, map 和 spec 工作记录. Spec Readiness 是实施前的治理准备审核. Commit Audit 是对冻结提交候选的最终要求核对. 后文继续使用这些准确名称.

| 目标 | 进入路线 | 主要权威来源 |
| --- | --- | --- |
| 修改公开命令, 安装, 仓库工作流, ARW Artifact 或其他正式运行行为 | [修改产品实现](#修改产品实现) | 适用长期规格, ADR 和实施 issue |
| 修改读者文档, Agent 文档或术语 | [文档和术语检查](#文档和术语检查) | 目标文档, 写作规则和适用治理来源 |
| 修改引导脚本或安装载荷 | [引导脚本和 Installation](#引导脚本和-installation) | 安装长期规格和清单 |
| 修改跨仓库共用的后台 Agent 运行, App Server 容量或恢复 | [修改产品实现](#修改产品实现) | 产品后台 Agent 规则与安装管理规则 |
| 修改共享工作流或平台投射 | [Workflow Distribution 和 Platform Projection](#workflow-distribution-和-platform-projection) | 实际工作流文件, 分发配置和开发长期规格 |
| 采用外部 Skill Package 更新 | [Upstream Sync](#upstream-sync) | 来源配置和 `$upstream-sync` Skill |
| 修改 Reviewer Role, 独立运行或验证 Reviewer 能力 | [Reviewer 配置和能力验证](#reviewer-配置和能力验证) | 规范 Role, 用户配置和 Reviewer 能力规则 |
| 验证跨操作系统安装或维护受验环境 | [跨操作系统验证环境](#跨操作系统验证环境) | 活动 issue 和 `$release` Skill |
| 准备首次 GitHub 源码迁移 | [首次 GitHub 迁移](#首次-github-源码迁移) | 已批准的迁移说明和最新源码文件快照 |
| 验证并发布稳定版本 | [稳定版本发布](#稳定版本发布) | 发布长期规格和 `$release` Skill |

Agent 执行工作时从根 `AGENTS.md` 进入适用规则. 本手册只帮助维护者选择内容路线, 不说明 Agent 工作流. 如果一个任务横跨多条路线, 先分别找到各自的权威来源和操作入口.

## 修改产品实现

产品实现路线适用于 JavaScript 正式运行行为. 先从适用长期规格找到拥有该行为的 Module 和公开 Interface, 再进入对应源码与测试责任.

### 准备开发环境

项目使用原生 JavaScript, ES Modules, Node.js 内置 Module, `node:test` 和 `node:sqlite`. Node.js 24 是最低运行版本. 产品没有第三方运行时依赖. 源码仓库使用 pnpm 11 管理 TypeScript 和 Node.js 24 类型声明这两项开发依赖.

在仓库根目录准备并检查开发基线:

```text
node --version
npx get-pnpm
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

`pnpm typecheck` 对受 Git 管理的 `.mjs` 执行完整严格检查且不生成文件. `pnpm test` 运行 Node.js 内置测试套件. 需要逐项显示同一测试集合时使用 `pnpm test:verbose`, 不需要把两种模式重复运行.

### 找到实现责任

先在适用长期规格中找到拥有行为的 Module 或 Interface, 再进入对应目录. 根入口负责解析和连接, 具体业务规则通常位于按长期责任命名的 `lib/<responsibility>/` 中.

| 修改目标 | 首要导航 |
| --- | --- |
| 公开 CLI 路由和最近 Git 仓库发现 | 根 `arw.mjs`, `lib/arw.mjs`, `lib/common/repository.mjs` 和 `lib/arw-common/repository.mjs` |
| ARW Artifact, issue 文档和迁移 | `lib/arw-common/`, `lib/artifact-migration/` |
| Spec Readiness 或 Commit Audit | `lib/spec-readiness/`, `lib/commit-audit/` |
| 跨调用方后台 Agent 控制与 App Server 共享容量 | `lib/background-agent/`, `tests/background-agent/`, [产品后台 Agent 规则](../specs/agent-repository-workflow/spec.md#background-agent-control) 和 [安装管理规则](../specs/agent-repository-workflow-installation/spec.md#background-agent-management) |
| Reviewer 专属角色, 审核及报告运行 | `lib/reviewer-runtime/` 与 [Reviewer 工作流](../specs/agent-repository-workflow/spec.md#reviewer-workflow) |
| 仓库工作流和工作流分发载荷 | `lib/repository-workflow/`, `lib/workflow-distribution/` |
| 安装, 引导脚本和卸载 | 根 `install.mjs`, `uninstall.mjs`, `lib/installation/` |
| 平台投射和平台环境 | `lib/arw-common/platform-adapter.mjs`, `lib/arw-common/platform-environment.mjs` |
| 源码仓库发布和 Reviewer 能力 | `lib/release/` |
| 文本, 术语和语言分析 | `lib/document-terms/`, `lib/common/`, `lib/arw-common/` 中对应公共能力 |

测试按同一长期责任在 `tests/` 下组织. 先选择能够观察公开结果的最近测试边界, 不依赖一次性 issue 名称或私有辅助程序结构来定义长期行为.

### 进入验证流程

源码仓库验证入口由 [验证规则](../../.agents/skills/validation/SKILL.md) 和 [源码仓库确定性验证](../agents/source-checkout-validation.md) 拥有. 常用命令名称包括:

```text
pnpm typecheck
pnpm test
node scripts/check-workflow-distribution.mjs
node --check <changed-javascript-file>
node arw.mjs text check
node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/
git diff --check
```

各命令何时适用以及怎样解释结果以链接的验证规则为准. 需要分析额外显式文档路径时, 可使用 `node arw.mjs language inspect <repository-relative-path>...`.

## 维护源码仓库内容

维护路线处理源码仓库拥有的文档, 工作流来源, 平台投射, 外部来源采用和发布准备. 各三级章节只说明适用场景, 责任来源和起始入口. 完整操作方法由链接的长期规格和 Agent 规则拥有.

### 文档和术语检查

维护读者文档, Agent 文档, 长期规格或术语时使用这条路线. 内容由目标文档及适用治理来源拥有, 写作与验证入口是 [写作规则](../agents/writing.md) 和 [验证规则](../../.agents/skills/validation/SKILL.md). 读者文档另由 [读者文档规范](../specs/arw-reader-documentation/spec.md) 说明文档分工.

常用检查命令是:

```text
node arw.mjs text check
node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/
node arw.mjs language inspect <repository-relative-path>...
git diff --check -- <changed-path>...
```

准确检查范围和结果解释由验证规则负责.

### 引导脚本和 Installation

维护可单独下载的引导脚本, 安装载荷, 全局配置或卸载入口时使用这条路线. 行为与载荷责任由 [安装长期规格](../specs/agent-repository-workflow-installation/spec.md) 拥有, 源码与派生文件关系由 [开发长期规格](../specs/agent-repository-workflow-development/spec.md) 拥有.

引导脚本的生成和核对入口是:

```text
node scripts/generate-install-arw.mjs
node scripts/generate-install-arw.mjs --check
```

从克隆的源码仓库运行安装入口使用 `node install.mjs`. ARW 安装目录中的卸载入口使用 `node uninstall.mjs`.

公开 GitHub 仓库为 [pellorao/agent-repository-workflow](https://github.com/pellorao/agent-repository-workflow). 初始发布时没有稳定 tag. 当前源码安装路线是克隆 `main` 分支, 然后在检出根目录运行 `node install.mjs`; 这条路线要求外部 Node.js 和 Git, 使用本地来源模式和 `<version>-pre` 身份. 单独下载的 Bootstrap 要求稳定 tag, 没有 tag 时会失败, 不会回退到 `main`. 在出现稳定版本前, 不要把 Bootstrap 安装描述为当前可用路线.

### Workflow Distribution 和 Platform Projection

修改实际共享工作流内容, 分发配置, 平台投射或平台原生种子时使用这条路线. 源码仓库实际使用的 `.agents/skills/`, 受管理的 Agent 文档区域, 规范 Role 和固定许可证文件是内容来源. `distribution/` 是发布前同步形成的安装载荷. 完整责任关系由 [开发长期规格](../specs/agent-repository-workflow-development/spec.md) 拥有, 平台格式与目标入口由 [平台标准](../../.agents/skills/platform-standards/SKILL.md) 说明.

发布前同步和生产检查使用这些命令名称:

```text
node scripts/sync-workflow-distribution.mjs review
node scripts/sync-workflow-distribution.mjs review --confirm <additional-skill-references-hash> <skill-reference-normalizations-hash>
node scripts/sync-workflow-distribution.mjs prepare
node scripts/sync-workflow-distribution.mjs apply --plan-digest <plan-digest>
node scripts/check-workflow-distribution.mjs
```

这些命令的调用关系和输入以开发长期规格与平台标准为准.

### Upstream Sync

采用固定外部 Skill Package 更新时, 由维护者显式调用 [`$upstream-sync` Skill](../../.agents/skills/upstream-sync/SKILL.md). Agent 运行 `node scripts/upstream-sync.mjs <source> <full-commit-id>` 生成上游旧快照, 上游新版本和当前 `.agents/skills/` 的三方视图, 维护者逐批批准要采用的变化, 结果记录在 `upstream/sources/<source>/adoptions.md`. 工作流分发载荷由独立的发布前同步路线维护.

### Reviewer 配置和能力验证

修改规范 Reviewer Role, Reviewer 专属审核运行或 Reviewer 能力场景时使用这条路线. Role 位于 `docs/agents/roles/`, 共同执行与通信规则见 [Reviewer 责任](../agents/reviewer.md). 跨仓库共享的后台 Agent 容量, 连接和恢复由 [产品后台 Agent 规则](../specs/agent-repository-workflow/spec.md#background-agent-control) 与 [安装管理规则](../specs/agent-repository-workflow-installation/spec.md#background-agent-management) 拥有. 用户模型与档位保存在 ARW 程序目录的 `config.json` 和仓库的 `arw.config.json`, 格式及默认值见 [Reviewer 配置规格](../specs/agent-repository-workflow-installation/spec.md#reviewer-configuration). 能力场景的维护入口见 [Reviewer 能力验证](../agents/reviewer-capability-validation.md).

Reviewer 能力维护的定向准备, 结果验证和发布准备使用这些命令名称:

```text
node scripts/reviewer-capability-conformance.mjs prepare --reviewer <identity>
node scripts/reviewer-capability-conformance.mjs verify --prepared <prepared-path> --input <artifacts-path>
node scripts/reviewer-capability-conformance.mjs prepare
```

命令模式和输入由 Reviewer 能力验证的分阶段文档负责.

### 跨操作系统验证环境

需要证明安装, PATH 登记和 `arw workflow init` 在真实 Windows 与 Linux 系统中可用时使用这条路线. 源码仓库专用的 `$release` Skill (`.agents/skills/release/`) 说明 VM 配置, 受验系统要求和快照纪律. `scripts/release-vm.mjs` 还原 VMware 快照, 经 SSH 传入候选 Git bundle, 在 guest 中运行 `scripts/release-guest-check.mjs`, 结束后再次还原快照.

### 首次 GitHub 源码迁移

首次迁移以最新 `master` 文件快照和已批准的本地修改为基础, 在 GitHub 上建立没有旧提交祖先的新 `main`. 迁移不上传旧分支, tag 或 Git 历史. 用户手动导出最终快照, 创建根提交, 配置 GitHub `origin`, 只推送 `main`, 将它设为默认分支, 并核对远端文件树. 本地准备和迁移说明不代表已经推送. 实际命令应遵循针对这次迁移提供的一次性说明; 如果远端出现非预期内容, 应停止核对, 不覆盖它.

这项迁移不同于版本发布, 不会创建 tag 或 GitHub Release. [GitHub 迁移目标](https://github.com/pellorao/agent-repository-workflow)是公开仓库, 但首次源码迁移仍由用户手动执行.

### 稳定版本发布

验证或发布稳定版本时使用这条路线. Agent 只在维护者显式调用该 Skill 时执行 (Codex 中为 `$release`, Claude Code 中为 `/release`); 本地检查, VM 验证, tag, 公开 Bootstrap 检查, GitHub Release 和 tag 恢复都由该 Skill 负责. 发布合同由 [发布长期规格](../specs/agent-repository-workflow-release/spec.md) 拥有.

## 按责任导航代码

先按责任选择根入口, `scripts/` 维护入口或 `lib/` Module, 再沿导入关系和同责任测试定位细节. 目录只帮助导航, 不代替长期规格中的 Module 和 Interface 合同.

### 根目录入口

- `arw.mjs`, `arw` 和 `arw.cmd` 是从源码仓库直接运行的产品入口.
- `install.mjs` 和 `uninstall.mjs` 是从克隆检出副本运行的安装入口.
- `package.json`, `pnpm-lock.yaml` 和 `tsconfig.json` 分别保存产品版本及开发命令, 实际开发依赖树和严格 JavaScript 检查配置.
- `config.install.json`, `release-manifest.json` 和 `release-validation.json` 分别服务初始全局配置, 安装载荷和发布验证.
- `AGENTS.md` 与 `CONTEXT.md` 分别提供仓库 Agent 入口规则和持久领域词汇.

### scripts

`scripts/` 的直接子项是只供源码仓库维护者使用的入口或可下载引导脚本, 不会变成公开 `arw` 子命令.

| 入口 | 责任 |
| --- | --- |
| `scripts/check-workflow-distribution.mjs` | 验证生产工作流分发载荷和平台投射 |
| `scripts/generate-install-arw.mjs` | 生成或核对可单独下载的引导脚本 |
| `scripts/install-arw.mjs` | 可单独下载并从固定发布来源启动安装的引导脚本 |
| `scripts/release-guest-check.mjs` | 在可丢弃的受验系统中检查安装, PATH 登记, `arw workflow init` 和卸载 |
| `scripts/release-vm.mjs` | 在 VMware VM 中运行 guest 检查并还原快照 |
| `scripts/reviewer-capability-conformance.mjs` | 准备或验证 Reviewer 能力场景 |
| `scripts/sync-workflow-distribution.mjs` | 审核, 准备并应用发布前工作流分发同步 |
| `scripts/upstream-sync.mjs` | 为 `$upstream-sync` Skill 生成上游三方视图 |

### lib

`lib/` 保存正式运行实现和只服务源码仓库的维护 Module. `lib/common/` 只放与 ARW 语义无关的公共能力. `lib/arw-common/` 放依赖 ARW 语义且由多个业务范围复用的公共能力. 其他 `lib/<responsibility>/` 目录拥有具体业务责任.

依赖方向是具体业务实现可以依赖 `lib/arw-common/` 和 `lib/common/`, `lib/arw-common/` 可以依赖 `lib/common/`, 而 `lib/common/` 不依赖 ARW 语义或其他 `lib/` 实现. 根级 `lib/` 文件只连接多个责任. 不要为每个目录自动增加 `index.mjs`, 转发层或新的 Module Interface.

### 主要目录

- `.agents/skills/` 保存源码仓库实际使用并维护的 Skill Package.
- `distribution/` 保存发布前同步产生并审核的工作流分发安装载荷.
- `docs/specs/` 保存长期产品行为, `docs/adr/` 保存难以撤销的决定, `docs/agents/` 保存 Agent 工作规则, `docs/manuals/` 保存 Human 读者指南.
- `tests/` 按 `lib/` 的长期责任组织, 根级测试只覆盖根连接和跨责任不变量, `tests/helpers/` 与 `tests/fixtures/` 保存共享测试基础设施.
- `.scratch/` 保存 ARW Artifact 和完成证据, 不是 Engine 临时目录.
- `.tmp/` 保存当前平台和会话的短期 Engine 状态, 不保存受 Git 管理的权威数据.
- `upstream/` 保存外部来源配置和采用记录. 三方视图写在被忽略的 `.tmp/upstream-sync/`.

## 进一步阅读

- [根 README](../../README.zh-CN.md): 面向使用者的项目判断, 首次成功和主要路线.
- [Agent Repository Workflow 长期规格](../specs/agent-repository-workflow/spec.md): 公开命令, ARW Artifact, Agent CLI, Repository Workflow 和产品 Module.
- [开发长期规格](../specs/agent-repository-workflow-development/spec.md): 源码仓库布局, 工作流分发, 平台投射和公共 Module.
- [安装长期规格](../specs/agent-repository-workflow-installation/spec.md): 引导脚本, 安装, 全局配置, PATH 和卸载.
- [发布长期规格](../specs/agent-repository-workflow-release/spec.md): 发布候选, Reviewer 能力, VM 验证, 标签和外部写入.
- [读者文档规范](../specs/arw-reader-documentation/spec.md): README 与全部手册的读者目标和责任边界.
- [验证规则](../../.agents/skills/validation/SKILL.md): 当前 Agent 验证责任和文档检查.
- [源码仓库确定性验证](../agents/source-checkout-validation.md): 当前完整验证入口和覆盖路由.
- [提交规则](../../.agents/skills/commit/SKILL.md): 用户请求提交后的范围, 审核和 Commit Audit 流程.
