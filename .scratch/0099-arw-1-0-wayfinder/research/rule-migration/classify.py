"""v1-migrate: per-file classification of ARW rule text into 1.0 destinations.
Allocations are character counts per class taken from the section sizes; the rest of each file
(title, front matter, unlisted lines) goes to the file's default class. Prints Markdown tables."""
import os, sys
ARW = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../..'))
CLS = ['F', 'Fj', 'C', 'S', 'K1', 'K2', 'K3', 'D']
NAME = {'F': '流程定义', 'Fj': '流程定义中的判断节点', 'C': '程序检查', 'S': '本步短指令',
        'K1': '保留的 Skill', 'K2': '常读规则', 'K3': 'Reviewer 文档', 'D': '删除'}
B = 'distribution/baseline/'
K = 'distribution/skills/'
# path: (default class, [(class, chars), ...])
DIST = {
 B+'AGENTS.md': ('K2', [('K2', 700), ('S', 150), ('C', 134), ('F', 129), ('Fj', 300), ('S', 240), ('K2', 148), ('D', 199), ('K2', 267), ('D', 1259)]),
 B+'docs/agents/agent-writes.md': ('F', [('S', 157), ('S', 100), ('C', 200), ('S', 112)]),
 B+'docs/agents/environment.md': ('F', [('S', 300), ('D', 200), ('C', 150)]),
 B+'docs/agents/parallel-implementation.md': ('D', []),
 B+'docs/agents/repository-terminology.md': ('K2', []),
 B+'docs/agents/reviewer.md': ('K3', [('D', 70), ('F', 169), ('S', 192), ('F', 288), ('C', 333), ('F', 400), ('S', 300), ('C', 200), ('C', 179)]),
 B+'docs/agents/roles/code-standards-reviewer.md': ('K3', []),
 B+'docs/agents/roles/requirements-reviewer.md': ('K3', []),
 B+'docs/agents/roles/spec-readiness-reviewer.md': ('K3', []),
 B+'docs/agents/roles/spec-readiness-reviewer/challenges.md': ('K3', []),
 B+'docs/agents/roles/spec-readiness-reviewer/findings.md': ('K3', []),
 B+'docs/agents/roles/spec-readiness-reviewer/module-design.md': ('K3', []),
 B+'docs/agents/specification-presentation.md': ('K1', []),
 B+'docs/agents/subagent-allocation.md': ('F', [('D', 164)]),
 B+'docs/agents/subagent-findings.md': ('S', [('F', 241), ('F', 243), ('F', 300)]),
 B+'docs/agents/subagent-model-setup.md': ('F', [('S', 200)]),
 B+'docs/agents/writing.md': ('K2', [('C', 250), ('C', 100), ('F', 337)]),
 K+'application-workflow/SKILL.md': ('F', []),
 K+'application-workflow/references/association-and-distribution.md': ('F', [('C', 300), ('S', 111)]),
 K+'application-workflow/references/configuration.md': ('F', [('S', 400), ('C', 300)]),
 K+'application-workflow/references/jira-acceptance.md': ('F', [('C', 200), ('S', 192)]),
 K+'application-workflow/references/jira-completion.md': ('F', [('C', 225)]),
 K+'application-workflow/references/module-correction.md': ('F', [('S', 500), ('C', 400)]),
 K+'application-workflow/references/recovery.md': ('F', [('S', 203)]),
 K+'application-workflow/references/synchronization.md': ('C', [('F', 280)]),
 K+'arw-commands/SKILL.md': ('K1', [('D', 1538), ('D', 396), ('F', 82)]),
 K+'arw-commands/post-init-handoff.md': ('S', [('F', 500)]),
 K+'code-maps/SKILL.md': ('K1', [('F', 253), ('C', 250)]),
 K+'code-review/SKILL.md': ('F', [('C', 349), ('C', 1300), ('C', 168)]),
 K+'code-review/explicit-range.md': ('C', []),
 K+'code-review/result-reuse.md': ('F', [('C', 100), ('S', 110)]),
 K+'codebase-design/DEEPENING.md': ('K1', []),
 K+'codebase-design/DESIGN-IT-TWICE.md': ('K1', [('F', 250)]),
 K+'codebase-design/SKILL.md': ('K1', []),
 K+'commit/SKILL.md': ('F', [('C', 253), ('S', 301)]),
 K+'commit/fix-rounds.md': ('F', [('S', 496)]),
 K+'commit/implementation-workflow.md': ('F', [('C', 400), ('S', 297), ('C', 198), ('C', 600)]),
 K+'commit/non-implementation-workflow.md': ('C', [('F', 400), ('S', 159)]),
 K+'diagnosing-bugs/SKILL.md': ('K1', []),
 K+'domain-modeling/ADR-FORMAT.md': ('K1', []),
 K+'domain-modeling/CONTEXT-FORMAT.md': ('K1', []),
 K+'domain-modeling/SKILL.md': ('K1', [('F', 100)]),
 K+'grill-me/SKILL.md': ('K1', []),
 K+'grill-with-docs/SKILL.md': ('K1', [('F', 150)]),
 K+'grilling/SKILL.md': ('K1', [('F', 450)]),
 K+'implement/SKILL.md': ('F', [('C', 500), ('S', 290), ('Fj', 200), ('S', 191), ('C', 52), ('S', 100), ('D', 150)]),
 K+'improve-codebase-architecture/HTML-REPORT.md': ('K1', []),
 K+'improve-codebase-architecture/SKILL.md': ('K1', [('F', 200)]),
 K+'issue-tracking/SKILL.md': ('C', [('S', 454), ('F', 300), ('F', 200), ('S', 118), ('F', 200), ('S', 200), ('C', 120)]),
 K+'issue-tracking/artifact-model.md': ('C', [('S', 264), ('F', 236)]),
 K+'prototype/LOGIC.md': ('K1', [('F', 179)]),
 K+'prototype/SKILL.md': ('K1', [('F', 600)]),
 K+'prototype/UI.md': ('K1', []),
 K+'research/SKILL.md': ('K1', [('F', 207)]),
 K+'retro/SKILL.md': ('K1', []),
 K+'reviewer-launch/SKILL.md': ('D', [('F', 600), ('F', 288)]),
 K+'reviewer-launch/capacity-priority.md': ('F', []),
 K+'reviewer-launch/machine-operations.md': ('D', []),
 K+'reviewer-launch/other-reviews.md': ('F', [('D', 447)]),
 K+'rule-and-design-changes/SKILL.md': ('F', [('Fj', 155), ('S', 164), ('K2', 359), ('K2', 200), ('C', 31)]),
 K+'spec-readiness/SKILL.md': ('F', [('C', 200), ('Fj', 171), ('C', 341), ('S', 454), ('C', 200), ('S', 700), ('C', 300), ('C', 500), ('D', 177)]),
 K+'spec-readiness/exception-workflow.md': ('F', [('C', 241)]),
 K+'spec-readiness/respond-to-findings.md': ('S', [('F', 335)]),
 K+'tdd/SKILL.md': ('K1', []),
 K+'tdd/mocking.md': ('K1', []),
 K+'tdd/tests.md': ('K1', []),
 K+'teach/GLOSSARY-FORMAT.md': ('K1', []),
 K+'teach/LEARNING-RECORD-FORMAT.md': ('K1', []),
 K+'teach/MISSION-FORMAT.md': ('K1', []),
 K+'teach/RESOURCES-FORMAT.md': ('K1', []),
 K+'teach/SKILL.md': ('K1', []),
 K+'test-performance-optimization/SKILL.md': ('K1', [('F', 150), ('F', 194)]),
 K+'test-value-cleanup/SKILL.md': ('K1', [('F', 349), ('F', 285), ('F', 300)]),
 K+'to-questionnaire/SKILL.md': ('K1', []),
 K+'to-spec/SKILL.md': ('K1', [('F', 200), ('S', 397)]),
 K+'to-tickets/SKILL.md': ('S', [('F', 206), ('C', 300), ('F', 200)]),
 K+'validation/SKILL.md': ('F', [('C', 429), ('K1', 800), ('C', 238), ('Fj', 134), ('C', 218)]),
 K+'wait-what/SKILL.md': ('K1', []),
 K+'wayfinder/SKILL.md': ('S', [('F', 238), ('C', 200), ('F', 241), ('F', 400), ('F', 181), ('F', 358), ('F', 450), ('S', 539)]),
 K+'wizard/SKILL.md': ('K1', [('F', 200)]),
 K+'writing-for-agents/SKILL-MECHANICS.md': ('K1', []),
 K+'writing-for-agents/SKILL.md': ('K1', []),
}
SRC = {  # source-checkout only, repository-owned (13: kept as is); indicative split only
 'AGENTS.md#repository-owned': ('K2', [('C', 700)]),
 'docs/agents/source-checkout-coverage.md': ('K1', []),
 'docs/agents/source-checkout-issue-workflow.md': ('K2', []),
 'docs/agents/source-checkout-reviewer-testing.md': ('K1', []),
 'docs/agents/source-checkout-validation.md': ('C', []),
 'docs/agents/subagent-allocation.md#repository-owned': ('F', []),
 'docs/agents/writing.md#repository-owned': ('K2', []),
 '.agents/skills/platform-standards/SKILL.md': ('K1', []),
 '.agents/skills/release/SKILL.md': ('F', [('S', 1500), ('C', 1500)]),
 '.agents/skills/release/references/fixtures.md': ('S', []),
 '.agents/skills/release/references/publication.md': ('F', [('S', 1694), ('C', 646)]),
 '.agents/skills/release/references/vm.md': ('K1', []),
 '.agents/skills/reviewer-capability/SKILL.md': ('F', [('S', 3000), ('C', 1500)]),
 '.agents/skills/reviewer-capability/drift-check.md': ('C', []),
 '.agents/skills/reviewer-capability/last-results.md': ('K1', []),
 '.agents/skills/unattended-run/SKILL.md': ('S', [('F', 385)]),
 '.agents/skills/upstream-sync/SKILL.md': ('K1', []),
}

NOTES = {
 'AGENTS.md': 'Efficiency First, Rule Conflicts, Output Text 常读; 体积预算的估算进写 issue 的短指令, 实测净增已由 `commit-audit prepare` 计算; Important Decisions 成为判断题 "是否需要用户决定" 与输出 schema 的 "交用户"; Workflow Triggers 与 Agent Writes 指针按 13 删除',
 'agent-writes.md': '写入范围, 恢复基线, 写入者令牌进流程定义 (07, 08, 10); 每步后的 Git 检测是程序检查; "需改范围外文件先报告" 与交付证据成为输出 schema 与短指令',
 'environment.md': '工作区路径由 Engine 生成 (13); "原样使用绑定路径" 成为短指令; 平台会话 ID 规则删除',
 'parallel-implementation.md': '1.0 不提供 worktree 并行实施 (10, 用户 11-13 确认)',
 'repository-terminology.md': '写作规则的一部分',
 'reviewer.md': 'Re-review, Evidence, Report 格式, Conflicts 等 Reviewer 行为保留 (09); 独立运行, 单 Agent 强制, 拒绝转交, 空报告与 `ready`/`incomplete` 由 Engine 执行; 单命令规则与中途通知协议成为 Reviewer 步骤的短指令',
 'code-standards-reviewer.md': '按 09, 13 原样交给 Reviewer; 输出加覆盖清单 (09); 预检题由转换从检查项生成',
 'requirements-reviewer.md': '同上',
 'spec-readiness-reviewer.md': '同上',
 'challenges.md': '同上', 'findings.md': '同上', 'module-design.md': '同上',
 'specification-presentation.md': '写 spec 的方法文档, 由写 spec 的步骤附带',
 'subagent-allocation.md': '会话的创建, 复用与按档位取模型进流程定义, 具体取决于决定 A',
 'subagent-findings.md': '核对, 按来源分流, 质疑写法成为处置步骤的短指令 (09); 何时交用户, 授权结果不可覆盖, 质疑的路由进流程定义',
 'subagent-model-setup.md': '档位映射的首次配置成为配置流程: 调研模型的 Agent 步骤, 等待用户批准, Engine 写配置',
 'writing.md': '写作规则常读; `language inspect`, UTF-8 与 LF 等由程序检查; 指向其他文档的读取指令由流程定义按步骤附带',
 'application-workflow/SKILL.md': '生命周期路由与 "需要相应授权" 成为流程定义中的分支与等待用户节点',
 'association-and-distribution.md': '前提核对与发布顺序进流程定义 (外部写入是 08 的屏障); 关联命令已是确定性操作',
 'configuration.md': '起草 `arw.config.json` 是 Agent 步骤; 配置校验是程序检查',
 'jira-acceptance.md': '展示与授权是等待用户节点, 提交, 推送, `jira accept` 是确定性操作',
 'jira-completion.md': '同上, `jira complete`',
 'module-correction.md': '授权门是等待用户节点; `Downstream changes` 写法成为短指令, 结构由 `module check-correction` 检查',
 'recovery.md': '各失败点的恢复路径进流程定义 (07 的失败合同)',
 'synchronization.md': '`application sync` 的行为已在代码中; 前提与之后的提交进流程定义',
 'arw-commands/SKILL.md': '只读与检查类命令的参考保留, Agent 步骤可当工具运行 (13); 门禁与写入类命令说明删除 (13 从公开命令中删除), 用户可见命令的用法归用户手册',
 'post-init-handoff.md': '升级后审核流程 (13): 顺序与 "恰好一个补全 issue" 进流程定义, 各审计项成为短指令',
 'code-maps/SKILL.md': '写 Code Map 的方法保留; 何时读由流程定义按 Repository Profile 附带; `code-map verify` 是程序检查',
 'code-review/SKILL.md': '非提交 Code Review 流程: 比较解析, 路径过滤, 绑定副本是确定性操作; 启动两轴与汇总进流程定义 (09)',
 'explicit-range.md': '确定性比较解析',
 'result-reuse.md': '轴结果复用由 Engine 按冻结输入机械判断 (09); 完成记录核对是程序检查',
 'DEEPENING.md': '方法保留',
 'DESIGN-IT-TWICE.md': '方法保留; 并行协作者的分配随决定 A 改写',
 'codebase-design/SKILL.md': '方法保留',
 'commit/SKILL.md': '分类由 `verify --non-implementation` 机械完成; 提交说明由 Agent 步骤起草',
 'fix-rounds.md': '轮次计数, 第 3 轮规则, 台账交接进流程定义 (09); 台账条目写法, 行为缺陷与冲突裁决由处置步骤判断',
 'implementation-workflow.md': '步骤顺序进流程定义; `prepare` 摘要与 warning, 记录差异核对, `verify` 是程序检查; 启动前自查成为短指令',
 'non-implementation-workflow.md': '封闭分类与机械检查已在 `verify --non-implementation`; 规则文档例外的单轮 Reviewer 进流程定义',
 'diagnosing-bugs/SKILL.md': '方法保留',
 'ADR-FORMAT.md': '方法保留', 'CONTEXT-FORMAT.md': '方法保留',
 'domain-modeling/SKILL.md': '方法保留; 写入前的指针改由流程定义给写入范围',
 'grill-me/SKILL.md': '用户入口, 保留',
 'grill-with-docs/SKILL.md': '保留; 写入前的指针改由流程定义给写入范围',
 'grilling/SKILL.md': '追问方法保留给对话会话; 决定项的选项, 推荐与 "只有用户明确选择才算确认" 由 Engine 的等待用户节点承担 (07)',
 'implement/SKILL.md': 'Entry 的授权条件 (Status, 阻断项, 就绪 `verify`) 进流程定义与程序检查; "配套修改是否增加行为" 成为单向判断题; 实施方法成为短指令',
 'HTML-REPORT.md': '方法保留',
 'improve-codebase-architecture/SKILL.md': '方法保留; 协作者分配随决定 A 改写',
 'issue-tracking/SKILL.md': '格式, `Status` 取值, 记录章节机械核对, Artifact 发现是程序检查; 状态转换与读取范围授权进流程定义; "写到最终状态, 对照用户原话" 等写法成为起草 issue 的短指令',
 'artifact-model.md': '编号与身份规则是程序检查; "一个 effort 一个主要目标" 等成为起草步骤的短指令; Wayfinding 规则进流程定义',
 'LOGIC.md': '方法保留', 'UI.md': '方法保留',
 'prototype/SKILL.md': '原型方法保留; 由 Main Agent 分配与回交的句子改为子流程与输出 schema',
 'research/SKILL.md': '一手来源方法保留; 分配协作者进流程定义',
 'retro/SKILL.md': '保留; Files 节描述 0.x 的规则加载方式, 需按 1.0 (规则源, graph, 常读规则) 改写',
 'reviewer-launch/SKILL.md': 'Agent 操作 `arw background-agent` 的平台说明, haiku 回退 (09 删除), 按需读取指针删除; 审核轮步骤, 抽查 (改由 Engine 随机选, 09), 30 分钟等待进流程定义',
 'capacity-priority.md': '关卡 Reviewer 优先与名额预留由 Engine 调度',
 'machine-operations.md': 'Agent 控制后台 Agent 的机器接口说明; Engine 直接用会话层 (07), 不再给 Agent',
 'other-reviews.md': '无 `prepare` 审核的请求组装由 Engine 完成; 字段清单删除',
 'rule-and-design-changes/SKILL.md': '受保护文档判断成为判断题, 用户确认成为等待用户节点, Reviewer 提出的 spec 修改按 09 的共同决定; 长期文档写法与 "不改受管区域" 并入常读写作规则',
 'spec-readiness/SKILL.md': '授权时点 ("已开始实施" 按实例状态, 09), subject 规范化, `generate`/`promote`/`verify` 是程序与流程; "只涉及措辞" 成为单向判断题; Governing design 与 `prepare` 前自检成为写 spec 与处置步骤的短指令; Responsibilities 按 09 删除',
 'exception-workflow.md': '用户确认是等待用户节点, 记录生成是确定性操作',
 'respond-to-findings.md': '修正后的自检清单成为处置步骤的短指令; 质疑与重新 `prepare` 进流程定义',
 'tdd/SKILL.md': '方法保留', 'mocking.md': '方法保留', 'tests.md': '方法保留',
 'GLOSSARY-FORMAT.md': '方法保留', 'LEARNING-RECORD-FORMAT.md': '方法保留', 'MISSION-FORMAT.md': '方法保留', 'RESOURCES-FORMAT.md': '方法保留', 'teach/SKILL.md': '方法保留',
 'test-performance-optimization/SKILL.md': '测量与优化方法保留; 开工授权与新损失交用户进流程定义',
 'test-value-cleanup/SKILL.md': '清理方法保留; 用户发起, 损失授权, 最终验收与审核进流程定义',
 'to-questionnaire/SKILL.md': '方法保留',
 'to-spec/SKILL.md': 'spec 模板与写法保留; 测试边界交用户核对进流程定义',
 'to-tickets/SKILL.md': '切片方法成为拆分步骤的短指令, 交用户确认进流程定义, issue 格式由程序检查',
 'validation/SKILL.md': '必要检查与单回调耗时测量是程序检查; 结果复用与并行由 Engine 按输入身份; "失败是否由执行环境造成" 成为判断题; 覆盖原则保留给写测试的步骤',
 'wait-what/SKILL.md': '用户入口, 保留',
 'wayfinder/SKILL.md': '领取, 解决, 更新地图的顺序与 Ticket Types 对应的步骤类型进流程定义; 地图写法与 "迷雾还是 issue" 成为短指令',
 'wizard/SKILL.md': '方法保留; 开工授权指针改由流程定义',
 'SKILL-MECHANICS.md': '方法保留', 'writing-for-agents/SKILL.md': '方法保留',
 'AGENTS.md#repository-owned': '仓库自有, 按 13 原样保留; 测试命令与单回调阈值是 Engine 要机械使用的参数, 见决定 B',
 'source-checkout-coverage.md': '仓库自有, 保留', 'source-checkout-issue-workflow.md': '仓库自有, 保留', 'source-checkout-reviewer-testing.md': '仓库自有, 保留',
 'source-checkout-validation.md': '验证命令清单, 见决定 B',
 'subagent-allocation.md#repository-owned': '模型映射表, 见决定 A, B',
 'writing.md#repository-owned': '仓库自有写作例外, 保留',
 'platform-standards/SKILL.md': '维护者方法, 保留',
 'release/SKILL.md': '仓库自有流程; 按 22 (用户 11-13 确认: 转换只在 ARW 源码仓库运行, 仓库自有规则仍是文本) 保留为 Skill, 比例只示意转换时会落到哪里',
 'fixtures.md': '同上', 'publication.md': '同上', 'vm.md': '同上',
 'reviewer-capability/SKILL.md': '同上', 'drift-check.md': '同上', 'last-results.md': '同上',
 'unattended-run/SKILL.md': '同上; 驱动程序扮演用户的文本协议在 1.0 应改接 Engine 的机器入口, 留给规范',
 'upstream-sync/SKILL.md': '维护者流程, 保留; 适用范围见决定 C',
}

def note(rel):
    for k in sorted(NOTES, key=len, reverse=True):
        if rel.endswith(k): return NOTES[k]
    sys.exit('no note for ' + rel)

def size(rel):
    if '#' in rel:
        p, _ = rel.split('#')
        t = open(os.path.join(ARW, p), encoding='utf-8').read()
        i = t.find('<!-- arw:repository-owned:start -->')
        return len(t[i:])
    return len(open(os.path.join(ARW, rel), encoding='utf-8').read())

def alloc(table):
    rows = []
    for rel, (dflt, parts) in table.items():
        n = size(rel); a = dict.fromkeys(CLS, 0)
        for c, k in parts: a[c] += k
        rest = n - sum(a.values())
        if rest < 0: sys.exit(f'over-allocated {rel}: {rest}')
        a[dflt] += rest
        rows.append((rel, n, a))
    return rows

def pct(a, n):
    return ' '.join(f'{c} {round(100 * a[c] / n)}%' for c in CLS if a[c] and round(100 * a[c] / n))

def totals(rows):
    t = dict.fromkeys(CLS, 0)
    for _, _, a in rows:
        for c in CLS: t[c] += a[c]
    return t

if __name__ == '__main__':
    for title, table, strip in (('dist', DIST, 'distribution/'), ('src', SRC, '')):
        rows = alloc(table); t = totals(rows); n = sum(t.values())
        print(f'### {title} files={len(rows)} chars={n}')
        for rel, k, a in rows: print(f'| `{rel[len(strip):]}` | {k} | {pct(a, k)} | {note(rel)} |')
        print('| totals | ' + str(n) + ' | ' + ' '.join(f'{c} {t[c]} ({100 * t[c] / n:.1f}%)' for c in CLS) + ' |')
    rows = alloc(DIST) + alloc(SRC); t = totals(rows); n = sum(t.values())
    print('### all', n, ' '.join(f'{c} {t[c]} ({100 * t[c] / n:.1f}%)' for c in CLS))
