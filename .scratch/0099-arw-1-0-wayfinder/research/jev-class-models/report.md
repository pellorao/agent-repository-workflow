# Jev 类判别模型调研报告

## Scope and method

本报告回答 issue 02: Jev 及同类 "固定选项判断" 模型的接口, 输入限制, 输出, 延迟, 价格, 数据政策, 许可与本地权重, 以及哪些候选值得用 ARW 分流案例实测. 没有运行任何模型, 没有注册账号, 没有向托管服务发送请求. 所有主张来自 11-07 读取的公开网页. 10-25 参考材料中的来源均已按一手页面重新核对, 采用处注明 "参考 10-25 材料, 已于 11-07 核实".

候选的发现方式: 先读第三方目录 all-methods.jsonl (2073 条, 其中 255 条为模型, 页面自述 "未经独立核实", 见 https://hanxiao.io/all-about-jev/ ), 再按点赞, 下载量, 星标, 是否含中文筛出少数条目, 最后只采信条目所指向的模型卡和 GitHub 页面. 目录本身只作线索. 整个生态很新: Jev 于 2026-09-15 发布, 开源仿制品的模型卡日期集中在 9 月至 10 月, 数字会很快过期.

## Hosted Jev

一手来源: https://typesafe.ai/blog/introducing-system-one-models-and-jev , https://docs.typesafe.ai/models.md , https://docs.typesafe.ai/introduction/quickstart.md , https://docs.typesafe.ai/confidence.md , https://docs.typesafe.ai/api/errors.md .

- 接口: `POST https://api.typesafe.ai/v1/systemone`, Bearer 密钥. 请求含 `state` (字符串或结构化对象) 和 `questions` (题目编号到题目的映射), 题型为 choice, score, noul (0 到 1 的真假概率), box (仅 jev-1.14.0). 同一请求内所有题目对同一 `state` 并行, 互相独立, 题数没有单独上限. 因此一次调用可批量回答多个独立问题. 官方建议每题只问一个窄问题, 由代码合并结果.
- 版本: `jev-1.14.0` (2026-10-14 起), `jev-1.13.0`, 别名 `jev-latest` 指向 1.14.
- 输入长度: 每请求 64k token, 每题 32k token; 加请求头 `TypeSafe-Danger-Zone-Long-Context: true` 可到 262k, 但官方称更慢更不准. 请求体上限 32 MiB, UTF-8 JSON. 官方模型页和 jaggedness 页都说 "状态里无关内容越多越不准" (context rot).
- 语言: 官方模型页, 博客, jaggedness 页均未列支持语言, 未提中文. 1.14 更新日志只写 "Improved multilingual support" (https://docs.typesafe.ai/changelog.md ). 参考 10-25 材料称 "官方承认对中文敏感", 已于 11-07 核实: 未找到一手证据支持这句话, 官方也没有声明中文可用. 中文表现只有第三方数据 (见 Chinese fit).
- 输出: choice 返回所选项, 各选项概率和 confidence; score 返回分数, 各档概率, confidence; noul 只返回概率. 博客宣称 "校准的概率", 但 confidence 文档明确说 confidence 只衡量分布集中度, 不等于所选答案正确的概率; 按风险决策时看所选选项的概率; 在 ARW 文本上是否校准无一手证据, 阈值要用自己的数据确定. 另: 文档承认倾向选第一个选项, 字面理解, 对日期和数字弱, 注入内容会改变答案.
- 延迟: 厂商声称端到端 70 到 500 ms. 第三方实测见下文, 约 280 到 590 ms (含公网).
- 价格: 输入每百万 token 0.042 美元, 输出免费, 长上下文同价. 以 2000 token 的输入计, 单次约 0.000084 美元. 速率限制按组织设置, 控制台显示, 文档未给数字.
- 数据: 隐私政策写明 "不会用你的输入训练或微调模型", 服务托管在美国, 输入只披露给服务提供商, 保留期没有固定数字, 企业客户可申请零数据保留, 子处理方名单在其信任中心 (https://typesafe.ai/legal/privacy-policy , https://typesafe.ai/legal/data-processing , https://docs.typesafe.ai/legal.md ). 1.14 提供自愿的数据共享, 官方称仍不用于训练 (https://typesafe.ai/blog/jev-1-14 ).
- 许可与权重: 官方页面没有提到许可或权重发布, 未找到一手证据表明可本地运行, 按仅托管处理. 博客称 Jev 处于早期访问, 候补名单; 文档与控制台已存在, 个人账号能否直接注册: 未找到一手证据.

## Open-weight candidates

下表数字均来自各模型卡, 由作者自测, 没有独立复现, 除非另注.

| 候选 | 基座与规模 | 许可 | 语言与长度 | 延迟 (自报) | 校准 |
|---|---|---|---|---|---|
| Laya multilingual | mmBERT-base, 322M | Apache-2.0 | 声称 100+ 种, 未专门测中文; 默认 1024 token, 可开到 8192 | T4 上 1 题 32.8 ms, 10 题 72.3 ms | 出厂过度自信; 按题型重拟温度后 ECE 从 0.314 降到 0.106 |
| NeoHorse-Jev-4B | Qwen3.5-4B 系, 权重约 9.08 GB | Apache-2.0 | 模型卡未写语言与上下文 | 未给 | 未报告 |
| Kev-4B | Qwen3.5-4B-Base + LoRA, 显存常驻 14.3 GB | Apache-2.0 | 仅英文; 验证长度 8192 | L40S 上 6 题约 41.5 ms | 单一温度, 域内 ECE 0.029, 域外不保证 |
| decider-4b | Qwen3.5-4B-Base, 约 8.4 GB | Apache-2.0 | 标注英文 | 未重测 | 有拟合温度, 作者称 ECE 约 0.16 |
| Bespoke Nimble 9B | Qwen3.5-9B + LoRA (约 165 MiB) | Apache-2.0 | 英文; 8192 token; 每题最多 255 项 | 未给 | 默认 T=1.0, 未单独拟合 |
| OpenJev 27B | 27B, Q4 约 16.5 GB, FP8 约 29 GB | 权重 CC BY-NC 4.0, 辅助代码 Apache-2.0 | 含中文 (XNLI 中文 82.5%); 16384 token; 最多 52 项 | H100 FP8 短文本约 80 ms | 固定设置换算 |
| APUS-OpenJev 4B/9B | Qwen 系 | 自有代码 MIT, 权重 Apache-2.0 | 标签含中英, 无中文评测 | 9B 的 vLLM P50 25.6 ms | 作者写明 "不是校准的置信度" |

来源依次为: https://huggingface.co/convaiinnovations/laya-multilingual , https://github.com/NandhaKishorM/laya , https://huggingface.co/TokenRhythm/NeoHorse-Jev-4B , https://huggingface.co/jaredpalmer/kev-4b , https://huggingface.co/Mapika/decider-4b , https://huggingface.co/bespokelabs/Bespoke-Nimble-9B , https://huggingface.co/openjev/openjev , https://huggingface.co/apus-ailab/APUS-OpenJev-v1 . 共同点: 全部是单次前向读出选项概率, 不生成文本, 多数提供与 TypeSafe 兼容的 `/v1/systemone` 本地服务. NeoHorse 卡片特别说明 "一个请求里的多题不等于共用一次前向", 批量是接口层面的, 不一定省算力. 批量一次答多题: Laya 与 Kev 的文档明确支持, Nimble, decider 的卡片未明说.

## Chinese fit

只找到一份专门的中文基准: zh-decision-bench v0.2 (https://github.com/codyqin/zh-decision-bench , 个人项目, 378 条, 467 题, 多为短语音指令, 客服消息, 审核帖子; 人工标注者只有一人; 部分子集仅 21 到 55 条). 准确率 (Jev API 为 1.13):

| 场景 | Jev API | NeoHorse 4B | Laya multi 322M | Qwen3.5-2B 直接读 logit |
|---|---|---|---|---|
| 语音路由 (323) | 0.960 | 0.950 | 0.870 | 0.938 |
| 客服路由 (34) | 0.882 | 0.912 | 0.618 | 0.882 |
| 客服紧急度 (34) | 0.676 | 0.471 | 0.647 | 0.529 |
| 诈骗判断 (21) | 0.952 | 0.810 | 0.714 | 0.524 |
| 是否升级 (55) | 0.600 | 0.618 | 0.564 | 0.473 |

Jev 1.13 到 1.14 的中文总准确率 0.891 变为 0.889. 调换选项顺序后答案翻转率: Jev 2.9% 和 1.9%, NeoHorse 2.9% 和 4.0%, Laya multi 20.6% 和 10.8%. 是否升级这类判断对所有模型都难. 该基准没有长输入, 也没有仓库规则类文本.

另有两份小样本: 40 条中文工单, Jev 准确 78% (均 588 ms), 本地 Laya 57% (7.6 ms), 置信度 0.60 以下转 Jev 的级联在 55% 转发率下追平 Jev, 但作者撤回了两条早先结论, 样本小, 标签自己写 (https://github.com/yibie/laya-jev-lab ). 一份 AI 作为第一作者的预印本称 Laya 在中文 NLI 上 AUC 为 0.568 (英文 0.984), 权重版本未锁定, 证据权重低 (https://github.com/SnackTerminator/small-decision-model-cross-domain-degradation ).

结论: 小模型对短中文指令的路由可用, 对 "是否该升级" "紧急度" 这类依赖判断的题与 Jev 有明显差距, 所有数字都不是 ARW 文本. ARW 仓库的中文规则文本较长, 带大量路径与术语, 上述基准没有覆盖, 必须在实测中补上.

## Task routing evidence

Jev 用于流程分流的现成例子很少. jev-review (https://github.com/devagrawal09/jev-review , MIT, 698 星) 用代码编排, 只让 Jev 做有边界的选择与打分, 阈值由代码套用, 作者称是实验, 没有准确率数据. jev-codex-benchmark (https://github.com/syjlovecyf/jev-codex-benchmark ) 让 Jev 在两档执行模型间分派 40 个任务: 全用低档 24/30, 全用高档 28/30, 分派 25/30, 分派了 33 个给低档, 作者明说不能据此宣称节省成本, 且为单次探索性运行. 它们说明接法可行, 不构成 ARW 的证据.

## Recommended trial set

用同一批带人工标签的 ARW 分流案例, 实测下面 3 个, 外加 1 个对照:

1. 托管 Jev 1.14 (必要时同批对比 1.13): 基线和上限. 价格极低, 1000 次 2000 token 的调用约 0.084 美元. 代价是 ARW 案例文本会发往美国托管服务, 需要用户决定可发送的范围.
2. NeoHorse-Jev-4B: 唯一在中文基准里接近 Jev 的开源 4B, Apache-2.0. 但模型卡不写语言, 上下文, 延迟, 校准, 这些都要自己测.
3. Laya multilingual 322M: 最便宜, 可在 CPU 上跑, 自带转发 "route" 与保形预测设计, 与 "低置信度转高智能 Agent" 的设想最贴近. 中文偏弱且出厂过度自信, 需要先测零样本, 再测用少量案例拟合温度 (README 要求至少 35 行校准数据, 要证明 0.95 精度大约需 50 行以上).
4. 对照: 未微调的 Qwen3.5 2B 或 4B 直接读选项 logit. 目的是判断专门训练到底带来多少收益, 这在上表中已有迹象 (语音路由 0.938).

不选: Kev, decider, Nimble 均标明仅英文, 与以中文为主的 ARW 文本不符; OpenJev 27B 权重为非商用许可, 且需约 16.5 GB 以上显存的量化版或 80 GB 级卡, 只有在接受非商用许可并需要开源上限时才值得加; APUS 明说概率未校准.

## Resources for the trial

- 数据: 100 到 200 条带标签的历史分流案例, 分成校准集和测试集, 记录输入长度与是否含路径规则文本, 以便看长度与无关内容的影响.
- 本地硬件: NeoHorse 与对照模型需要一块支持 BF16 的 CUDA 显卡, 4B 级权重约 9 GB, 同类 Kev-4B 常驻显存 14.3 GB, 所以 16 GB 以上较稳妥 (NeoHorse 自身的显存数字: 未找到一手证据, 此处为按同类推算). Laya 在 CPU 上即可. 本机若有其他常驻大模型服务, 要与它排先后, 不要同时占用.
- 下载: 合计约 10 GB 以上 (NeoHorse 约 9 GB, Laya 约 0.7 GB, 对照模型数 GB), 超过 100 MB 的门槛, 需先报批.
- 托管调用: 需要 API 密钥, 用户注册并同意发送范围, 费用按上面的价格可忽略.
- 必测指标: 准确率, 校准 (ECE 与按置信度分桶的准确率), 选项顺序翻转率, 单次与批量延迟, 以及 "高置信错误" 占比, 因为分流设计依赖置信度分流.

## Open decisions and gaps

- 需用户决定: 是否允许向托管 Jev 发送 ARW 案例文本, 以及注册账号; 是否接受约 10 GB 下载与占用一块显卡; 是否接受非商用许可的候选.
- 前提修正: 10-25 材料里 "官方承认对中文敏感" 缺少一手依据, 中文可用性应由实测决定, 不应预设官方已承认或否定.
- 证据质量: 开源模型的数字几乎全是作者自测, 且 "JevBench" 这个名字被不同项目用于不同基准, 不可互相比较; 只有 zh-decision-bench 单一第三方中文数据, 样本小.
- 未找到一手证据: Jev 的权重或许可条款, 个人账号注册条件, 速率限制的具体数字, NeoHorse 的显存与延迟, Decitron 等其他托管同类 (只在第三方文章里被提到, 未取得一手页面).
