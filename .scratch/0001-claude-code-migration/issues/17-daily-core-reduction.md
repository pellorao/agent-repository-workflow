# 日常核心模块瘦身

Status: completed

## What to build

ticket 12 跳过了每天运行的核心模块, GPT 式防御仍集中在这里 (审计: `manager.mjs` 116 个 throw, `spec-readiness.mjs` 125 个, `codex-app-server.mjs` 80 个). 按 `AGENTS.md` Efficiency First 的信任边界原则压缩 `lib/background-agent/`, `lib/reviewer-runtime/`, `lib/spec-readiness/`, `lib/commit-audit/`: 删除对内部数据的重复校验, 只用一次的辅助函数, 没有现实失败场景的错误处理. 对外行为不变.

范围: 本 ticket 只落实 `#code-reduction` 的第三条 (删除校验程序自身刚产生数据的代码, 吞掉错误又不处理的 `catch`) 以及 `AGENTS.md` Efficiency First 的同类原则 (只用一次的辅助函数, 没有现实失败场景的错误处理), 作用于上述四个目录的 `lib/` 源码. `#code-reduction` 的其余条目由其他 ticket 承担 (公共工具函数与声明式校验: ticket 3 和 12; release VM, Reviewer 能力一致性, reviewer-benchmark, Upstream Sync: ticket 9 至 11), 不在本 ticket 内. 同样, 所选 `#rule-structure-and-context-budget` 只有把效率与精简原则应用于四个目录的代码这一点属于本 ticket (该原则写入规则文档, 规则预算, Skill 化, 删除规则文件和规则审批等条目的落实由 ticket 6 至 8 等其他 ticket 承担, 本 ticket 不改 `docs/agents/` 和规则), 所选 `#migration-sequencing` 只有 "每张 ticket 提交前由独立 agent 审查 diff" 一条属于本 ticket ("最后一张 ticket" 的切换工作不在本 ticket 内). 保留的信任边界 (含 ARW 自己写入磁盘, 数据库或其他进程后再读回的状态, 如恢复记录, SQLite 行, Request, artifact 和已跟踪就绪记录: 读回的数据可能损坏, 写到一半或被改动, 所以读回路径的校验属于边界, 不删): 外部输入 (文件, 命令行, 子进程和 Codex/Claude 协议数据) 的校验, 以及 `verify` 路径上对磁盘记录新鲜度与摘要的检查; 只删对程序自身刚在同一进程写出的数据的重复校验.

预估改动: 这四个目录的 `lib/` 源码合计净减不足 1% (实测见 `## Comments` 的结果表; 原目标 20% 在保留信任边界且不改变外部行为时不可达, 用户 2026-10-28 决定接受实测结果, 见 `## Comments`), 目标由本 ticket 自定 (spec 只要求 "大幅压缩"), 度量为基线提交 `d1e9012` 与本 ticket 提交的 `lib/` 四个目录 `wc -l` 之差, 本 ticket 在 `d1e9012` 之上只含本 ticket 的提交, 所以不含其他 ticket 的改动; 不含 `tests/`. 开工前按文件写出行数预算.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#code-reduction`
- `.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget`
- `.scratch/0001-claude-code-migration/spec.md#migration-sequencing`

## Acceptance criteria

- [x] 四个目录行数净减不足 1% (实测见结果表, 用户 2026-10-28 决定接受, 取代原 20% 目标), 前后行数记入 `## Comments`.
- [x] 完整测试套件通过, 只为被删除的功能删除测试.
- [x] 本 ticket 提交前的独立 diff 审查 (`#migration-sequencing`) 用源码 `arw background-agent` 分别在 Claude 后端 (haiku) 和 Codex 后端各跑一次真实审核, 行为与压缩前一致 (能受理, 完成并返回报告). 两个后端在 `d1e9012` 已可用 (ticket 4, 21, 25). 这不取代最后一张 ticket 的完整人工冒烟.

## Blocked by

- issue:0001:16
- issue:0001:21

## Validation

- `pnpm test` 707 通过 1 跳过, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check` 均通过.
- 四个目录 8519 到 8461 行 (-0.7%), 用户 2026-10-28 决定接受, 见 `## Comments`.
- 独立 diff 审查: requirements-reviewer 与 code-standards-reviewer 分别在 Claude 后端 (haiku high) 和 Codex 后端各跑一次真实审核, 结果见提交说明.

## Comments

开工前行数与预算 (2026-10-27, `wc -l`, 基线 `d1e9012`). 四个目录合计 8519 行, 20% 即 1704 行, 目标净减约 1790 行 (21%).

| 文件 | 前 | 预算后 |
| --- | --- | --- |
| background-agent/manager.mjs | 1291 | 1000 |
| background-agent/codex-app-server.mjs | 1194 | 950 |
| background-agent/state-store.mjs | 558 | 450 |
| background-agent/model-catalog.mjs | 396 | 320 |
| background-agent/client.mjs | 383 | 310 |
| background-agent/claude-sessions.mjs | 299 | 260 |
| background-agent/其余 15 个文件 | 1362 | 1100 |
| reviewer-runtime/reviewer-runtime.mjs | 1040 | 800 |
| reviewer-runtime/reviewer-measurement.mjs | 328 | 250 |
| reviewer-runtime/reviewer-session-record.mjs | 237 | 170 |
| reviewer-runtime/其余 3 个文件 | 216 | 190 |
| spec-readiness/spec-readiness.mjs | 891 | 680 |
| commit-audit/commit-audit.mjs | 324 | 260 |
| 合计 | 8519 | 6740 |

实施结果 (2026-10-28, `wc -l`, `cat lib/<dir>/*.mjs`): 用户决定接受部分压缩, 取代原 20% 目标.

| 目录 | 前 | 后 |
| --- | --- | --- |
| background-agent | 5483 | 5427 |
| reviewer-runtime | 1821 | 1819 |
| spec-readiness | 891 | 891 |
| commit-audit | 324 | 324 |
| 合计 | 8519 | 8461 |

净减 58 行 (0.7%). 过程: 第一版净减 435 行 (5.1%), 但其中约 300 行来自删除读回磁盘数据的校验 (恢复记录, SQLite 行, spec-readiness 的 Request, artifact 和已跟踪记录) 以及 `newThread` 的协议类型校验; 提交审核中两个独立 Reviewer (Claude haiku 和 Codex) 都指出这些属于信任边界 (读回的状态可能损坏或被改动, 且 artifact 校验被绕过会使 Spec Readiness 门槛失效), Main 决定恢复这些校验, 并在范围里写明读回状态属于边界. 因此最终只保留对内部数据的写入侧重复校验, 重复实现合并和无场景的参数检查 (state-store, model-catalog, reviewer-runtime 中的小项). `forward([...names])` 因绕过方法名静态检查而撤销.

用户决定 (2026-10-28): 接受部分压缩, 取代原 20% 目标; 要再减需删除行为或信任边界校验, 不在本 ticket 内.

剩余内容及必须保留的原因:

| 文件 | 行数 | 保留原因 |
| --- | --- | --- |
| background-agent/manager.mjs | 1291 | 管理进程内 run 状态机与并发保护; throw 对应未知 run 或 turn, 回合已变化, 重复 id, 提供方与模型选择, 容量和外部协议返回值 |
| background-agent/codex-app-server.mjs | 1194 | 外部协议解析, 提供方凭据, config 和 env_key 校验, 以及连接, 线程发现, 卸载重启, 共享 App Server 生命周期 |
| reviewer-runtime/reviewer-runtime.mjs | 约 1030 | 恢复记录, 轮次与报告绑定, 停止清理, 外部输入校验和崩溃恢复 |
| reviewer-runtime/reviewer-session-record.mjs | 237 | 读回恢复记录的结构校验 (信任边界) |
| spec-readiness/spec-readiness.mjs | 891 | Request, artifact 和已跟踪记录的读回校验, verify 路径的新鲜度检查 (信任边界) |
| background-agent/state-store.mjs | 约 545 | SQLite 行读回校验 (信任边界), 事务和脏行刷新 |
| reviewer-runtime/reviewer-measurement.mjs | 328 | 纯计算, 无保护代码可删 |
| commit-audit/commit-audit.mjs | 324 | 未改动; ticket 26 刚精简, 剩余为 Git 与 JSON 外部输入校验和分类 |
