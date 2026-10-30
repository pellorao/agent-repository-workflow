# 向导规则对齐与自主例外复核

Status: completed

## What to build

处理 `.tmp/ledger.md` 第 442-444, 317 和 333 行, 从 issue:0009:03 拆出不依赖上游同步设计决定的范围.

wizard Skill 的一次性脚本使用 docs/agents/environment.md 的会话临时目录. 创建任何脚本前按 docs/agents/agent-writes.md 准备恢复基线; 交付受跟踪脚本前按 implement Entry 确认已授权 issue, 按目标仓库布局选择路径并按 commit Skill 处理提交. 不默认写入 scripts 或 ARW Artifact 根目录. 保留 Bash 语法检查与静态核对, 按 validation Skill 使用目标仓库声明的验证, 不因 shellcheck 已安装就自动执行. 不修改 template.sh.

更新 wizard 的 distribution Markdown 副本时使用 scripts/sync-workflow-distribution.mjs 的 review, prepare, 用户确认准确 planDigest, apply 流程; Claude Code 投影按 scripts/project-claude-skills.mjs 生成. 核对 docs/agents/agent-writes.md 的 Repository-owned 区域已经明确声明自主提交和审核期间推进下一个 issue 的 Baseline 例外, 当前符合时仅记录证据. 不修改根 AGENTS.md 或上游同步范围, 排除 475/476, 454/318, 未核实 T1 和 lib/background-agent/**. 不安装, 不推送. 用户要求保留 Spec Readiness 和两个提交 Reviewer.

预估文档净增约 3000 字符, 含本 issue 和分发及投影副本. 纯规则改动不新增测试.

## Acceptance criteria

- [x] wizard 的临时路径, 写入授权, 验证与提交说明引用相应权威规则, 不再默认创建受跟踪脚本或运行未声明工具. 观察: Skill 对应段落与其权威文件的人工核对.
- [x] 分发副本与 Claude Code 投影一致, template.sh 未变. 观察: 三个生产脚本及 Git 差异.
- [x] 317/333 的例外逐项核对并记录现有定位, 不重复添加规则. 观察: Validation 的定位和复核结果.
- [x] node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, arw text check, 当前 effort 的 terms check 和 git diff --check 通过. 观察: Validation 的实际命令结果.

## Blocked by

- None - can start immediately

## Validation

- node arw.mjs spec-readiness verify --issue issue:0010:04 通过, 04.spec-readiness.json 为 satisfied.
- 人工核对 docs/agents/agent-writes.md:57 已明确声明自主提交取代 Delivery and review 的请求前提, 以及审核期间独立 issue 写入放宽 Issue concurrency. 未修改规则.

- 源 Skill 的三个改动段落已逐项对照 environment, agent-writes, implement, validation 和 commit; 新增链接均指向现有文件.
- node scripts/project-claude-skills.mjs --check 和 arw text check 通过. git diff --exit-code HEAD -- .agents/skills/wizard/template.sh .claude/skills/wizard/template.sh distribution/skills/wizard/template.sh 通过, 模板字节未变.

- 主检出中按 scripts/sync-workflow-distribution.mjs 完成 review (两份审核文件均为空, 用户关闭编辑器), prepare 和用户确认 planDigest 后的 apply. apply 另把 distribution/baseline/docs/agents/agent-writes.md 重建为当前源文本 (此前源改动未同步留下的差异), 它不属本 issue 范围, 已单独提交为 7bf0469.
- node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, arw text check, arw terms check --include .scratch/0010-triage-rule-manual-alignment/, git diff --check 与 git diff --cached --check 均通过; 三份 template.sh 相对 HEAD 未变.

## Comments

- 原 Spec Readiness Reviewer 复核质疑后返回 No problems., 已 generate, promote 和完整 verify.
- wizard 候选补丁保存在当前会话临时目录, 源文件恢复本人修改前字节, 先串行完成 issue 03; 分发引用审核和 planDigest 的用户授权仍未取得.
- issue 03 进入提交审核后已恢复 wizard 候选补丁; 当前源 Skill 和 Claude Code 投影已修改, distribution 副本仍等待正式同步.
- Claude 明确暂不批准启动 code --wait 引用审核, 要求先取得准确 planDigest. 只读运行 node scripts/sync-workflow-distribution.mjs prepare 退出 1, 返回 sync-review-handoff-unavailable, 必须先完成引用审核. 现有流程无法按所请求的相反顺序生成摘要值, 未启动编辑器, 未 apply, 等待升级处置.

- Claude 更正误路由回复: 人工用户本次运行不可参与引用审核, 明确要求不启动 code --wait 或 apply. 分发副本同步及依赖它的完整验证和提交保持阻塞, 源候选及就绪记录保留未提交, 由维护者随后在主检出运行同步. 317/333 已独立复核完成, 无需修改现有例外.
- 后续 (2026-10-30, 主检出): 用户参与 review (两份审核文件均为空, 用户关闭编辑器) 并在对话中确认 planDigest ee72adcd3f832b859dbdabaa4c65905dede3e73baa93112adf3030c9d261dedf 后执行 apply, 上面两条阻塞记录已解除; Validation 中的同步与检查结果即此次实际运行.
- 本 effort 由 codex20 克隆中的 0009 改号为 0010 后并入主检出; What to build 中的 issue:0009:03 指改号后的 issue:0010:03, 为保持就绪 subject 字节不变未改写.
- 台账: .agents/skills/wizard/SKILL.md 三份副本中新改的段落为英文 转入后续 issue 整份 Skill 原为英文, 本 issue 沿用文档原语言, 不引入新的语言违规; 整份翻译已在待办 (Skill 中文化, d5dc25c 提交说明), 本次交付不依赖它.
- 台账: 04-align-wizard-workflow.md 第 7 行 issue:0009:03 冲突裁决 issue-tracking 要求编号稳定, spec-readiness 的 Authorization timing 规定已开始实施后的一致性处置不改 subject 并记入 Comments; 按后者保留 subject 字节, 此处 issue:0009:03 指本 effort 改号后的 issue:0010:03.
