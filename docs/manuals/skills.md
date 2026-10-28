# ARW Skills manual

[English](skills.md) | [简体中文](skills.zh-CN.md)

This manual is for people who have already enabled ARW in a repository (see the [root README](../../README.md)) and want to know which Skills came with it, which ones the Agent picks up on its own, and which ones you must name. A Skill is a set of task-specific instructions the Agent follows. Most Skills are used automatically: the Agent loads one when the task matches its description. Skills marked "name it explicitly" never trigger on their own (`disable-model-invocation: true`); they run only when you name them in the conversation, for example `Use $grill-with-docs to confirm the requirements with me` in Codex, or `/grill-with-docs` in Claude Code.

`arw workflow init` installs Skills for the platforms you selected: Codex reads `.agents/skills`, Claude Code reads `.claude/skills`. The list below covers every Skill under `distribution/skills/`. It does not copy any Skill's full contract; the installed `SKILL.md` and the `docs/agents/**` rules it points to decide the actual steps.

## Skills from the upstream repository

These 23 Skills come from [mattpocock/skills](https://github.com/mattpocock/skills) (`skills/engineering/` and `skills/productivity/`). ARW keeps an adapted fork pinned to one upstream commit, translated and adjusted for ARW issues, records and platforms, so behavior can differ from the upstream text. Each entry links to the upstream description at the pinned commit; read it for the original idea.

### Discussion and clarification

- `grilling` (automatic): Interviews you relentlessly about a plan or decision until every branch is resolved; other Skills reuse it. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/grilling/SKILL.md)
- `grill-me` (name it explicitly): The same interview, started by you, for plans that do not involve code. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/grill-me/SKILL.md)
- `grill-with-docs` (name it explicitly): The interview plus recording agreed terms and architecture decisions in `CONTEXT.md` and ADRs as you go. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/grill-with-docs/SKILL.md)
- `wait-what` (name it explicitly): Use when the last message did not land: the Agent re-pitches it in plain words. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/wait-what/SKILL.md)
- `to-questionnaire` (name it explicitly): Turns a decision you cannot make alone into a questionnaire for the person who can. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/to-questionnaire/SKILL.md)

### Investigation and design

- `wayfinder` (name it explicitly): Plans work too large for one session as a map of decision issues and resolves them one at a time. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/wayfinder/SKILL.md)
- `research` (automatic): Investigates a question against primary sources and saves cited findings as a Markdown file. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/research/SKILL.md)
- `prototype` (automatic): Builds a throwaway prototype to answer a design question. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/prototype/SKILL.md)
- `domain-modeling` (automatic): Reads and updates the domain glossary and ADRs before naming concepts or deciding boundaries. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/domain-modeling/SKILL.md)
- `codebase-design` (automatic): Shared vocabulary for deep modules, seams and testable interfaces. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/codebase-design/SKILL.md)
- `improve-codebase-architecture` (name it explicitly): Scans a codebase for deepening opportunities, shows them as an HTML report, then grills through the one you pick. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/improve-codebase-architecture/SKILL.md)

### Planning and implementation

- `to-spec` (name it explicitly): Turns the current conversation into a specification without a new interview. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/to-spec/SKILL.md)
- `to-tickets` (name it explicitly): Splits a plan or specification into vertical-slice issues that declare their blockers. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/to-tickets/SKILL.md)
- `triage` (name it explicitly): Moves issues through triage states and writes agent-ready briefs. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/triage/SKILL.md)
- `implement` (automatic): Builds what an implementation issue asks for, validates it, and records the result. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/implement/SKILL.md)
- `tdd` (automatic): Test-first development with a red-green-refactor loop. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/tdd/SKILL.md)
- `diagnosing-bugs` (automatic): A disciplined loop for hard bugs and performance regressions. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/diagnosing-bugs/SKILL.md)
- `resolving-merge-conflicts` (automatic): Resolves an in-progress merge or rebase conflict hunk by hunk and finishes it. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/resolving-merge-conflicts/SKILL.md)
- `code-review` (automatic): Reviews a Git comparison on two independent axes: implementation standards and requirement conformance. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/code-review/SKILL.md)

### Handoff, setup and learning

- `handoff` (name it explicitly): Compacts the conversation into a handoff document for another agent. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/handoff/SKILL.md)
- `wizard` (automatic): Generates an interactive shell script that walks you through steps only a human can do. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/wizard/SKILL.md)
- `teach` (name it explicitly): Teaches you a new skill or concept over several sessions in the current directory. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/teach/SKILL.md)
- `writing-for-agents` (automatic): Guidance for writing Skills, `AGENTS.md`, `CLAUDE.md` and other documents agents read. [Upstream](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/writing-for-agents/SKILL.md)

## ARW custom Skills

These 11 Skills are written for ARW and implement its workflow: records under `.scratch`, independent Reviewers, and commit gates. Each entry says when it applies, what it does, what it leaves behind, and which commands and Skills it works with.

### Commands and records

#### `arw-commands` (automatic)

- When: the Agent writes or runs an `arw` command, queries issues, maps, specs or background Agents, resolves which repository a command targets, or audits a repository right after `arw workflow init`.
- What it does: fixes the canonical command forms and tells read-only commands apart from the ones that write (`workflow init`, `workflow update`, `text fix`, `spec-readiness generate`, and so on). After `init` it audits the domain documents, conflicting repository rules, and non-English file names.
- Leaves behind: at most one merged workflow-completion issue when the audit finds gaps; no issue when there are none.
- Related: `arw list issues`, `arw print`, `arw text check`, `arw terms check`; `validation`, `issue-tracking`.

#### `issue-tracking` (automatic)

- When: the Agent reads, creates or updates an effort, issue, map or spec, and before it reports an issue as complete.
- What it does: defines the `.scratch` layout and numbering, the required sections of an implementation issue, the status and triage values, how `## Spec Requirement` points at governing documents, and where evidence goes (`## Validation`, `## Comments`). It also limits the Agent to its current effort unless you authorize another.
- Leaves behind: issue, map and spec files under `.scratch/<NNNN>-<effort-slug>/`.
- Related: `arw list issues`, `arw print`, `arw open`; `implement`, `spec-readiness`.

#### `code-maps` (automatic, only when configured)

- When: the Repository Profile configures Code Map roots and the Agent changes covered source, or writes or checks a Code Map.
- What it does: reads the Code Map README before changing covered code, updates every affected Code Map in the same issue, and runs `arw code-map verify`. It never creates a Code Map just because a directory exists.
- Leaves behind: Code Map `README.md` files with the fixed front matter and section order.
- Related: `arw code-map verify`; `validation`.

### Planning, review and commits

#### `spec-readiness` (automatic)

- When: an implementation issue's design is finished (or revised) and needs independent design review before any implementation.
- What it does: prepares the inputs (governing specification, ADRs, context documents), starts a Spec Readiness Reviewer through `reviewer-launch`, then runs `generate`, `promote` and `verify`. Fixing findings means a new round. A "no governing design needed" exception requires your explicit confirmation.
- Leaves behind: `.scratch/<NNNN>-<effort-slug>/issues/<NN>.spec-readiness.json`. A missing, stale or `gap` record blocks implementation and commit, not unrelated work.
- Related: `arw spec-readiness prepare|generate|promote|verify`; `implement`, `reviewer-launch`, `rule-and-design-changes`.

#### `reviewer-launch` (automatic, Main Agent only)

- When: the Agent you talk to starts, follows, waits for, interrupts or resumes an independent Reviewer (Code Standards, requirement conformance, Spec Readiness). Reviewers themselves do not use it.
- What it does: runs the prepared review round with `cat <round>/*.jsonl | arw background-agent --wait`, reads the report from `completion`, and handles platform differences between Codex and Claude Code. If a review runs past 30 minutes it asks you whether to keep waiting, and it also asks when a Reviewer reports repeated early exits.
- Leaves behind: Reviewer reports at the paths prepared by the round.
- Related: `arw background-agent`, `arw list background-agents`; `spec-readiness`, `commit`.

#### `commit` (automatic, only after you ask for a commit)

- When: you ask for a Git commit. Finishing an issue alone never starts it.
- What it does: classifies the staged files. A candidate with implementation work gets the full workflow: update the issue record, `arw commit-audit prepare`, two parallel Reviewers (requirement conformance and Code Standards), check each finding, `arw commit-audit verify`, `arw spec-readiness verify`, then commit. A candidate of only planning records, Agent rules and documents (including the root README, `CONTEXT.md` and `CLAUDE.md`) uses the lighter path checked by `arw commit-audit verify --non-implementation`. Commit messages follow Conventional Commits. Any failed gate stops the commit.
- Leaves behind: review rounds under `.tmp` and the commit itself.
- Related: `code-review`, `reviewer-launch`, `spec-readiness`, `issue-tracking`.

#### `rule-and-design-changes` (automatic)

- When: before changing Agent instructions, Skills, long-term specifications, ADRs, context documents, or other documents that hold lasting design.
- What it does: states the target path and the concrete change and waits for your explicit confirmation; a request that already contains the exact change counts as confirmation. Specification changes proposed by an independent Reviewer are decided by the Main Agent together with one independent subagent, and only disagreements come to you. It also tells how to write lasting documents as current rules rather than history.
- Leaves behind: the confirmed edits only; it does not stage or commit.
- Related: `spec-readiness`, `commit`.

### Testing and validation

#### `validation` (automatic)

- When: before changing behavior or tests, and before running verification.
- What it does: decides which checks are required (`arw text check`, `arw terms check --include <effort directory>`, `arw code-map verify` when configured, and the test commands the repository declares in its root `AGENTS.md`), applies the least sufficient test coverage, reuses valid results, and defines what documentation-only changes need.
- Leaves behind: concrete evidence per acceptance criterion, normally in the issue's `## Validation`.
- Related: `test-performance-optimization`, `test-value-cleanup`, `implement`.

#### `test-performance-optimization` (automatic)

- When: after creating or semantically changing test cases (to measure each callback against the repository threshold, 100 ms by default), or when the goal is to make an existing suite faster.
- What it does: for optimization work it first needs an issue, records a baseline (total time and the ten slowest callbacks), then shortens tests by keeping the smallest representative case per outcome, table-driving equivalent inputs, and sharing immutable setup.
- Leaves behind: measurements and before-and-after comparison in the issue.
- Related: `validation`, `test-value-cleanup`.

#### `test-value-cleanup` (automatic, but only on your request)

- When: you ask to clean up low-value tests. It has no schedule and ordinary new tests never trigger it.
- What it does: confirms the authorizing issue, fixes the baseline count and target, deletes low-value tests by relative value (by default at least 20 percent), states every loss honestly, keeps core guarantees such as permissions, identity and data safety, then checks the full test command against the time target (median under 5 seconds over three runs, unless you set another).
- Leaves behind: the deleted tests, a record of each loss, and measurements in the issue.
- Related: `test-performance-optimization`, `validation`, `implement`.

### Multiple repositories

#### `application-workflow` (name it explicitly)

- When: you have chosen the multi-repository and JIRA path (see [Distribute work across repositories and sync JIRA](application-jira.md)). Repository configuration or a JIRA request never triggers it.
- What it does: needs a complete `application` object in `arw.config.json`, then guides one stage at a time: configuration, accepting a JIRA task, associating and distributing issues, correcting a Module issue, synchronizing, completing in JIRA, and recovery from partial results. It grants no permission by itself; every file write, commit, push or JIRA write still needs the authorization the repository rules require.
- Leaves behind: Application effort and issues, distributed Module issues, and JIRA updates that you authorized.
- Related: `arw workflow init`, `arw workflow verify`, `arw application associate`, `arw application sync`, `arw jira list|print|open|accept|complete`, `arw module check-correction`; `issue-tracking`.
