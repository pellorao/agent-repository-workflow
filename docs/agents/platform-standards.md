# Agent 平台标准

该工作流只适用于 ARW 源码仓库. 更改受支持的平台标准, Projection 配置, Skill 引用规则或目标路径前, 阅读 [开发长期规范](../specs/agent-repository-workflow-development/spec.md).

## Responsibility boundary

Source Checkout 的实际工作流文件是创作权威. `distribution/` 是开发长期规范所定义的发布前同步产生的已审查发布载荷. 目标仓库操作只读取其 Engine Installation 携带的 Workflow Distribution. 它不得读取当前 Source Checkout 文件, Upstream Sync 状态或网络文档.

`distribution/projections/config.json` 负责从统一的 Codex 格式 Skill 来源映射到每个受支持的平台. 它只包含 `source`, `skills` 和 `platforms`. 平台项包含仅供参考的 `supportedVersionRange`, 格式差异和目标根目录.

不得重新创建平台特定事实文件, 带版本的 Grammar 文件, 环境证据台账或静态预期输出清单.

`distribution/config.json` 负责 Repository-owned 初始文件声明. 这些文件的规范来源由 Workflow Distribution 独立维护, 不从 Source Checkout 当前的实际配置中复制.

Codex 仓库配置默认内容在 `distribution/projections/codex/config.toml` 独立维护, `platforms.codex.targets.configuration` 映射到 `.codex/config.toml`. 同步保留该文件, 分发构建验证并携带它. Platform Adapter 只解释映射; 通用配置模块处理 TOML 内容, Repository Workflow 负责目标文件观察和事务.

Platform Adapter 与操作无关且只读. 它解释共用 Projection 配置, 生成有序的目标字节, 并执行 Skill 引用分析和转换.

它不扫描用户, `system`, 随附内容, 普通子目录或嵌套仓库中的 Agent 和 Skill 位置. 它不建立平台优先级证据, 探测 Agent 命令行接口, 比较运行时版本, 写入仓库文件或授权事务.

规范审核角色通过完整的共享文档传递审核责任, 独立运行入口负责实际执行. 平台投射只处理文件与调用格式, 不另外保存角色的模型选择或执行权限, 避免用户调整配置后出现多套默认值. 维护者修改角色的工作方式时编辑角色文档, 修改运行设置时使用所属用户配置, 修改平台格式时编辑投射配置; 每项变更在自己的责任范围内接受审查和验证. 这些边界让静态文件安装保持确定性, 不需要通过启动真实模型判断一次投射是否完成.

## Reviewing a platform change

如果平台语法或目标合同可能已经变化, 根据当前受支持平台发布的官方资料验证行为. 需要解释变更时, 把研究证据保留在 issue 或明确授权的研究记录中.

不得在 Projection 配置中存储证据 URL, 检查日期, 文档摘要值, 随附内容身份清单或优先级声明.

只更改负责该行为的有效来源:

- `distribution/projections/config.json` 负责跨平台格式和目标映射.
- `distribution/config.json` 负责 Repository-owned 初始文件声明.
- `distribution/baseline/` 中相应的文件负责有意维护的 Repository-owned 初始文件默认值.
- 共用工作流内容发生变化时, 更改实际 `.agents/skills/`, 受管理的 Agent 文档区域, Role 文档或许可证.
- 只有当前数据合同无法表达已确认行为时, 才更改 `lib/platform-adapter.mjs` 或最终负责它的 Module.
- 生产 Module 边界上的确定性测试.

不得仅为了重复目录合同或生产代码已经固定的事实而添加字段. 除非数据必须独立于包含它的代码修订版本被读取或升级, 否则不得添加版本字段.

如果 Source Checkout 维护者有意向 Workflow Distribution 添加 Repository-owned 初始文件, 应在 `distribution/config.json` 中声明其准确目标, 并使规范来源与目标保持一致.

## Skill references

只有 Skill Package 中的 Markdown 文件参与 Skill 引用分析和转换. 其他所有安全普通文件保留精确字节. 统一来源语法是 Codex `$name`. 有效身份只在 ASCII 空格, 水平制表符, 换行或反引号前结束.

当前 Skill 身份集合以外的潜在引用成为用户审查的 `additionalSkillReferences`. 非标准相邻字符成为用户审查的规范化位置, 字段顺序为 `path`, `line`, `column`, `identity`.

不得维护非 Skill 拒绝清单或推断平台名称映射.

用户审查使用开发长期规范定义的两个临时逐行文件, 以及能够等待的 `reviewEditor` 合同. 用户删除拒绝的行. 不得要求用户编辑完整的最终 JSON 配置, 或把较长的替代列表粘贴到聊天中.

## Source Checkout and pre-release synchronization

`.agents/skills/` 中的项目视图是实际 Skill 权威. 每个 Skill 名称都是直接子项, 软件包不保留上游类别目录. Upstream Sync 更新该实际视图, 而不是 Workflow Distribution.

源码仓库发布前, 完成开发长期规范负责的 `review`, `prepare` 和已授权 `apply` 工作流. 审查精确且有意义的来源变更, 且只授权显示的 `planDigest`. 同步不会把当前 `.arwignore` 内容复制到 Repository-owned 初始文件.

同步输出可以包含已暂存来源字节, 但操作前, 其负责的 Workflow Distribution 路径不得有未暂存或未跟踪变更. `apply` 失败时, 把这些路径恢复到 Git 索引基线, 只删除精确的新建路径, 并从 Skill 引用审查重新开始. 不得从混合的中间载荷继续.

## Deterministic validation

测试直接调用生产 Workflow Distribution Module 和 Platform Adapter. 断言精确的 Codex 和 Claude Code 目标路径与字节, 并加入能够证明来源, 配置, 初始文件或目标输出错误时检查会失败的变异测试. 不得生成或维护 `platform-projection-goldens.json`, 定位信息哈希, 第二个预期输出树或发布覆盖台账.

验证至少必须覆盖:

- 扁平化的 Baseline, Skill 和 Role 布局.
- 封闭的 Workflow Distribution 和 Projection 配置.
- Codex 保留且 Claude Code 排除的 `agents/openai.yaml`.
- 仅 Markdown 引用转换和准确的非 Markdown 字节.
- 额外引用, 规范化位置和全部 4 种终止符.
- 仓库负责的初始文件目标.
- 精确的 `CLAUDE.md` 投射内容.
- 稳定顺序, 不安全路径, 链接, 不常见文件类型和大小写冲突.
- 来源, 配置和投射字节的变异测试.

然后运行定向测试, 完整的 `pnpm typecheck` 和 `pnpm test`, 适用的 `node --check`, `node arw.mjs text check`, 使用当前 issue 实际 effort 目录的 `node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/`, 以及 `git diff --check`.

实时平台行为只用于可选的回归诊断; Reviewer 能力测试由维护者显式调用 `$reviewer-capability` Skill. Claude Code 支持要求确定性的 Skill 与 `CLAUDE.md` 投射字节, Workflow Distribution 构建, Platform Projection 和变异验证, 不要求实时 Agent 或原生会话测试.

## Release boundary

Source Checkout 发布使用已经同步且提交的候选内容. 它不决定实际文件转换, 不重新生成静态基准, 不审计静态要求台账, 也不修复 Workflow Distribution. 如果发布前同步尚未产生完整可审查的载荷, 则在发布验证前停止.
