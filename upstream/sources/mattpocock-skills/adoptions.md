# mattpocock-skills 采用记录

按 `$upstream-sync` Skill 追加. 每节记录一次采用: 日期, 旧提交 -> 新提交, 采用, 部分采用和拒绝的内容及原因.

## 391a2701dd948f94f56a39f7533f8eea9a859c87 -> 6acc160e4e0cd062dbbbd7a1b26ae92855edf07e

由旧版 Upstream Sync 引擎完成, 原 Sync Record `sync-records/94cb3aa94a55a4a7adb4886738b519d2de6d8032134c31eef1a8d6dcbf20af67.json` 见 Git 历史.

## 2026-10-30 本地化 (无上游提交变化)

`to-spec`, `to-tickets`, `triage`, `to-questionnaire`, `wayfinder`, `teach` 已按 ARW 本地模型改写并译为简体中文, 不再与上游逐字一致. 主要变化: 去掉外部跟踪器, 外部 PR, `bug`/`enhancement` 类别标签, `.out-of-scope/` 知识库, 分流免责声明和 `arw workflow verify` 回退; `triage` 的 `AGENT-BRIEF.md` 与 `OUT-OF-SCOPE.md` 并入 `SKILL.md` 后删除; `to-spec` 不再应用分流标签并交由 `spec-readiness` 决定 `## Module Design`; `to-questionnaire` 输出改到 effort 的 `research/` 或会话工作区; `teach` 的工作区改为用户指定的仓库外目录. 之后的上游同步以这些版本为 Ours, 逐块解决冲突, 不复活被删除的内容.

## 2026-11-03 拒绝 3 个 Skill (提交不变, 仍为 6acc160e4e0cd062dbbbd7a1b26ae92855edf07e)

不经同步, 维护者审定删除下列已采用的 Skill, 并把上游路径加入 `source.json` 的 `exclude`:

- `skills/productivity/handoff/`: 交接作用已由 issue, 台账, 就绪记录等持久记录和平台自带的上下文压缩覆盖.
- `skills/engineering/resolving-merge-conflicts/`: 针对并行分支合并, ARW 的工单在主工作区串行进行.
- `skills/engineering/triage/`: 自带的分诊状态机与 ARW issue 的 Status 和分流标签不一致.

## 2026-11-03 6acc160e4e0cd062dbbbd7a1b26ae92855edf07e -> d1478fcb140db0b93c0c8df17bcfd311844749d0 (v1.3.2)

同步目标改为上游最新发布版 v1.3.2, 不跟 `main` 上未发布的提交.

采用:

- `diagnosing-bugs`: 强制变红时先与原始副本 `diff` 证明改动生效; 删除 Cleanup 中 "什么本可以防止这个 bug" 一段 (预防建议改由用户手册提示运行 `$retro`).
- `tdd`: 每个候选 Seam 附一行能抓到和抓不到什么.
- `teach`: 工作区路径相对启动目录解析; 测验正确答案位置轮换.
- `grilling`: 上游的每轮格式 (不用 emoji 标记), 措辞让回答 "是" 即接受推荐答案.
- `research`, `grilling`, `codebase-design` (`DESIGN-IT-TWICE.md`), `improve-codebase-architecture` 中的 "subagent 从全新上下文启动": 不写进各 Skill, 改为在 `docs/agents/subagent-allocation.md` 写一次, 对所有新建实例生效.
- `implement`: 开工前先说出授权 issue 的标题.
- `wizard/template.sh`: 逐字节采用.
- 新 Skill `retro`: 译为中文并按 ARW 本地化 (Reviewer 与编码规范位置, 默认只看当前会话, 选定候选后按 `$rule-and-design-changes` 实施), 分发, 只能显式调用.

拒绝:

- 全仓库去长破折号, 措辞润色, Skill 引用改为 "call the Skill tool" 写法: ARW 使用 `$name`.
- `CONTEXT.md` 改名 `GLOSSARY.md` (含 `domain-modeling/CONTEXT-FORMAT.md` 改名和 `wait-what` 的 MAP 引用): ARW 代码和分发物使用 `CONTEXT.md`.
- `code-review`, `to-spec`, `to-tickets`, `wayfinder` 中的外部跟踪器, sub-issue, 分流标签和 PR 相关改动, `domain-modeling` 的 description: 本地已改写为 ARW 流程.
- 新 Skill `implement-spec` (多 worktree 并行实施) 和 `pr` (PR 正文模板): 与 ARW 主工作区串行实施和不开 PR 的流程不符, 加入 `exclude`.

## 2026-11-07 Local modifications

上游提交不变. `wizard/template.sh` 本地修复: `write_env` 区分读取失败与 `grep` 无匹配, 读取失败时不截断原文件; 检查写入失败, 不记录成功; `set_var` 把成功设置的 GitHub variable 纳入最终摘要, 失败仍记待办. `improve-codebase-architecture/SKILL.md` 将报告描述更正为依赖 CDN 的 HTML 文件, 与其 Tailwind 和 Mermaid 来源一致. 后续同步保留这三项本地修改.
