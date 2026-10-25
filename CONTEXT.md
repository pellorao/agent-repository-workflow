# Agent Repository Workflow

本文件定义 Agent Repository Workflow (ARW) 在产品和工作流文档中长期使用的全局名称. 它只记录这些名称的含义与边界, 不记录实现步骤, 命令细节, 状态或一次性决定.

## Language

**ARW Artifact**:
ARW 在当前操作的 Git 仓库根目录 `.scratch` 下登记和管理的工作记录, 精确类型值只有 `issue`, `map` 和 `spec`. 普通 Markdown 文件, ADR, 可下载的引导脚本, 规范工作流交付内容和其他交付文件都不是 ARW Artifact.
_Avoid_: Artifact

**Application Leader**:
在 `application` 类型 Git 仓库中, ARW 根据当前仓库类型固定赋予调用者的 Application 级操作角色, 不验证调用者的具体人员身份. 该角色不是某个人在所有仓库中的身份, 也不适用于 `module` 类型 Git 仓库中的调用者.

**Application Member**:
在 `module` 类型 Git 仓库中, ARW 根据当前仓库类型固定赋予调用者的 Module 级操作角色, 不验证调用者的具体人员身份. 该角色不是某个人在所有仓库中的身份, 也不适用于 `application` 类型 Git 仓库中的调用者.

**Application Source Issue**:
Application Leader 仓库中的独立 issue 类型, 用于把一项应用交付工作关联到一个模块仓库实施 issue. 它不承担实施工作, 交付内容在分发后保持冻结, `Status:` 只反映关联实施 issue 的状态; 模块仓库中实际实施工作的 issue, JIRA issue 和没有一对一模块关联的普通工作记录都不属于该类型.

**Code Map**:
由采用 ARW 工作流且启用源码目录说明规则的 Git 仓库拥有的一组源码目录 README 文件, 由 Agent 维护, 用于说明各目录的职责, 重要文件和子目录的作用与关系, 以及理解和修改相关代码所需的接口与边界. 未来设计, 待办清单, 自动推断的目录结构和由 ARW 负责生成或更新的文件都不是 Code Map.

**Main Agent**:
在一次工作所属的独立运行环境中负责统筹任务的 Agent, 整合证据和其他参与者的结果, 分配任务及互不重叠的写入责任. 直接接受用户委托的 Main Agent 还负责用户沟通, 整体工作判断和 Git 写入. 独立 Reviewer 在自己的审核运行环境中独自完成全部审核, 不承担任务分派, 不创建或管理子 Agent, 也不负责用户沟通或 Git 写入. 同一运行环境内受分派的子 Agent, 工作流引擎, 平台承载程序和其他并发参与者不因参与工作取得 Main Agent 身份.

**Managed Content**:
已通过 ARW 初始化工作流的 Git 仓库中, 由根目录 `arw-lock.json` 明确登记且由 ARW 负责完整性检查和更新的文件或文件区域. 路径或目录名称本身不能让未登记的文件, 受管理区域之外的文本或尚未写入该 Git 仓库的来源内容成为 Managed Content.

**Repository Profile**:
`arw-lock.json` 中记录该 Git 仓库所选平台和源码布局的一组设置, 供 ARW 在初始化和更新时重现相同的工作范围. 用户直接编辑的配置, 根据现有目录自动推断的设置和该 Git 仓库拥有的说明文字都不是 Repository Profile.

**Spec Readiness**:
针对实施工作的独立治理设计就绪检查, 用于确认所选要求具有完整, 一致, 可实现和可验证的设计依据. 结论绑定实际受审的审核对象与治理内容, 是完成验收和提交所需的设计依据, 不代表随后改变的版本也已经通过. 就绪判断与实施工作的进行是不同事实, 正在审核也不等于取得通过结论. 它不替代任务授权, 必要的用户设计决定或实现符合性审核. 任务状态, 规划流程, 测试结果和实现完成后的代码审核都不是这项设计就绪判断.

**Upstream Sync**:
ARW 源码仓库采用维护者选定外部项目新版本的流程, 适用于以该项目为来源的部分 Skill. 维护者对固定上游快照与当前实际 Skill 进行人工审核的三方合并, 明确批准要采用的内容并保存采用记录; 普通 Git 更新, 发布前的 Workflow Distribution 同步, 其他 Git 仓库中的 ARW 工作流更新和 Agent 临时拉取或合并外部内容都不属于该流程.

**Workflow Distribution**:
ARW 为采用其工作流的 Git 仓库提供的一套完整工作流内容, 可供安装和更新; 这套内容在发布前由源码仓库实际使用的共享工作流文件和单独维护的仓库自有初始文件派生, 并经过人工审核和授权写入. 执行 `arw` 命令的程序, 源码仓库中的实际编写来源, 已写入某个目标 Git 仓库的文件和单独一组规则都不是 Workflow Distribution.
_Avoid_: ARW Distribution, Distribution
