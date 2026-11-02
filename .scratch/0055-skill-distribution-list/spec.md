# Skill 分发登记

## Behavior

### 背景与规则

`.agents/skills/` 是实际 Skill 的唯一编写来源, 发布前同步从中复制 Skill 进入 Workflow Distribution. 哪些 Skill 不分发 (仅供 Source Checkout 使用) 现在硬编码在 `lib/workflow-distribution/workflow-distribution-sync.mjs` 的 `sourceOnlyRoots` 中, 是黑名单: 新增的 Skill 默认被分发, 没有任何环节要求维护者判断它是否应该安装到使用 ARW 的仓库. 维护者 2026-11-03 决定改为显式登记, 并由程序强制, 不靠 Agent 记住规则.

`distribution/config.json` 的封闭结构变为 (示例为节选, 实际名单见初始名单):

```json
{
  "distributedSkills": ["code-maps", "implement"],
  "repositoryOwnedSeeds": [".arwignore"],
  "sourceOnlySkills": ["release", "upstream-sync"]
}
```

规则:

- 只有 `distributedSkills` 中的 Skill 进入 Workflow Distribution (白名单). `sourceOnlySkills` 中的 Skill 只留在源码仓库.
- `.agents/skills/` 下每个 Skill (至少含一个文件的直接子目录, 推导见 Checks 节) 必须恰好出现在两个列表之一.
- 两个列表的元素都是合法 Skill 身份 (小写 ASCII 字母段以单个连字符连接), 同一列表内不重复, 两个列表不相交. `distributedSkills` 不得为空 (空名单意味着什么都不分发, 只会是误操作); `sourceOnlySkills` 可以为空. 列表不要求排序.

### Checks

下列诊断码都使 Workflow Distribution 生产检查失败. 两个登记诊断 (`skill-unregistered`, `skill-registration-stale`) 的消息提示须先由维护者判断该 Skill 是否分发, 再登记到合适的列表; `skill-source-path-invalid` 只指出来源树形状错误; 两个配置诊断只指出配置形状错误:

| 诊断码 | 触发 | 产生位置 |
|---|---|---|
| `distribution-config-invalid` | 配置的键集合不是恰好 `distributedSkills`, `repositoryOwnedSeeds`, `sourceOnlySkills` (含缺少任一列表) | `validateDistributionConfig` (沿用现有码) |
| `skill-lists-invalid` | 任一列表不是数组, 含非法身份或重复名, `distributedSkills` 为空, 或某名字同时出现在两个列表 | `validateDistributionConfig` |
| `skill-unregistered` | `.agents/skills/` 下有 Skill (见下文 "Skill 身份" 的推导) 不在任何列表 (含目录名不是合法 Skill 身份的情形, 因为列表元素不可能是非法身份, 这类目录一定未登记) | 登记检查 |
| `skill-source-path-invalid` | 直接位于 `.agents/skills/` 下的非目录条目 (沿用现有码) | 登记检查 |
| `skill-registration-stale` | 列表中的名字在 `.agents/skills/` 下没有对应的 Skill | 登记检查 |

配置检查发生在读取配置时, 所有构建, 同步和生产检查路径都会遇到. 登记检查有一条唯一的推导路径, 保证同步与生产检查对同一棵树结论一致:

- Skill 身份的推导: `.agents/skills/` 下至少含一个文件的直接子目录, 身份是目录名 (与现有同步按文件路径第一段取身份一致). 不含任何文件的目录不是 Skill (Git 也不跟踪空目录, 所以克隆出的树里不会有它们), 不要求登记, 也不构成 `skill-registration-stale` 之外的新诊断; 名单中登记的名字若只对应没有文件的目录, 同样是 `skill-registration-stale`. 直接位于 `.agents/skills/` 下的非目录条目保持现有行为: 阻断, 诊断码 `skill-source-path-invalid`.
- Workflow Distribution Module 导出纯函数 `skillRegistrationDiagnostics({distributionConfig, skillNames})`: 输入已验证的配置与上述 Skill 身份, 返回稳定排序的诊断数组 (空数组表示通过), 不读文件系统.
- Workflow Distribution Sync Module 导出 `checkSkillRegistration({distributionConfig, filesystem})`: 用限定范围的文件系统 (`lib/common/filesystem.mjs` 的 `createScopedFilesystem`) 递归列出 `.agents/skills` (不读文件内容), 遇到符号链接或目录联接返回 `blocked` (`filesystem-link-unsupported`, 与现有来源读取一致), 直接位于其下的非目录条目返回 `blocked` (`skill-source-path-invalid`), 否则按上述推导取得 `skillNames` 并调用纯函数; 有诊断返回 `blocked`.
- 发布前同步在读取验证阶段先读配置, 再调用 `checkSkillRegistration`, 有诊断则 `blocked`, 此时尚未删除任何路径; 通过后复制来源时只保留 `distributedSkills` 中的 Skill, 其他文件不复制.
- `scripts/check-workflow-distribution.mjs` 的 `checkWorkflowDistributionProduction` 在构建和自包含检查成功后, 用 `createScopedFilesystem({root: sourceRoot})` 取得文件系统并调用同一个 `checkSkillRegistration`; 它新增可选输入 `sourceRoot` (默认源码仓库根), 只为测试注入夹具仓库. `checkSkillRegistration` 或 `createScopedFilesystem` 的任何非成功结果 (`blocked`, `failed`, 含 `.agents/skills` 不存在, 根目录不存在) 都映射为 `{diagnostics, status: 'failed'}`: 取其 `diagnostics` 数组经现有 `normalizeDiagnostic` 输出; `sourceRoot` 不是绝对路径时 `createScopedFilesystem` 抛出 `TypeError`, 沿用脚本入口已有的 `catch` 输出消息并以退出码 1 结束.

之所以枚举放在 Sync Module 而不是生产检查脚本: 这一步依赖限定范围的文件系统和 `.agents/skills` 的读取约定 (目录推导, 符号链接拒绝), 正是同步已经拥有的责任; 脚本若自己用 `node:fs` 枚举, 会绕过 Filesystem Module 对符号链接的集中拒绝, 并可能与同步在空目录等情形上结论不同. 代价是脚本新增对 Sync Module 的依赖 (两者都是 Source Checkout 维护入口, 方向合理).

场景: 维护者新增 `.agents/skills/foo/` 后运行同步或生产检查, 得到 `skill-unregistered` (path 为 `.agents/skills/foo`), 没有写入发生; 维护者与用户确认后把 `foo` 加入某个列表, 重跑通过. 删除一个 Skill 目录而忘记改名单时得到 `skill-registration-stale` (path 为 `distribution/config.json`), 修正名单后继续. 失败发生在读取验证阶段, 之前没有产生任何影响, 修正输入后从同一命令重新开始.

阻断而不是警告的理由: 警告会被忽略, 一个未判断过的 Skill 就会按旧黑名单的默认行为被分发或遗漏, 这正是本改动要消除的问题. 接受的成本是每个新 Skill 在被登记前都使同步和生产检查失败 (多一步登记), 上游采用流程多一个 "是否分发" 的问题.

初始名单使分发结果与改动前完全相同: `sourceOnlySkills` 为 `reviewer-capability`, `release`, `upstream-sync`, `platform-standards`, `unattended-run` (原硬编码的五个), 其余 `.agents/skills/` 下的 Skill 全部进 `distributedSkills`. 同步后 `distribution/skills/` 不应有任何变化.

### Upstream Sync

`.agents/skills/upstream-sync/SKILL.md` 在询问维护者是否采用上游新 Skill 时一并询问是否分发, 并把结果登记到 `distribution/config.json` (一句话). 自写的新 Skill 由上述检查拦下后询问.

### Documentation

`docs/specs/agent-repository-workflow-development/spec.md` 更新以下位置: `Workflow Distribution configuration` 节的封闭结构并说明两个列表与检查; "仅供 Source Checkout 使用的 ..." 段改为指向 `sourceOnlySkills`, 不再罗列硬编码名单; `Entry point and lifecycle` 节读取与验证阶段的关闭式失败列表, 以及同文来源表中 "来源无法完整枚举, 必需文件缺失或终止符错误时在删除前阻断" 一行, 增加未登记或过期的 Skill; `Module Design` 节两个 Module 的责任增加登记检查. `docs/adr/0026-use-source-checkout-workflow-files-as-distribution-authority.md` 开头加一句被新 ADR 部分取代的说明, 新增 `docs/adr/0040-register-skill-distribution-in-config.md`.

## Testing

- `tests/workflow-distribution/workflow-distribution.test.mjs`: 夹具配置加两个列表. 观察 (构建结果的诊断码): 缺少任一列表为 `distribution-config-invalid`; 非数组, 非法身份, 列表内重复名, `distributedSkills` 为空, 同名出现在两个列表各为 `skill-lists-invalid`, 空的 `sourceOnlySkills` 通过. 防止配置格式被悄悄放宽. 生产检查的两个现有用例经 `sourceRoot` 指向含 `.agents/skills/review/SKILL.md` 的夹具仓库继续有效; 新增用例: 夹具含未登记 Skill (含非法目录名) 时生产检查失败含 `skill-unregistered`, 名单含不存在的名字时含 `skill-registration-stale`; `sourceRoot` 指向不含 `.agents/skills` 的目录时返回 `{diagnostics: [...], status: 'failed'}` (非抛出), 证明非成功结果的映射.
- `tests/workflow-distribution/workflow-distribution-sync.test.mjs`: 夹具配置登记 `review`; 新增用例: 夹具再放 `.agents/skills/local-only/` 登记为 `sourceOnlySkills`, 同步成功但 `distribution/skills/local-only` 不存在; 未登记 Skill, 名单含不存在的名字, 列表非法, `.agents/skills` 下含符号链接 (临时目录夹具), 含直接位于其下的普通文件 (`skill-source-path-invalid`) 五种情形下同步各 `blocked` 并含对应码, 且 `distribution/` 未被改写 (旧 `obsolete` 仍在), 证明失败发生在删除之前. 另有一个用例观察 `.agents/skills` 不存在时同步返回非 `succeeded` 且带 `diagnostics` 的结果 (不断言 `blocked` 还是 `failed`, 由文件系统合同决定), 空目录 (`.agents/skills/empty/`) 不要求登记.
- `tests/workflow-distribution/workflow-distribution-exact-file-seeds.test.mjs`: 夹具配置补两个列表.
- 真实仓库由 `node scripts/check-workflow-distribution.mjs` 与 `node scripts/sync-workflow-distribution.mjs` 验证 (后者运行后 `distribution/` 无差异). 不加真实进程测试.

## ADR Evaluation

新增 `docs/adr/0040-register-skill-distribution-in-config.md`. 权威来源变化: ADR 0026 规定发布前同步在源码选择阶段排除 `$reviewer-capability`, 且 Workflow Distribution 配置只记录仓库自有初始文件和可调整参数的专有验证; 本次把 "哪些 Skill 分发" 的权威来源改为 `distribution/config.json` 的两个列表, 取代 0026 中这两处; 0026 的其余决定 (实际工作流文件是唯一编写来源, 发布前同步派生载荷) 不变. 持久状态: 名单是随 Git 修订提交的配置, 不新增运行时持久状态, 目标仓库不受影响. 恢复合同: 检查失败发生在写入之前, 不新增事务; 名单错误由提交审核和 Git 恢复. 难以逆转程度低. ADR 记录替代方案 (保留黑名单, 只警告不阻断) 与代价, 见 Behavior 节.

## Module Design

### Modules

- Workflow Distribution Module (`lib/workflow-distribution/workflow-distribution.mjs`): 责任增加 Skill 分发名单的验证与登记比较 (纯计算).
- Workflow Distribution Sync Module (`lib/workflow-distribution/workflow-distribution-sync.mjs`): 不再自带不分发名单; 责任增加枚举 `.agents/skills` 并执行登记检查, 以及只复制已登记分发的 Skill.
- 生产检查脚本 (`scripts/check-workflow-distribution.mjs`): 构建成功后增加登记检查, 不自己枚举文件系统.

### Interfaces

- `validateDistributionConfig`: 合法输入恰含三个键, 规则与诊断码见 Checks 表; `repositoryOwnedSeeds` 的规则不变. `DistributionConfiguration` 类型新增两个 `string[]` 字段, `buildWorkflowDistribution` 成功结果的 `distributionConfig` 因而含它们.
- `skillRegistrationDiagnostics({distributionConfig, skillNames})`: 返回诊断数组; `skill-unregistered` 的 `path` 为 `.agents/skills/<name>`, `skill-registration-stale` 的 `path` 为 `distribution/config.json`; 按现有 `sortDiagnostics` 排序; 不读文件系统, 不抛出.
- `checkSkillRegistration({distributionConfig, filesystem})`: 输入已验证的配置与根为源码仓库的限定文件系统; 输出 `{status: 'succeeded', diagnostics: []}`, 或 `blocked` (含登记诊断, `filesystem-link-unsupported`, `skill-source-path-invalid`), 文件系统列举的非成功结果 (含 `.agents/skills` 不存在) 原样传递: 现有 `readFilesUnder` 把文件系统的 `failed` 标注 `stage: 'source-enumeration'`, `blocked` 不变; 它们都带 `diagnostics`, 调用方只依赖 `status` 不是 `succeeded` 和 `diagnostics` 非空.
- 生产检查新增可选 `sourceRoot` (绝对路径, 默认源码仓库根); 非成功结果的映射见 Checks 节.

### Seams and Adapters

不变. 同步与登记检查都经 ScopedFilesystem, 测试经临时目录夹具注入 (同步测试已使用).

### Dependencies and Data Flow

同步: 读配置 -> `checkSkillRegistration` -> 读 `.agents/skills` 文件并过滤出已登记分发的 Skill -> 复制. 生产检查: 构建 -> 自包含检查 -> `checkSkillRegistration` -> 平台投影验证. 依赖方向: 生产检查脚本新增依赖 Sync Module (已依赖 Workflow Distribution Module), Sync Module 依赖 Workflow Distribution Module, 无环.

### Module Design Rationale

纯比较放在 Workflow Distribution Module, 使同步与生产检查共用一份判断; 不放进 `buildWorkflowDistribution`: 它只看 `distribution/` 目录, 安装后的目标不含 `.agents/skills`. 枚举放在 Sync Module 而不是脚本的理由见 Checks 节. 重复名和相交检查放进配置验证, 因为它们只依赖配置本身. 不引入 `glob`, 排序要求或第三个状态, 名单保持最小.

### ADR Evaluation

见上文 `ADR Evaluation` 节.
