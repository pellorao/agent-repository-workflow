# Source Checkout 确定性验证

## Source Checkout deterministic coverage

长期规范负责产品行为. 本节负责实际检验这些行为的当前 Source Checkout 确定性测试矩阵细节. 把这些测试保持在公开 Module Interface 上. 如果不依赖私有辅助程序名称, 临时目录前缀和测试 Adapter 调用日志结构, 也能保留相同的可观察覆盖, 则这些内容不属于合同.

### Repository workflow and Agent launch

Agent CLI 启动覆盖包括没有调用方参数, 多个普通参数, Codex `resume --last`, Claude Code `--resume <session>`, 字面 `--`, 位于调用方参数之前的已配置参数, 子进程非零退出和生成进程失败. 它不得启动真实 Agent CLI.

Repository Workflow 覆盖使用注入的提示 Adapter 验证每项适用的说明, 示例, 消息, 选择集合和顺序. 终端集成验证解释文字出现在简短提示之前. 交互式替换和完整的非交互式替换必须把 `src` 和 `src/` 视为相同的 Repository Profile 根目录观察, 计划和锁. 无效根目录矩阵必须在应用前失败, 并保留现有锁和受管理的输出字节.

### Installation and identity

Windows PATH 覆盖使用公开责任归属操作实际检验安装写入, 等效空操作结果, 禁用注册, 卸载重写, 整值删除, 通知成功, 返回零, 超时和异常. 断言持久 Registry 变更在通知前完成, 且通知警告不会更改责任归属, 清单顺序或最终操作结果. 真实 Windows 验证在安装和卸载后, 从正在运行的 Explorer 启动新 PowerShell 进程, 然后验证 Installation 目录是否按要求参与 `arw` 解析.

软件包身份覆盖根据适用的 `package.json` 推导当前稳定预期, 并包含有效解析, 缺失或不可读输入, 非 UTF-8 字节, 格式错误的 JSON, 产品名称不匹配, 缺失版本和无效的稳定 SemVer. 进程身份覆盖包括仅有软件包权威的 Source Checkout, 仅有清单权威的 Installation, 两个权威都存在, 两者都不存在, 以及所选权威损坏且不使用后备路径. 没有 Git 证据的本地安装程序集成证明当前运行时字节得到复制, 固定的 `-pre` 身份得到报告和记录, 且 Installation 中没有 `package.json`. Installation 覆盖包括本地和严格发布输入边界, 稳定版本和固定 `-pre` 的顺序, 降级拒绝, 写入前的载荷失败, 以及事务恢复. 发布载荷覆盖验证精确的清单字段, 从运行时和受管理清单中排除 `package.json`, 检测软件包和标签不匹配, 独立验证 Git 树中的软件包, 并使每项软件包检查在 Installation 写入前失败. 发布升级测试从候选历史中低于候选版本的最近稳定 Release tag 建立真实旧版本 checkout, 并在安装写入前验证 tag, commit 和软件包版本身份一致.

### Issue and readiness integration

Issue 文档要求覆盖包括相对于仓库根目录的 spec 和仓库文档引用, 可选锚点, `Not required`, 错误位置, `../`, `./`, 绝对路径, 反斜杠, NUL, 路径穿越和无效锚点. Spec Readiness 和 Commit Audit 必须使用相同的归一化结果, 且不得相对于 issue 目录进行解析. 路径规则迁移只能更改非终态 issue 当前的 `## Spec Requirement`. 定向检查保留终态 issue 字节和 `## Comments` 字节.

### Application and JIRA workflow

纯 Module 覆盖通过确定性的 Git, HTTP 和 Browser Adapter 调用公开 Application 和 JIRA Interface, 并断言完整的成功, 阻断项, 失败阶段, 影响和恢复结果. 公开 CLI 覆盖使用隔离的 Application 仓库, 真实临时 Git 子模块, 裸远程仓库, 本地 JIRA HTTP 服务和记录型 Browser Adapter. 通过生产命令和外部服务边界观察标准输出, 标准错误, 退出代码, 工作树, Git 索引, 引用和 HTTP 请求. 已安装 CLI 集成运行已经安装的入口, 验证 Application 配置发现和命令路由, 把全局 `jira.listLimit` 与仓库 `arw.config.json` 组合, 且不读取 Source Checkout 内部路径.

Application 配置覆盖包括 Application Member, Application Leader, 空模块, 使用默认值创建, 无效或缺失字段, 名称, 路径, URL 和精确状态. Repository Workflow 覆盖包括 `workflow init` 和 `workflow update` 的配置创建, 转换规划和事务行为.

JIRA 发现覆盖包括单页列表, 总数, 数量限制覆盖值, 精确 JQL, 标题归一化, 打印分页, 稳定 JSON 结构, issue key 空白和控制字符拒绝, 保留字符路径段编码, 打开 URL 和失败. 通过确定性 HTTP Adapter 和使用本地服务的生产 Adapter, 覆盖 10 秒超时, 不重试, 拒绝重定向, 安全诊断和令牌遮盖.

关联覆盖包括同一 Module 阻断项, 跨仓库外部依赖, 后续归一化, 多个受影响的 Module 仓库, 状态保留, 终态拒绝, 干净状态和 Git 索引前提条件, 成功的未暂存输出, 阻断时零替换, 事务失败和工作树恢复结果.

子模块覆盖包括零模块, 全有或全无的切换预检, 本地和远程分支选择, 回滚结果, 分支不匹配, 干净状态, 落后且可快进, 超前, 分叉, 保留的部分拉取, 失败影响, 以及最终本地与远程相等. Application 同步覆盖包括 Application 写入前每个 Module 的收敛, 关联验证, 状态前进, 回退和终态镜像, 完整替换当前 Downstream changes, 删除旧项, 保留普通评论, 空输入, 不安全结构, 稳定的汇总诊断, 多 Module 的全有或全无行为, 事务恢复, 未暂存 `gitlink` 和 issue 替换, 以及 Application 仓库独立性.

Module 修正覆盖包括每个软锁, Acceptance 任务列表标记归一化, 关联硬锁, 已变化的非空 Downstream changes 列表, 已暂存和未暂存内容共存, 同时发生的普通 issue 变更, Git 和文件系统读取失败, 以及零写入. Workflow Distribution 和 Repository Workflow 投射覆盖证明 Codex 和 Claude Code 的仅显式元数据, 相同的 Skill Markdown 内容, Claude Code 排除 `agents/openai.yaml`, 共用 Module 交接, 以及目标 Agent 规则中没有 Application 操作方法.

完成流程覆盖包括只涉及 spec 的验收, effort issue 下限, 唯一验证 issue, 依赖完整性, 普通 `wontfix`, 验证 issue 的 `completed` 要求, 读取已经提交的 HEAD, 以及精确的 effort 上游证明. JIRA 写入覆盖包括来源和目标状态, 精确评论身份, 较新页面之前的最新 10 条评论, 有目标但没有评论时的修复, 有评论但没有转换时的恢复, 零个或多个转换, 评论优先顺序, 完整成功操作, 每个失败阶段及其影响, 写入后验证, 以及发生变化的授权输入.

常规覆盖不访问真实 JIRA 服务, 不读取真实令牌, 不启动真实浏览器, 也不修改用户仓库. 实时本地服务是确定性集成证据, 不是第二个 HTTP Adapter.

## Source Checkout validation commands

完成前取得以下全部必要源码仓库验证的当前有效结果. 实施期间先进行相关定向检查, 独立命令按[验证版本和复用规则](../../.agents/skills/validation/SKILL.md#reuse-and-parallel-runs)并行或复用, 列表顺序不构成命令间依赖. 实际需要某个产物或当前主仓库来源时保留该依赖和准确版本核对.

- `pnpm typecheck` - 运行完整的严格 JavaScript 检查, 不输出文件.
- `pnpm test` - 运行完整 Node.js 内置测试套件, 隐藏成功条目, 保留测试日志, 失败诊断和完整最终统计. 需要逐项结果时改用 `pnpm test:verbose`, 无需重复运行两种模式; 两种模式都不自动保存日志.
- `node scripts/check-workflow-distribution.mjs` - 验证生产 Workflow Distribution 投射.
- `node --check <file>` - 只检查本次受影响的 JavaScript 或 ESM 文件的语法, 不执行文件; 没有适用文件时跳过.
- `node arw.mjs text check` - 验证 `.arwignore` 选定的当前 Git 可见文本.
- `node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/` - 在即时模式下根据术语表验证当前工作树和当前 issue 的实际 effort 目录.
- `git diff --check` - 检查已跟踪差异中的空白错误.

Source Checkout 使用 pnpm 11, TypeScript 和 Node.js 24 类型声明作为开发工具. 除非后续 issue 明确添加该范围, 否则不得引入或运行 Vitest, ESLint, Prettier, Playwright, 浏览器检查或其他第三方工具.
