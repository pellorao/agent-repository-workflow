# 关闭 Codex Reviewer 的记忆功能

Status: completed

## What to build

Codex 后端的 Reviewer 根线程不再带入维护者本机的 Codex 记忆, 其他后台 Agent 角色和 Claude 后端不变. 最终行为见本 effort 的 spec.

实现位置是 Reviewer 专属层组装 Reviewer 根线程原生配置的地方, 那里已经强制关闭 Agent 协作: 在同一处加入 `features.memories = false`, 点号键写法和调用方以嵌套 `features` 对象传入的写法都要强制关闭, 嵌套对象的其他键保持原样. 新建线程和恢复线程共用同一线程参数组装, 不需要另外处理; 不修改共享 App Server 的启动参数, 不按角色在 App Server 进程层区分.

同时更新长期规范 (Background Agent 总规范) 的 Reviewer runtime 节, 强制配置说明按本 effort spec 给出的文字修改; Isolation and measurement 节不改. 不修改面向 Agent 的 Reviewer 规则文档及其分发副本.

体积预算: 非测试代码净增约 1 行; 文档净增不超过 150 个字符; 测试另计.

预期验证: 新增测试覆盖 Reviewer 专属层的原生配置 (无记忆设置的输入, 点号键打开的输入, 嵌套 `features` 打开的输入); 在共享 App Server 原生会话测试中为非 Reviewer 线程补一条配置不含记忆设置的观察; 运行 `validation` Skill 要求的检查. 不启动真实 Codex. 边界情况: 调用方嵌套 `features` 中含其他键时保留这些键; 两种写法同时出现时均被强制关闭.

## Acceptance criteria

- [x] Reviewer 专属层的原生配置测试: 调用方未设置记忆时, 返回的 Reviewer 根线程配置中 `features.memories` 为 `false`.
- [x] 同一测试文件: 调用方用点号键 `features.memories` 或嵌套 `features` 对象把记忆设为 `true` 时, 返回配置仍为 `false`, 嵌套对象中的其他键原样保留.
- [x] 共享 App Server 原生会话测试: 非 Reviewer 线程的 `thread/start` 配置中 `features.memories` 为 `undefined`; 该测试文件中对 App Server 启动参数的既有断言保持通过, 启动参数代码未被修改 (由 `git diff` 观察).
- [x] 用 `git diff` 观察 Claude 后端的源码和测试文件均未修改, 运行其测试文件通过.
- [x] 长期规范 Reviewer runtime 节的强制配置说明含 `features.memories = false` 及其目的 (不带入维护者本机 Codex 记忆), 该节其余文字不变, Isolation and measurement 节无改动 (由 `git diff` 观察); 面向 Agent 的 Reviewer 规则文档及其分发副本未出现在 `git diff` 中.
- [x] `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0065-codex-reviewer-memories/` 与上述涉及的测试文件通过.

## Blocked by

- None - can start immediately

## Validation

- `node --test tests/reviewer-runtime/reviewer-native-policy.test.mjs tests/background-agent/codex-app-server.test.mjs tests/reviewer-runtime/reviewer-runtime.test.mjs tests/background-agent/claude-sessions.test.mjs`: 88 项通过. 新增测试 "Reviewer root thread config forces Codex memories off whatever the caller sets" 覆盖无设置, 点号键打开, 嵌套 `features` 打开 (其他键保留), 两种写法同时打开; `codex-app-server.test.mjs` 非 Reviewer 线程补 `features.memories` 为 `undefined` 的断言, 其启动参数断言保持通过.
- `git diff --stat`: 除本 effort 的 `.scratch` 工件 (spec, 本 issue, 就绪记录) 外, 改动文件为 `lib/reviewer-runtime/reviewer-native-policy.mjs`, 总规范 Reviewer runtime 节一处, 两个测试文件; Claude 后端源码和测试, App Server 启动参数代码, 面向 Agent 的 Reviewer 规则文档及其分发副本均无改动, Isolation and measurement 节无改动.
- `pnpm typecheck`, `pnpm test` (880 项通过), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0065-codex-reviewer-memories/`, `git diff --check`: 均通过.
- 体积: 非测试代码净增 1 行 (+2 -1), 文档净增约 90 个字符, 在预算内.

## Comments

- 用户确认: 维护者 2026-11-04 定 ARW 启动的 Agent (含 Reviewer) 不载入本机用户级规则和配置, 否则无法评估分发后的效果, 并同意 Codex Reviewer 启动时关闭记忆, 非 Reviewer 角色保持按用户配置运行. Main Agent 据此拟定本 effort 的 spec 和长期规范的两处改动并向实施 worker 下达; 按根 `AGENTS.md` Source Checkout Baseline 例外, Main Agent 对规则和设计文档改动的确认等同用户确认, 本条为确认依据.
- Main Agent 决定 (2026-11-04): 不修改面向 Agent 的 Reviewer 规则文档, 本改动只改变 Codex Reviewer 的运行时上下文, 不是 Reviewer 规则文本改动, 不做 Reviewer 能力对比.
- Spec Readiness: 三轮, 第 1 轮 5 个问题 (Claude 侧记忆依据, 强制配置说明目的不一致, 部署前旧线程, ADR 评估, Module Design 格式), 修正 spec 与验收项后第 2 轮剩 1 个 (旧线程接受理由不成立), 修正后第 3 轮 No problems, 记录已提升. 修正中去掉了对 Isolation and measurement 节的改动 (该句只陈述工作目录不提供隔离, 与本改动不冲突).
- 部署提示: Reviewer 运行层在管理进程内, 需 `node install.mjs` 后才对真实 Codex Reviewer 生效; 真实生效由 Main 另行用一次 Codex Reviewer 运行核对.
