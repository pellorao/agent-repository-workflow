# 修复 wizard 记录与收尾重构

Status: completed

## What to build

实施 `.tmp/triage.md` 本轮唯一的 F' 分组, 本 effort 只含本 issue, 不创建 spec. 用户明确授权下列缺陷修复并确认无需治理设计, Spec Readiness 通过例外流程记录 `not-applicable`.

- `distribution/skills/wizard/template.sh`: `write_env` 读取失败时报告错误并返回, 不截断 `.env`; `grep` 无匹配的退出码 1 是正常结果. 检查写入失败, 失败项不得进入成功摘要. `set_var` 成功时进入最终摘要, 失败项保留待办. 添加回归测试.
- `distribution/skills/improve-codebase-architecture/SKILL.md`: 将 "自包含的 HTML" 改为 "依赖 CDN 的 HTML 文件". 只为这句更正及上述两项 wizard 修复在 `upstream/sources/mattpocock-skills/adoptions.md` 追加本地修改记录.
- 为 11-06 已合入的两项修复补定向测试: 非实施验证遇到无法解析的 issue 后继续其他检查, `diff-tree` 失败保留诊断.
- `lib/arw.mjs`: 把 `usage()` 拼接集中到 `UsageError` 构造器, 保持所有命令输出及退出码. 机械部分预算约 150 个改动行, 超出时只完成机械部分并报告.
- 把 `standardsPaths` 内的忽略规则求值提取到公共模块. Commit Audit 仍拥有规则选择, 已暂存候选来源和排除策略; 公共函数只对调用方提供的规则字节和路径求值, 调用方提供临时目录和外部忽略规则文件名. 不改变 `failedGitRead` 或 `runCheckIgnore` 位置.

体积预算: 非测试代码净增不超过 50 行, 代码, 测试和 issue/文档合计约 350 个改动行. 不为凑预算添加工作. 除已明确授权的 wizard 修复外保持行为, 输出, 公开 Interface 和持久状态不变. 不改 `lib/background-agent/**`, 不安装, 不推送, 不启动 ARW Reviewer 之外的 Agent.

预期验证: wizard 的 Bash 实际执行测试, Commit Audit 定向测试与现有 CLI 测试, 完整 Source Checkout 验证 (`pnpm typecheck`, `pnpm test`, 分发和投影及安装引导检查, 受影响 JavaScript 语法, 文本和术语检查, `git diff --check`), 内置两个 Reviewer 的 Commit Audit.

边界: `.env` 读错误, 无匹配与全匹配, 写错误及失败后的成功记录; GitHub variable 成功和失败摘要; 无法解析的 issue 与后续独立错误; 无效树导致 `diff-tree` 失败同时保留其他审核错误; 忽略规则沿用已有暂存字节, 嵌套规则, 否定规则和排除策略.

## Acceptance criteria

- [x] wizard 读失败不截断原文件, 写失败不记成功, 无匹配正常写入, variable 成败摘要正确, 测试证明上述行为.
- [x] HTML 描述和仅覆盖三项本地修改的上游采用记录已更新.
- [x] 两项合并修复有能观察诊断和后续检查结果的定向回归测试.
- [x] usage 拼接和忽略求值重构保持现有行为与责任边界, 未修改禁止区域.
- [x] 完整 Source Checkout 验证通过, 就绪例外有效, 完成记录含估计和实际体积分类.

## Blocked by

- None - can start immediately

## Validation

- `node arw.mjs spec-readiness verify --issue issue:0101:01`: 通过, 结果 `not-applicable`.
- `node --test --test-isolation=none --test-reporter=spec tests/wizard-template.test.mjs tests/commit-audit/cli.test.mjs`: 31/31 通过. wizard 4 个测试覆盖读取失败不截断, 写入失败中止, 无匹配正常写入及 variable 成败摘要; Commit Audit 新增 2 个诊断回归测试. 现有忽略规则测试同时验证 Codex 和 Claude Code 的暂存字节, 嵌套规则与否定规则. 新增案例耗时约 8-629 毫秒; 超过 100 毫秒者按本仓库 Baseline 例外保留, 不为测试改变生产代码.
- `pnpm test`: 在允许本机回环监听且使用默认临时目录的环境中全套 926/926 通过, 0 失败, 约 7 秒. 先前尝试的沙箱监听限制及将临时目录放在仓库内的环境问题不作为通过证据; 新模块遗漏载荷清单导致的 4 个失败已通过补齐 `release-manifest.json` 修复.
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`: 全部通过.
- `node --check` 检查 `lib/arw.mjs`, `lib/commit-audit/commit-audit.mjs`, `lib/common/git-ignore.mjs`, `tests/commit-audit/cli.test.mjs`, `tests/wizard-template.test.mjs`; `bash -n distribution/skills/wizard/template.sh`: 全部通过.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0101-wizard-and-merge-cleanup/`, `git diff --check`: 通过. 新 issue 和上游采用记录的语言检查分别为 Chinese 82.1% 和 85.1%, 普通叙述均为中文.
- 对 HEAD 解析器和当前解析器运行 390 组输入差分检查, 返回结果, 完整错误文字, 错误名称及退出码全部一致. `lib/arw.mjs` 只有一处 `usage()` 拼接, 机械改动为 154 行, 比约 150 行估计高 4 行, 未追加其他清理.
- 预计改动行按代码约 220, 测试约 80, issue/文档约 50 分类, 总计约 350; 非测试代码净增预算 50 行. 合并入主仓库后实测非测试代码净增 49 行 (含 `.agents/skills`, `.claude/skills` 两份镜像副本, 随 `distribution/` 同步落地), 低于 50 行预算; 测试净增 89 行; 持久文档净增约 302 字符 (issue 和就绪记录另计).

## Comments

用户通过本轮清单明确指定 effort 0101 和唯一 F', 授权创建实施 issue, 以及无需治理设计的就绪例外. Main Agent 确认 Skill 单句更正和 wizard 缺陷修复的具体改动, 按 Source Checkout Baseline 例外执行. 其余候选不处理.


Commit Audit 第 1 轮候选体积摘要:

```text
code: +25 lines (files: 5)
  distribution/skills/wizard/template.sh +12
  lib/arw.mjs 0
  lib/commit-audit/commit-audit.mjs -13
  lib/common/git-ignore.mjs +25
  release-manifest.json +1
documents: +294 characters (files: 2)
  distribution/skills/improve-codebase-architecture/SKILL.md +4
  upstream/sources/mattpocock-skills/adoptions.md +290
tests: +89 lines (files: 2)
  tests/commit-audit/cli.test.mjs +23
  tests/wizard-template.test.mjs +66
next ADR number: 0041
```

实测改动行 (新增加删除) 分类: 代码 263 行, 测试 91 行, issue/文档约 98 行 (含就绪记录 13 行), 总计约 452 行 (含合并入主仓库时的镜像副本与审核台账). 超过约 350 行的部分主要是必要的 issue, 就绪和验证记录, 没有加入额外候选或填充工作.

Commit Audit 两个 Reviewer 均正常返回 `ready`. Code Standards 报告 `No problems.`; 要求符合审核只提出受审完成记录缺少实际体积分类, Main Agent 独立核对后在本记录中补齐. 抽查 `write_env` 无匹配继续写入及失败中止, `standardsPaths` 仍从暂存候选选择规则并保留排除策略; 390 组解析器差分也支持原有 CLI 错误输出不变. 收尾只改本 issue 的 `## Validation` 和 `## Comments`, 不改变状态, 验收勾选或受审实现. `node arw.mjs commit-audit verify` 返回空 `errors` 列表, `node arw.mjs spec-readiness verify --subject-only --issue issue:0101:01` 通过.

合并入主仓库后的提交审核 (克隆审核不可复用, 基线与上下文已变) 第 1 轮, 两个 Reviewer 均 ready. 要求符合 Reviewer 指出修复只落在 distribution 派生副本, 属实, 已把同样改动落到 `.agents/skills/wizard/template.sh` 和 `.agents/skills/improve-codebase-architecture/SKILL.md`, 并重新投影 `.claude/skills/`, 三处字节一致, 交该 Reviewer 复审. 其余问题按台账处置:

台账: tests/wizard-template.test.mjs 位于 tests/ 根目录 记录不修 目录归属偏好, 不改变行为.
台账: tests/commit-audit/cli.test.mjs:450,460-464 否定规则未被区分 转入后续 issue 测试覆盖补强, 生产代码行为未变.
台账: lib/commit-audit/commit-audit.mjs:196,204 排除策略无测试 转入后续 issue 既有问题, 本次未改该规则.
