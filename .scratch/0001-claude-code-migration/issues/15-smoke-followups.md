# 冒烟发现的日常使用问题

Status: completed

## What to build

修复 ticket 13 两端冒烟中 Main Agent 实际遇到的问题, 让目标仓库中的日常流程不再卡住:

1. 分发文档链接到目标仓库不存在的 `docs/specs/agent-repository-workflow/spec.md`, 两个平台的 Agent 都在这里卡过: 改为目标仓库内可读的位置或删除链接.
2. `draftPath` 必须位于报告目录的规则 (`report-binding-invalid`) 没有写进文档.
3. `reviewer-launch` 没写 `wait_agent` 超时低于 10000 ms 和重复 request id 会被拒绝.
4. Codex 中 PTY canonical 模式会截断长 JSONL 请求 (需 `stty -echo -icanon`): 在 Codex 用法中写明, 或让入口不依赖长单行.
5. 新初始化的仓库上 `arw terms check` 失败 (没有术语表, 语言检查未配置): 初始化后的默认状态应能通过.
7. 用户决定 (2026-10-26): `arw background-agent` 标准输入结束时, 先等未返回的 `wait_agent` 等响应写出再退出, 不再取消; 删除 `reviewer-launch` 中的 `sleep` 绕法.
8. 审计发现: 长期 spec `docs/specs/agent-repository-workflow/spec.md:47` 仍写 Reviewer 填 Engine 清单, 改为 txt 报告.
9. 审计发现: `docs/agents/subagent-allocation.md` 只有 Codex 模型映射, 补 Claude Code 映射.
10. 审计发现: Claude 后端 Reviewer 可能加载祖先目录的 `CLAUDE.md` 和用户 memory (冒烟需用 `claudeMdExcludes` 排除): 实测 Reviewer 实际上下文, 在后端强制排除.
6. ready 记录绑定到实现文件, 实施后必须再复审一轮: 绑定只覆盖设计文档 (spec, issue), 不覆盖实现文件.
11. 本 ticket 实施中发现: 没有 Codex home (`~/.codex`) 时 Claude 后端 Reviewer 无法启动 (`Codex home and model catalog sources are missing.`), 只用 Claude Code 的用户因此无法使用 Reviewer.

各项预期结果见治理 spec 的 `Smoke follow-ups`.

预估改动: 约 150 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#smoke-follow-ups`

## Acceptance criteria

- [x] 上述 11 项逐项修复或写明不修的理由.
- [x] 修复后在隔离目标仓库用一个中等规模的真实 issue (不是玩具函数) 在 Claude Code 和 Codex 各冒烟一次, 记录耗时, Reviewer 轮数和卡住之处.
- [x] 全量测试和分发检查通过.

## Blocked by

- 13 收尾接入

## Validation

各项结果:

- 1: 分发 Skill (`reviewer-launch`, `spec-readiness`, `arw-commands`) 和 Baseline `docs/agents/reviewer.md` 不再链接 Source Checkout 的长期规格, 需要的规则写在原处.
- 2: `reviewer-launch`, `spec-readiness` Skill 和长期规格 `draftPath` 合同写明报告子目录约束和 `report-binding-invalid`.
- 3, 4: `reviewer-launch` 写明 `timeout_ms` 范围, `background-agent-request-duplicate` 和 Codex PTY 截断的两种绕法.
- 5: `lib/document-terms/document-terms.mjs` 在未配置语言检查时不再报 `terms-glossary-missing`; `arw terms check` 输出没有术语可检查的说明. 新初始化的隔离仓库中 `arw terms check` 退出码 `0`.
- 6: 判断为非有意设计, 已修改: `promote` 和 `verify` 跳过 `architecture-evidence` (`lib/spec-readiness/spec-readiness.mjs`). 本 ticket 自身即验证: 长期规格是 `architecture-evidence`, 实施中修改后 `verify` 仍为 satisfied.
- 7: `lib/background-agent/machine.mjs` 在 EOF 后先等全部未返回请求再关闭; `SIGINT`/`SIGTERM` 仍取消. 长期规格机器入口段写明这一规则和理由, `reviewer-launch` 删除 `sleep` 绕法.
- 8: 长期规格 Commit Audit Module 理由段改为 txt 报告及其代价; 抽查规则改为 Main Agent 自选位置.
- 9: 暂不写入. `docs/agents/subagent-allocation.md` 的 Baseline 规定具体模型和推理强度须经用户批准才写入仓库自有区域; 建议值 (`haiku` low/medium/high, `sonnet` low/medium/high, `opus` medium/high/xhigh) 等待用户批准.
- 10: 实测 (claude 2.1.310, haiku, 金丝雀文件): 原参数 `--setting-sources ''` 已排除项目, 祖先和用户 `CLAUDE.md` 与 hook, 但 auto memory 的 `MEMORY.md` 仍被加载; 加 `--safe-mode` 后都不加载. 后端启动参数加入 `--safe-mode`.
- 11: `lib/background-agent/model-catalog.mjs` 没有 Codex home 时返回空提供方, 只有准备 Codex 模型目录时失败. 隔离 HOME (无 `~/.codex`) 中 Claude Reviewer 实际完成 9 轮 Spec Readiness.

命令:

- `pnpm test`: 697 项, 696 通过, 1 跳过, 0 失败.
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check`, `git diff --check`: 通过.
- `node arw.mjs terms check --include .scratch/0001-claude-code-migration/`: 失败项 (`Artifact` 用词, 本 effort 旧 issue 的中文比例) 在 `main` 上已存在, 与本 ticket 无关.
- Spec Readiness: haiku high, 同一线程 9 轮, 约 29 分钟 (04:47 到 05:16), 第 9 轮 `No problems.`. 前 8 轮的问题大多来自本 effort spec 原有内容 (缺 Module Design, 长期规格旧句子), 每轮修正后的新文字又引出新问题.
- effort spec 新增的 `## Module Design` 不是新实施范围: 第 4 轮 Spec Readiness 按 `MODULE-DESIGN-APPLICABILITY` 指出本 effort 修改了正式运行时代码却没有该章节, 不补就不能就绪. 内容只描述 `HEAD` 已有的 Claude 后端, 路由, Projection 和公共工具.

冒烟 (ticket 16 的对比基线, 2026-10-26, 修复提交 `4619e92` 的源码 arw):

- 目标: 自建的 tasklog CLI (约 330 行, 8 个测试), issue "Due dates and agenda" (spec 带 Module Design, 预估 250 行). 每个平台一个隔离仓库, 临时 HOME, 源码 `arw` 包装脚本, `arw workflow init --platform codex --platform claude-code`.
- 用户回复 (模拟, 均是真实用户会给的回答): Codex 2 次 ("测试阈值 100 ms, 语言检查本次例外"; spec 兼容性歧义选推荐项 1). Claude Code 2 次 (Spec Readiness 指出的周日边界和 spec 补写按建议改; "阈值 100 ms 写进 AGENTS.md, 要求 Reviewer 每次 Bash 只跑一条 git 命令后重审").
- 墙钟时间只算 Agent 运行, 不含等用户回复的时间.

| 平台 | Main | Reviewer | 墙钟 | Main 工具调用 | Spec Readiness 轮数 | 提交审核轮数 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Codex | 默认 `gpt-6.1-sol` high, `codex exec` | `gpt-6-luna` xhigh | 19 分钟 (46 s + 385 s + 725 s) | 82 次命令 + 12 次文件修改 | 2 | 2 (要求符合与 Code Standards 各 2) | 提交 `1ad188c`, 350 行 |
| Claude Code | `sonnet` high, `claude -p` | `haiku` high | 62 分钟 (425 s + 2464 s + 835 s) | 66 | 5 | 要求符合 4, Code Standards 3 | 提交 `f4a6dc3`, Main 费用约 4.2 美元 |

卡住之处:

- 两个平台: 新初始化仓库没有测试单回调耗时阈值, 也没有语言检查配置, 规则要求用户决定. Codex 动手前就停下来问; Claude Code 先实施, 到提交审核才因此卡住.
- Claude Code: Reviewer 用 `cd ... && git ...` 这类组合命令, 被 Claude 后端的 `dontAsk` 只读放行规则拒绝. 两轮提交审核因此 `incomplete`; 在 handoff 中要求单条 git 命令后才通过. 这是 ARW 缺陷, 未在本 ticket 修复.
- Claude Code: Main 先写代码再做 Spec Readiness. Spec Readiness 用了 5 轮, 每轮都对新补的 spec 文字提出新问题.
- Codex: Reviewer 运行在 Codex 沙盒外的管理进程中. `codex exec --sandbox workspace-write` 内启动的管理进程拉起的 App Server 报 `Read-only file system`, 所以冒烟时先在沙盒外启动了管理进程, 相当于用户批准在沙盒外运行 `arw background-agent`. 冒烟仓库放在 `/tmp` 下时, Codex 拒绝创建辅助程序.
- Codex: `arw lba` 的 Main session 列显示 "# AGENTS.md instructions for ...", 标题取自注入的指令而不是用户消息.
