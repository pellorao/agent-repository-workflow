# 修复 Reviewer 检查与发布脚本并合并重复实现

Status: completed

## What to build

按 `.tmp/triage.md` 的 G 分组, 在实际开始时重新核对 #587 到 #598. 预计总改动约 250 行, 非测试代码净增最多 +40 行, 测试约 +80 行, issue/文档约 +1600 字符. 不读取外部台账, 使用 triage 附录.

修复已授权的 #587 相对 sessionPath 返回指向 agent.json 的 blocked 诊断, #588 文件读取失败保留 failed/fixture-read, #593 PATH 探测失败不得被负向步骤判为成功, #597 同时保留主错误和清理错误. 完成 #589, #594, #595, #596, #598 的重复合并; #595 仅共用两份发布脚本的缩写提交检查, upstream-sync 的完整提交约束不变. #590 仅在确认 reviewer-runtime 仍校验 readPaths 后删除冗余循环, 不删除字段. #591 与 #592 不做. 不修改 lib/background-agent 下任何文件.

这些行为缺陷已由 triage 明确确认没有设计决定, 按普通 Spec Readiness 独立审核确认就绪. 其他项仅接受行为保持改动. 本 issue 不纳入可选填充项 #560 到 #562, 保持本次修复范围明确, 不为凑行数扩展范围.

具体观察与边界:

- 检查器要求单个成员具有非空绝对 sessionPath, 否则沿现有 blocked 结果指明 agent.json; 不能把相对路径交给本机工作目录解析. 测试覆盖相对路径和原有两种后端的绝对路径. 实例文件实际读取失败沿现有 fixture-read 失败结果报告, 不再被空文本吞掉; 用文件读取故障观察最终 status, stage 和诊断.
- 重复的 blocked/failed 结果构造合并为套件内部共用函数, 调用方继续拥有失败阶段与诊断语义, 不变更结果字段或输出.
- readPaths 字段与输入验证保留, 只删除原生权限构造器中已被 cwd 读取权限覆盖的循环. 用现有原生权限测试和运行器拒绝越界测试证明两种后端的边界仍成立, 不改变 Reviewer 规则或能力.
- 发布脚本只合并 package.json 的重复读取, 两处缩写提交检查和 --previous 解析. 缩写提交校验保持 7 到 40 位小写十六进制, 原有拒绝文字和退出码不变.
- Windows PATH 读取失败在返回 fresh 的实际命令结果前抛出错误, 因而无论调用方期待成功还是失败都不能误判通过; 以抽出的最小结果检查单元测试失败诊断与成功路径. 不在常规验证中运行安装, VM 或真实发布流程.
- check 的主错误与 down 的清理错误同时发生时, 最终 stderr 保留两条消息, 退出码为 1 且 stdout 报 FAIL. 只有清理错误时同样失败, --keep 仍跳过清理. 通过现有 release-vm 假进程边界验证, 不访问真实 VM.
- scripts/reviewer-capability.mjs 的列表容器由 LIST_OPTIONS 派生, 各选项原有行为保持不变.

## Acceptance criteria

- [x] 对各项给出已修复, 已消失或跳过的核对结论, 所有获准行为修复有最少充分测试, 包括相对路径, I/O 失败, 负向步骤未执行和主错误/清理错误同时出现.
- [x] 记录预计与实际改动量, 区分非测试代码, 测试, issue/文档.
- [x] 完整 Source Checkout 验证通过, 包括完整测试, 类型, 分发, 投影, 引导生成, 受影响语法, 文本, 术语和差异检查.


## Blocked by

- None - can start immediately

## Validation

#587 与 #588 已修复, inspection 测试观察 agent.json 的 blocked 诊断和 fixture-read 失败. #589 合并相同结果构造. #590 已确认 reviewer-runtime.mjs 仍校验 readPaths 位于 cwd 内, 保留字段及运行器验证, 仅删除原生权限冗余循环; 完整测试包含两种后端的运行器边界和原生权限验证. 没有修改 Reviewer 规则或能力, 因而无需能力校准.

#593 已修复, 既有 Windows guest-check 入口测试在 PATH 前置读取失败时观察诊断抛出且负向命令没有执行, 成功读取时观察命令确实执行. #594 到 #596 和 #598 已合并重复读取, 校验, 解析与列表初始化. upstream-sync 的完整提交约束未改. #597 的假 vmrun 用例覆盖双错误, 仅清理错误及 --keep 跳过清理. #591 与 #592 按授权排除, 没有其他跳过项.

完整验证通过: pnpm typecheck; pnpm test (926 个测试, 全部通过); node scripts/check-workflow-distribution.mjs; node scripts/project-claude-skills.mjs --check; node scripts/generate-install-arw.mjs --check; 所有受影响 .mjs 的 node --check; node arw.mjs text check; node arw.mjs terms check --include .scratch/0100-code-backlog/; git diff --check. 未运行真实安装, 发布或 VM.

新增回调定向实测: Windows PATH 入口检查 60.82 ms, 相对或空路径 3.59 ms, 实例读取失败 3.82 ms, 双错误 34.17 ms, 仅清理错误 35.80 ms, --keep 27.35 ms. 修改的现有发布配置用例最高 65.93 ms, 均小于 100 ms. 沙箱的发布测试只返回文件级失败, 在允许子进程的环境原样重跑逐例全部通过; 完整测试也在该环境运行.

预计非测试代码净增最多 +40 行, 测试约 +80 行, issue/文档约 +1600 字符. 提交审核 prepare 实测如下, 均在代码与测试预算内:

```text
code: +9 lines (files: 9)
documents: 0 characters (files: 0)
tests: +82 lines (files: 3)
```

引擎的 documents 统计不含 .scratch 规划记录. G 的 issue 实际为 4215 字符, 超过约 +1600 字符预算 2615 字符, 原因是普通就绪审核所需边界, 逐项处置和完整验证证据; 删除会丢失所需交接信息. F 的规划与 gap 记录一并保留在同一 effort, 没有作为 G 的实现代码计算.

## Comments

用户已裁决: triage 的 "同一 effort 两个 issue" 与 not-applicable 例外不能同时满足, 引擎要求例外 effort 恰有一个实施 issue. F 和 G 保留同一 effort, 均走更严格的普通 Spec Readiness, 不视为豁免; 最终汇总报告该冲突.

用户要求推进独立积压. Main 核对 G 与 F 没有代码或结果依赖, 原 Blocked by 只是规划的串行次序, 因此移除它并先推进 G; F 保持未完成.

第 1 轮提交审核: 要求符合 Reviewer 指出实测体积尚未写入受审树, 已补记. Code Standards Reviewer 指出单调用方结果包装器没有封装复杂逻辑, Main 独立确认既有 guest-check 入口可隔离此故障, 已内联判断并删除包装器及其单测, 改用现有安装合同测试中的假 Windows 入口. What to build 中抽出最小检查单元的文字按本次去重修正理解为最小隔离测试, 测试仍证明同样的失败诊断, 成功路径及命令是否执行; 不改变范围, 行为或验收含义, 按已开始实施后的一致性处置保留 subject, 交要求符合 Reviewer 核对.

第 2 轮 prepare 的两条体积警告对应内联修正前的记录, 已按该轮实测更新为 code +9 行, tests +82 行. 测试较约 +80 行估算多 2 行, 用于既有入口的 PATH 成功/失败替身; 代码仍低于 +40 行上限. 首次重跑套件的布局检查读取到索引中已删除的辅助模块, 同步索引后原样重跑, 不更改测试约束.

第 2 轮提交审核均正常结束. Code Standards 报告 No problems. 要求符合报告仅保留体积数字过期问题, Main 核对本轮 base-to-tree 差异为 code +9/9 个文件, tests +82/3 个文件, 已在 Validation 更新; 按记录章节例外无需语义复审. 抽查共用提交检查仍接受 7 到 40 位小写十六进制且 upstream-sync 保持 40 位; 运行器仍拒绝 cwd 外 readPaths, 原生权限的 cwd 读取与 writePaths 写入未改.

最终源代码改动 55 行 (新增 32, 删除 23, 净增 9), 测试改动 86 行 (新增 84, 删除 2, 净增 82), 合计 141 行, 低于约 250 行分组估算. 文档按字符度量见 Validation, 同一 effort 的 F 规划及就绪 gap 不算 G 的实现完成.

合并入主仓库后的提交审核 (克隆审核不可复用, 基线与上下文已变) 第 1 轮, 两个 Reviewer 均 ready, 问题均不是行为缺陷, 按台账处置:

台账: lib/reviewer-capability/results.mjs:1-2 blocked 与 failed 应移到 lib/common/ 记录不修 issue 授权为套件内部共用函数, 移到公共模块属可选的归属调整, 不改行为.
台账: lib/reviewer-runtime/reviewer-native-policy.mjs:7-8 readPaths 类型声明仍必填 转入后续 issue 字段与校验按授权保留, 仅是 JSDoc 类型与测试入参清理, 不改行为.
台账: lib/reviewer-capability-setup.mjs:31,32,97 仍内联同形结果 转入后续 issue 这三处未改动, 机械合并不改行为, 可与上一条一并处理.
台账: docs/specs/agent-repository-workflow-development/spec.md:325 与 inspection.mjs:110 的 fixture-read 阶段表述不一致 转入后续 issue #588 要求实例读取失败报告为 fixture-read, 规格句需随之修订, 属文档修订, 代码行为符合 #588.
