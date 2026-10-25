# Spec Readiness Reviewer 问题记录

只有审查发现至少一个结果为 `gap` 或 `uncertain` 的问题时, 才读取本文档.

每条问题按 `docs/agents/reviewer.md#report` 以 `- ` 开头, 依次写出: 负责的检查名 (例如 `MODULE-DESIGN-INTERFACES`), `gap` 或 `uncertain`, 具体缺陷, 缺失内容或冲突合同, 以及它对就绪的影响. 写入前完成 [覆盖与归责](../spec-readiness-reviewer.md#coverage-and-attribution) 的逐条核实. 无需建议修复方法.

定位以 Inputs 中的完整 `filePath` 开头, 后接冒号和从 1 开始的行号或范围, 例如 `docs/specs/example/spec.md:14-17,18`; 行号对应请求内该 Input 的 `content`, 不对应请求 JSON 文件或工作树中的其他版本. 只有 `SPEC-READINESS-INPUTS` 和 `SPEC-READINESS-REQUIREMENTS` 还可以引用 subject 的 `filePath` (行号对应 `subject.content`), 用来标识所选范围或选择缺陷.

为每项断言引用最小充分正文. 缺少必要事实的结论仍须引用建立该义务和显示遗漏或未知的正文. 跨文档冲突引用两侧直接陈述合同的正文. 不使用章节锚点或仅文件路径代替行号.

示例:

```text
- MODULE-DESIGN-INTERFACES, gap: 上传 Interface 没有定义写入失败时的调用方可见结果 (`docs/specs/example/spec.md:14-17,18`), 因而无法实现和验证该失败合同.
```
