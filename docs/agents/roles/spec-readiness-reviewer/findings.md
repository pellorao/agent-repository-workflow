# Spec Readiness Reviewer 问题记录

只有审查发现至少一个结果为 `gap` 或 `uncertain` 的问题时, 才读取本文档.

## Evidence

`evidence` 使用非空字符串数组. 每个字符串以 Inputs 中的完整 `filePath` 开头, 后接冒号和从 1 开始的正文行号或连续范围, 例如 `docs/specs/example/spec.md:14-17,18`. 同一文件的后续片段可以省略路径; 换文件时写出完整路径. 各片段使用逗号分隔, 也可分别写为数组元素. 行号对应请求内该 Input 的 `content`, 不对应请求 JSON 文件的行号或工作树中的其他版本.

只有 `SPEC-READINESS-INPUTS` 和 `SPEC-READINESS-REQUIREMENTS` 还可以引用 subject 的 `filePath`, 用来标识所选范围或选择缺陷; 行号对应请求中的 `subject.content`. 其他检查不得引用 subject. Subject 不能代替证明行为, 理由, ADR 覆盖范围或 Module Design 质量的治理 Input 正文.

为每项断言提供最小充分正文. 连续证据使用起止行范围, 不连续的证据使用组合定位. 需要完整一节正文时, 引用第一行正文到最后一行正文. 范围可以包含标题和边界空行, Engine 会剔除这些行; 只有标题或空白的引用无效. 缺少必要事实的结论仍须引用建立该义务和显示遗漏或未知的正文. 跨文档冲突引用两侧直接陈述合同的正文. 不使用章节锚点或仅文件路径, 不附加仅仅相关的内容.

## JSONL draft

每个非空行写入一个完整 JSON 对象, 只包含 `check`, `result`, `evidence` 和 `finding`. `result` 是 `gap | uncertain`. `evidence` 是非空定位信息数组. `finding` 解释具体缺陷, 缺失内容或冲突合同, 以及它对就绪的影响. 写入前完成 [覆盖与归责](../spec-readiness-reviewer.md#coverage-and-attribution) 的逐条核实. 无需建议修复方法.

每行只记录一个可以独立修正的问题, 并把该问题的全部证据放入它的 `evidence` 数组. 不得使用数组或对象包装各行. 不得输出 `satisfied` 检查, 总体结果, 模式版本, Input 哈希, 快照, 原始字节, base64, ARW Engine 元数据, 或者为 `satisfied` 或未执行检查添加占位符. Reviewer 的写入时机是内部信息. 只有返回 `ready` 后才消费最终字节.

以下与具体场景无关的单行示例展示组合正文定位和最小 JSONL 形状:

```jsonl
{"check":"MODULE-DESIGN-INTERFACES","result":"gap","evidence":["docs/specs/example/spec.md:14-17,18"],"finding":"上传 Interface 没有定义写入失败时的调用方可见结果, 因而无法实现和验证该失败合同."}
```

首次写入时, 直接把这一类单行内容和末尾 LF 写到 Reviewer Request 的精确 `draftPath`. 后续每次写入都在同一路径保留当前已核实的完整行集合. 使用直接文件写入或补丁操作, 让 JSON 保持字面内容; 不经命令替换, shell 反引号或转义后的换行组装内容, 也不创建中间文件. 写入后继续语义审查.
