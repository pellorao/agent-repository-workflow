# 确定现有规则正文迁入 Engine 的逐份去向

Type: grilling
Status: resolved
Blocked by: issue:0099:07, issue:0099:09, issue:0099:13, issue:0099:22

##### Question

现有约 19 万字符的 Skill 与规则正文, 在 1.0 中逐份怎样处理: 哪些写进 Engine 的流程定义, 哪些变成程序检查, 哪些变成随步骤下发的本步短指令, 哪些仍作为 Skill 或常读规则分发, 哪些删除? 各类占多少, Agent 每步实际要读的规则缩到多少?

## Answer

11-13 worker 分析, 交 Main Agent 综合. 三处方向性取舍 (A, B, C) 已由用户 11-13 (D21) 按推荐确认, 并追加: 删除 Upstream Sync 流程; 选项与答复见 Comments. 11-14 按 D24 (语义判断改为 Agent 输出字段), D26 (迁移后 graph 为权威) 与用户 11-13 "ARW 源码仓库的规则也转成 graph" 更新归类并重算清单. 依据: 用户 11-12 对 D12 的附言 ("大部分内置进 Engine, 多数机械执行, 少数由判断模型触发"; D24 后 "少数" 一类由 Agent 输出字段承担) 与 11-13 的四项目标 (见 [本地 Jev 类候选的可行性小实验](15-task-local-candidate-feasibility.md) 的 11-13 Comments), [定义 Engine 驱动流程的运行合同](07-define-engine-runtime-contract.md) 的步骤类型与 "会话一视同仁", [定义 Reviewer 与正式关卡在 Engine 下的执行协议](09-define-reviewer-protocol.md), [确定现有 ARW 合同在 1.0 中的继承范围](13-decide-legacy-contracts.md) 的归类, [定义规则到 graph 的转换与 Engine 按 graph 执行](22-define-rule-to-graph-conversion.md) 的节点类型与转换范围, 以及 ARW HEAD `69e8beb` 的全部规则正文 (初版基准 `00f41f3`). 逐份清单, 合计, 删除理由与估算方法见 [规则正文迁移清单](../research/rule-migration/report.md), 同目录 `classify.py` 可重算.

### Scope and classes

- 范围按 13: 分发的 82 份 Markdown 157427 字符, 加源码仓库专用的 17 项 41728 字符, 合计 199155 字符. 源码仓库专用部分同样完整归类, 转换范围内的转成 graph, 这些 graph 只在 ARW 源码检出中加载 (用户 11-13, 见 22 的 Source checkout graphs 节); 两部分分别合计.
- 类别与 22 的节点类型对齐: 流程定义 (F), Agent 输出分支字段 (Fj, 初版称判断节点, D24 后是 Agent 节点输出 schema 的必填分支字段), 程序检查 (C), 本步短指令 (S) 合称转换范围, 由一次性迁移转成 graph, 新原语与配置字段, 去向记入 22 的迁移源映射 (只用于迁移时的完整性核对); 迁移后 graph 为权威 (D26), 这些正文从 ARW 源码仓库删除, 不再分发, Agent 不再阅读; 保留的 Skill (K1, 方法类, 按步骤附带或按需读取), 常读规则 (K2), Reviewer 文档 (K3, 按 09 交给 Reviewer; 其中可机械判定的检查项除外, 归 C); 删除 (D).
- 一份文件跨类时按节拆分, 拆分写在清单的去向一栏.

### Totals

| 类别 | 分发部分 | 比例 | 源码仓库专用 | 比例 |
|---|---|---|---|---|
| 流程定义 F | 33522 | 21.3% | 10051 | 24.1% |
| Agent 输出分支字段 Fj | 960 | 0.6% | 350 | 0.8% |
| 程序检查 C | 16235 | 10.3% | 9026 | 21.6% |
| 本步短指令 S | 13898 | 8.8% | 6610 | 15.8% |
| 保留的 Skill K1 | 62862 | 39.9% | 11131 | 26.7% |
| 常读规则 K2 | 4878 | 3.1% | 1105 | 2.6% |
| Reviewer 文档 K3 | 16445 | 10.4% | 0 | 0% |
| 删除 D | 8627 | 5.5% | 3455 | 8.3% |
| 合计 | 157427 | 100% | 41728 | 100% |

- 分发部分的转换范围 64615 字符 (41.0%), 其中机械部分 (F+C) 占 77%, Agent 输出分支字段 1.5%, 本步短指令 21.5%. 需要判断的规则多数要连同本步工作一起判断, 归本步短指令; 能写成封闭问题的归 Fj. 两者都由同一个 Agent 步骤在本步作答, 不另开请求, 最终字段以迁移出的 graph 为准. 比 11-13 初版多出的约 1.9K 主要是 Role 中可机械判定的检查项 (约 1000 字符, 由 K3 移到 C) 与基准提交之间的增长.
- 不计方法类 Skill, 分发部分规则正文的 77% 离开 Agent 的阅读范围. 1.0 仍分发的是 K1+K2+K3 共 84185 字符 (53%).
- 源码仓库专用部分的转换范围 26037 字符 (62.4%), 主要是 `release` (含发布, fixture 与回滚), `reviewer-capability` (含漂移检查), Reviewer 能力测试的触发与待测项, 根 `AGENTS.md` 仓库自有区域的触发与 Baseline 例外; 保留 12236 字符 (`platform-standards`, `vm.md`, `source-checkout-coverage.md` 等维护者方法与参考, 常读的 Project Overview 与写作例外); 删除 3455 字符 (`upstream-sync` 与根 `AGENTS.md` 中相应一条, D21; `unattended-run` 的文本协议). 逐项见清单的 Source checkout files 节.
- 分发部分删除 8627 字符, 每段都写明守护的目标和 1.0 中的覆盖; 主要是 Workflow Triggers (13), worktree 并行实施 (10), Agent 操作 `arw background-agent` 与 haiku 回退 (09, 13), 门禁与写入类命令说明 (13). 按 "现有系统先完整移植" 的要求, 没有删除任何仍有职责的流程: 子会话模型档位的首次配置, `application-workflow` 的生命周期路由等都进入流程定义.

### Destinations

- 不再分发: `application-workflow`, `code-review`, `commit`, `implement`, `issue-tracking`, `reviewer-launch`, `spec-readiness`, `to-tickets`, `wayfinder` 这几个 Skill, 以及 `docs/agents/` 下的 `agent-writes.md`, `environment.md`, `parallel-implementation.md`, `subagent-allocation.md`, `subagent-findings.md`, `subagent-model-setup.md`.
- 缩减后仍分发: `arw-commands` (只留只读与检查类命令参考), `validation` (只留 Coverage principles), `rule-and-design-changes` (两段常读写作规则, 可并入 `writing.md`), `code-maps`, `to-spec`, `grilling`, `grill-with-docs`, `research`, `prototype`, `codebase-design`, `domain-modeling`, `improve-codebase-architecture`, `test-performance-optimization`, `test-value-cleanup`, `wizard`. 这些 Skill 中的流程段落 (如 `research` 的后台派发, `to-spec` 的发布步骤) 进转换范围.
- 原样分发: `diagnosing-bugs`, `tdd`, `teach`, `to-questionnaire`, `wait-what`, `writing-for-agents`, `grill-me`, `specification-presentation.md`, `repository-terminology.md`, 全部 Reviewer Role 文档 (除去移到 C 的可机械判定检查项) 和 `reviewer.md` 的 Reviewer 行为部分; 其中 "Reviewer 不与用户沟通" 改为 Reviewer 可以经 Engine 问用户 (22, Main Agent 11-14 定).
- `retro` 的 Files 节按 1.0 的实例记录改写.
- 根 `AGENTS.md` 只留 Efficiency First, Rule Conflicts, Output Text, 加一句 "ARW 流程只经 Engine 运行", 约 1.3K 字符. Important Decisions 成为 Agent 节点输出 schema 的 "是否需要用户决定" 必填分支字段 (D24), 体积预算的估算进写 issue 步骤的短指令.
- 协作者 (定稿, 决定 A): 所有协作者经 Engine 创建. Agent 步骤的输出 schema 有 "需要协作者" 分支, Engine 按配置的档位起子流程, 统一计量和授予权限; 能关的平台原生 subagent 尽量关闭 (Claude 禁用 Task/Agent 工具, Codex `agents.enabled=false`), 与 `.git` 只读层一样尽力而为, 由事件流检测. `subagent-allocation.md` 因此全部进入流程定义, `research`, `prototype`, `DESIGN-IT-TWICE.md`, `improve-codebase-architecture` 中 "派 subagent" 的写法改为请求协作者.
- 仓库自有规则中需机械使用的参数 (定稿, 决定 B): 测试, 构建, 验证命令和单回调耗时阈值, 以及模型映射表, 移到 `arw.config.json` 的机器可读字段 (如 `validation.commands`, `callbackThresholdMs`), 由 13 的升级审计经唯一的补全 issue 从散文中迁出; 散文里只留解释. 这是 13 "仓库自有区域原样保留" 的一处例外, 也给 [确定 1.0 的安装与配置方式](20-decide-installation-and-configuration.md) 增加字段.
- Upstream Sync (定稿, 决定 C, 用户 11-13 D21 改为删除): 1.0 删除 Upstream Sync 流程, 不再分别处理四个分叉 Skill 的 `exclude`. 以后真要同步上游, 开一个普通任务: 照上游改动修改我们的 Skill (仍是文本); 改动若落在已迁入 graph 的流程内容, 直接改 graph (D26, 见 22), 不走专门的三方审核流程. 要删的具体路径与配置键见下一节. 删除在 1.0 实现时做, 0.x 照旧.

### Upstream Sync deletion and distribution trimming

只读核对 ARW 现状 (HEAD 工作区), 1.0 实现时删除或改写:

- 脚本与 Skill: `scripts/upstream-sync.mjs`; `.agents/skills/upstream-sync/` (含 `SKILL.md`) 及其投影 `.claude/skills/upstream-sync/`.
- 配置与数据: 整个 `upstream/` (现只有 `upstream/sources/mattpocock-skills/` 的 `source.json` 和 `adoptions.md`). `source.json` 的键为 `url`, `commit`, `map`, `exclude`, 随文件删除. `distribution/config.json` 的 `sourceOnlySkills` 里去掉 `"upstream-sync"` 一项 (`platform-standards`, `release`, `reviewer-capability`, `unattended-run` 照旧). `arw.config.json`, `package.json`, `release-manifest.json` 里没有上游同步相关键.
- 文本: 根 `AGENTS.md` 第 99 行 Upstream Sync 一条; `docs/manuals/development.md` 与 `.zh-CN.md` 的 "Upstream Sync" 一节, Task 表一行, 脚本表一行, `upstream/` 目录说明一行; `docs/specs/agent-repository-workflow-development/spec.md` 与 `docs/specs/agent-repository-workflow/spec.md` 中的 Upstream Sync 段落; ADR 0011, 0028 按 ADR 流程标为被取代 (ADR 不删), 提到 Upstream Sync 的 ADR 0014, 0015, 0017, 0022, 0026, 0040 随规范改写时核对. 这些随 1.0 规范正文一起改, 不单独发.
- 不删: `docs/licenses/arw/LICENSE.mattpocock-skills` 与 `distribution/baseline/docs/licenses/arw/LICENSE.mattpocock-skills` (分发的方法类 Skill 仍含上游 MIT 内容, 署名必须保留); `lib/application-jira/git-upstream-proof.mjs` (指 git 的上游分支, 与此无关). 现有测试里没有引用 `upstream-sync`.
- 代价: 删掉后不再有 Base 快照 (`source.json` 的 `commit`) 供三方比较, 以后同步的人自己取上游的新旧版本比较; 用户已接受 (D21: 同步只是按上游改动改 Skill).

`distribution/` 只删与流程类 Skill 和 `docs/agents/` 相关的部分, 方法类 Skill 与精简后的 baseline 仍分发 (用户 D21 说 "绝大部分可以删", 核对后 Skill 字符约 40% 和 baseline 的 Reviewer 文档要保留, 不是整个删, 已在 chat 向用户说明):

- `distribution/skills/` 删 9 个目录: `application-workflow`, `code-review`, `commit`, `implement`, `issue-tracking`, `reviewer-launch`, `spec-readiness`, `to-tickets`, `wayfinder`; `distribution/config.json` 的 `distributedSkills` 去掉同样 9 项. 其余 Skill 目录留在原处 (其中 `arw-commands`, `validation`, `rule-and-design-changes` 按上文缩减).
- `distribution/baseline/docs/agents/` 删 6 份: `agent-writes.md`, `environment.md`, `parallel-implementation.md`, `subagent-allocation.md`, `subagent-findings.md`, `subagent-model-setup.md`; 留 `reviewer.md` (只留 Reviewer 行为部分), `writing.md`, `repository-terminology.md`, `specification-presentation.md`, `roles/` 全部.
- `distribution/baseline/AGENTS.md` 缩到约 1.3K 字符 (见上); `distribution/baseline/.arwignore`, 许可证文件, `distribution/projections/` 不动 (`projections/codex/config.toml` 是否随 subagent 设置变化留给实现时按 20 核对).
- `scripts/sync-workflow-distribution.mjs`, `scripts/check-workflow-distribution.mjs` 继续使用: 分发内容仍从源码仓库实际 Skill 同步到 `distribution/`.

### Rules read per step

以下为推断, 由 15 的 E2 回放按 token 实测.

- 现行一次实施到提交的 worker 流程按触发读取约 32.1K 字符规则 (ARW 源码仓库约 36.8K, 用 `tdd` 再加 4.1K). 1.0 中同一流程合计约 9.5K (少约 70%; ARW 源码仓库约 10.6K, 少约 71%, 源码仓库专用的流程也转成 graph 后只剩常读的约 1.1K): 每个会话常读约 1.3K, 本步短指令整条流程约 4.8K, 写仓库文本的步骤附带 `writing.md` 常读部分约 2.6K. 单个 Agent 步骤读到约 1.6K 到 5.7K.
- 对照 15 的元数据统计: worker 读入内容中规则文档的中位数 31% 降到约 12% 到 13%; 规则文档加关卡与命令输出 (现约 48%) 降到约 25%.
- Reviewer 的 Role 文档按 09 原样保留, 读到的规则只少约 22% 到 34%, 13% 的占比降到约 9% 到 10%; Reviewer 的主要节省来自 [09 的审核包](09-define-reviewer-protocol.md) (Review packet 节), 不来自规则缩减; 另外 Role 中可机械判定的检查项归 C (程序检查, 移到 09 第 1 步), 不再留在 K3; 上表已按节估计约 1000 字符计入 C, 逐项清单在迁移时列出, 上面的读取比例未计这部分.
- 会话不再驱动流程, 压缩后重读触发规则的开销 (15 中占 Main 文本增量 6% 到 13%) 消失.

### Interfaces

- 22: 转换范围内段落怎样一次性转成 graph; 本清单是迁移源映射的初始输入, 迁移时可以在 F, Fj, C, S 之间调整, 但不能把段落移出转换范围而不记去向. 源映射只用于迁移时核对每段都有去向, 核对后连同转换范围内的正文一起删除, 之后不维护 (D26).
- 14: 规范大纲中规则迁移一章引用本清单; 验收时核对不再分发的文件确已从 Workflow Distribution 删除, 缩减的 Skill 只剩保留部分.
- 15 / E2: 实测每步读入的规则 token 与占比, 校正上面的推断.
- 20: 决定 B 已采用, 配置 schema 增加验证命令与阈值字段.
- 13: 已采用仓库的一次性升级审计负责把仓库自有区域中的机械参数迁到配置 (决定 B).

## Comments

11-13: 三处方向性取舍 (已由用户 D21 确认, 见本节最后一条), 选项如下:

- A 协作者 (subagent) 由谁创建. 背景: `subagent-allocation.md` 与 `research`, `prototype`, `DESIGN-IT-TWICE.md`, `improve-codebase-architecture` 都假定有一个派 subagent 的 Main Agent; 07 与 13 没有说 Agent 步骤内能否使用平台原生 subagent. 选项: A1 所有协作者经 Engine, 输出 schema 加 "需要协作者" 分支, 尽量关闭原生 subagent (推荐: 机制只有一套, 计量覆盖目标 1 与 3, 不需要 Main Agent 角色; 代价是每次协作多一轮往返); A2 允许步骤内用原生 subagent 做只读探索 (快, 但 Engine 计量不到, 模型档位不受配置控制); A3 不限制, `subagent-allocation.md` 保留为常读规则 (上下文与计量都不受控, 与 "会话一视同仁" 冲突).
- B 仓库自有规则中需机械使用的参数放在哪里. 背景: 测试与验证命令, 单回调耗时阈值写在根 `AGENTS.md` 的仓库自有区域, 模型映射表写在 `subagent-allocation.md` 的仓库自有区域, 都是散文; Engine 要机械使用它们 (09 的程序检查, 22 的 graph 参数来自 Repository Profile 或用户配置), 与 13 "仓库自有区域原样保留" 冲突. 选项: B1 在 `arw.config.json` 加机器可读字段, 升级审计经 13 的补全 issue 迁出 (推荐: 读取确定, 无需每次判断, 误判率为零); B2 保留散文, 每次运行由 Agent 或判断模型读取 (每次都多一次请求, 可能读错); B3 流程开始时由 Agent 步骤抽取, Engine 按内容哈希缓存 (省掉多数请求, 但多一套缓存和抽取步骤).
- C 上游分叉的流程类 Skill 是否继续 Upstream Sync. 背景: 22 把这项留给本 issue. 选项: C1 `implement`, `code-review`, `to-tickets`, `wayfinder` 转换后退出 Upstream Sync, 加入 `exclude`, 其余照旧 (推荐: 11-03 的采用记录显示上游对它们的改动已全部不采用或在 Engine 下无意义); C2 继续同步规则源, 每次采用后重新转换 (每次同步都要转换, 夹具, 变异检查和回放). 这改变长期维护责任, 交用户决定. (D21 的结果是第三条路: 不论哪类 Skill 都删除 Upstream Sync 流程, 见最后一条.)

11-13: D21 答复 (用户, 状态页 11-13 07:36 #450): "1, 2, 3 都按照建议来, 而且 3 对应的上游同步流程可以直接删掉了, distribution 目录和对应的配置文件, 绝大部分应该都可以删掉了. 这样我们的维护工作会减小很多. 以后真的要同步, 就开一个任务做就行, 同步也仅仅是根据上游的改动, 修改我们的 skill 然后编译. 不走某个繁重的流程." 结果: A, B 按 A1, B1 定稿; C 改为删除 Upstream Sync 流程, `upstream/` 与相关配置键 (清单见 Answer); `distribution/` 只删与流程类 Skill 和 `docs/agents/` 相关的部分, 方法类 Skill 与精简后的 baseline 仍分发. 删除在 1.0 实现时做. 三处 "待用户确认" 已改为定稿. 21 的归类清单 `research/rule-migration/report.md` 仍把 `upstream-sync` 的 Skill 归 K1 "保留, 适用范围见决定 C": 它是源码仓库专用 Skill, 不属分发范围, 按本答复应删除, 该行与决定 C 的说明待下次重算清单时更正.

11-14 (任务 v1-d26ans): 按 D24, D26 和用户 11-13 "arw 1.0 中, 不仅仅是分发下去的规则和流程要改为 graph, arw 源码仓库中的也要改" 更新本答案并在 `69e8beb` 上重算清单: 源码仓库专用的 17 项由 "仍是仓库自有文本, 只示意归类" 改为完整归类, 转换范围 26037 字符进 graph (只在源码检出中加载); 判断节点一类改称 Agent 输出分支字段; Role 中可机械判定的检查项按节估计约 1000 字符由 K3 移到 C; 源映射改为只用于迁移时的一次性核对; 上一条所说 `upstream-sync` 归 K1 的错误已更正为 D, `unattended-run` 的文本协议 126 字符归 D; 清单 `classify.py` 的说明一并改为 D15, D24 之后的说法.
