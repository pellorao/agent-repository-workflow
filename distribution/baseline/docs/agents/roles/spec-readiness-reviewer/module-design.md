# Spec Readiness Reviewer Module Design 检查

只有治理 spec 或 PRD 使用 `Not required:` 或完整的 Module Design 格式时, 才阅读本文件. 对每个实质适用的 `Not required:` 格式应用 `MODULE-DESIGN-EXEMPTION`, 然后只对使用完整格式的文档应用 5 项完整格式检查.

## Exemption checks

对于 `MODULE-DESIGN-EXEMPTION`, 枚举实质适用 `Not required:` 格式的每个治理 spec 或 PRD, 并独立评估每个段落. 判断它是否具体说明不需要模块相关变更的原因. 一个文档的证据或结论不能覆盖另一个文档. 循环, 笼统或内部矛盾的推理是 `gap`. 不得评估格式选择已经错误的文档. 如果没有实质适用的例外, 不执行 `MODULE-DESIGN-EXEMPTION`, 也不为它写任何行; 直接继续其他适用检查.

## Complete-form checks

### `MODULE-DESIGN-MODULES`

检查 Module 是否通过责任和非责任定义, 重要行为和数据是否只有一个责任方, 以及设计是否避免重复的策略编排, 以文件清单定义边界和直通包装器. 在长期规范中, 要求具有稳定且唯一的责任, 同时排除实施导航和临时结构.

### `MODULE-DESIGN-INTERFACES`

检查调用方输入, 输出, 不变量, 错误, 顺序, 结果和副作用. 把每种表示和失败形式与所提供的使用方合同和架构合同进行比较. 把每个公开成功, 错误和恢复结果与 Testing Decisions 进行比较, 并独立报告每个缺失的公开生命周期测试边界. Interface 必须隐藏实现细节, 并向调用方和测试提供一个小而完整的边界.

### `MODULE-DESIGN-SEAMS-ADAPTERS`

只评估分配给非测试运行时代码的行为.

不得仅因某项操作具有必要顺序, 调用平台特定工具, 或具有失败和恢复规则, 就把用户, Main Agent, Platform Host 或其他外部参与者负责的操作重新分类为运行时 Module. 如果完整 Input 把操作保留在运行时代码外, 评估运行时 Module 和 Seam 是否保留该责任归属, 而不是要求为外部参与者提供 Interface 或 Adapter.

检查每个实际运行时 Seam 是否表示具体的行为变化, 是否具有明确的 Interface, 以及是否至少有两个具体 Adapter. 如果确定性测试 Adapter 满足相同 Interface, 且更改了可通过 Module Interface 观察的行为, 可以把它计入. 相同 Interface 要求相同的操作和结果合同, 不要求配置的结果相同. 只有设计声称现有运行时行为或等效结果时, 才要求相关证明.

如果 Input 标识 Adapter, 但明确把 Interface 一致性留为未知, 报告 `uncertain`. 对明确缺失或矛盾使用 `gap`. 拒绝重复的运行时领域策略, 绕过适用 Module Interface 并由调用方编排的平台步骤, 只有一个 Adapter 的假想 Seam, 以及绕过所述 Interface 的测试辅助程序.

### `MODULE-DESIGN-DEPENDENCIES-DATA-FLOW`

检查依赖方向, 规范来源, 可变状态的责任方, 转换, 失败和恢复传播, 循环, 以及跨章节一致性. 对长期规范, 要求 `Dependencies and Data Flow` 中具有一张权威来源表, 其他位置使用引用而不是重复的责任表, 并具有明确的最终提交时点. 沿每项已经声明的权威追踪其来源, 责任方, 转换, 传播, 失败和恢复行为, 以及最终提交时点. 除非适用治理规则有此要求, 围栏 `mermaid` 图是可选的. 散文仍然具有规范性.

### `MODULE-DESIGN-RATIONALE`

在每份完整格式文档中, 独立清点 `Modules` 中每个不明显的 Module 边界, 以及 `Dependencies and Data Flow` 中每项权威选择和依赖方向选择. 检查每项选择的替代方案, 所选优先事项, 接受的成本或限制, 以及拒绝理由, 且不重复共用设计理由. 一个边界, 权威或方向的理由不能满足另一个.
