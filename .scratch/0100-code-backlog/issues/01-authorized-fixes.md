# 修复机器输入与向导行为并清理合并遗留

Status: ready-for-human

## What to build

按 `.tmp/triage.md` 的 F 分组完成已确认缺陷与合并遗留, 本 effort 的下一 issue 承载 G. 预计改动约 500 行, 非测试代码净增预算 +60 行, 测试约 +160 行, 文档净增预算 600 字符; 完成时分别记录代码, 测试和 issue/文档的预计与实测变更量.

- F1: `lib/background-agent/machine.mjs` 跳过空 JSONL 行, 合法请求与无效非空输入的结果保持不变.
- F2: `distribution/skills/wizard/template.sh` 的 `write_env` 读取失败时报告错误并返回, 不截断原文件; 检查写回失败, 失败不得进入成功摘要. 无匹配项时 grep 的退出码 1 仍为正常情况.
- F3: 成功的 GitHub variable 写入进入最终摘要, 失败仍进入待办.
- F4: `distribution/skills/improve-codebase-architecture/SKILL.md` 改称依赖 CDN 的 HTML, 在 `upstream/sources/mattpocock-skills/adoptions.md` 记录 F2 到 F4 的本地修改.
- F5: 维护端口改为 `20000 + hash % 10000`, 控制端口不变, 不修改规范. 本会话用户明确允许 F1 与 F5 修改上述两个后台模块文件; 同目录其他文件不在范围内.
- F6: 为非实施核验遇到不可解析 issue 后继续检查, 以及 `diff-tree` 失败保留诊断, 补充定向回归测试.
- 合并遗留: 将 `usage()` 前缀统一放进 `UsageError` 构造函数, 保持 CLI 文本不变, 机械替换控制在约 150 变更行; 将重复的需要配置命令集合并为常量; 将 `standardsPaths` 的忽略规则求值提取到共享模块. 不改变 `failedGitRead` 或 `runCheckIgnore` 的位置.

忽略规则的选择, 暂存候选来源, 排除策略和错误文本仍由 Commit Audit 拥有; 共享求值仅接受调用方提供的规则字节, 待查路径和既定 Git 参数, 在临时快照运行 Git 并返回匹配路径, 不发现仓库, 不读取实时规则, 不决定审核范围.

F1 到 F5 是 triage 明确确认的无设计决定缺陷修复, 按普通 Spec Readiness 独立审核确认就绪. 提交依照正常 Commit Audit 取得两个内置 Reviewer 的独立结论并处理问题, 不推送. 其余只补覆盖或保持行为的机械重构, 不改变模块职责, 公开接口, 数据来源和持久状态, 不添加长期规范. 除上述授权行为外保持输出和错误结果.

## Acceptance criteria

- [ ] F1 到 F5 及合并遗留全部完成, 有效输入, 空输入, 读取失败, 写入失败和摘要成功/失败分支得到最少充分覆盖.
- [ ] F6 的两个回归由定向测试证明; 忽略规则仍使用暂存版本并覆盖 Codex 和 Claude Code.
- [ ] 完整 Source Checkout 验证通过, 包括 pnpm typecheck, pnpm test, 分发检查, Claude 投影检查, 安装引导生成检查, 受影响文件语法, 文本, 术语和差异空白检查.


## Blocked by

- None - can start immediately

## Comments

Main Agent 确认 F4 的具体措辞为 "依赖 CDN 的 HTML 文件", 并确认上游本地修改记录只记述 F2 到 F4. 这与 triage 既有授权一致, 适用 Source Checkout 文档确认例外. 不运行安装或发布, 不读取外部台账, 不启动非 ARW Reviewer 的 Agent.

用户已裁决: triage 的 "同一 effort 两个 issue" 与 not-applicable 例外不能同时满足, 引擎要求例外 effort 恰有一个实施 issue. F 和 G 保留同一 effort, 均走更严格的普通 Spec Readiness, 不视为豁免; 最终汇总报告该冲突.

就绪审核第 1 轮返回 ready, 报告包含 3 个 gap, 已经 generate 和 promote 保存原结论, 未开始实现. F1 的逐行错误合同见 docs/specs/agent-repository-workflow/spec.md:264; F5 的共享固定维护互斥与源码优先使用已安装管理进程见 docs/specs/agent-repository-workflow-installation/spec.md:193,348. Main 独立核对认为存在需要用户裁决的规范及版本过渡冲突. 第 3 项通过明确公共机械求值与 Commit Audit 业务策略的边界修正 issue, 待下一轮审核确认.

起点复核: lib/arw.mjs:1089-1091 的配置加载判定已只有一处, 没有重复的完整条件可合并, 此项不另加常量.

用户当前无法裁决 F1 规范冲突与 F5 版本过渡问题, 明确要求保留记录并推进独立积压. F 暂停于就绪 gap, 未开始实现; 后续恢复须先处理待决事项并重新就绪审核.

拆分去向 (合并入主仓库时记录, 本 issue 不实施): F1 与 F5 转 `ARW/f15design` 待用户裁决规范冲突后另行处理; F2 到 F4, F6 与合并遗留拆到 effort 0101 的 F' issue 实施 (克隆提交 `6ccc968`). 本 issue 保持 ready-for-human.
