# 发布前同步由一次命令验证后直接写入

[ADR 0034](0034-let-the-main-agent-complete-distribution-sync-review.md) 被本决定完全取代. [ADR 0026](0026-use-source-checkout-workflow-files-as-distribution-authority.md) 与 [ADR 0015](0015-use-versioned-skill-package-grammars.md) 中涉及引用审核和写入授权的句子由本决定取代, 二者的其余决定保持不变.

## Context

原有的 `review`, `review --complete`, `prepare`, `apply --plan-digest` 四步协议为 Skill 引用判断维护两份候选文件, 删除式校验, 两个哈希, `completed-review.json` 和 `planDigest`. 自首次提交以来两份候选列表一直为空, 协议的主要成本服务于一个从不出现的判断.

## Decision

发布前同步由一次无子命令的命令完成状态检查, 读取验证, 引用检查, 重建和 Codex 与 Claude Code 双平台验证, 直接写入 Workflow Distribution, 没有写入前的审核或授权步骤. 写入的是读取验证阶段已检查的字节. 写入结果经普通 Git 提交审核和用户复核 diff.

已知 Skill 身份后接非终止符使同步 `blocked`, 零写入, 由 Main Agent 修正源码文字; 同步不再产生规范化位置. 未知身份只作为提示输出, Main Agent 逐条判断, 真实 Skill 加入 `additionalSkillReferences`, 且只在存在提示时由独立 Agent 复核.

同步只读 `distribution/projections/config.json`, `skillReferenceNormalizations` 字段及其安装投影处理删除. 该配置没有版本字段, 与读取它的代码在同一 Git 修订中发布和安装, 删除不需要兼容期. 信任根, 分发边界和 `reviewEditor` 不变.

## Rejected alternatives

- 保留四步协议只删除冗余: 主要成本都服务于当前从不出现的判断.
- 保留规范化候选或该配置字段: 要继续维护候选格式或留下没有写入者的字段.
- 未知身份阻断直到判断: 需要持久化非 Skill 决定, 与不维护非 Skill 排除名单的规则冲突.
- 每次同步都做独立复核: 没有提示时复核对象为空.

## Consequences

上游采用的 Skill 若含终止符错误, 需要本地改源码. 判断为非 Skill 的标记每次同步都会再次提示并触发复核. Main Agent 的误判进入普通 Git 提交, 由独立复核, 提交审核和用户复核 diff 发现, 恢复靠 Git.
