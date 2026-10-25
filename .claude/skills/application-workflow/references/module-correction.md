# Module 修正

用户没有显式调用 `application-workflow` 时, Module 的共用规则只能读取这份引用文档. 读取它不授权任何 Application 工作.

## Governance gate

只在以下条件同时满足时使用此路径:

- 已发布的 Module implementation issue 具有一个有效 `Application source issue:` 关联.
- 受保护的 Module 内容存在真实问题, 且该问题阻止已经同意的实施范围继续.

解释问题和准确的拟议修改, 然后在编辑前取得用户对这些修改的明确授权.

软锁定包括以下内容:

- `## What to build`.
- `## Spec Requirement`.
- `## Acceptance criteria`, 但排除任务列表的复选框状态.
- `## Blocked by`.
- 同一 effort 中现有且已由 Git 跟踪的 `spec.md`.

`Application source issue:` 关联是硬锁定. 不得更改它, 也不得建议新的关联目标. 软锁定和硬锁定之外的普通 issue 内容继续遵循普通 issue 工作流.

## Record the current correction

获得授权后, 编辑实际的 Module issue 或已跟踪 spec. 在 issue 唯一的 `## Comments` 下维护位于末尾的唯一 `### Downstream changes` 子章节.

为当前修正添加一个列表项, 记录问题, 必要修改和用户授权. 只有旧列表项对应的修正被撤回或取代时, 才删除该列表项.

列表遵循以下结构:

- 只有空列表使用 `- None.`, 它不得与真实列表项共存.
- 真实列表项从第 0 列的 `- ` 开始, 并在同一行包含非空内容.
- 每个非空延续行, 嵌套列表行或围栏代码块行至少缩进 2 个 ASCII 空格或 1 个制表符.
- 所有普通评论都保留在这个末尾子章节之前.

在把修正提交到普通审核工作流前, 运行以下只读机械检查:

```text
arw module check-correction <local-module-issue-id>
```

命令把 `HEAD` 中的 issue 和适用的已跟踪 spec 与文件系统中的当前字节进行比较. 当前字节可以同时包含已暂存和未暂存的修改.

检查成功要求软锁定内容实际发生变化, 关联未变, `Downstream changes` 子章节已变, 并且至少包含一个当前存在的真实列表项.

命令不判断问题是否真实, 修改是否已获授权, 或列表项是否在语义上描述了每项修改. 它不写文件, 不改变 Git 索引, 也不执行 Git 暂存或差异审核.
