# prepare 输出实测体积和下一个 ADR 编号

Status: completed

## What to build

按本 effort 的 spec 实现: `arw commit-audit prepare` 在标准错误输出已暂存候选的体积摘要和下一个 ADR 编号, 标准输出仍然只有轮目录绝对路径. 摘要的口径 (计入范围, 测试, 文档, 代码三类的归属顺序, 行与字符的计法, 重命名和删除的计法), 下一个 ADR 编号规则, 不改变任何关卡语义和不增加 Git 读取都见 spec 的 Implementation Decisions.

同一 issue 内的配套修改:

- 长期规范的 Commit Audit 一节写明 `prepare` 除轮目录外在标准错误输出该摘要, 并完整写出摘要口径 (计入范围, 三类归属顺序, 行与字符的计法, 逐文件列表与合计, 下一个 ADR 编号规则, 只描述本次候选, 分多次提交的 issue 把各次数字相加, 不应用 `.arwignore`) 使长期文档自足, 与本 effort 的 spec 一致; Commit Audit Module 的责任描述增加这项只读计算; 该节中 `prepare` 的 Interface 描述同步.
- 通用提交工作流 Skill 的 Run 一节在 `prepare` 一步增加一句: 摘要中的数字与下一个 ADR 编号写 issue 的 `## Validation` 或 `## Comments` 时直接复制 (一个 issue 分多次提交时把各次数字相加). 该 Skill 的 `.claude` 投影和 Workflow Distribution 副本由仓库的投影与同步脚本更新, 不手写.

预期验证:

- 在 Commit Audit 现有测试夹具上增加一个测试, 暂存候选同时含非测试代码 (有增有删), 测试, Markdown 文档, `.scratch` 记录和已有 ADR; 观察 `prepare` 返回的摘要: 三类合计与文件列表正确, `.scratch` 记录不出现, ADR 编号为已暂存最大编号加 1.
- 再增加一个通过命令入口的观察: 标准输出只含轮目录路径, 摘要在标准错误. 复用现有暂存候选夹具, 不新增夹具.
- 运行 `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`.
- 本 issue 改动的文档运行 `arw text check`.

相关边界: 候选没有计入文件时三类合计为 0; 没有 ADR 时编号为 `0001`; 删除多于新增时净增为负.

体积预算: 非测试代码净增约 40 行 (度量与文本格式化约 35 行, 命令入口约 3 行, 其余为类型声明).

## Acceptance criteria

- [x] `prepare` 的摘要按 spec 口径给出文件列表, 代码, 文档, 测试三类的净增合计和文件数, 以及下一个 ADR 编号; `.scratch` 记录不出现在摘要中.
- [x] 通过命令入口运行时, 标准输出仍然只含轮目录绝对路径, 摘要写在标准错误; `request.json`, Reviewer 交接和关卡行为不变.
- [x] 长期规范和提交工作流 Skill (含投影与分发副本) 已同步, 相关检查脚本全部通过; `pnpm test` 和 `pnpm typecheck` 通过.

## Blocked by

- None - can start immediately

## Validation

- 实测非测试代码净增 +25 行 (`git diff --cached --numstat HEAD -- lib`: `lib/arw.mjs` +1/-0, `lib/commit-audit/commit-audit.mjs` +26/-2), 低于约 40 行的预算.
- Commit Audit CLI 测试新增 2 项: 摘要测试 (暂存代码, 测试, 多种 Markdown, `.scratch` 记录, 两个 ADR 的候选, 断言完整摘要文本和 `next ADR number: 0005`) 与命令入口测试 (标准输出只含轮目录, 标准错误含摘要); 18 项全部通过, 单项约 30 毫秒.
- `pnpm test` 873 项通过, `pnpm typecheck` 通过, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 通过, `arw text check` 通过.
- 提交 Skill 的副本: Main 在已暂存树上运行 `node scripts/sync-workflow-distribution.mjs` (输出 "Workflow Distribution synchronization completed.") 与 `node scripts/project-claude-skills.mjs` (写出 65 个 `.claude/skills/` 文件), 两者都没有产生任何未暂存差异, 即 `distribution/skills/commit/SKILL.md` 与 `.claude/skills/commit/SKILL.md` 与脚本输出一致.
- `arw spec-readiness verify --issue issue:0061:01 --subject-only` 退出码 0 (完整 `verify` 因长期规范作为 Input 已被本 issue 修改而过期, 属已开始实施后的预期).

## Comments

- Spec Readiness: 经 4 轮 Reviewer (haiku high) 审核, 第 4 轮 `No problems.`. 前 3 轮处置: 长期规范须自足写出口径 (写入 What to build); `.arwignore` 取自工作树使数字不可只用受审树复算, 改为不应用 `.arwignore` 并在 spec 写明替代方案与成本; 多次提交的 issue 数字相加 (写入 spec, 长期规范和 Skill); 去掉含义不明的测试耗时表述; 补充放在 `Commit Audit Module` 而非 `Repository State Inspector` 的理由.
- 偏离: 摘要的文件数写作 `(files: <n>)` 而非自然语言, 避免 "1 files" 的单复数问题.
- 第 1 轮处置 (Main): 测试中只用一次的 `stageSummaryChanges` 内联进测试; 只用一次的码点计数内联; 记录副本同步脚本的运行结果 (见 `## Validation`).
- 台账: lib/commit-audit/commit-audit.mjs countLines 冲突裁决 第 1 轮 Code Standards 要求把行数计数移入 `lib/common` 与 `lib/reviewer-capability/evidence.mjs` 的 `lineCounts` 共用, 第 2 轮要求符合审核指出 `lib/common/text-policy.mjs` 按开发长期规范只拥有编码与换行规则; 按本 effort spec (摘要属于 Commit Audit Module) 计数留在 `commit-audit.mjs` 内, 不改 Text Policy 合同也不新增公共模块, 与 `lineCounts` 的一行重复接受. 第 3 轮 Code Standards 再提新增 `lib/common` 度量模块: 为一个一行函数新增公共模块并改开发长期规范的公共能力清单, 按 Efficiency First 第 1, 2 条投入与收益不相称, 第 3 轮起非行为缺陷不再开修复轮, 维持本裁决.
