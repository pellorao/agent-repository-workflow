# ARW Skills manual

[English](skills.md) | [简体中文](skills.zh-CN.md)

After you enable ARW in a repository (see the [root README](../../README.md)), `arw workflow init` installs task-specific instruction sets called Skills for the platforms you selected: Codex reads `.agents/skills`, and Claude Code reads `.claude/skills`. This manual helps you see every Skill you now have, tell which ones the Agent picks up on its own, and know which ones you must name yourself so you do not wait for a workflow step that never starts automatically.

Most Skills are automatic: the Agent loads one whenever your task matches its description. By contrast, Skills marked "name it explicitly" carry `disable-model-invocation: true` and never trigger on their own. You run them by naming them in the conversation -- for example, `Use $grill-with-docs to confirm the requirements with me` in Codex, or `/grill-with-docs` in Claude Code.

The two sections below cover every Skill under `distribution/skills/`: first the general engineering and productivity Skills adapted from upstream, then the custom Skills built for ARW's own records, reviews, and commit gates. Because this manual is a guide rather than a duplicate of any Skill's full contract, the installed `SKILL.md` and the `docs/agents/**` rules it points to always decide the actual steps.

## Skills from the upstream repository

For day-to-day problem solving, design, and coding, ARW includes 21 Skills from [mattpocock/skills](https://github.com/mattpocock/skills) (`skills/engineering/` and `skills/productivity/`). ARW maintains an adapted fork pinned to a single upstream commit, translated and adjusted to work with ARW issues, records, and platforms, so behavior can differ from the upstream text. Each entry below links to the upstream description at that pinned commit if you want to read the original idea. They are grouped in the order a task usually unfolds: clarifying what you mean, investigating and designing, turning plans into verified code, and improving your setup.

### Discussion and clarification

Before you write specs or code, these Skills help you stress-test an idea or clear up confusion in the conversation.

- `grilling` (automatic): Interviews you relentlessly about a plan or decision until every branch is resolved; other Skills reuse it. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/grilling/SKILL.md)
- `grill-me` (name it explicitly): Runs that same interview when you start it yourself for plans that do not involve code. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/grill-me/SKILL.md)
- `grill-with-docs` (name it explicitly): Runs the interview while recording agreed terms and architecture decisions in `CONTEXT.md` and ADRs as you go. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/grill-with-docs/SKILL.md)
- `wait-what` (name it explicitly): Helps when the last message did not land: the Agent re-pitches it in plain words. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/wait-what/SKILL.md)
- `to-questionnaire` (name it explicitly): Turns a decision you cannot make alone into a questionnaire for the person who can. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/to-questionnaire/SKILL.md)

### Investigation and design

Once the goal is clear -- or when the problem is too big or unfamiliar to plan at once -- these Skills help you explore the codebase, check primary sources, and shape module boundaries.

- `wayfinder` (name it explicitly): Plans work too large for one session as a map of decision issues and resolves them one at a time. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/wayfinder/SKILL.md)
- `research` (automatic): Investigates a question against primary sources and saves cited findings as a Markdown file. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/research/SKILL.md)
- `prototype` (automatic): Builds a throwaway prototype to answer a design question. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/prototype/SKILL.md)
- `domain-modeling` (automatic): Reads and updates the domain glossary and ADRs before naming concepts or deciding boundaries. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/domain-modeling/SKILL.md)
- `codebase-design` (automatic): Provides a shared vocabulary for deep modules, seams, and testable interfaces. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/codebase-design/SKILL.md)
- `improve-codebase-architecture` (name it explicitly): Scans a codebase for deepening opportunities, presents them as an HTML report, and then grills you through the one you pick. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/improve-codebase-architecture/SKILL.md)

### Planning and implementation

After you settle on a design, these Skills turn your decisions into specifications and issues, then guide coding, testing, debugging, and review.

- `to-spec` (name it explicitly): Turns the current conversation into a specification without starting a new interview. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/to-spec/SKILL.md)
- `to-tickets` (name it explicitly): Splits a plan or specification into vertical-slice issues that declare their blockers. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/to-tickets/SKILL.md)
- `implement` (automatic): Builds what an implementation issue asks for, validates the result, and records it. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/implement/SKILL.md)
- `tdd` (automatic): Guides test-first development with a red-green-refactor loop. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/tdd/SKILL.md)
- `diagnosing-bugs` (automatic): Runs a disciplined loop for hard bugs and performance regressions. After the fix, run `$retro` to find how to prevent similar problems. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/diagnosing-bugs/SKILL.md)
- `code-review` (automatic): Reviews a Git comparison on two independent axes: implementation standards and requirement conformance. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/code-review/SKILL.md)

### Setup and learning

Alongside feature work, these Skills help you automate manual setup steps, learn unfamiliar topics, and tune the Agent's instructions after a session.

- `wizard` (automatic): Generates an interactive shell script that walks you through steps only a human can do. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/wizard/SKILL.md)
- `teach` (name it explicitly): Teaches you a new skill or concept over several sessions in the current directory. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/teach/SKILL.md)
- `retro` (name it explicitly): Reviews a coding session and suggests improvements to the Agent's working environment (navigation, automated checks, coding standards, instruction files). Run `$retro` often: after every finished issue or long session. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/retro/SKILL.md)
- `writing-for-agents` (automatic): Provides guidance when writing Skills, `AGENTS.md`, `CLAUDE.md`, and other documents that agents read. [Upstream](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/writing-for-agents/SKILL.md)

## ARW custom Skills

While the upstream Skills cover general engineering habits, these 11 ARW-specific Skills wire those habits into ARW's local workflow: managing records under `.scratch`, running independent Reviewers, enforcing commit gates, keeping tests fast, and coordinating multi-repository work. Each entry below tells you when the Skill applies, what it does, what it leaves behind on disk or in Git, and which commands and other Skills it works with.

### Commands and records

Everything in ARW starts with running `arw` CLI commands and keeping work records in `.scratch` (plus optional Code Maps in the source tree).

#### `arw-commands` (automatic)

- When: the Agent writes or runs an `arw` command, queries issues, maps, specs, or background Agents, resolves which repository a command targets, or audits a repository right after `arw workflow init`.
- What it does: fixes the canonical command forms and separates read-only commands from commands that write (`workflow init`, `workflow update`, `text fix`, `spec-readiness generate`, and so on). Right after `init`, it audits domain documents, conflicting repository rules, and non-English file names.
- Leaves behind: at most one merged workflow-completion issue when the audit finds gaps, or no issue when there are none.
- Related: `arw list issues`, `arw print`, `arw text check`, `arw terms check`; `validation`, `issue-tracking`.

#### `issue-tracking` (automatic)

- When: the Agent reads, creates, or updates an effort, issue, map, or spec, and before it reports an issue as complete.
- What it does: defines the `.scratch` layout and numbering, the required sections of an implementation issue, the status and triage values, and where evidence belongs (`## Validation`, `## Comments`). It also restricts the Agent to reading only its current effort unless you authorize another.
- Leaves behind: issue, map, and spec files under `.scratch/<NNNN>-<effort-slug>/`.
- Related: `arw list issues`, `arw print`, `arw open`; `implement`, `spec-readiness`.

#### `code-maps` (automatic, only when configured)

- When: the Repository Profile configures Code Map roots and the Agent changes covered source code, or writes or checks a Code Map.
- What it does: reads the Code Map README before changing covered code, updates every affected Code Map in the same issue, and runs `arw code-map verify`. It never creates a Code Map merely because a directory exists.
- Leaves behind: Code Map `README.md` files with the fixed front matter and section order.
- Related: `arw code-map verify`; `validation`.

### Planning, review and commits

Once an issue is tracked in `.scratch`, these Skills govern how its design is reviewed before coding, how independent Reviewers are launched, how protected rules and design docs are edited, and how finished work passes the commit gates.

#### `spec-readiness` (automatic)

- When: an implementation issue's design is finished (or revised) and needs an independent design review before any implementation begins.
- What it does: prepares the inputs (governing specification, ADRs, context documents), starts a Spec Readiness Reviewer through `reviewer-launch`, and then runs `generate`, `promote`, and `verify`. Fixing findings requires a new review round. Claiming a "no governing design needed" exception requires your explicit confirmation.
- Leaves behind: `.scratch/<NNNN>-<effort-slug>/issues/<NN>.spec-readiness.json`. A missing, stale, or `gap` record blocks starting implementation, but does not block unrelated work. Once implementation has started, only a change to the issue's own review subject blocks the commit (`verify --subject-only`).
- Related: `arw spec-readiness prepare|generate|promote|verify`; `implement`, `reviewer-launch`, `rule-and-design-changes`.

#### `reviewer-launch` (automatic, Main Agent only)

- When: the Agent you talk to starts, follows, waits for, interrupts, or resumes an independent Reviewer (Code Standards, requirement conformance, Spec Readiness). Reviewers themselves do not use it.
- What it does: runs the prepared review round with `cat <round>/*.jsonl | arw background-agent --wait`, reads the report from `completion`, and handles platform differences between Codex and Claude Code. If a review runs past 30 minutes, it asks whether you want to keep waiting; it also asks when a Reviewer reports repeated early exits.
- Leaves behind: Reviewer reports at the paths prepared by the round.
- Related: `arw background-agent`, `arw list background-agents`; `spec-readiness`, `commit`.

#### `commit` (automatic, only after you ask for a commit)

- When: you ask for a Git commit. Finishing an issue on its own never triggers a commit.
- What it does: classifies the staged files first. A candidate that includes implementation work runs the full gate: updating the issue record, `arw commit-audit prepare`, two parallel Reviewers (requirement conformance and Code Standards), checking each finding, `arw commit-audit verify`, and `arw spec-readiness verify --subject-only` (skipped for behavior-preserving refactor issues, which have no readiness record), followed by the commit. A candidate containing only planning records, Agent rules, and documents (including the root README, `CONTEXT.md`, and `CLAUDE.md`) takes the lighter path checked by `arw commit-audit verify --non-implementation`. Commit messages follow Conventional Commits, and any failed gate stops the commit.
- Leaves behind: review rounds under `.tmp` and the Git commit itself.
- Related: `code-review`, `reviewer-launch`, `spec-readiness`, `issue-tracking`.

#### `rule-and-design-changes` (automatic)

- When: before changing Agent instructions, Skills, long-term specifications, ADRs, context documents, or other documents that hold lasting design.
- What it does: states the target path and the concrete change, then waits for your explicit confirmation (if your request already states the exact change, that counts as confirmation). When an independent Reviewer proposes specification changes, the Main Agent and one independent subagent decide together, and only disagreements come to you. It also requires writing lasting documents as current rules rather than chronological history.
- Leaves behind: only the confirmed edits; it does not stage or commit them.
- Related: `spec-readiness`, `commit`.

### Testing and validation

During implementation and maintenance, these Skills decide which checks must pass and how to keep the test suite fast and high-value.

#### `validation` (automatic)

- When: before changing behavior or tests, and before running verification.
- What it does: determines which checks are required (`arw text check`, `arw terms check --include <effort directory>`, `arw code-map verify` when configured, and the test commands declared in the repository's root `AGENTS.md`), applies the least sufficient test coverage (including measuring new or changed test callbacks against the repository threshold, 100 ms by default), reuses valid results, and defines what documentation-only changes require.
- Leaves behind: concrete evidence for each acceptance criterion, normally recorded in the issue's `## Validation` section.
- Related: `test-performance-optimization`, `test-value-cleanup`, `implement`.

#### `test-performance-optimization` (automatic)

- When: the goal is to make an existing test suite faster.
- What it does: requires an authorizing issue first, records a baseline (total time and the ten slowest callbacks), and then shortens tests by keeping the smallest representative case per outcome, table-driving equivalent inputs, and sharing immutable setup.
- Leaves behind: timing measurements and a before-and-after comparison in the issue.
- Related: `validation`, `test-value-cleanup`.

#### `test-value-cleanup` (name it explicitly)

- When: you explicitly ask to clean up low-value tests. It has no recurring schedule, and adding ordinary new tests never triggers it.
- What it does: confirms the authorizing issue, fixes the baseline count and target, deletes low-value tests by relative value (at least 20 percent by default), states every coverage loss honestly, preserves core guarantees such as permissions, identity, and data safety, and then checks the full test command against the time target (a median under 5 seconds over three runs, unless you set another target).
- Leaves behind: the test deletions, a record of each loss, and timing measurements in the issue.
- Related: `test-performance-optimization`, `validation`, `implement`.

### Multiple repositories

Finally, if your work spans several Git repositories synchronized with JIRA rather than a single repository, name this Skill to step through that workflow.

#### `application-workflow` (name it explicitly)

- When: you have chosen the multi-repository and JIRA path (see [Distribute work across repositories and sync JIRA](application-jira.md)). Neither repository configuration nor a JIRA request triggers it automatically.
- What it does: requires a complete `application` object in `arw.config.json`, then guides you through one stage at a time: configuration, accepting a JIRA task, associating and distributing issues, correcting a Module issue, synchronizing, completing in JIRA, and recovering from partial results. It grants no permission by itself; every file write, commit, push, or JIRA write still requires the authorization required by the repository rules.
- Leaves behind: Application efforts and issues, distributed Module issues, and the JIRA updates you authorized.
- Related: `arw workflow init`, `arw workflow verify`, `arw application associate`, `arw application sync`, `arw jira list|print|open|accept|complete`, `arw module check-correction`; `issue-tracking`.
