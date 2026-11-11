# 清理分诊清单中的重复和无用实现

Status: completed

## What to build

实施 `.tmp/triage.md` 的 Issue R 的 12 项机械清理, 每项更改前核对调用链, 调用方和测试. 限于删除已满足退役条件的 Linux 旧身份格式及其测试, 无调用方的 `validateText`, 仅测试使用的 `writeJson`, 未使用的 `spawnProcess` 参数和类型; 合并相同路径校验, `escapeText`, 分发诊断辅助实现, `frontmatterBytes`, SHA-256 计算和后台 Agent 响应交付代码; 用最短方案保证 Claude 权限副本与实际授权一致. 最后移动 `Native*` 类型声明及类型导入, 若类型检查或文件数量超预期则放弃并记录. 其中, `lib/background-agent/**` 内的改动仅限清单明确授权的项目.

行为保持重构例外: 只删除死代码或退役分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不满足这些条件的项跳过并记录, 不扩大范围.

体积预算: 预估变更约 350 行, 非测试代码约删除 90 行, 测试约删除或调整 40 行; 非测试代码净增预算 0 行. 完成记录分别列出代码, 测试, issue 与文档的预估和实际增删行数.

预期验证: 保留有效覆盖, 删除检查前确认原风险已消失或由现有检查覆盖. 运行完整 Source Checkout 验证和双 Reviewer Commit Audit 后提交. 边界包括当前 Linux 身份格式, 不安全路径与转义文本, 分发失败诊断, 原样前置元数据, 相同哈希, 消息交付标记及 Claude 权限与类型兼容.

## Acceptance criteria

- [x] 12 项逐一确认并清理或说明放弃原因, 用户可见行为与退出码完全一致.
- [ ] 完整 Source Checkout 验证及 Commit Audit 通过并提交.
- [x] 完成记录包含删除依据及代码, 测试, issue 与文档的预估和实际变更量.

## Blocked by

- None - can start immediately

## Validation

- 12 项均已核对, 实施第 1, 2, 3, 8, 9, 10, 11, 12 项; 第 4, 5, 6, 7 项因需要新增 Module Interface 或职责而按跳过条款撤回. 用户可见命令和退出码不变, 唯一退役行为是用户明确授权的 Linux 旧身份计算.
- `pnpm typecheck` 通过. `pnpm test` 在允许本机服务和子进程的环境中通过, 954 项测试全部成功. 沙箱内挂起的尝试已停止, 不计入成功证据.
- `node --test --test-reporter=spec tests/background-agent/claude-sessions.test.mjs tests/common/json.test.mjs tests/background-agent/process-identity.test.mjs` 通过, 26 项. 语义修改的 Claude 权限回调约 52 毫秒, JSON 删除死封装断言后的回调约 1 毫秒; 其他测试仅移动类型路径或删除退役测试.
- 受影响 ESM 文件的 `node --check`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0118-backlog-mechanical-cleanup/` 和 `git diff --check` 通过.
- `node arw.mjs spec-readiness verify --issue issue:0118:01` 在首次实现写入前通过, 记录为用户确认的 `not-applicable` 例外.
- 预估变更约 350 行: 代码净 -90 行, 测试删除或调整约 40 行, issue 与文档约 40 行. 实际增删以本章的候选统计为准.

实际代码 +94/-119 (净 -25), 测试 +30/-53 (净 -23). issue 与文档 +126/-0 (含本 issue 和 13 行就绪记录); 长期文档未改动. 非测试代码净增未超出 0 行预算.

```text
code: -25 lines (files: 20)
  lib/application-jira/application-jira-cli.mjs 0
  lib/arw-background-agent-host.mjs 0
  lib/background-agent/claude-sessions.mjs -1
  lib/background-agent/codex-app-server.mjs -3
  lib/background-agent/codex-consumption.mjs 0
  lib/background-agent/manager.mjs -4
  lib/background-agent/native-session.mjs +19
  lib/background-agent/process-identity.mjs -8
  lib/background-agent/recovery-record.mjs 0
  lib/background-agent/strata-work-policy.mjs 0
  lib/common/json.mjs -10
  lib/common/text-policy.mjs -19
  lib/repository-workflow/workflow.mjs -1
  lib/reviewer-capability/scenario.mjs +1
  lib/reviewer-runtime/reviewer-group.mjs 0
  lib/reviewer-runtime/reviewer-measurement.mjs 0
  lib/reviewer-runtime/reviewer-native-policy.mjs 0
  lib/reviewer-runtime/reviewer-runtime.mjs 0
  lib/reviewer-runtime/reviewer-session-record.mjs 0
  release-manifest.json +1
documents: 0 characters (files: 0)
tests: -23 lines (files: 10)
  tests/background-agent/claude-sessions.test.mjs +5
  tests/background-agent/codex-app-server.test.mjs 0
  tests/background-agent/host.test.mjs 0
  tests/background-agent/manager.test.mjs 0
  tests/background-agent/process-identity.test.mjs -12
  tests/common/json.test.mjs -16
  tests/helpers/reviewer-runtime-adapter.mjs 0
  tests/reviewer-runtime/reviewer-measurement.test.mjs 0
  tests/reviewer-runtime/reviewer-native-policy.test.mjs 0
  tests/reviewer-runtime/reviewer-runtime.test.mjs 0
next ADR number: 0041
```

## Comments

本轮按用户指定单 issue effort 分组. 此 issue 仅适用行为保持重构例外, 不安排 Spec Readiness 审核.

前置 issue:0117:01 已由提交 `9b5ec0d` 完成. 原跨 effort 阻断字段不符合跟踪器格式, 已改为无阻断. 用户本轮明确确认无需治理设计并要求 not-applicable 例外流程, 本次确认记录时间为 2026-11-11T18:58:58Z.



1. Linux 兼容分支的退役条件已满足, 软件包为 0.5.4. 删除旧 btime 纳秒计算及唯一专属存活测试. 保留 boot-id 与 start-ticks 测试; 其余数字身份测试使用注入读取器, 继续覆盖 Windows 和 macOS 所需的数字格式, 没有依赖真实 Linux 旧计算的夹具.
2. `validateText` 全仓无调用方. 其二进制和编码风险仍由实际使用的 `inspectTextBytes` 与文本策略测试覆盖.
3. `writeJson` 仅 JSON 测试调用. 删除封装及其专属断言和写入类型, 保留序列化, 顺序和无效值测试.
4. 两处安全相对路径判断使用相同算法. 合并到 `lib/common/filesystem.mjs`, 保留原路径检查和拒绝结果.
5. 两处 `escapeText` 完全相同, 移到现有公共文本模块, 所有转义顺序保留.
6. 分发与同步的三处诊断辅助实现完全相同, 同步直接导入分发模块的原实现, 排序和错误文字不变.
7. 两处前置元数据切片对短输入和缺失结束分隔符给出相同字节, 合并到公共文本模块; 原有字符串结束定位保留供其他调用方使用.
8. 五处独立 SHA-256 十六进制计算改用公共 `sha256`. `client.mjs` 和场景复合摘要保留原有计算.
9. 后台 Agent 列表和等待的响应与交付标记合并. 保留等待独有的 `cancelled` 字段, 输出成功后才标记已交付, 也保留外层捕获输出失败的时序. 原有失败输出测试覆盖此风险.
10. Claude `spawnProcess` 没有生产或测试注入调用方, 删除未使用参数和局部类型导入, 直接调用原生 `spawn`. 公共 `NativeSpawn` 仍供 Codex 注入测试使用.
11. 在既有 Claude 进程测试中对照权限副本检查实际 `--add-dir` 与 `Edit(...)` 参数, 没有修改授权生成逻辑或标志.
12. 18 个消费文件的 Native 类型路径迁到 `native-session.mjs`, 全量严格类型检查通过. 原生后端保留自身使用的局部类型导入, 新类型文件加入运行时清单以满足现有可达文件检查.


Reviewer 相关修改只有类型位置移动和相同原生进程调用的内联, 没有修改工具, 权限, 沙箱, 上下文或模型设置. 按 `docs/agents/source-checkout-reviewer-testing.md` 的不改变含义去重例外, 不运行能力 A/B.

第 2 轮 Code Standards 报告指出 OS reader 留有未使用形参和过时说明. Main 核实后删除这两处残留, 保留注入读取器的第二参数及转发, 没有改动读取结果. 复审范围为此差异及其影响.

第 2 轮要求符合报告的范围问题提交重核: What to build 同段明确列有公共路径校验, 转义, 分发, 前置元数据和 SHA-256 合并, 本轮用户的 Issue R 也逐项授权了这些文件. 末句 "只改清单明确授权的 lib/background-agent/** 范围" 限制的是该受禁目录内的例外, 并不排除同段其他清理任务. `release-manifest.json` 的单行新增是新类型文件满足既有可达文件检查的必要配套, 不增加行为或扩大清理范围. 请按同段完整任务重新判断该问题.

第 2 轮要求符合报告的统计和提前勾选问题已核实: 现已补齐准确统计, 并撤回第 2 项勾选. 计划在独立审核通过且实施提交完成后, 按非实施记录工作流补记勾选及提交证据, 然后结束本 issue; 不启动下一个 issue.

第 3 轮 Code Standards 为 `No problems.`. 要求符合 Reviewer 要求统一 What to build 第 7 行的路径措辞, 未接受 Comments 对目录例外的解释. Main 已核实: 本轮用户明确授权全部 12 项, 但实施后的一致性修正按 spec-readiness 的 Authorization timing 应仅记录而不改 subject, 且提交工作流从第 3 轮起不再开启措辞修复轮. 现向用户请求针对该末句和必要复审的精确例外, 未修改 subject, 未提交.

本轮用户已明确授权修正 What to build 的目录限制措辞, 范围保持原 12 项, 并例外批准第 4 轮提交审核. 原就绪记录是 `not-applicable` 例外, 没有 Spec Readiness Reviewer 线程; 按同一例外重新生成并提升记录, 在原要求符合 Reviewer 线程增量复审该措辞及其影响. 实现和测试字节与第 3 轮相同, 复用已有完整验证及 Code Standards 通过结果.

Main 裁决 2026-11-12 05:3x: 原 Reviewer 线程拒绝跨 Main 会话恢复, 返回 `Native thread belongs to another Main session.`. 用户明确批准用新线程替代原线程增量复审, 保留原报告路径和模型设置, 在第 4 轮对当前完整候选执行要求符合及 Code Standards 双轴审核. 新线程恢复状态使用当前 Main 会话工作区, 不绕过原会话归属检查.

第 4 轮两个新 Reviewer 均以 `ready` 完成. Code Standards 为 `No problems.`; 要求符合报告指出新增公共导出与 Text Policy 职责不满足本 issue 的行为保持例外. Main 核对长期开发规范的公共 Module 职责后, 按 What to build 的跳过条款撤回第 4, 5, 6, 7 项合并, 保留原局部实现, 不新增设计例外或修改长期规范. 前文逐项记录描述的是撤回前候选, 当前交付以本条和 Validation 为准.

第 4 轮报告的验收第 2 项仍未勾选是准确状态: 审核与提交成功后按已记录的非实施工作流补记. 统计问题已核实, 将以收尾候选的精确增删数替换旧统计及摘要.

撤回四项后的当前候选重新运行 `pnpm test` 全部 954 项通过, `pnpm typecheck`, 分发, Skill 投影, 安装脚本生成, 文本, 术语, 受影响文件语法与空白检查均通过. 提交尝试的下一轮只复审这四项撤回及记录修正; Engine 使用当前会话恢复记录继续两个新线程.
