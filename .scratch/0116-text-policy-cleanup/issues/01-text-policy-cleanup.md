# 文本策略清理与 .arwignore 读取错误修正

Status: completed

## What to build

落实本轮 Issue N, 仅修改 lib/arw-common/text-policy.mjs 及必要测试. 不创建 spec, 不涉及治理设计或架构决定, 使用用户已授权的 Spec Readiness 例外.

1. 将 .arwignore 的读取移出解码捕获范围, 使读取失败直接传播. 仍将无效 UTF-8, NUL 和不支持的策略文件类型报告为 invalid-agent-scope-policy. 这是本轮唯一预期的用户可见输出变化.
2. collectGitVisiblePaths 使用 lib/common/git-process.mjs 的 runCheckIgnore 批量处理 check-ignore, 删除本地 runGit 的 check-ignore 特判. 输入已由 ls-files 路径解析验证, 授权不再对 check-ignore 输出重复执行尾 NUL 和严格 UTF-8 检查. 不改 code-map.mjs.
3. executeTextPolicy 删除重复的 intent 检查, 输入类型收窄为 'check' | 'fix', 删除 fiz 断言. lib/arw.mjs 继续承担命令参数边界校验.
4. 合并三处重复的阻断结果, 保持原有诊断与零写入语义. 不改 comparePath 或其他未列范围.

预计净增量: 非测试代码 -15 行, 测试 +20 行, issue 文本约 40 行. 使用现有文件系统注入边界添加一个读取失败案例, 测量新改测试回调耗时, 执行定向测试和完整 Source Checkout 验证.

## Acceptance criteria

- [x] .arwignore 读取错误原样传播, 新增回归测试证明不被误报为策略错误.
- [x] 原有无效策略, 不支持文件, Git 路径筛选和文本修复行为保持, 唯一预期变化为读取错误报告.
- [x] 四项清理均核对调用方并完成, 未更改禁止范围.
- [x] 定向测试, 完整套件和 Source Checkout 必要检查通过, 两个提交审核轴通过后提交.

## Blocked by

- None - can start immediately

## Validation

```text
code: -11 lines (files: 1)
  lib/arw-common/text-policy.mjs -11
documents: 0 characters (files: 0)
tests: +9 lines (files: 1)
  tests/arw-common/text-policy.test.mjs +9
next ADR number: 0041
```

- 新增 .arwignore 读取错误测试通过, 断言原始 EACCES 异常对象传播, 不再返回策略诊断.
- node --test --test-isolation=none tests/arw-common/text-policy.test.mjs tests/arw-common/text-cli.test.mjs: 14 个测试通过. 新案例约 0.17 毫秒, 修改的批量修复案例约 0.37 毫秒.
- 完整 pnpm test 在沙箱外通过, 950 个测试, 0 失败. 沙箱内清除继承测试环境后的重复运行出现本机服务测试失败并已停止, 不作为通过依据.
- pnpm typecheck, Workflow Distribution 检查, Claude Skill 投影检查, 安装引导脚本生成检查, 两个修改文件的 node --check, text check, terms check 和 git diff --check 均通过. language inspect 确认新 issue 的普通叙述为中文.
- 通过一次性注入检查核对无效 UTF-8, NUL, 策略符号链接和目录仍被拒绝, check-ignore 失败仍保留原有完整错误文案. 文本 CLI 测试继续证明未知操作在边界被拒绝, 不支持的文本文件零读取和零写入.
- 预计/实际净行数: 生产代码 -15/-11, 测试 +20/+9, issue 文本约 40/50. 就绪 JSON 另计 13 行工作流记录.

- 两个 ARW Commit Audit Reviewer 均返回 ready, 报告精确为 No problems. 受审树 b6c1079d97048f4a6e7e38406a02b932b4220901. Main Agent 抽查读取与解码边界及命令参数边界, 回归核对不支持文件的零写入行为.
## Comments

用户通过本轮分流记录明确授权单 issue effort 的无治理设计例外, 并明确允许 .arwignore 读取错误报告变化. 本轮仅由 Main Agent 实施, 独立审核通过 ARW Reviewers 执行.

四项发现均成立, 无跳过项. 删除 intent 检查所守护的输入合法性由 lib/arw.mjs 的参数边界覆盖; check-ignore 输出验证按用户授权移除, ls-files 的路径验证保留. 生产代码实际净增比预算多 4 行, 原因是复用公共方法时仍需保留原 Git 失败文案的异常转换, 以遵守唯一输出变化约束. 没有无关冗余删除.
