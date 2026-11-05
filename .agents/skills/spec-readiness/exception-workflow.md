# 例外流程

## Exception workflow

只有应用治理设计和 ADR 触发条件, 并取得用户关于不需要治理设计的明确确认后, 才使用例外. Main Agent 在当前会话的 spec-readiness 临时工作区 `<仓库根>/.tmp/<agent-platform>/<sessionId>/<NNNN>_<NN>/spec-readiness/` 下写入 JSON 例外草稿 (用绝对路径传给 `--input`), 只包含 `exception.reason` 和 UTC 秒级 `exception.confirmedAt`, 然后执行同样的 `generate -> promote -> verify`; 只有 `promote` 写入与 issue 绑定的 `not-applicable` 记录. 例外不使用 Reviewer 报告. 不得推断确认, 也不得把失败的普通审查转为例外. 用户确认须早于首次修改本 issue 的实现文件; `exception.confirmedAt` 写用户作出确认的时间 (用户事先对一类 issue 作出的常设确认, 写该常设确认作出的时间), 不写生成时间. 满足这一条件时, 例外记录可以在实施开始后补生成, 在实施提交前完成上述流程, 因为例外不经 Reviewer, 记录内容与生成时机无关.
