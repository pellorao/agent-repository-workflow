---
description: 按分流状态机处理本地跟踪器中的 issue: 分类, 验证, 必要时追问, 并把 issue 正文整理到可交给 Agent 实施.
name: triage
disable-model-invocation: true
---

# 分流

让本地跟踪器中的 issue 沿一个小型状态机流转. 分流状态就是 issue 的 `Status:` 值, 字段和路径遵循 `issue-tracking` Skill; 本 Skill 只定义分流判断. 没有 `Status:` 的 issue 表示尚未分流.

## States

- `needs-triage`: 需要用户评估.
- `needs-info`: 等待报告者提供更多信息.
- `ready-for-agent`: 已充分定义, 可交给无人值守的 Agent.
- `ready-for-human`: 需要人来实施.
- `wontfix`: 不处理.

转换: 未分流的 issue 通常先到 `needs-triage`, 再到 `needs-info`, `ready-for-agent`, `ready-for-human` 或 `wontfix`; `needs-info` 在报告者回复后回到 `needs-triage`. 用户可以随时覆盖. 转换看起来不寻常时先指出并询问.

`wontfix` 是终态. 把实施 issue 置为 `wontfix` 的提交路径见 `commit` Skill 的非实施工作流.

## Invocation

用户调用 `$triage` 并用自然语言说明需求, 例如 "有什么需要我处理的", "看看 issue 0003/02", "把它移到 ready-for-agent", "有哪些可以交给 Agent". 按 `arw-commands` Skill 查询 issue 列表.

**展示需要关注的事项**: 分三组, 最旧的在前: 未分流的; `needs-triage`; `needs-info` 且报告者在上次分流记录之后有新回复的. 每项一行摘要和各组数量, 由用户挑选.

## Triage a specific issue

1. **收集上下文.** 读取完整 issue, 包括 `## Comments` 中已有的分流记录 (不重复提已解决的问题). 按适用的上下文文档并遵循所涉区域的 ADR 探索代码库. 做两项检查: (a) 冗余: 按领域概念 (而不只是请求措辞) 搜索是否已有该行为的实现, 并报告搜索位置; 已有则是 "已实现" 的 `wontfix`. (b) 先例: 读取相关 ADR 和已 `wontfix` 的 issue, 找出与本请求相似的既有拒绝决定.
2. **验证主张.** 在追问之前确认主张成立. 缺陷按报告步骤复现. 报告结果: 已确认 (附代码路径), 失败, 或细节不足 (强烈的 `needs-info` 信号). 验证不得修改已跟踪文件.
3. **建议.** 向用户说明你建议的状态及理由, 以及与请求相关的代码库概况 (包括是否已实现), 然后等待指示.
4. **必要时追问.** 请求需要充实时, 同时使用 `$grilling` 和 `$domain-modeling`, 边追问边澄清领域术语, 并随决定落地更新上下文文档或 ADR.
5. **落实结果:**
   - `ready-for-agent`: 把 issue 正文整理为可实施的 `## What to build` 和 `## Acceptance criteria` (见下).
   - `ready-for-human`: 同上, 并在 `## Comments` 注明不能交给 Agent 的原因 (需要判断, 外部权限, 设计决定, 手工测试).
   - `needs-info`: 在 `## Comments` 写分流记录: "已确认" 列出追问中已解决的要点 (使工作不丢失), "仍需报告者回答" 列出具体, 可操作的问题, 不写 "请提供更多信息" 这类空话.
   - `wontfix`: 在 `## Comments` 写理由. 已实现的, 指向实现位置. 拒绝的功能请求, 且理由需要长期保留时, 通过 `$domain-modeling` 写入 ADR (理由要实质性的, 引用项目范围, 技术约束或战略决定, 而非 "暂时没空"). 之后先例检查就能找到它.
   - `needs-triage`: 设置状态; 有部分进展时在 `## Comments` 补一句.

## Writing a ready issue

issue 正文是实施的唯一要求来源, `## Comments` 不承载要求 (见 `issue-tracking` Skill). 把要求写进 `## What to build` 和 `## Acceptance criteria`:

- **持久而非精确.** issue 可能放几天甚至几周, 代码库会变. 描述接口, 类型和行为合同, 可以点名 Agent 应查找或修改的类型, 函数签名或配置形状; 不引用文件路径和行号 (规则见 `../to-spec/SKILL.md`).
- **行为而非过程.** 写系统应该做什么, 不写怎么实现. 好: "`SkillConfig` 应接受类型为 `CronExpression` 的可选 `schedule` 字段". 坏: "打开 src/types/skill.ts, 在第 42 行加字段".
- **验收标准完整.** 每条都具体, 可独立验证. 好: "运行 `arw list issues --status needs-triage` 返回已完成初步分类的 issue". 坏: "分流应该正常工作".
- **写明范围边界.** 说明不在本 issue 范围内的内容, 防止 Agent 过度发挥.
- 缺陷类 issue 写清当前行为 (坏在哪) 与期望行为, 已确认的验证结果会让正文有力得多.

issue 的 subject 变化会使已有的就绪记录失效, 之后由 Spec Readiness 流程处理.

## Quick state override

用户说 "把它移到 ready-for-agent" 时直接设置状态, 先确认你要做的事 (状态变化, 记录), 跳过追问. 若正文还不满足上节要求, 指出这一点即可, 不另设询问回合.
