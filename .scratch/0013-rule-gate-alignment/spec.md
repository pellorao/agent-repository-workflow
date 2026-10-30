# 纯规则文档 issue 的终态提交与无人值守运行 Skill

## Behavior

- 非实施提交 (`arw commit-audit verify --non-implementation`) 允许候选使实施 issue 新进入 `wontfix`; 只有该 issue 在候选树中没有就绪记录 (`issues/<NN>.spec-readiness.json` 不存在) 时, 才允许它新进入 `completed`. 有就绪记录的 issue 进入 `completed` 仍被拒绝, 走实施提交流程. 其他非实施分类条件不变. 范围定义: 交付只含非实施分类内容 (Agent 规则与文档 Markdown 和 `.scratch` 记录) 的实施 issue 不运行 Spec Readiness (与 `implement` Skill 一致), 因而没有就绪记录; 其他实施 issue 照旧在首次修改实现文件前取得就绪记录. 理由: 这类 issue 没有代码交付, Gate 1 核对的实施符合性无对象, 两个 Reviewer 的往返只重复轻量流程已有的检查; `wontfix` 不交付任何内容, Gate 1 同样无对象. 已知限制: `verify` 只能证明候选中没有就绪记录, 不能证明该 issue 历史上没有实施字节; 接受它是因为终态提交本身仍受非实施分类的路径限制 (不能携带代码), 而此前任何代码改动都须经 `implement` Entry 的就绪检查和实施提交的 Commit Audit. 被拒绝的替代方案: 保留 Gate 1 (成本如上, 收益为零); 机械检查 `## Validation` 内容 (无法证明交付范围, 只增加规则). 豁免判据选 "候选树中没有就绪记录": 它是跳过 Spec Readiness 的直接机械结果, 不新增状态; 被拒绝的替代方案是在 issue 中加显式 doc-only 字段, 它新增一个需要维护和校验的字段, 而字段与实际交付是否一致仍只能由 Main Agent 判断. 接受的成本: issue 是否只交付非实施内容由 Main Agent 判断, `verify` 无法发现分类错误, 由上述路径限制和用户复核 diff 兜底.
- 新增仅供 Source Checkout 使用的 `unattended-run` Skill: 只在无人值守驱动程序的开局说明点名时使用, 关闭隐式调用 (`disable-model-invocation: true`, Codex `allow_implicit_invocation: false`). 它规定必须由真人完成的步骤先拆出, 不依赖它的部分照常提交, 其余列为待用户决定事项. 发布前同步把它与其他源码限定 Skill 一样排除在 Workflow Distribution 之外.

## ADR Evaluation

需要新 ADR (编号 0035), 部分取代两份 ADR: [ADR-0006](../../docs/adr/0006-enforce-spec-readiness-with-independent-review.md) `## Decision` 中 "对每个实施 issue" 运行 Spec Readiness 的适用范围, 改为不含交付只含非实施分类内容的实施 issue; [ADR-0023](../../docs/adr/0023-separate-commit-audit-review-from-implementation.md) `## Decision` 中纯规划路线只接受 "未在当前变更中进入 `completed` 或 `wontfix` 的实施 issue", 把实施 issue 进入终态列为拒绝条件的机械检查, 以及该路线 "不运行 `arw commit-audit verify`" 的表述, 改为: 该路线 (含规则与文档候选) 由 `arw commit-audit verify --non-implementation` 做机械检查, 按上述条件放行终态转换. 两份 ADR 在对应句处指向新 ADR, 其余决定不变. 总长期规格中 "不改变二者对实施 issue 和实施提交的约束, 因而不需要新 ADR" 一段改为引用 ADR 0035.

## Module Design

Not required: 只放宽 Commit Audit 非实施分类中一个既有拒绝条件的适用范围, 并把一个 Skill 身份加入既有的源码限定排除列表. Module 责任, Interface 字段含义, Seam, 依赖方向, 权威来源和数据流不变.
