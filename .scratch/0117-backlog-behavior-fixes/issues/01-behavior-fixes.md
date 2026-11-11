# 修复分诊清单中的行为问题

Status: completed

## What to build

实施 `.tmp/triage.md` 的 Issue P, 限于八项已授权行为修复. 每项更改前核对调用链, 调用方和测试; 不成立的项不实施, 在完成记录说明. 不增加清单外工作.

1. `spawn_agent` 入口按恢复记录的相同规则校验 `settings.serviceTier` 和 `settings.config`, 不合格输入立即失败. 首次任务交付失败时保存 `providerError` 原因并结束等待状态. 不改变普通后台 Agent 的 `--wait` 行为.
2. `--platform` 错误列出合法值 `codex` 和 `claude-code`.
3. `arw workflow init` 用法将 `--transform-existing-agent-docs` 和 `--orphan-code-map-readmes` 标为仅适用时必填, 同步 `lib/arw.mjs`, 长期规范及 `arw-commands` Skill 的分发和投射副本. `inapplicable-choice` 诊断提示删除对应选项, 保留检查和退出码.
4. Claude 流式事件到达时累计用量, 中断不丢失本轮用量; `result` 到达不重复累计.
5. 已结束 Reviewer 运行的中断请求返回 `turn-mismatch`. 只使用廉价的已退役身份来源; 若需要大型结构则放弃此项并记录.
6. Reviewer 恢复路径平台错误保留合法平台列表. 仅在现有句子可用一行表达时补充 `other-reviews.md` 及其副本中的合法值.
7. 轻量提交检查只对文本检查 BOM, CRLF 和无效 UTF-8, 允许 `research/**` 和 `prototype/**` 中的二进制文件, 保留 Markdown 的 NUL 拒绝.
8. 共享 Markdown 围栏开闭解析, 保留字符和长度边界, 修复 issue 章节与审核对象解析中的嵌套围栏问题, 删除相同的辅助实现.

体积预算: 预估变更约 370 行, 其中代码约 140 行, 测试约 190 行, issue 与文档约 40 行; 非测试代码净增预算 140 行. 完成记录分别列出代码, 测试, issue 与文档的预估和实际增删行数.

预期验证: 每项行为修复增加或调整最少充分回归测试, 第 3 项只核对文字及已有诊断测试. 运行完整 Source Checkout 验证, 包括 `pnpm typecheck`, `pnpm test`, 分发, Skill 投射, 安装脚本检查, 受影响文件语法, 文本与术语检查及差异空白检查. 按正常工作流完成双 Reviewer Commit Audit 和提交.

边界情况: 缺少或无效配置, 首次原生交付异常, Claude 中断与成功结果的用量去重, 已退役与从未存在的运行, 非法平台, PNG 二进制与非法文本, 四反引号包裹三反引号及不同字符围栏, 围栏中的章节和任务勾选.

## Acceptance criteria

- [x] 八项逐一确认并修复或按授权条件放弃, 清单外行为保持不变.
- [x] 回归测试覆盖上述独立边界, 完整 Source Checkout 验证通过.
- [ ] 取得本 issue 的 Spec Readiness 例外记录, 通过 Commit Audit 并提交.
- [x] 完成记录说明每项结果及按代码, 测试, issue 与文档拆分的变更量.

## Blocked by

- None - can start immediately

## Validation

- P1: `tests/background-agent/manager.test.mjs` 验证缺失设置在接受前失败, 原生启动失败, 不完整事实与原生请求失败均能观察错误, 并保留失败与未知交付的区别. 原有 Strata 失败恢复测试通过, 不增加无关持久提供商状态.
- P2, P3: `tests/repository-workflow/cli.test.mjs` 验证非法平台的合法值列表, 两种不适用选项都提示删除并保持退出码 2, 不生成锁文件. 用法及指定分发副本已同步.
- P4: `tests/background-agent/claude-sessions.test.mjs` 的中断案例在真实假进程输出用量后中断, 保留 inputTokens 16, cachedInputTokens 5, cacheWriteInputTokens 1, outputTokens 3, totalTokens 19. 正常结果和连续消息仍分别累计为 19 和 38, 不重复计算流与最终结果.
- P5, P6: `tests/reviewer-runtime/reviewer-runtime.test.mjs` 观察实际退役后中断返回 turn-mismatch, 未知运行仍返回 run-not-found; `reviewer-session-record.test.mjs` 验证非法平台诊断保留合法值. 使用当前运行环境的退役身份集合, 不增加持久字段.
- P7: `tests/commit-audit/cli.test.mjs` 在 research 中暂存带 PNG 头的二进制文件, 轻量检查通过; 原有 CRLF 拒绝仍通过. 文本编码检查和 Markdown NUL 检查保留.
- P8: `tests/arw-common/issue-documents.test.mjs` 覆盖四反引号中的三反引号, 不同围栏字符, 带尾随文字的无效关闭行, 示例章节与状态, 以及只规范真实验收勾选. 公共模块已加入 `release-manifest.json`, 安装可达性测试通过.
- 完整 `pnpm test`: 955 个测试全部通过, 耗时约 3 秒. `pnpm typecheck`, 三项分发, 投射和安装脚本检查, 全部受影响 `.mjs` 的 `node --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0117-backlog-behavior-fixes/`, `git diff --cached --check` 与 `git diff --check` 均通过.
- 新增或语义修改的测试回调在定向运行中均低于 100 毫秒, 无需新增生产注入接缝. 测试日志保存在当前会话的临时工作区.
- Spec Readiness 例外记录已由 Engine 生成并提升, 完整 verify 通过. 实施已完成, Commit Audit 已通过; 包含 Git 提交动作的验收勾选未提前声明提交事实, 实际提交由本 issue 的实施提交与下述门禁证据确认.
- 预估变更: 代码约 140 行, 测试约 190 行, issue 与文档约 40 行. 实际增删行数在提交审核摘要及本节收尾记录中给出.

实际变更统计: code 新增 109 行, 删除 70 行, 净增 39 行; tests 新增 77 行, 删除 4 行, 净增 73 行; text 新增 127 行, 删除 7 行, 净增 120 行. issue 与文档超出最初约 40 行估算, 原因是补全逐项证据, 裁定及 Engine 摘要; 非测试代码净增 39 行, 低于 140 行预算.

```text
code: +39 lines (files: 13)
  lib/arw-common/issue-documents.mjs +2
  lib/arw.mjs +1
  lib/background-agent/claude-sessions.mjs +20
  lib/background-agent/manager.mjs +6
  lib/background-agent/recovery-record.mjs +3
  lib/commit-audit/commit-audit.mjs -1
  lib/common/markdown-fences.mjs +17
  lib/common/markdown-visible-text.mjs -5
  lib/repository-workflow/workflow.mjs 0
  lib/reviewer-capability/evidence.mjs -8
  lib/reviewer-runtime/reviewer-runtime.mjs +3
  lib/reviewer-runtime/reviewer-session-record.mjs 0
  release-manifest.json +1
documents: +474 characters (files: 7)
  .agents/skills/arw-commands/SKILL.md +86
  .agents/skills/reviewer-launch/other-reviews.md +36
  .claude/skills/arw-commands/SKILL.md +86
  .claude/skills/reviewer-launch/other-reviews.md +36
  distribution/skills/arw-commands/SKILL.md +86
  distribution/skills/reviewer-launch/other-reviews.md +36
  docs/specs/agent-repository-workflow/spec.md +108
tests: +73 lines (files: 8)
  tests/arw-common/issue-documents.test.mjs +13
  tests/background-agent/claude-sessions.test.mjs +2
  tests/background-agent/manager.test.mjs +25
  tests/commit-audit/cli.test.mjs +1
  tests/fixtures/fake-claude.mjs +4
  tests/repository-workflow/cli.test.mjs +19
  tests/reviewer-runtime/reviewer-runtime.test.mjs +2
  tests/reviewer-runtime/reviewer-session-record.test.mjs +7
next ADR number: 0041
```

- 提交审核结果: Code Standards 第 3 轮和要求符合审核第 4 轮均正常完成并返回 `No problems.`. `node arw.mjs commit-audit verify` 返回 `errors: []`. 复审后再次抽查 `serviceTier: null` 及文本 CRLF, Markdown NUL 拒绝合同, 均保持成立.

## Comments

用户明确确认本轮不需要治理设计, 按 Spec Readiness Exception workflow 使用单 issue effort. 用户已确认第 3 项的 Agent 指令和长期规范文字修改, 以及第 6 项的一行合法平台说明; Main 接受该精确范围, 适用 Source Checkout Baseline 例外.

实施前发现流程冲突: `docs/agents/source-checkout-reviewer-testing.md` 要求 Reviewer 运行时变更做能力 A/B, `reviewer-capability` Skill 的盲裁步骤需要独立裁判, 而本轮禁止启动 ARW Reviewers 之外的 Agent. 等待用户决定此轮采用确定性回归验证例外, 或放宽该禁止并运行能力 A/B. 尚未更改实现文件.

用户裁定: `docs/agents/source-checkout-reviewer-testing.md` 第 3 行将 Reviewer 运行时限定为原生工具, 权限, 沙盒, 上下文, 默认模型和设置. D1, D2, D3 只改控制结果和诊断, 不属于该定义, 不触发能力 A/B, 这不是豁免. 禁止启动裁判或其他 Agent; 若实施中发现某项影响上述能力, 跳过该项并记录. 继续定向回归测试, 完整 Source Checkout 验证和正常 Commit Audit. 此裁定取代前述待决说明.

八项均在代码和调用链中确认成立并完成, 未放弃任何项. 没有更改 Reviewer 的工具, 权限, 沙盒, 上下文, 默认模型或设置, 因此按用户裁定无需能力 A/B.

第 2 轮提交审核独立核对: 要求符合审核发现首次交付异常后 ended 任务与 unknown 环境组合导致现有 --wait 循环立即重试. 本轮仅在首次交付失败时调用既有 unload, 确认原生环境退出后进入 exited, 不修改等待流程或正常后台 Agent 行为. 新断言覆盖准备失败, 不完整事实和丢失原生回执的公开退出状态及 wait_agent 结果. Code Standards 指出的非 Error 回退确无现实场景, 已直接读取已知 Error 的 message, 由现有平台诊断测试覆盖.

第 4 轮范围重核: Main 提交一次合并质疑, 引用原始分诊清单明确排除通用 --wait 行为改动, 并对照基线的 unknown 等待路径, 区分本次引入的即时轮询回归与退出无法确认时既有的有界等待. 原 Reviewer 对完全相同的受审树重核后返回 No problems. 未修改等待流程, 未扩大本轮行为范围, Code Standards 通过结果按相同输入复用.
