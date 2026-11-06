# 修复 CLI 用法错误和诊断输出

Status: completed

## What to build

修复 `lib/arw.mjs` 中分流记录 E 的五项已授权缺陷: `lm` 和 `ls` 的重复选项错误与完整命令一致; 每个 `UsageError` 都包含 `usage()`; `-s ""` 使用空列表项错误; 工作流诊断保留并输出 `remediation`; 先解析命令, 只为使用配置的命令读取 `config.json`, 缺少配置时用法错误仍返回 2. 其他行为保持不变, 不修改 `lib/background-agent/**`, 不安装或发布.

预计代码净增不超过 25 行. 预计改动行数 (新增加删除): 代码 45, 测试 100, issue 和记录文本 50. 以公开 CLI 边界验证完整命令和别名, 空字符串及逗号空项, 缺少配置时的无效命令与有效无配置命令, 以及诊断修复建议的转义输出. 运行定向测试和完整 Source Checkout 验证.

## Acceptance criteria

- [x] `lm -f -f` 和 `ls --full --full` 分别与 `list maps` 和 `list specs` 返回相同的重复选项消息.
- [x] 所有用法错误包含使用说明并返回 2, 包括无效类型, 后台命令选项和后台列表选项; 空状态值与逗号空项均使用空项消息.
- [x] 工作流诊断保留并输出存在的 `remediation`, 正确转义控制字符; 没有该字段的诊断保持原输出.
- [x] 缺少 `config.json` 时无效命令和选项仍返回使用说明及退出码 2; 不使用配置的命令可正常执行; 使用配置的命令仍验证配置.
- [x] 定向测试, 完整源码验证, Spec Readiness 例外核对和两个独立提交审核通过; 完成记录包含估算与实际改动行数分类.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 915 个测试全部通过. 沙箱运行出现子进程及本机服务限制, 完整命令在具备能力的环境中原样重跑通过.
- `pnpm typecheck`, 三项 Source Checkout 分发检查, 四个受影响文件的 `node --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0096-cli-usage-errors/`, `git diff --check` 均通过.
- `tests/arw-entry.test.mjs` 覆盖别名重复选项, 全部遗漏使用说明的错误分支, 空值与空项消息, 缺失配置时的用法错误及无配置命令. `tests/arw-common/agent-cli.test.mjs` 保留使用配置的命令在仓库发现前验证配置的覆盖.
- `tests/repository-workflow/cli.test.mjs` 对 Codex 和 Claude Code 验证修复建议保留及控制字符转义. 定向测试 31 项通过, 新增和修改回调实测均低于 100 毫秒 (新增用例最大 17.2 毫秒, 修改的配置矩阵 13.4 毫秒).
- Spec Readiness 例外 `not-applicable` 已提升, 首次实施前完整核对通过. 首轮两个提交 Reviewer 均已返回 `ready`. Code Standards 报告为 `No problems.`; 要求符合报告指出控制字符转义及收尾记录问题, 已修复. 第 2 轮要求符合报告为 `No problems.`, Code Standards 正常结束并报告一项结构问题, 已按用户裁决记录不修, 第 3 轮 Code Standards 已正常返回 `ready`, 报告为 `No problems.`, 第 2 轮要求符合报告继续有效. `node arw.mjs commit-audit verify` 已取得空错误列表, `node arw.mjs spec-readiness verify --subject-only --issue issue:0096:01` 通过; 第 3 轮结束后已再次核对, 仍为空错误列表和通过结果.
- 估算改动行数 (新增加删除): 代码 45, 测试 100, issue 和记录文本 50. 实际代码 35 行, 测试 71 行, issue 和记录文本 60 行 (含就绪记录 13 行), 另有治理规格同步 4 行 (两份 spec 各改 1 行); 代码净增 5 行.

## Comments

本 issue 根据 `.tmp/triage.md` 中 Claude 对 E 的明确授权创建. 用户确认这些修复不需要治理设计, 使用单 issue effort 的 `not-applicable` 例外. 当前会话继承此确认. 无未决设计选择.

首轮要求符合审核指出修复建议中的 TAB 和 ESC 等控制字符未转义, 已扩展现有转义结果并增加 C0/C1 字符测试, 没有改变其他诊断字段的行为. 同时撤回提前勾选的审核验收项, 在全部关卡完成后再勾选. 两条记录问题均以最终收尾记录为准.

首轮 Commit Audit 摘要: `code: +4 lines (files: 1)`, `documents: 0 characters (files: 0)`, `tests: +65 lines (files: 3)`, `next ADR number: 0041`.

台账: lib/arw.mjs:813-814 记录不修 C0/C1 转义提取到公共模块属于结构调整, 不涉及行为缺陷; Claude 明确要求按第 3 轮起只修复行为缺陷的规则保留当前实现, 不申请例外.

第 2 轮 Commit Audit 摘要: `code: +5 lines (files: 1)`, `documents: 0 characters (files: 0)`, `tests: +65 lines (files: 3)`, `next ADR number: 0041`. 第 3 轮仅包含上述台账及完成记录变化, 实现与测试均与第 2 轮一致, 要求符合审核结果复用. 第 3 轮 Commit Audit 摘要与第 2 轮相同: `code: +5 lines (files: 1)`, `documents: 0 characters (files: 0)`, `tests: +65 lines (files: 3)`, `next ADR number: 0041`.

要求符合审核指出规格与新命令顺序及配置读取范围不一致 (`docs/specs/agent-repository-workflow/spec.md` 的启动顺序, `docs/specs/agent-repository-workflow-installation/spec.md` 的配置读取). 本 issue 的授权明确要求该行为, 故只同步这两处规格文字; 此规格同步由 Main Agent 授权, 依 AGENTS.md Baseline 例外视同用户确认.

台账: lib/arw.mjs 五处 `${usage()}\n` 前缀 转入后续 issue 把 usage() 移入 UsageError 构造需同时改约 76 处既有调用, 属结构重构, 本 issue 只补齐遗漏.
台账: lib/arw.mjs:1089-1091 使用配置命令的判断 转入后续 issue 合并为单一常量属结构调整, 现有分支行为正确.
