# 提供方配置脱离 Codex 用户目录, Claude 后端默认限 4 个并发

Status: needs-triage

## What to build

用户 2026-10-28 指出: 共享模型目录 `models.custom.json` 只能放在 Codex 用户目录 (`~/.codex` 或 `CODEX_HOME`), 安装还会为它创建 `~/.codex`, 于是每台安装 ARW 的机器都要有 Codex 目录; ARW 要兼容 Claude Code, 只用 Claude 后端的机器不应依赖 Codex. 用户要求先解决这个问题, 否则后台 Agent 的维护一直会出问题.

现状 (`docs/specs/agent-repository-workflow-installation/spec.md#shared-model-catalog`, `lib/background-agent/model-catalog.mjs`): 该文件同时承载两类内容:

- `models`: 交给 Codex App Server 的自定义模型条目 (如 Strata 的三个变体和 `deepseek-flash`), 只有 Codex 后端使用.
- `providers`: ARW 自己读取的提供方容量和专用驱动设置 (`maxInstances`, `driver`, `installationDirectory`), 与 Codex 无关.

另一个相关问题 (用户同日): Codex 时代 Reviewer 受 `providers.openai.maxInstances: 4` 限制, 全局最多 4 个; Claude 后端 (`anthropic`) 没有提供方上限, 只受全局 16 约束, 一个工程内可能同时有十几个 Reviewer, 不符合要求.

建议方向 (实施前由独立 Agent 复核):

- ARW 自己的提供方设置移到 ARW 安装目录下由 ARW 拥有的位置 (如全局配置的 `backgroundAgent.providers`, 或安装目录下的同名文件), 安装不再创建 `~/.codex`; Claude 后端运行不读取 Codex 目录.
- Codex 自定义模型条目只在实际启动 Codex App Server 时需要; 是留在 Codex 用户目录, 还是也移到 ARW 位置, 由复核决定, 原则是只用 Claude 后端时不要求它存在.
- 已有 `~/.codex/models.custom.json` 的 `providers` 迁移到新位置 (安装或更新时一次性迁移, 或明确报错提示), 不丢失用户已设置的上限和 Strata 设置.
- `anthropic` 提供方默认上限 4, 与 `openai` 一致.
- 同步安装长期规范, 产品长期规范中引用该位置的条款, 以及安装说明文档.

用户在 Windows 下载目录有一份旧开发机的 `models.custom.json` (含 Strata 和 `deepseek-flash` 条目及 `qwen_strata` 提供方设置); 本 ticket 完成后由 Main Agent 与用户确认后放到新位置, 不在实施中自动复制.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-installation/spec.md#shared-model-catalog`
- `docs/specs/agent-repository-workflow-installation/spec.md#background-agent-configuration`

## Acceptance criteria

- [ ] 没有 Codex 用户目录的机器上, 安装和 Claude 后端的后台 Agent 正常工作, 不创建 `~/.codex`.
- [ ] 提供方设置从 ARW 拥有的位置读取; 已有 Codex 目录中的提供方设置有明确的迁移路径.
- [ ] `anthropic` 默认提供方上限为 4, 有测试覆盖.
- [ ] 长期规范与安装说明已同步; 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately
