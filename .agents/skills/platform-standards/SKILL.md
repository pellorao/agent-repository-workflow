---
name: platform-standards
description: 在 ARW 源码仓库中研究或修改受支持 Agent 平台 (Codex, Claude Code) 的标准: Projection 配置, Skill 引用规则, 目标路径和平台格式差异时使用. 不自动触发, 由维护者调用或按 AGENTS.md 索引读取.
disable-model-invocation: true
---

# Agent 平台标准

只在 ARW Source Checkout 中研究或修改平台标准时使用. 它不进入 Workflow Distribution. 修改前阅读 [开发长期规范](../../../docs/specs/agent-repository-workflow-development/spec.md).

## Responsibility boundary

Source Checkout 的实际工作流文件是创作权威. `distribution/` 是发布前同步产生的已审查发布载荷. 目标仓库操作只读取其 Engine Installation 携带的 Workflow Distribution, 不读取 Source Checkout 文件或网络文档.

只更改负责该行为的来源:

- `distribution/projections/config.json`: 从统一 Codex 格式 Skill 来源到每个平台的格式差异和目标映射. 只包含 `source`, `skills` 和 `platforms`; 平台项包含仅供参考的 `supportedVersionRange`, 格式差异和目标根目录.
- `distribution/config.json`: Repository-owned 初始文件声明. `distribution/baseline/` 中相应文件是这些文件有意维护的默认值.
- `distribution/projections/codex/config.toml`: Codex 仓库配置默认内容, 由 `platforms.codex.targets.configuration` 映射到 `.codex/config.toml`.
- 共用工作流内容变化时, 改实际 `.agents/skills/`, 受管理的 Agent 文档区域, Role 文档或许可证.
- 只有当前数据合同无法表达已确认行为时, 才改 `lib/arw-common/platform-adapter.mjs`.

Platform Adapter 与操作无关且只读: 解释 Projection 配置, 生成有序目标字节, 执行 Skill 引用分析和转换. 它不扫描用户级, 系统或嵌套仓库的 Agent 与 Skill 位置, 不探测 Agent 命令行, 不写仓库文件.

平台投射只处理文件与调用格式, 不保存角色的模型选择或执行权限. 修改角色工作方式时编辑角色文档, 修改运行设置时用所属用户配置, 修改平台格式时编辑投射配置.

不得在配置中存储证据 URL, 检查日期, 文档摘要值或优先级声明; 不得重新创建平台事实文件, 带版本的 Grammar 文件, 证据台账或静态预期输出清单. 除非数据必须独立于代码修订版本被读取或升级, 否则不加版本字段.

## Researching a platform change

平台语法或目标合同可能已经变化时, 根据该平台当前的官方资料验证行为. 研究证据留在 issue 或明确授权的研究记录中.

## Skill references

只有 Skill Package 中的 Markdown 文件参与引用分析和转换, 其他文件保留精确字节. 统一来源语法是 Codex `$name`. 有效身份只在 ASCII 空格, 水平制表符, 换行或反引号前结束.

当前 Skill 身份集合以外的潜在引用成为用户审查的 `additionalSkillReferences`; 非标准相邻字符成为用户审查的规范化位置 (`path`, `line`, `column`, `identity`). 用户在开发长期规范定义的两个临时逐行文件中删除拒绝的行. 不维护非 Skill 拒绝清单, 不推断平台名称映射.

## Validation

测试直接调用生产 Workflow Distribution Module 和 Platform Adapter, 断言准确的 Codex 与 Claude Code 目标路径和字节, 并用变异测试证明来源, 配置或输出错误时检查会失败. 不维护第二份预期输出树或金样文件. 覆盖重点: 扁平布局, 封闭配置, Codex 保留而 Claude Code 排除的 `agents/openai.yaml`, 仅 Markdown 引用转换, 额外引用与规范化位置, 精确的 `CLAUDE.md` 投射, 稳定顺序与不安全路径.

然后运行 `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs` 和 `node scripts/project-claude-skills.mjs --check`. Claude Code 支持以确定性投射字节验证, 不要求实时 Agent 会话测试.
