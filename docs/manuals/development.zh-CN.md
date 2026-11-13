# ARW 开发者手册

[English](development.md) | [简体中文](development.zh-CN.md)

这份手册面向已经克隆 ARW 源码仓库, 准备修改实现, 文档, 工作流分发载荷或发布候选的维护者. 因为源码仓库同时保存了 ARW 运行时代码和将分发到用户仓库的工作流模板, 先认清哪份权威来源管辖你的改动, 哪些验证命令负责检验结果, 才能避免误改派生文件或测错层次. 如果你只是想在其他 Git 仓库中使用 ARW, 请从 [根 README](../../README.zh-CN.md) 开始.

在这里, 你可以为手头的任务选择源码维护路线, 找到实现与验证入口, 并按责任定位代码. 本手册是一份导览图, 不重复规则正文: 稳定产品行为由 [长期规格](../specs/agent-repository-workflow/spec.md) 及其引用的专门规格拥有, Agent 的具体操作要求由根 [AGENTS.md](../../AGENTS.md) 和 [docs/agents 规则](../agents/) 拥有.

## 选择源码维护路线

每次动手修改前, 先明确你要改变的最终结果以及管辖它的权威来源. 不要从某个熟悉的脚本出发, 再反推它是否适合当前任务.

以下三个名称贯穿全文的各条路线, 在本手册中始终保持准确含义:

- **ARW Artifact**: `.scratch` 中登记的 issue, map 和 spec 工作记录.
- **Spec Readiness**: 实施开始前的治理准备审核.
- **Commit Audit**: 提交完成前对冻结提交候选的最终要求核对.

对照下表, 根据你的修改目标选择进入路线和主要权威来源:

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
| 验证并发布稳定版本 | [稳定版本发布](#稳定版本发布) | 发布长期规格和 `$release` Skill |

当 Agent 在本仓库中执行工作时, 会从根 `AGENTS.md` 进入适用规则; 本手册只帮助维护者选择内容路线和操作入口, 不描述 Agent 工作流. 如果一个任务横跨表中的多条路线, 动手前先分别确认每条路线的权威来源和起始入口.

## 修改产品实现

只要改动涉及 JavaScript 正式运行行为, 就走产品实现路线. 先从适用长期规格找到拥有该行为的 Module 和公开 Interface, 接着准备好本地开发基线, 进入对应的源码与测试目录完成修改, 最后运行验证检查.

### 准备开发环境

改代码之前, 先确保本地运行时和测试基线干净可用. 项目使用原生 JavaScript, ES Modules, Node.js 内置 Module, `node:test` 和 `node:sqlite`, 最低运行版本为 Node.js 24, 没有第三方运行时依赖. 源码仓库仅使用 pnpm 11 管理两项开发依赖: TypeScript 和 Node.js 24 类型声明.

在仓库根目录依次运行以下命令, 准备并检查开发基线:

```text
node --version
npx get-pnpm
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

`pnpm typecheck` 对受 Git 管理的 `.mjs` 文件执行完整严格检查, 不会生成任何编译文件. `pnpm test` 运行 Node.js 内置测试套件; 如果需要逐条显示同一测试集合中的每个用例, 改用 `pnpm test:verbose` 即可, 不需要把两种模式重复跑一遍.

### 找到实现责任

基线通过后, 先在适用长期规格中查明哪个 Module 或 Interface 拥有你要修改的行为, 再进入对应目录. 根目录入口只负责解析参数和连接命令; 具体业务规则通常位于按长期责任命名的 `lib/<responsibility>/` 中:

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
| 源码仓库发布和 Reviewer 能力 | `lib/release/`, `lib/reviewer-capability/`, `lib/reviewer-capability-setup.mjs`, `lib/reviewer-capability-view.mjs` |
| 多仓库 Application 与 JIRA 工作流 | `lib/application-jira/` 与 [多仓库与 JIRA 手册](application-jira.zh-CN.md) |
| 文本, 术语和语言分析 | `lib/document-terms/`, `lib/common/`, `lib/arw-common/` 中对应公共能力 |

测试在 `tests/` 下按相同的长期责任对应组织. 新增或修改测试时, 选择能够直接观察公开结果的最近测试边界, 不要依赖一次性 issue 名称或私有辅助程序的结构来定义长期行为.

### 进入验证流程

改完代码和测试后, 运行验证确认改动有效. 源码仓库的验证入口由 [验证规则](../../.agents/skills/validation/SKILL.md) 和 [源码仓库确定性验证](../agents/source-checkout-validation.md) 拥有, 它们规定了何时运行哪些命令以及怎样判读结果. 常用验证命令包括:

```text
pnpm typecheck
pnpm test
node scripts/check-workflow-distribution.mjs
node scripts/project-claude-skills.mjs --check
node --check <changed-javascript-file>
node arw.mjs text check
node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/
git diff --check
```

如果还需要分析指定文档路径的语言字符比例, 运行 `node arw.mjs language inspect <repository-relative-path>...`.

## 维护源码仓库内容

并非每次修改都会触及 JavaScript 运行时行为. 你可能是在维护源码仓库拥有的文档, 同步分发给目标仓库的工作流内容与平台投射, 引入外部 Skill 更新, 或者准备发布新版本. 下面的各小节从日常文档与载荷维护一路延伸到发布验证与上线, 分别说明何时采用该路线, 哪份长期规格或 Agent 规则拥有完整操作流程, 以及从哪些命令入手.

### 文档和术语检查

当你要维护读者文档, Agent 文档, 长期规格或项目术语时, 走这条路线. 文档内容由目标文档本身及适用治理来源拥有. 动笔前先读 [写作规则](../agents/writing.md) 和 [验证规则](../../.agents/skills/validation/SKILL.md); 如果修改的是读者手册或根 README, 还要查看 [读者文档规范](../specs/arw-reader-documentation/spec.md) 了解各份读者文档的分工.

改完文档后, 使用以下常用检查命令验证:

```text
node arw.mjs text check
node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/
node arw.mjs language inspect <repository-relative-path>...
git diff --check -- <changed-path>...
```

具体的检查范围和结果判读以验证规则为准.

### 引导脚本和 Installation

当改动涉及用户如何安装或卸载 ARW (包括可单独下载的引导脚本, 安装载荷, 初始全局配置或卸载入口) 时, 采用这条路线. 安装行为与载荷责任由 [安装长期规格](../specs/agent-repository-workflow-installation/spec.md) 拥有, 源码文件与派生文件的对应关系由 [开发长期规格](../specs/agent-repository-workflow-development/spec.md) 拥有.

由于可单独下载的引导脚本由源码生成, 修改后使用以下命令重新生成并核对:

```text
node scripts/generate-install-arw.mjs
node scripts/generate-install-arw.mjs --check
```

如果要直接从克隆的源码仓库测试安装, 在检出根目录运行 `node install.mjs`; 测试卸载则在 ARW 安装目录中运行 `node uninstall.mjs`.

注意区分两条安装路线: 普通用户从公开 GitHub 仓库 ([pellorao/agent-repository-workflow](https://github.com/pellorao/agent-repository-workflow)) 单独下载 Bootstrap 脚本来安装稳定版本, 它会从 GitHub release 下载 `arw.tar.gz`, 不会回退到 `main`; 而维护者和开发者克隆 `main` 分支后在检出根目录运行 `node install.mjs`, 则属于本地来源模式, 需要外部 Node.js 和 Git, 安装身份记为 `<version>-pre`.

### Workflow Distribution 和 Platform Projection

如果你修改了实际共享的工作流内容, 分发配置, 平台投射或平台原生种子文件, 就需要同步更新工作流分发载荷. 在源码仓库中, `.agents/skills/`, 受管理的 Agent 文档区域, 规范 Role 和固定许可证文件是编写来源, 而 `distribution/` 是发布前同步生成的安装载荷. 两者之间的完整责任关系由 [开发长期规格](../specs/agent-repository-workflow-development/spec.md) 拥有, 各平台的目标格式与入口由 [平台标准](../../.agents/skills/platform-standards/SKILL.md) 说明.

使用以下命令完成发布前同步和生产检查:

```text
node scripts/sync-workflow-distribution.mjs
node scripts/check-workflow-distribution.mjs
```

同步命令不带参数. 这两个命令读取哪些输入以开发长期规格和平台标准为准, 同步过程中所发提示的处理方式见开发长期规格的 [Reference check](../specs/agent-repository-workflow-development/spec.md#reference-check).

### Upstream Sync

`.agents/skills/` 中的一部分 Skill 来自外部 Skill Package. 当需要引入固定外部来源的新版本时, 由维护者显式调用 [`$upstream-sync` Skill](../../.agents/skills/upstream-sync/SKILL.md). Agent 会运行 `node scripts/upstream-sync.mjs <source> <full-commit-id>`, 生成上游旧快照, 上游新版本和当前 `.agents/skills/` 的三方视图; 维护者逐批审核并批准要采用的变化后, 结果会记录在 `upstream/sources/<source>/adoptions.md` 中. (把采用后的改动同步到 `distribution/` 载荷, 仍走上一节独立的发布前同步路线.)

### Reviewer 配置和能力验证

当你修改规范 Reviewer Role, Reviewer 专属审核运行逻辑或用于检验审核质量的基准场景时, 需要走这条路线验证 Reviewer 能力. 规范 Role 位于 `docs/agents/roles/`, 共同执行与通信规则见 [Reviewer 责任](../agents/reviewer.md). 跨仓库共享的后台 Agent 容量, 连接和恢复由 [产品后台 Agent 规则](../specs/agent-repository-workflow/spec.md#background-agent-control) 与 [安装管理规则](../specs/agent-repository-workflow-installation/spec.md#background-agent-management) 拥有; 用户模型与档位设置保存在 ARW 程序目录的 `config.json` 和仓库的 `arw.config.json` 中, 其格式及默认值见 [Reviewer 配置规格](../specs/agent-repository-workflow-installation/spec.md#reviewer-configuration).

运行能力测试时, 由维护者显式调用源码专用的 `$reviewer-capability` Skill. 测试场景 (物化后的夹具, 答案键, 盲裁 brief 与锚点, 来自 qwen_strata benchmark v2) 保存在 `tests/fixtures/reviewer-capability/` 中. 该 Skill 会调用以下三组命令, 每组命令都输出 JSON, 成功退出 `0`, 被阻断或失败退出 `1`, 用法错误退出 `2`:

```text
node scripts/reviewer-capability.mjs setup <scenario-directory> <new-target-directory>
node scripts/reviewer-capability.mjs score <scenario-directory> <report> [--instance ID] [--decisions FILE]
node scripts/reviewer-capability.mjs pool build|prompt|split|override ...
```

### 跨操作系统验证环境

仅靠本机单元测试无法证明安装程序, PATH 登记和 `arw workflow init` 在干净的真实操作系统上都能正常工作. 要在真实 Windows 与 Linux 系统中完成端到端验证, 使用源码仓库专用的 `$release` Skill (`.agents/skills/release/`), 其中规定了 VM 配置, 受验系统要求和快照纪律. 执行验证时, `scripts/release-vm.mjs` 会先还原干净的 VMware 快照, 经 SSH 传入候选 Git bundle, 在 guest 中运行 `scripts/release-guest-check.mjs`, 跑完后再次还原快照.

### 稳定版本发布

当代码, 分发载荷和跨平台验证都准备就绪后, 使用这条路线验证并发布稳定版本. Agent 只在维护者显式调用发布 Skill (Codex 中为 `$release`, Claude Code 中为 `/release`) 时才会执行发布流程; 本地检查, VM 验证, 创建 tag, 上传带 `arw.tar.gz` 资产的 GitHub Release 以及公开 Bootstrap 验证都由该 Skill 统筹完成. 完整的发布合同由 [发布长期规格](../specs/agent-repository-workflow-release/spec.md) 拥有.

## 按责任导航代码

无论你是修改产品功能还是维护分发脚本, 都可以先按责任选定入口层 (根目录入口, `scripts/` 维护入口或 `lib/` Module), 再顺着导入关系和同责任测试定位具体细节. 目录结构只是导航辅助, 不能代替长期规格中的 Module 和 Interface 合同.

### 根目录入口

仓库根目录下的文件负责连接公开 CLI, 安装程序, 工具链配置和顶层 Agent 规则:

- `arw.mjs`, `arw` 和 `arw.cmd` 是从源码仓库直接运行的产品入口.
- `install.mjs` 和 `uninstall.mjs` 是从克隆检出副本运行的安装入口. 单独传入 `--help` 或 `-h` 会向标准输出打印用法和逐行选项并以 `0` 退出; 参数错误时则保留原消息和退出码 `2`, 并追加一行指向 `--help` 的提示.
- `package.json`, `pnpm-lock.yaml` 和 `tsconfig.json` 分别保存产品版本及开发命令, 实际开发依赖树和严格 JavaScript 检查配置.
- `config.install.json`, `release-manifest.json` 和 `release-validation.json` 分别服务初始全局配置, 安装载荷和发布验证.
- `AGENTS.md` 与 `CONTEXT.md` 分别提供仓库 Agent 入口规则和持久领域词汇.

### scripts

与根目录入口不同, `scripts/` 的直接子项只供源码仓库维护者使用, 或者是可单独下载的引导脚本, 不会变成公开的 `arw` 子命令:

| 入口 | 责任 |
| --- | --- |
| `scripts/check-workflow-distribution.mjs` | 验证生产工作流分发载荷和平台投射 |
| `scripts/generate-install-arw.mjs` | 生成或核对可单独下载的引导脚本 |
| `scripts/install-arw.mjs` | 可单独下载并从固定发布来源启动安装的引导脚本 |
| `scripts/pack-release.mjs` | 把安装载荷打成发布压缩包 `arw.tar.gz`, 由 `$release` 上传为 release 资产 |
| `scripts/project-claude-skills.mjs` | 由 `.agents/skills/` 生成 `.claude/skills/`, 或用 `--check` 检查两者是否一致 |
| `scripts/release-guest-check.mjs` | 在可丢弃的受验系统中检查安装, PATH 登记, `arw workflow init` 和卸载 |
| `scripts/release-vm.mjs` | 在 VMware VM 中运行 guest 检查并还原快照 |
| `scripts/reviewer-capability.mjs` | Reviewer 能力套件入口: 搭建场景仓库, 给报告计分, 组盲池并记录裁决 |
| `scripts/sync-workflow-distribution.mjs` | 一次命令完成发布前工作流分发同步 |
| `scripts/upstream-sync.mjs` | 为 `$upstream-sync` Skill 生成上游三方视图 |

### lib

根目录命令和 `scripts/` 最终都会调用 `lib/`, 这里保存了全部正式运行实现和只服务源码仓库的维护 Module. 其子目录遵循严格的单向依赖层次:

- 具体业务责任位于各自的 `lib/<responsibility>/` 目录中, 可以依赖 `lib/arw-common/` 和 `lib/common/`.
- `lib/arw-common/` 保存依赖 ARW 语义且由多个业务范围复用的公共能力, 可以依赖 `lib/common/`.
- `lib/common/` 只放与 ARW 语义无关的通用能力, 不依赖 ARW 语义或任何其他 `lib/` 实现.

直接位于 `lib/` 根级的文件负责连接多个责任. 保持直接导入: 不要仅因为存在某个目录, 就自动为它增加 `index.mjs`, 转发层或新的 Module Interface.

### 主要目录

除了 `scripts/` 和 `lib/`, 其余顶层目录分别承载编写来源, 派生载荷, 文档, 测试和运行状态:

- `.agents/skills/` 保存源码仓库实际使用并维护的 Skill Package.
- `distribution/` 保存发布前同步产生并审核的工作流分发安装载荷.
- `docs/specs/` 保存长期产品行为, `docs/adr/` 保存难以撤销的决定, `docs/agents/` 保存 Agent 工作规则, `docs/manuals/` 保存 Human 读者指南.
- `tests/` 按 `lib/` 的长期责任组织, 根级测试只覆盖根连接和跨责任不变量, `tests/helpers/` 与 `tests/fixtures/` 保存共享测试基础设施.
- `.scratch/` 保存 ARW Artifact 和完成证据, 不是 Engine 临时目录.
- `.tmp/` 保存当前平台和会话的短期 Engine 状态, 不保存受 Git 管理的权威数据.
- `upstream/` 保存外部来源配置和采用记录. 三方视图写在被忽略的 `.tmp/<agent-platform>/<sessionId>/_upstream-sync/<source>/`.

## 进一步阅读

当你需要查阅上述某条路线或目录背后的完整合同时, 直接进入拥有该责任的权威文档:

- [根 README](../../README.zh-CN.md): 面向使用者的项目判断, 首次成功和主要路线.
- [Agent Repository Workflow 长期规格](../specs/agent-repository-workflow/spec.md): 公开命令, ARW Artifact, Agent CLI, Repository Workflow 和产品 Module.
- [开发长期规格](../specs/agent-repository-workflow-development/spec.md): 源码仓库布局, 工作流分发, 平台投射和公共 Module.
- [安装长期规格](../specs/agent-repository-workflow-installation/spec.md): 引导脚本, 安装, 全局配置, PATH 和卸载.
- [发布长期规格](../specs/agent-repository-workflow-release/spec.md): 发布候选, Reviewer 能力, VM 验证, 标签和外部写入.
- [读者文档规范](../specs/arw-reader-documentation/spec.md): README 与全部手册的读者目标和责任边界.
- [验证规则](../../.agents/skills/validation/SKILL.md): 当前 Agent 验证责任和文档检查.
- [源码仓库确定性验证](../agents/source-checkout-validation.md): 当前完整验证入口; 覆盖路由见 [源码仓库确定性测试覆盖](../agents/source-checkout-coverage.md).
- [提交规则](../../.agents/skills/commit/SKILL.md): 用户请求提交后的范围, 审核和 Commit Audit 流程.
