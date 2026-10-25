# Agent Repository Workflow

[English](README.md) | [简体中文](README.zh-CN.md)

Agent Repository Workflow, or ARW, is a workflow manager for work in local Git repositories. It connects work records, implementation authorization, Agent collaboration rules, repository configuration, and release maintenance. It does not replace user authorization for important decisions, commits, or external publication.

This README is for new developers who know basic terminal, Git, and Node.js operations but have not used ARW. Node.js 24 is the minimum runtime. ARW uses native JavaScript and ES modules and has no npm runtime dependencies. Windows and Linux are fully supported; macOS is currently experimental.

## What ARW is for

ARW is for teams that want users and Agents to keep working together in the same Git repository. It aims to improve several problems that come with using Agents to write code:

- YOLO (You Only Live Once) can cause an Agent to skip necessary understanding, authorization, and validation, seriously reducing code and documentation quality.
- Code written by an Agent can look complete while its validity remains difficult to establish.
- Agents produce code much faster than users can review it item by item.
- When context is too full, Agent intelligence declines, making it easier to miss constraints or connect information incorrectly.
- Having one Agent repeatedly reread and review its own work to address these risks consumes too many tokens.
- Agent-written documentation can fill up with jargon, making actual behavior and responsibility hard for users to understand.

ARW has not fully solved these problems:

- Long-term maintainability of Agent-written code is still low. Continuous refactoring can improve it, but at high cost.
- Under ARW's strict process, reviews take much longer than implementation. This makes ARW's return on investment less compelling than YOLO mode.

ARW may be too heavy if you only want an Agent to answer occasional questions, or if you do not need work authorization and evidence stored in a Git repository. The first-use path below is suitable if you want users to confirm important decisions, work records to authorize implementation scope, and an independent Reviewer to inspect work before a commit.

## Quick start

First install the ARW program for the current user, then initialize the target Git repository where you plan to use ARW long term. Keeping the source checkout, installation directory, and target repository separate avoids mixing their roles.

During initialization, ARW asks whether to configure a Code Map. A Code Map is an Agent-maintained description of source directories. It helps later Agents understand each directory's responsibility through its README files, and lets validation detect missing descriptions for configured source areas. You can leave it unconfigured if the project does not need this navigation and coverage check.

1. Prepare Node.js 24 or later and Git. GitHub has no stable release yet, so clone the public `main` branch and install from source:

   ```text
   git clone -c core.autocrlf=false --branch main https://github.com/pellorao/agent-repository-workflow.git
   cd agent-repository-workflow
   node install.mjs
   ```

2. The installer can register `arw` on Windows or Linux. The current terminal may retain its old PATH, so open a new terminal and verify with `arw --version`. Experimental macOS does not register PATH automatically. The current source installation has an identity of `<version>-pre`.
3. Enter the target Git repository where you want to use ARW and run `arw workflow init`. This writes repository workflow content based on your platform, domain-document layout, and optional Code Map configuration. It does not install an Agent CLI.
4. Give the complete `Agent Post-init Handoff` from the command to the Main Agent in the current session. The Agent reviews rule, documentation, and validation gaps that mechanical checks cannot judge. It creates no issue when there are no gaps; otherwise it creates exactly one summary issue to complete the repository workflow, and completes it before ordinary implementation.
5. Run `arw workflow verify` and the applicable checks requested by the handoff review. Then use `arw list issues` to see work that can proceed. If the repository has no work records yet, a missing `.scratch` directory and an empty list are both normal; neither indicates failed initialization.

After these five steps, `arw` is available and the target repository has its own Agent working rules. The rest of this README explains why each step matters, then moves from the first work record into the everyday workflow.

## Install and configure ARW

Installation and initialization solve different problems. Installation places the ARW runtime and Workflow Distribution in a fixed directory for the current user. Workflow Distribution is shared Agent workflow content that target repositories consume during initialization. Updating the ARW installation directory is different from running `arw workflow update`: the first replaces the user's runtime, while the second updates Managed Content in the current target repository.

### Install the ARW program

GitHub currently has no stable release tag. The available public installation path is to clone `main` and install from the source checkout. It requires Node.js 24 or later and Git; it does not require GitLab access or an SSH key:

```text
git clone -c core.autocrlf=false --branch main https://github.com/pellorao/agent-repository-workflow.git
cd agent-repository-workflow
node install.mjs
```

This uses local-source mode and has an identity of `<version>-pre`. Running `node install.mjs` does not access a remote. Do not use the Bootstrap stable-release installation commands below yet: with no stable tag, Bootstrap fails and does not fall back to `main`. After a formal stable tag exists, you can use the single-file [`scripts/install-arw.mjs`](scripts/install-arw.mjs) obtained from GitHub. Do not pipe a remote response directly to Node.js; inspect the downloaded file first. Bootstrap does not accept a remote override or save credentials.

ARW checks source bytes exactly. Git must not convert repository text line endings to Windows form while obtaining the source, or installation can fail because the source bytes do not match. The downloaded Bootstrap sets `core.autocrlf=false` in its temporary Repository and does not change the user's global Git configuration.

Check the runtime first:

```text
node --version
```

The version must be 24 or later. Before obtaining source or writing installation content, the installer rejects a runtime below that minimum.

After a formal stable tag exists, Bootstrap's interactive installation selects the highest stable SemVer release by default. These Bootstrap commands are not available while the repository has no stable tag.

```text
node install-arw.mjs
```

After a stable tag exists, to install the highest stable version without interaction and register PATH, use:

```text
node install-arw.mjs --non-interactive --register-path true
```

After a stable tag exists, choose an exact stable version present on the remote only when you explicitly want a historical version or downgrade:

```text
node install-arw.mjs --version MAJOR.MINOR.PATCH
```

Source maintainers and current installers use the following command to clone the complete public repository. The clone's own `-c` option disables line-ending conversion before the first checkout and stores the setting only in this Repository:

```text
git clone -c core.autocrlf=false --branch main https://github.com/pellorao/agent-repository-workflow.git
cd agent-repository-workflow
node install.mjs
```

Do not install from a working tree where line endings have already been converted. Run the clone command again to keep repository data in its original bytes. The repository is public, so cloning does not require private GitLab access. If your goal is to modify ARW source, continue to the [Developer Guide](docs/manuals/development.md), which covers the development environment, source navigation, and maintenance paths.

The installation directory is fixed:

- Windows: `%USERPROFILE%\.agent-repository-workflow`, including when installing from Git Bash; it does not switch to `$HOME`.
- Linux and experimental macOS: `$HOME/.agent-repository-workflow`.

PATH behavior depends on the platform:

- Windows manages only `Path` in the current user's Registry. Even if the environment-change notification succeeds, the current PowerShell, CMD, or Git Bash session may retain its old environment. Open a new terminal, sign out and back in, or refresh the current command interpreter manually.
- Linux manages only the exact PATH block marked by ARW in `~/.profile`; it does not guess other shell configuration files.
- Experimental macOS does not register PATH automatically. Configure it yourself or use the launcher in the installation directory.
- `--register-path false` does not change PATH or configuration files, and does not release ownership previously established by ARW.

After installation, verify it:

```text
arw --version
```

The installer does not copy Node.js. The `arw` launcher resolves `node` from the current PATH each time, so verification uses the runtime visible to the new terminal.

To stop using ARW, enter the installation directory and run `node uninstall.mjs`. The user's `config.json` is kept by default; it is removed only when you explicitly run `node uninstall.mjs --remove-config true`. Uninstall removes only runtime and PATH or configuration-file entries that the valid installation manifest proves ARW owns. Unknown files remain untouched.

### Initialize or adjust files in a target repository

Installation makes the command available, but it does not tell ARW which Agent platforms or documentation layout a project uses. Open a new terminal, enter the target Git repository, and run:

```text
arw workflow init
```

ARW searches upward from the current directory for the nearest Git working-tree root, and observes and modifies only that root. A nested Git repository does not fall back to an outer repository. Initialize each repository that needs ARW separately, from its root or a subdirectory.

Initialization collects or reuses a Repository Profile. This configuration records the selected platforms, domain-document layout, and optional Code Map root, include, and exclude rules. The platforms selected by the user are the sole basis for which platform content is installed. ARW does not scan user-level or platform-built-in Skills, and does not download or validate an Agent CLI.

After writing, the command prints the complete `Agent Post-init Handoff`. Give the entire handoff block to the Main Agent: gaps observed by the Engine are review input and cannot prove there are no other semantic gaps. The review checks repository workflow, domain documents and long-term terms, managed areas and duplicate rules, repository-owned validation, writing and filename rules, `.arwignore`, Agent management scope, and preparation to migrate old ARW Artifacts.

`workflow init` does not create root `CONTEXT.md`, `CONTEXT-MAP.md`, or `.scratch`. If domain documents are missing or another review item has a gap, the Main Agent combines all gaps into exactly one repository workflow completion issue. It uses `Status: needs-info` while user choices remain, and changes to `Status: ready-for-agent` only after choices and blockers are resolved. If the complete review finds no gaps, no issue is created; a missing `.scratch` is then normal.

After the handoff is complete, run:

```text
arw workflow verify
arw code-map verify
arw text check
arw terms check
```

`arw workflow verify` reads the lock file, Repository Profile, Managed Content, platform projections, and configured Code Map. Run `arw code-map verify` separately only when the Profile configures a Code Map. `arw text check` checks UTF-8, BOM, and LF for Agent-managed text. `arw terms check` discovers the terminology source from the repository root: if root `CONTEXT-MAP.md` exists, it uses the referenced `CONTEXT.md` files; otherwise it uses root `CONTEXT.md`. It checks managed Markdown and excludes `.scratch` by default. To include the current effort, add `--include .scratch/<NNNN>-<effort-slug>/`. Each command proves only the contract it actually observes; they do not replace one another.

A new ARW installation does not automatically update repositories that already have an initialized ARW workflow. To use the newer installed workflow content in a target repository, preview the update plan, confirm it, apply it, and verify the result:

```text
arw workflow update --dry-run
arw workflow update
arw workflow verify
```

`--dry-run` shows how the newer workflow would change this repository. After confirming the plan, the second command applies the update and the last command reads back the result.

Run `arw workflow remove` when you no longer want ARW in the target repository. The command asks you to choose how to handle platform Agent configuration, `.arwignore`, Code Map, and mixed Agent documents. ARW does not treat files whose ownership it cannot prove as deletable.

## Complete one JIRA request across multiple repositories

When a task changes only one Git repository, continue with the everyday path below. When the same JIRA request must be completed across multiple Git repositories, a single-repository path cannot clearly separate the overall request, work in each repository, and final JIRA state.

ARW's multi-repository path keeps the overall request and coordination record in an Application Repository, while each Module Repository owns only its own implementation and validation. This adds repository configuration, work records on both sides, ordered commits and pushes, and authorization for JIRA writes. In return, each fact has a clear owner and failures can be retried from a precise boundary.

If you are deciding whether a task needs multi-repository collaboration, or have chosen this path and need to understand the repository and record responsibilities, use [Distribute work across repositories and sync JIRA](docs/manuals/application-jira.md). To have an Agent perform the coordination, explicitly invoke the `application-workflow` Skill; repository configuration and JIRA requests do not trigger it automatically.

## Everyday use

After repository initialization, the everyday path starts by checking whether there is work that can proceed. If a record exists, read its status and blockers. If there is no record, choose a discussion or investigation path based on how much is unknown, then create an implementation issue. Finishing implementation does not automatically create a commit; the commit and review process starts only when the user explicitly requests it.

If you are already in an Agent conversation and only want to choose a request to send, use [Everyday commands for Agent conversations](docs/manuals/daily-agent-conversation-commands.md). It is a quick reference with decision prompts, not a replacement for the complete workflow below.

### Find and read work records

ARW groups its registered `issue`, `map`, and `spec` records under the name ARW Artifacts and stores them in `.scratch` in the nearest Git repository. An effort uses `.scratch/<NNNN>-<effort-slug>/`; an issue uses `issues/<NN>-<issue-slug>.md`. Numeric identifiers carry stable identity, while descriptive slugs make paths easier to read.

The corresponding local Canonical IDs are `issue:<NNNN>:<NN>`, `map:<NNNN>`, and `spec:<NNNN>`. A Canonical ID contains no slug or file path, so it remains stable if an effort or issue is renamed.

First list issues that can proceed and have no unfinished blockers:

```text
arw list issues
```

In a terminal, the short alias is `arw li`. By default, results may include implementation issues with `ready-for-agent` or `ready-for-human` status, and open unclaimed Wayfinder issues. Application Source Issues mirror the status of another repository and are not included by default.

Narrow the results when investigating by status or type:

```text
arw list issues --all-statuses
arw list issues --status ready-for-agent,needs-info
arw list issues --type implementation,application-source,wayfinder
```

To view investigation maps and local specs:

```text
arw list maps
arw list specs
```

The short aliases are `arw lm` and `arw ls`. After finding a record, use its complete Canonical ID to open or print it:

```text
arw open issue:0007:02
arw print issue:0007:02
arw open map:0007
arw print spec:0007
```

`open` uses the `editor` in the global `config.json`, prints the repository-relative path, starts the editor, and returns immediately. `print` writes the exact original UTF-8 content to stdout for an Agent or script. Both accept only local Canonical IDs; neither reads Git history or another repository.

`.scratch` may be absent when the repository has no ARW Artifacts. `list` succeeds with an empty result, `migrate artifacts` succeeds without changes, and a specific `open` or `print` returns a controlled `not-found`. The parent directory for a record is created only when that record is created. Do not manually create an empty `.scratch` just to make a command succeed.

You can first ask an Agent to read the state and suggest the next step:

```text
Read <issue-canonical-ID> and tell me its current status, blockers, and next step. Do not modify files yet.
```

### Start an Agent for the current session

Each independent session needs one Main Agent to communicate with the user, coordinate task assignments, and own Git writes. ARW does not require that Agent to be launched with an ARW command. For a first use, directly launching the installed and authenticated platform CLI from the target Git repository is usually simplest, for example `codex` or `claude`.

If you often use the same Agent CLI with the same fixed parameters, you can save a named configuration in ARW's user configuration and start it from the target repository:

```text
arw agent start <name> [agent-arguments...]
```

A named configuration avoids repeated typing; it does not turn an external CLI into an ARW internal Reviewer. If you choose this path, read the [Agent CLI Guide](docs/manuals/agent-cli.md) before editing the configuration. It covers the current global configuration structure, Codex and Claude Code examples, per-run arguments, executable programs, exit codes, and process and session boundaries. Only one writer should use a working tree at a time; ARW does not provide an automatic write lock.

<a id="create-and-plan-work"></a>

### Create and plan work

If `arw list issues` already shows an issue ready for implementation, continue to the next section. If there is no record, choose the smallest sufficient discussion path based on what is unknown. An implementation issue should authorize writes only after its requirements and important decisions are clear.

When the boundaries are clear but product behavior or long-term maintenance choices remain, use `grill-with-docs` to discuss each choice and save decisions after they are confirmed:

```text
I want to add CSV export to the existing list. Use $grill-with-docs to reach agreement with me. Do not implement until I confirm that the discussion is complete.
```

When the scope is broad, spans more than one Agent session, or the current idea is not yet a complete request, use `wayfinder` to create a shared investigation map and resolve one question at a time:

```text
I want to redesign the project's permissions system, but I do not know the full scope yet. Use $wayfinder to create an investigation map. Do not implement product changes yet.
```

Once investigation and discussion are clear enough, `to-spec` organizes the confirmed content into a spec without interviewing you again:

```text
Use $to-spec to organize the requirements we have confirmed into a spec. Do not start a new interview.
```

Then use `to-tickets` to split the plan or spec into issues with blocker relationships. Review the split before records are created:

```text
Use $to-tickets to split this spec into issues that can be implemented one at a time. Show me the proposed split first; create the records only after I approve it.
```

Combine these paths as needed; not every task needs to start from the beginning. Existing complete requirements can go straight to issue splitting. An already authorized implementation issue can go straight to implementation. Read-only answers usually need no implementation record. A Wayfinder investigation issue does not authorize implementation, and an Application Source Issue only mirrors Module status. Only a matching, actionable implementation issue authorizes changes to deliverables.

Common implementation statuses help determine the next step:

- `needs-triage`: classification and an initial check are needed.
- `needs-info`: a user decision or external fact is still needed.
- `ready-for-human`: the next action must be performed by the user.
- `ready-for-agent`: user decisions and blockers are resolved, and an Agent may start implementation.
- `completed`: acceptance criteria and required validation are complete and recorded.
- `wontfix`: the issue has explicitly been ended without implementation.

### Start implementation

Choose an implementation issue with `ready-for-agent` status and completed blockers, then give the Agent a request with clear boundaries:

```text
Use $implement to implement issue:<NNNN>:<NN>. If an important decision has not been confirmed, stop and use $grilling to discuss it with me.
```

`implement` first reads the issue and its effort spec in full. It then uses the Issue Gate to check issue status, blockers, and implementation authorization, and completes Spec Readiness through `prepare -> independent review -> generate -> promote -> verify`. The `spec-readiness-reviewer` only checks whether the issue-selected governance design is current, complete, and sufficient to implement. A successful record authorizes starting that issue; it does not prove the final implementation is correct.

After authorization, the Main Agent establishes a recoverable baseline for the write scope and coordinates assignments. A subagent may deliver work within its assigned non-overlapping scope, but the Main Agent performs all Git writes. If the task exceeds the issue, an important decision remains unresolved, or repository rules conflict, stop affected writes and ask the user to decide.

Implementation proceeds against the acceptance criteria. Start with focused validation closest to the change, then run the complete validation required by the repository before finishing. Each acceptance criterion needs actual evidence. When all criteria are met, the Agent records evidence under `## Validation`, checks completed criteria, and changes the issue status to `completed`.

`completed` means only that the work record is complete. It does not stage files, create a commit, or include unrelated worktree changes.

### Review and commit

The Main Agent enters the commit workflow only after an explicit user request to commit. The request should identify the issue and exact scope, for example:

```text
Review and commit the implementation for issue:<NNNN>:<NN>. Include only changes authorized by this issue and preserve other worktree content.
```

The Main Agent first confirms completion evidence and the exact staged candidate. The `code-review` Skill then starts `code-standards-reviewer` and, when applicable, `code-spec-reviewer` against the same Git comparison. The first checks repository standards; the second checks governing requirements. Freeze the final implementation bytes only after both complete results pass and any permitted wrap-up is complete.

After freezing, the Main Agent prepares a Commit Audit Request for the candidate. `commit-audit-reviewer` checks issue requirements and applicable long-term requirements for this batch, and writes its complete result to the bound JSONL. After the Reviewer returns completion, the Main Agent asks ARW to generate the formal record, promotes only the exact bytes from the returned mapping, then runs `arw commit-audit verify` and the other mechanical checks. Any change to frozen implementation bytes after the audit starts invalidates the review and audit.

A candidate containing only investigation, design, or other closed non-implementation content may use the lighter commit path. Once a candidate includes implementation deliverables for the current repository, use the complete implementation commit workflow. The target repository's `code-review` and `commit` Skills own exact comparison preparation, result reuse, and recovery rules; this README does not copy their full protocols.

## Common commands

This section summarizes everyday entry points. For complete syntax, run the installed `arw` command and consult the applicable long-term specification. The Main Agent uses complete specification commands in operating instructions; users may use the short aliases shown here in a terminal.

### Check version and repository configuration

| Command | Question it answers |
| --- | --- |
| `arw --version` | Which ARW version is running? |
| `arw workflow init` | How do I initialize a workflow for the nearest target Git repository? |
| `arw workflow verify` | Do Managed Content and the current Repository Profile match? |
| `arw workflow update --dry-run` | What target repository content would change, without writing it yet? |
| `arw workflow update` | How do I apply a confirmed workflow update? |
| `arw workflow remove` | How do I remove Managed Content from the target repository using explicit choices? |
| `arw code-map verify` | Does the configured source-directory description cover its scope and have a valid structure? |
| `arw text check` | Does Agent-managed text meet UTF-8, BOM, and LF requirements? |
| `arw text fix` | How can I mechanically repair issues that text checks can fix? |
| `arw terms check [--strict] [--include <repository-relative-directory>]...` | Are terms correct in the current context? `--strict` adds release-name checks; `--include` includes a selected `.scratch` directory. |
| `arw language inspect <repository-relative-path>...` | What language mix is in the explicit Markdown files or directories? This does not judge compliance. |

### Find, open, and read work records

| Command | Short alias | Question it answers |
| --- | --- | --- |
| `arw list issues` | `arw li` | Which issues can proceed without unfinished blockers? |
| `arw list issues --all-statuses` | `arw li -a` | What issues have valid structure and status? |
| `arw list issues --status <status>[,<status>...]` | `arw li -s <status>[,<status>...]` | Which issues use the selected statuses? |
| `arw list issues --type <type>[,<type>...]` | `arw li -t <type>[,<type>...]` | Which issues are `implementation`, `application-source`, or `wayfinder`? |
| `arw list maps` | `arw lm` | Which Wayfinder maps are registered? |
| `arw list specs` | `arw ls` | Which local specs are registered? |
| `arw open <canonical-id>` | - | How do I open a local ARW Artifact in the configured editor? |
| `arw print <canonical-id>` | - | How do I write the exact original text of a local ARW Artifact to stdout? |

`--all-statuses` and `--status` are mutually exclusive. `--type` can be combined with status filters. If `list`, `open`, or `print` reports an old issue or `PRD.md` format, check the entire preflight scope first; `arw migrate artifacts` migrates the nearest repository's entire `.scratch`, not only the record just mentioned.

### Start a saved Agent CLI configuration

```text
arw agent start <name> [agent-arguments...]
```

Use this entry point after deciding to save a named configuration. See the [Agent CLI Guide](docs/manuals/agent-cli.md) for its fields, arguments, and process behavior.

### Review commands usually run by an Agent

Users usually need to specify only the issue and goal. The Main Agent organizes these commands under the current workflow:

| Command | Responsibility |
| --- | --- |
| `arw spec-readiness prepare --issue issue:<NNNN>:<NN> [--input <temp-json-path>]` | Freeze current governance inputs, review subject, and Reviewer Role into a Reviewer Request. |
| `arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <temp-json-path>` | Validate the independent Reviewer's final draft and generate a temporary readiness result. |
| `arw spec-readiness promote --input <generated-path>` | Revalidate unchanged bindings and promote the exact generated issue result. |
| `arw spec-readiness verify --issue issue:<NNNN>:<NN>` | Read-only check that implementation authorization for the issue is still valid. |
| `arw commit-audit prepare --input <absolute-input-path>` | Prepare an independent Commit Audit Request from the frozen staged candidate. |
| `arw commit-audit generate --request <absolute-request-path>` | Generate the formal pre-commit review file from the Reviewer's bound JSONL. |
| `arw commit-audit verify` | Read-only check that the final staged candidate matches the promoted review. |

### What to check when a command fails

For ordinary commands, exit code `0` means success or an accepted no-op, `1` means findings, blockers, or operation failure, and `2` means invalid command usage. Agent CLI exit behavior is covered in its dedicated guide.

- `Not inside a Git working tree`: enter the target Git repository root or a subdirectory and try again.
- `.scratch` is absent: this is an allowed normal state for `list`, `migrate artifacts`, and repository workflows. When opening or printing a specific identity, check whether the record has actually been created.
- `arw` is missing after installation on Windows: open a new terminal. If environment refresh still has not taken effect, sign out and back in or refresh the current command interpreter manually.
- `arw` is missing after installation on Linux: check that PATH registration was allowed and that the current shell reads `~/.profile`; ARW does not change other shell configuration.
- `arw` is missing on experimental macOS: installation does not register PATH automatically. Use the installation-directory launcher or configure PATH yourself.
- `open` cannot start the editor: check the editor setting in the global `config.json`; the [Agent CLI Guide](docs/manuals/agent-cli.md) has the full structure.
- `arw agent start` fails: check its named configuration, arguments, and launch boundary in the [Agent CLI Guide](docs/manuals/agent-cli.md).
- Spec Readiness returns `gap`, `uncertain`, or an expired result: fix the governance source or review input that owns the issue, then rerun the full workflow. Do not bypass the result.
- `workflow update` reports unknown ownership or state drift: preserve user changes, resolve the conflict using the current lock file and Git recovery baseline, then rerun the full operation.
- Multiple Agents are writing to the same working tree: stop the extra writers. The Main Agent must reconfirm the recovery baseline and non-overlapping scopes.

<a id="reviewers"></a>

## Why independent reviews matter

The Main Agent communicates with the user, selects scope, coordinates implementation, runs validation, and performs all Git writes. An Agent reviewing its own work can retain its original assumptions, so ARW uses four Canonical Reviewer Roles at different stages:

- `spec-readiness-reviewer`: before the first implementation write, checks whether the governance design selected by the issue is current, complete, and sufficient to implement.
- `code-standards-reviewer`: after the user requests an implementation commit, checks the candidate against repository standards and applicable writing or code rules.
- `code-spec-reviewer`: at the same stage, checks from another axis whether the candidate meets explicit governing requirements.
- `commit-audit-reviewer`: after both Code Review axes finish and the final candidate is frozen, checks issue requirements and applicable long-term requirements for the batch.

A typical relationship is:

```text
Main Agent
|-- before implementation: spec-readiness-reviewer
|-- implementation and validation: Main Agent and subagents with assigned write scopes
`-- after the user explicitly requests an implementation commit
    |-- code-standards-reviewer
    |-- code-spec-reviewer
    `-- after the candidate is frozen: commit-audit-reviewer
```

A Reviewer Role is a temporary Agent started by the current workflow, not an external program launched by `arw agent start` from the global `config.json`. The two have no name mapping or shared session. Independent reviews add waiting time and model usage, so they run only at their relevant stages; in return, the judgment comes from someone separate from the implementer.

## Included Skills

`arw workflow init` installs applicable Skills for the platforms selected by the user. Codex uses `.agents/skills` in the target repository; Claude Code uses `.claude/skills`. A Skill is a set of task-specific operating instructions. You can name one directly in a conversation, for example, `Use $grill-with-docs to confirm the requirements with me`.

In the current Source Checkout, Skills are grouped below by their main purpose. A Skill may also be called by another Skill; these groups help you find an entry point and do not change the Skill's instructions:

- Discussion and clarification: `grill-me`, `grilling`, `grill-with-docs`, `wait-what`, `to-questionnaire`.
- Investigation and design: `wayfinder`, `research`, `prototype`, `domain-modeling`, `codebase-design`, `improve-codebase-architecture`.
- Planning and implementation: `to-spec`, `to-tickets`, `triage`, `implement`, `tdd`, `diagnosing-bugs`, `resolving-merge-conflicts`.
- Review and cross-repository coordination: `code-review`, `application-workflow`.
- Handoff, setup, and learning: `handoff`, `wizard`, `teach`, `writing-for-agents`.

Choose a Skill based on your current goal. Use `grilling` or `grill-with-docs` to test important choices; use `wayfinder` to save unknowns that span more than one session; use `to-spec` to organize existing agreement into a specification; use `implement` when an implementation issue already exists; and explicitly use `application-workflow` after deciding to follow the multi-repository and JIRA path.

This directory is a reader-facing discovery entry point, not a machine inventory or the full contract for every Skill. Actual steps come from the relevant `SKILL.md` in the target repository and applicable `docs/agents/**`. `distribution/` is the installation payload synchronized and reviewed before release, not the place to edit this content during ordinary Source Checkout work.

## Develop ARW

If your goal is to modify ARW Source Checkout rather than use ARW in your own project, do not run `arw workflow init`, `update`, `verify`, or `remove` on the source repository. Source Checkout is where Workflow Distribution is authored, not a target repository that consumes the distribution.

After cloning Source Checkout and preparing to make changes, confirm Node.js 24 or later from the repository root, then continue to the [Developer Guide](docs/manuals/development.md). It helps you prepare the full development environment, choose an implementation or maintenance path, run focused and shared validation, and locate code by source responsibility. Stable product behavior and long-term boundaries belong to the [ARW long-term specification](docs/specs/agent-repository-workflow/spec.md) (in Chinese); neither the README nor Developer Guide duplicates those contracts.

## A final note

More process makes development heavier and slower. Too little process, or no process, makes quality hard to ensure. Every project therefore needs to balance process cost against quality gains and choose the smallest path that is still sufficient for the risk of the change.

That balance will change as Agent intelligence improves. When a mechanical check no longer provides reliable protection, or natural-language review is better suited to carry responsibility, its cost and benefit should be reconsidered instead of keeping it forever because it already exists. ARW may have no practical value at all in the not-too-distant future.

## Further reading

- [Distribute work across repositories and sync JIRA](docs/manuals/application-jira.md): When one JIRA request must be completed across multiple Git repositories, use this to judge fit and follow repository responsibilities, operation order, and failure recovery.
- [Agent CLI Guide](docs/manuals/agent-cli.md): When you have decided to save and start an external Agent CLI configuration with ARW, read about configuration, argument forwarding, and process and session boundaries.
- [Everyday commands for Agent conversations](docs/manuals/daily-agent-conversation-commands.md): When you are already in an Agent conversation and want to choose a request to send, use this quick reference with decision prompts.
- [Developer Guide](docs/manuals/development.md): When you have cloned ARW Source Checkout and are preparing to maintain implementation, documentation, Workflow Distribution, or a release candidate, use this to choose a maintenance path and validation entry point.
- [ARW long-term specification](docs/specs/agent-repository-workflow/spec.md): For stable product behavior, security boundaries, and long-term responsibilities (in Chinese).
- [Installation long-term specification](docs/specs/agent-repository-workflow-installation/spec.md): For Bootstrap, global configuration, installation directory, PATH ownership, upgrades, and uninstall contracts (in Chinese).
- [Reader documentation specification](docs/specs/arw-reader-documentation/spec.md): For the long-term responsibilities and routing boundaries of the root README and manuals (in Chinese).
- [Project context](CONTEXT.md): For names already established in ARW Source Checkout and their exclusions (in Chinese).
