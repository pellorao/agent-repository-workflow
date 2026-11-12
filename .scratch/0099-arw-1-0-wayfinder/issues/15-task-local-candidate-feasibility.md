# 本地 Jev 类候选的可行性小实验

Type: task
Blocked by: issue:0099:02, issue:0099:05

##### Question

用一批取自 ARW 公开仓库的带标签分流, 预检和输出检查案例 (约 100 到 200 条, 标签为高智能 Agent 或人工给出的正确判断), 在本机实测选定本地候选的判断准确率, 置信度分布, 单次延迟与显存占用; 用同一批案例对托管 Jev 测速度与准确率作为基准, 另可加入其他托管替代方案; 得出本地运行是否可行的事实. 托管服务只接收 ARW 公开仓库中的案例, 私有内容只给本地候选; 托管 API 凭据由用户放在仓库外的本地私有文件, 只由脚本引用, 不进入 Git, 日志, 报告和提示词, 这一步作为用户动手步骤先说明再做. 本地运行需要 GPU, 由 Main Agent 按本机资源规则另行排期, 下载和写盘量先报批.

## Comments

11-09 (worker): 不用 GPU 的案例集做法与首批进度. 实验要回答的指标与转正门槛见 [定义 Jev 类模型的评测与转正条件](11-define-evaluation-and-graduation.md), 调用接口见 [定义 Engine 调用 Jev 类模型的接入方式](16-define-judge-model-integration.md).

- 来源只取 ARW 公开 GitHub 仓库 (`pellorao/agent-repository-workflow`, 已核对为 PUBLIC) 在固定提交上的内容, 不含本 effort; 因此托管基准与本地候选可以用同一批案例.
- 每条案例: 类别 (分流, 预检, 输出检查), 一道 `choice` 或 `noul` 题 (`instructions` 与 `criteria`), `state` 文本, 标签, 标签来源 (仓库事实, 高智能 Agent, 人工), 来源提交与路径, 字符数, 哈希. 按类别分层, 40% 作校准集, 60% 作测试集; 另记输入长度与是否含路径和规则文本, 用于看长度与无关内容的影响.
- 标签优先用仓库事实, 不需要人判: (1) 分流 "实施 issue 是否含设计决定" 用该 issue 的 Spec Readiness 记录 (`result` 为 `not-applicable` 即不含); (2) 预检用 `tests/fixtures/reviewer-capability/**` 四个场景 `expected.json` 中已标注的案例: 问题案例 109 条, 无问题案例 159 条 (11-09 计数), 均为英文合成材料. 问题案例的 `expectation` 描述真实缺陷, 无问题案例的 `expectation` 说明一处看似可疑的地方为什么没问题; 因此每条要写成一道 "这段内容是否存在下述问题" 的 `noul` 题, 无问题案例的 "下述问题" 按 `expectation` 与 `findingTerms` 写成那个诱饵问题, `state` 取 `evidence` 或 `placements` 所指行的上下文. 标签直接来自 fixture, 写题由 Agent 完成, 不改变标签. 仓库事实给不出标签的 (输出检查 "交付说明是否覆盖每条验收标准", Wayfinder issue 的类型) 由不低于 Main Agent 的 Agent 标注, 人工抽查 10%, 标注者拿不准的案例不收.
- 首批 (仓库事实标签, 不用 GPU): 脚本 `~/projects/.tasks/ARW/v1/caseset/build.py` 在 `9cfd2b3` 上生成 71 条分流案例 (含设计决定 17, 不含 54; `state` 中位数 892 字符, 最长 3617), 写在任务目录的 `data/caseset/` (不进 Git). 只收 effort 0020 起的记录: 0001 到 0019 的 59 条全部走了就绪审核, 当时还没有 not-applicable 例外, 标签不反映判断. 为防泄题, 去掉了 `## What to build` 中提到 spec, 就绪审核或设计决定的行 (48 条有被去掉的行), 这可能也去掉了判断所需的内容, 要在抽查中确认. 标签是当时 Main Agent 的判断, 不是事后核实的真值, 类别也不平衡.
- 待办: 预检约 50 条 (Reviewer 能力测试 fixture), 输出检查约 40 条 (Agent 标注), 合计达到 150 条左右; 抽查已生成案例的文本需要读取其他 effort 的内容, 按 `issue-tracking` 的 Effort reading scope 先由 Main Agent 取得用户授权. 脚本只输出计数, 本轮没有读取案例原文.

11-11 (worker, 预检部分由 Sonnet 子 Agent 写题): 预检 52 条已生成 (`noul` 题, 有问题 27, 无问题 25; Code Standards 14, Spec Readiness 11, Commit Audit 14, Code Spec 13; `state` 中位数 1576 字符, 最长 6381), 脚本是任务目录的 `caseset/precheck.py`, 在 `9fb4b5d` 上运行, 输出 `data/caseset/precheck.jsonl` (不进 Git). 题目用英文, 因为 fixture 的代码与规则多为英文; Spec Readiness 场景的 spec 其实是中英混写, 上文 "均为英文合成材料" 不准确. 未入选的 232 条中, 79 条是占位, `uncertain` 或与 GATE-1 重复的 GATE-2 改写, 8 条证据跨 4 个以上文件, 其余没有抽到. 实验前要处理的已知局限:

- 题目由 `expectation` 改写, 点出了具体失效机制, 比真实预检容易; 两种标签的措辞对称, 不泄露答案. 是否另写一版只给规则不点机制的题, 实验设计时定.
- `state` 是证据行前后 20 行 (Markdown 3 行或整份文件), 窗口里可能有题目没问的其他真缺陷 (已知 2 条).
- 有几组案例的 `state` 几乎相同而标签相反, 校准集与测试集按 `source` 中的文件分组切分, 不随机按条切分.
- `noul` 概率高是否对应 "有问题" 的方向, 要在候选兼容核对中确认.
- Commit Audit 题目自带了需求条文, `state` 只含代码.

端到端测量 (按 [确定本地判断模型服务的运行责任](18-decide-local-judge-server-ownership.md) 的用户要求补充): 除单次判断的准确率与延迟外, 实验还要测同一批任务用与不用判断模型的端到端墙钟, 因为用户要求用判断模型的整体任务执行比不用时快很多. 这一项要等 Engine 有原型才能测, 本轮的小实验只能给出单次延迟与准确率, 不能单独证明可行.

待办: 输出检查约 40 条 (Agent 标注).

11-12 (worker, Opus 5.5 标注): 输出检查 40 条已生成 (`noul` 题, `covered` 22, `not-covered` 18), 三类合计 163 条. 脚本是任务目录的 `caseset/output.py`, 输出 `data/caseset/output.jsonl` (不进 Git).

- 来源: 公开仓库 `9cfd2b3` (即 `origin/main`) 上 13 个已完成的单 issue 实施 effort: 0028, 0029, 0031, 0032, 0033, 0034, 0041, 0045, 0048, 0053, 0060, 0097, 0106, 实施提交都是 `9cfd2b3` 的祖先. 每条案例对应一条验收标准.
- 题面与 `state`: 题目用中文, 问 "交付说明与 diff 是否表明这条验收标准的每一部分都已满足", 交付说明中明确写出的验证结果可作依据, 没写出也不在 diff 中的部分算未满足. `state` 是该 issue 的 `## Validation` 加实施提交的 diff (不含 `.scratch`), 中位数 6186 字符, 最长 12478. `noul` 高表示已覆盖, 与预检 (高表示有问题) 方向相反.
- 反例的构造: 已完成 issue 的标准几乎都被覆盖, 天然反例极少, 所以反例由删减构造. 从同一 issue 的 diff 删去体现该标准的文件, hunk 或测试块 (hunk 头重新计数), 并删去交付说明中的对应句子, 模拟交付时漏做. 交付说明里的 "验收条件 N" 编号统一去掉, 以免缺号泄题. 每条的删减方式记在 `construction` 字段.
- 标注: 逐条阅读生成后的 `state` 判定. 删减后仍能推断已满足的 (如实现删了但测试仍在, 交付说明又写了测试通过) 不收.
- 分组: 按 `effort` 字段切分校准集与测试集. 同一标准的完整版与删减版几乎相同而标签相反, 必须同组. 0097 和 0106 也可能被 POC 选作端到端输入, 选中时这两组只放进测试集.
- 局限: 反例是人工删减, 不是真实漏做, 删减痕迹 (如交付说明里的体积数字或文件数与 diff 不符) 可能被模型利用. 有 9 条反例只缺一个子条件 (生成物同步, 投影副本, 测试覆盖, 规范同步等), 判定依赖题面的 "每一部分". 来源 diff 都不超过约 15k 字符, 比 POC 端到端的 issue 小. 标签是 Agent 判断, 人工抽查 10% (4 条) 待 Main 安排.
