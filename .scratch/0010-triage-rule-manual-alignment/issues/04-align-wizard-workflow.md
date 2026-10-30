# 向导规则对齐与自主例外复核

Status: ready-for-agent

## What to build

处理 `.tmp/ledger.md` 第 442-444, 317 和 333 行, 从 issue:0010:03 拆出不依赖上游同步设计决定的范围.

wizard Skill 的一次性脚本使用 docs/agents/environment.md 的会话临时目录. 创建任何脚本前按 docs/agents/agent-writes.md 准备恢复基线; 交付受跟踪脚本前按 implement Entry 确认已授权 issue, 按目标仓库布局选择路径并按 commit Skill 处理提交. 不默认写入 scripts 或 ARW Artifact 根目录. 保留 Bash 语法检查与静态核对, 按 validation Skill 使用目标仓库声明的验证, 不因 shellcheck 已安装就自动执行. 不修改 template.sh.

更新 wizard 的 distribution Markdown 副本时使用 scripts/sync-workflow-distribution.mjs 的 review, prepare, 用户确认准确 planDigest, apply 流程; Claude Code 投影按 scripts/project-claude-skills.mjs 生成. 核对 docs/agents/agent-writes.md 的 Repository-owned 区域已经明确声明自主提交和审核期间推进下一个 issue 的 Baseline 例外, 当前符合时仅记录证据. 不修改根 AGENTS.md 或上游同步范围, 排除 475/476, 454/318, 未核实 T1 和 lib/background-agent/**. 不安装, 不推送. 用户要求保留 Spec Readiness 和两个提交 Reviewer.

预估文档净增约 3000 字符, 含本 issue 和分发及投影副本. 纯规则改动不新增测试.

## Acceptance criteria

- [ ] wizard 的临时路径, 写入授权, 验证与提交说明引用相应权威规则, 不再默认创建受跟踪脚本或运行未声明工具. 观察: Skill 对应段落与其权威文件的人工核对.
- [ ] 分发副本与 Claude Code 投影一致, template.sh 未变. 观察: 三个生产脚本及 Git 差异.
- [ ] 317/333 的例外逐项核对并记录现有定位, 不重复添加规则. 观察: Validation 的定位和复核结果.
- [ ] node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, arw text check, 当前 effort 的 terms check 和 git diff --check 通过. 观察: Validation 的实际命令结果.

## Blocked by

- None - can start immediately

## Validation

- node arw.mjs spec-readiness verify --issue issue:0010:04 通过, 04.spec-readiness.json 为 satisfied.
- 人工核对 docs/agents/agent-writes.md:57 已明确声明自主提交取代 Delivery and review 的请求前提, 以及审核期间独立 issue 写入放宽 Issue concurrency. 未修改规则.

## Comments

- 原 Spec Readiness Reviewer 复核质疑后返回 No problems., 已 generate, promote 和完整 verify.
- wizard 候选补丁保存在当前会话临时目录, 源文件恢复本人修改前字节, 先串行完成 issue 03; 分发引用审核和 planDigest 的用户授权仍未取得.
