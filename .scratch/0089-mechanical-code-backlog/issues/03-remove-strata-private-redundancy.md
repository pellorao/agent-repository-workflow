# 清理 Strata 台账剩余的私有重复实现

Status: completed

## What to build

继续筛选用户复制到 `.tmp/strata-ledger.md` 的代码台账, 先核对 #522 至 #533 的 2026-10-31 条目, 再核对较早的 lib 代码条目. 行号是原始台账行号, 不是该文件内容中的源码行号. 当前基线为 eb10f4f, 同 effort 的 issue:0089:01 继续延期.

实施仍有效的私有清理: #31 删除两个最终状态映射中不可能缺键的检查; #87 删除重复 issue 来源映射中不可能缺键的检查; #88 复用已找到的标题, 删除迁移后重复的标题查找; #89 将相同的元数据正则表移出逐行循环; #92 复用现有围栏感知行扫描; #95 只合并 Comments 边界计算, 保留诊断的原优先级; #126 使用实际文件系统 resolve 类型, 删除成功结果中的不可能缺字段检查; #180 内联仅调用一次的字段父级判断; #194 删除 Markdown 私有状态中无人读取的位置字段; #195 删除仅匹配非字母标记时的重复大小写转换; #200 删除已验证排序的清单再次校验; #204 删除术语匹配及保留统计对自己构建的数据的不可能缺值检查; #256 删除已规范化角色记录中不可能缺少 platform 的检查; #311 删除成功目录列表中的死空数组回退; #314 内联仅调用一次的直接文件筛选. 最终状态映射保留两个不同结果类型, 不为合并重复查询引入通用抽象.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 只修改私有实现及本 issue 记录, 不修改导出签名, 不修改 Host 或 lib/background-agent 下的源码, 不安装, 不推送.

预算: 预计代码变更 130 行, 测试变更 0 行, issue 与文档约 90 行, 总计约 220 行; 生产代码净增不超过 0 行. 约 800 行是仍有适用项时的目标, 不以重复记录或测试填充篇幅.

复用现有迁移, 重复编号, 围栏与前导内容, Comments 边界与诊断优先级, 术语匹配与使用次数, 配置字段父级, 子模块收敛与切换恢复, 输入路径越界和分发源文件筛选测试. 不新增仅镜像实现的测试. 验证完整 Source Checkout, 含严格类型, 完整测试, 三个生产检查, 受影响文件语法, 文本, 术语和空白检查.

## Acceptance criteria

- [x] 已确认项完成, 现有输出, 公开 Interface, 错误与持久状态保持不变.
- [x] 完整 Source Checkout 验证和两个内置 Reviewer 的提交审核通过.
- [x] 记录台账筛选结果, 预计与实际变更行数分列代码, 测试和 issue 与文档, 不以凑行数扩大范围.

## Blocked by

- None - can start immediately

## Validation

- `pnpm typecheck` 通过, 公开签名未修改.
- `pnpm test` 全部 906 项通过, 无失败或跳过. 复用现有迁移, 围栏, 诊断, 术语, 配置, 文件系统, 子模块和分发覆盖, 不添加镜像实现测试.
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 全部通过.
- 九个修改的 mjs 文件分别运行 `node --check` 通过. 通过子进程统一检查的尝试遭环境 EPERM, 改为逐文件直接执行成功.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0089-mechanical-code-backlog/`, `git diff --cached --check` 通过. 新 issue 的语言检查为中文 84.8%, 其余是命令与精确标识符.
- 代码实际变更 119 行, 新增 36 行, 删除 83 行, 净删 47 行; 测试 0 行. 未超出代码 130 行及净增 0 行预算. issue 与记录按最终提交统计.

## Comments

用户授权在 effort 0089 中继续筛选 Strata 台账并创建后续 issue, 自主完成验证, 审核和提交. Main Agent 独占本 issue 及所列私有实现的写入; 基线工作树干净. 当前任务不需要其他 effort 的内容.

就绪处理: spec-readiness 的 Exception workflow 仍由 assertExceptionApplicable 限制为 effort 内只有一个实施 issue, 本 effort 不满足. 按 implement Skill 明文的行为保持重构例外实施, 不生成 not-applicable 记录, 不用例外跳过提交审核. 没有需要更改规则的冲突.

筛选结果: #522 至 #533 全部已在当前 HEAD 修复, 包括按 effort 读取冻结关联, 共享状态解析, 批量 Git 文本读取, 非空映射值, 规范身份解析和单次关联遍历. 不再重复实现.

较早条目按当前实现复核. 已消失或已由共享实现覆盖的代表项为 #3, #4, #8, #9, #11, #15 至 #18, #21, #23, #24, #39, #42, #46, #47, #54, #56, #58, #59, #63, #64, #69, #72, #80, #82, #85, #86, #90, #94, #97, #100, #109, #110, #112, #113, #115, #122, #123, #127, #129, #177, #179, #186 至 #190, #199, #205, #208, #209, #221, #223, #234, #235, #237, #238, #240 至 #243, #247, #248, #250, #252 至 #254. #292 至 #301 所属旧模块已经删除. #283 的 effortNumber 已有实际使用者, 不能按旧结论删除.

跳过输出或错误变化: #10, #12, #30, #38, #40, #43, #44, #53, #62, #68, #75, #76, #91, #93, #102, #111, #116, #119, #125, #176, #178, #193, #207, #239, #313. #95 的两个诊断检查优先级不同, 只合并不影响优先级的边界计算.

跳过公开 Interface 或输入校验变化: #6, #19, #20, #22, #25 至 #29, #32 至 #36, #55, #57, #60, #61, #70, #74, #77, #96, #101, #103 至 #108, #114, #117, #118, #128, #192, #198, #203, #206, #226, #227, #229, #249, #255, #258 至 #260, #305, #306, #309. #14, #28, #48, #66, #73, #81, #98, #99, #104, #120, #121, #124, #172 至 #175, #185, #196, #197, #201, #202, #210 至 #220, #222, #224, #225, #228, #232, #236, #244 至 #246, #251, #257, #282 至 #291, #302, #303, #307, #308, #310, #312, #315, #316 涉及模块职责, 不同验证合同, 来源或执行顺序, 不作为完全相同的重复实现合并. 个别还有数行的私有精简机会, 远低于 300 行, 不以抽象或测试填充本轮.

#50 至 #52, #130 至 #171 和 #261 至 #281 属于 Host, 禁止的后台实现或 Reviewer 运行时, 本轮不实施. #543 继续延期, 不通过安装绕开限制. arch 条目均不作为代码实施来源.

提交审核实测摘要:

```text
code: -47 lines (files: 9)
  lib/application-jira/submodule-coordination.mjs -6
  lib/arw-common/issue-documents.mjs -25
  lib/arw.mjs 0
  lib/common/configuration-conversion.mjs -3
  lib/common/markdown-visible-text.mjs -2
  lib/document-terms/document-terms-repository.mjs -1
  lib/document-terms/document-terms.mjs -5
  lib/repository-workflow/workflow-lock.mjs -1
  lib/workflow-distribution/workflow-distribution-sync.mjs -4
documents: 0 characters (files: 0)
tests: 0 lines (files: 0)
next ADR number: 0041
```

第一轮两个内置 Reviewer 正常结束, 均报告 `No problems.`. Main Agent 抽查迁移的围栏扫描与 Comments 诊断优先级, 以及 Markdown 标记匹配的全部调用, 未发现漏检. 更新完成状态后沿原线程复审最终候选.

最终行数: 代码 119 行, 测试 0 行, issue 与文档 74 行, 合计 193 行, 低于预计 220 行. 可在当前约束内直接确认的剩余精简不足约 300 行, 不为达到篇幅目标继续增加工作. #543 仍由延期的 issue:0089:01 承载.

第二轮处置: 要求符合 Reviewer 指出的行数错误属实, 已更正. 对 Code Standards Reviewer 的完成状态问题请求重新核对: commit Skill 第 5 步要求变更后再次 prepare, 第 6 步限制的是当前受审版本后的字段变更, 并未限制为首轮. 第二轮 request.tree 已包含 completed 和三个勾选; lib/commit-audit/commit-audit.mjs 的 verify 核对最新 request.tree 的 subject. 实际运行 commit-audit verify 得到空 errors, 与报告所称 Engine 必拒绝不符. 本条只请求依据上述证据重新检查, 不替代 Reviewer 判断. 最终轮再次 prepare, 状态与勾选不再改变; 仍有争议则交用户决定.
