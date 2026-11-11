# 非实施提交流程

## Non-implementation commit workflow

只有精确的已暂存候选只包含已由初始规划记录, issue, map 或仓库工作流授权的符合条件内容, 且 (规则与文档项除外) 属于同一个 effort 时才使用. 符合条件的项只有:

- `.scratch/<NNNN>-<effort-slug>/spec.md` 和 `.scratch/<NNNN>-<effort-slug>/map.md`.
- ARW 解析为实施, Application Source 或 Wayfinder issue 的 `.scratch/<NNNN>-<effort-slug>/issues/<NN>-<issue-slug>.md`.
- `.scratch/<NNNN>-<effort-slug>/research/**` 或 `.scratch/<NNNN>-<effort-slug>/prototype/**` 下的安全普通文件, 可以使用任何扩展名, 不要求其他文件链接它们.
- 只含规则与文档 Markdown (范围见 `./SKILL.md` 的 Select the workflow 节) 的改动, 不要求就绪记录. 没有 issue 授权的此类改动不与任何 issue 的改动放在同一提交; 多处这类改动可以合并为一个提交, 提交说明正文逐项写明修改的原因和目的. 运行 `arw text check`, Main Agent 用 grep 自查跨文档引用和副本一致性. 例外: 改动审核系统本身 (Reviewer 角色, 关卡语义) 或长期规范合同条款时, 由 Main Agent 按 `../reviewer-launch/other-reviews.md` 手工准备并启动一个 `requirements-reviewer` (普通身份, `issueIds` 为空数组, 再次审核按 `reviewer-launch` 复用原线程, 不用 `commit-audit prepare`), 最多一轮, 不运行 Spec Readiness; Main Agent 处理报告问题后提交, 不复审.
- 安全的 `gitlink`. 它把子模块提交记录为当前仓库状态, 是否符合条件不取决于 Application 配置, 自身路径或其他已暂存项; Main Agent 仍按实际语义把它归入本次 effort.

候选可以删除该 effort 的辅助文件, 但必须保留每个已提交的 ARW Artifact 身份; 类型和编号不变的重命名属于身份保留. 候选使实施 issue 新进入 `completed` (包括从另一个终态转换) 时, 只有该 issue 没有就绪记录且没有 `行为保持重构例外:` 声明 (它的全部交付都是规则, 文档和 `.scratch` 记录) 才符合条件, 有就绪记录的 issue 走实施 issue 工作流; 新进入 `wontfix` 不受此限; `HEAD` 中已处于相同终态的 issue 不因其他字节变化而再次进入该状态.

运行 `arw commit-audit verify --non-implementation`, 它完成上述分类, 单一 effort, 未暂存替代内容 (含子模块 `HEAD`), 终态转换, ARW Artifact 解析, 文本格式, `git diff --cached --check` 和身份保留的全部机械检查, 不做语义或跨文件检查. 错误列表为空才提交; 失败时修复候选后重跑, 完整候选包含实施工作时改用实施 issue 工作流.

该工作流不运行 Spec Readiness, Commit Audit, Code Review 或任何独立 Reviewer (规则与文档例外的 `requirements-reviewer` 除外).
