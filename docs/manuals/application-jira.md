# Distribute Work Across Repositories and Sync JIRA

[English](application-jira.md) | [简体中文](application-jira.zh-CN.md)

When a single JIRA Story requires changes across multiple Git repositories, tracking requirements, implementation status, and integration testing by hand is slow and error-prone. ARW's multi-repository workflow solves this by giving one Application repository ownership of the overall requirements, JIRA coordination, and final integration validation, while each Module repository keeps only its own code changes and test evidence.

This manual is for readers who are comfortable with a terminal and Git, and who already know single-repository ARW setup and daily work from the [project entry point](../../README.md) (which this manual does not repeat). It walks you through the multi-repository workflow from start to finish: deciding whether this approach fits your task, understanding how Application and Module work records connect, preparing your repositories, accepting a JIRA Story, associating and publishing work across repositories, syncing Module progress back to the Application, and completing Application-level validation and JIRA updates.

Whenever you want an Agent to coordinate an Application repository, Module repositories, and JIRA, explicitly ask it to use the [`application-workflow` Skill (Chinese)](../../.agents/skills/application-workflow/SKILL.md). Neither repository configuration nor a JIRA request triggers that Skill automatically. Invoking the Skill gives the Agent this workflow's operating method, though it does not replace the separate authorizations required for file writes, Git operations, browser actions, or JIRA writes.

## Decide whether this route fits

Use this workflow when one JIRA Story spans multiple Git repositories and you want:

- One authoritative home for cross-repository requirements, so specifications do not get copied across repositories.
- Each implementation repository to keep only its own code changes and validation evidence.
- One repository to aggregate published results and provide a single entry point for final validation, preventing status drift.

Because this coordination guarantees consistency across independent repositories, it carries a clear cost: you must maintain the Application configuration and work records on both sides, commit and push in strict dependency order, approve each exact candidate before it causes any external effect, and run Application-level validation after all Modules are released. If a request changes only one repository, stick to the ordinary ARW workflow and skip this coordination layer.

Once you decide to use this route, identify four things before touching any files:

- **Application Repository:** Which repository owns the cross-Module requirements and coordinates JIRA.
- **Module Repositories:** Which repositories own the actual product changes and their local validation evidence.
- **JIRA lifecycle:** Which JIRA project, Story type, and status transitions represent a candidate, acceptance, and completion.
- **Module publication target:** Which remote and branch all Modules use to publish results that the Application can read.

With these choices settled, do not distribute code right away. First understand how the Application and Module repositories divide their work records so you know what lives where.

## Understand the Application and Module responsibilities

ARW divides multi-repository work between two repository types, determined by the root `arw.config.json`:

- **Application repository (`Application Leader` role):** Holds cross-repository design, the overall specification, the work breakdown, and final integration validation. When the root `arw.config.json` contains a complete, valid `application` object, ARW treats the repository as an Application-type repository and assigns it the Application Leader role. The Application Leader coordinates work across repositories, but never implements Module code inside an Application Source Issue.
- **Module repository (`Application Member` role):** Holds one Module's product code, local implementation records, work history, and validation evidence. When a repository has no `application` object, ARW treats it as a Module-type repository and assigns it the Application Member role. These roles describe what work the current repository may perform; they do not authenticate the person operating it.

In an Application repository, each body of work organized around a single goal is stored as an effort under `.scratch/<NNNN>-<effort-slug>/`. Inside that directory, `spec.md` defines the overall result the effort must achieve, and files under `issues/` break that goal into individual work records. The four-digit effort number serves as a stable identity, and commands refer to registered records using a stable Canonical ID such as `spec:0007`.

For example, an Application effort might contain:

~~~text
.scratch/0007-payment-retry/spec.md
.scratch/0007-payment-retry/issues/01-prepare-billing.md
.scratch/0007-payment-retry/issues/02-validate-application.md
~~~

When you distribute the first Application work record (`01-prepare-billing.md`) to a Module named `billing`, ARW links the two repositories with a one-to-one association:

~~~text
Module implementation issue: `issue:billing:0013:07`
Application source issue: `issue:payments:0007:01`
~~~

Each line lives in a different repository and establishes a clear boundary:

- The first line (`Module implementation issue: ...`) is written into the Application repository's work record, turning that ordinary work record into an **Application Source Issue**. From that point on, the Application Source Issue retains only its place in the overall plan, its blocking relationships, the `Status:` mirrored from the Module, and any current downstream corrections.
- The second line (`Application source issue: ...`) is written into the Module repository's work record. It records where the task originated, while the Module work record continues to own the actual code changes, status, work history, and validation evidence.

Aside from distributed records, the Application effort also designates one local, undistributed implementation record in `spec.md` (`02-validate-application.md` in the example above) as the **Application validation issue**. It waits until all other work in the same effort finishes, then validates the integrated result across all Modules. That way, Module evidence stays in the Module, integration validation stays in the Application, and JIRA reflects only the accepted and completed state of a published, validated result.

In practice, each Module is usually mounted inside the Application repository as a Git submodule. A Git submodule is an independent Git repository nested at a path inside the outer repository, with its own work tree, index, branch, commits, and remote. The outer Application repository does not copy the Module's files; it records only the exact Module commit currently checked out, a pointer called a **gitlink**. Because the Application records a gitlink to a Module commit, you must always publish the Module commit first before the Application records that gitlink and its aggregated status.

## Prepare the Application repository

With the repository roles and record structure clear, your next step is to prepare the local environment. Before you can read JIRA or associate work records, four pieces must be ready: the Application configuration (`arw.config.json`), the JIRA list display limit, your JIRA access credentials, and the distribution branch in each Module. Note that ARW's configuration validation only checks whether the configuration file itself is well-formed; it does not verify that your Git remotes, branches, submodules, or JIRA service are actually reachable, so you must prepare those prerequisites separately.

### Configure participating repositories and JIRA

Before running `arw workflow init` for the first time, create a complete `arw.config.json` at the root of the Application repository. The example below connects the `payments` Application to `modules/billing` and declares the exact project key, issue type, and status names used in JIRA:

~~~json
{
  "configVersion": 2,
  "application": {
    "name": "payments",
    "submoduleRemote": "origin",
    "submoduleDistributionBranch": "dev",
    "modules": [
      {
        "name": "billing",
        "path": "modules/billing"
      }
    ],
    "jira": {
      "baseUrl": "https://jira.example.test/",
      "projectKey": "PAY",
      "issueType": "Story",
      "candidateStatus": "Candidate",
      "acceptedStatus": "Accepted",
      "completedStatus": "Completed"
    }
  }
}
~~~

Each section of `arw.config.json` sets a specific coordination rule:

- `configVersion`: Only `configVersion: 2` is supported; there is no migration path from an older configuration version.
- `application.name` and `application.modules`: `application.name` is the Application identifier used in association fields and JIRA comments. `application.modules` lists the participating implementation repositories: each entry's `name` is the short identifier used in association IDs, and `path` is a safe relative path from the Application repository root. Names may contain only lowercase English letters, digits, and hyphens, and may not start with a hyphen. Module names and paths must be unique, and Module paths may not be nested inside one another.
- `application.submoduleRemote` and `application.submoduleDistributionBranch`: Together, these specify the remote and branch where every Module publishes its results. They do not dictate which remote or branch the Application repository itself uses.
- `application.jira`: Defines the JIRA server URL, project key, work item type, and three lifecycle statuses. `issueType` and each status name must match the strings returned by JIRA character for character. `baseUrl` must be an absolute HTTP or HTTPS URL; it may include a path, but must not include a username, password, query string, or fragment.

Once `arw.config.json` is in place, run the separately authorized `arw workflow init` to initialize the repository workflow; initialization writes the repository workflow files and validates your configuration in a single transaction. If the Application repository is already initialized, you can validate the current configuration at any time without contacting JIRA by running:

~~~text
arw workflow verify
~~~

Remember that configuration validation does not check whether the configured remote, branch, or Module paths are usable on disk or over the network. If `arw.config.json` itself is invalid, subsequent Application commands will stop before making any business writes; fix the configuration and run `arw workflow verify` again before continuing.

### Set the list display limit and access credentials

Next, configure how ARW queries and authenticates with JIRA. In the ARW installation directory, the global `config.json` controls how many items `arw jira list` displays per page:

~~~json
{
  "jira": {
    "listLimit": 50
  }
}
~~~

`jira.listLimit` must be a positive safe integer and defaults to `50`. To override that limit for a single run without editing `config.json`, pass `arw jira list --limit <N>`.

For authentication, every JIRA command except `arw jira open` reads a nonempty `JIRA_ACCESS_TOKEN` environment variable from the current process and sends it via Bearer authentication. Keep this token strictly in your current process environment; never write it to repository configuration, global configuration, specifications, work records, comments, logs, or commit messages.

In Bash, set the token for your current terminal session with:

~~~text
export JIRA_ACCESS_TOKEN="<token>"
~~~

In PowerShell, set it with:

~~~powershell
$env:JIRA_ACCESS_TOKEN = "<token>"
~~~

Each JIRA REST request has a 10-second timeout, and ARW does not retry failed requests automatically. If `JIRA_ACCESS_TOKEN` is missing, the command stops before making any network request. If the JIRA server responds with an HTTP redirect, ARW also stops rather than forwarding your token to another address. Because a network error can occur after the server processes a request, always check the current state in JIRA after a command fails before deciding whether to retry; do not assume a failed request had no effect.

### Put Modules on the distribution branch

Finally, make sure every configured Module repository is checked out on `application.submoduleDistributionBranch`. Both work-record association and later synchronization require all Modules to sit on this branch so that association links and implementation commits stay on the single release line agreed by the Application.

To switch all configured Modules to the distribution branch at once, first confirm that every Module's work tree and Git index are clean, then run:

~~~text
arw submodule switch-branch <branch>
~~~

This command checks every configured Module before switching any of them, and it does not fetch from the remote. If `<branch>` already exists locally in a Module, ARW checks it out directly; if it does not exist locally, ARW creates a local tracking branch only when `<branch>` already exists on the configured remote.

If any pre-write check fails, no Module is switched. If an error occurs after switching has begun, the command attempts to restore the already-switched Modules in reverse order and prints each Module's final branch and `HEAD`. When recovering from a failed switch, inspect those reported final states rather than assuming the rollback restored every repository to its starting point.

## Establish and accept the overall requirements from JIRA

Once your configuration, token, and Module branches are ready, you can pull a candidate Story from JIRA and turn it into an Application effort. Start by listing the available candidate Stories and inspecting the one you want to accept:

~~~text
arw jira list
arw jira list --limit 20
arw jira print PAY-123
arw jira open PAY-123
~~~

Each read command serves a distinct purpose:

- `arw jira list` filters strictly by the configured project, work item type, and `candidateStatus`, sorts matches by key, and fetches a single page. Its output shows the total match count returned by JIRA followed by the keys and titles on the current page (titles are truncated to a 100-column layout by default; pass `arw jira list --full` or `-f` to print full titles). If the total match count is larger than the number of items displayed, more candidates remain beyond the first page.
- `arw jira print` fetches the full item details across all required pages and prints complete JSON only when every page succeeds; if any page fails, it outputs nothing rather than partial data.
- `arw jira open` opens the item in your default browser without reading `JIRA_ACCESS_TOKEN` or verifying beforehand that the item exists.

These commands only read from JIRA; they never generate ARW files automatically from a JIRA description. Work with your Agent to review the Story, confirm that its JIRA project, type, and status still match `arw.config.json` exactly, and decide on the Application effort name, specification (`spec.md`), and work breakdown. One JIRA Story maps to one Application effort. At acceptance time, the effort may start with only `spec.md`, though it must contain at least one work record before the effort can be completed.

To link the Application effort back to JIRA, place the exact JIRA link on the first metadata line immediately after the H1 heading in the Application `spec.md`:

~~~text
JIRA issue: [`PAY-123`](https://jira.example.test/browse/PAY-123)
~~~

Your Agent prepares the full diff through the ordinary specification and work-record workflow for you to review and approve. Before you can accept the Story in JIRA, that approved Application effort must already be committed and pushed so that your current branch's upstream (the remote branch tracked by your local branch) contains the exact same effort directory tree as local `HEAD` (your current local commit).

Because committing, pushing, and accepting the Story in JIRA form one continuous external action, the Agent first shows you the exact staged paths, upstream, JIRA key, complete acceptance comment, and target status, and asks for a single explicit authorization. If any of those inputs change, the Agent must obtain fresh authorization. After the commit and push succeed, run:

~~~text
arw jira accept spec:0007
~~~

`arw jira accept` does not commit or push on the Agent's behalf. Instead, it verifies the effort directory tree in the upstream branch, posts the exact acceptance comment to JIRA, and transitions the JIRA status from `candidateStatus` to `acceptedStatus`. When it succeeds, the overall requirements are published in Git and both the acceptance comment and `acceptedStatus` are recorded in JIRA. Because posting the comment and changing the status are separate requests, if the comment succeeds but the status transition fails, the comment stays in JIRA; fix the cause of the failure and rerun `arw jira accept spec:0007`, which detects the existing comment and completes only the missing status transition.

## Associate implementation work with Module repositories

After the overall requirements are accepted in JIRA, the Application Leader can distribute individual implementation tasks to the Module repositories. First, prepare an ordinary implementation work record in the Application repository and a matching ordinary implementation work record in the target Module repository. The two records may use different effort numbers and issue numbers, but they must have the exact same nonterminal `Status:`. Keep repository governance strictly local: a Module work record cites only governance sources within its own repository, because the Application specification never serves as implementation authorization across repository boundaries.

Before running the association command, verify four preconditions:

- Every configured Module is checked out on `application.submoduleDistributionBranch`.
- Neither the affected Application effort nor any related Module effort has unstaged changes or untracked files.
- Each repository's Git index is either clean or holds an Agent-prepared staged baseline. Any new or modified work records must be staged in the index as part of that recovery baseline before you run the association command.
- Any work records distributed from the same Application effort to the same Module belong to the same Module effort.

Staging new or modified records beforehand matters because `arw application associate` uses the exact bytes in each repository's Git index at invocation time as its recovery baseline. The command analyzes the full impact across all affected records before touching disk and starts writing to the work tree only if every replacement can succeed.

From the Application Repository, run:

~~~text
arw application associate issue:0007:01 issue:billing:0013:07
~~~

The first argument (`issue:0007:01`) is the local work-record Canonical ID in the Application repository; the second (`issue:billing:0013:07`) combines the configured Module name (`billing`) with that Module's work-record Canonical ID (`issue:0013:07`). After analyzing all potentially affected records, the command writes the two-way association into both repositories. When rewriting blocking relationships on the Module work record, if a blocker lives in the same Module effort, the Module record references its local identifier; if the blocker remains in another repository, the Module record writes `External dependency` with a nonempty explanation pointing to where that work actually lives.

When the command succeeds, the Application work record becomes an Application Source Issue while the Module work record remains an ordinary implementation work record. All modified files stay unstaged in each repository's work tree so you can review and stage them per affected effort; the command does not run `git add`, commit, or push.

If any write fails during association, the command attempts to restore every affected file to the bytes stored in each repository's Git index at invocation time, leaving the index itself unchanged. If recovery is incomplete, the command lists the file paths that still differ from the baseline. Inspect each listed path, restore the confirmed baseline, and re-verify the clean-state and branch preconditions before retrying; never stage or publish while the work tree is in an uncertain state.

## Publish association results in the correct order

Because the association links independent Git repositories, and the Application repository may only record Module commits that are already published, you must publish the Module changes before committing the Application repository:

1. Review the complete association changes in each affected Module and stage the relevant effort files.
2. Commit the distribution changes in each Module separately.
3. Obtain separate authorization to push those Module commits to `application.submoduleRemote` and `application.submoduleDistributionBranch`.
4. Confirm that the configured remote now contains each Module commit.
5. Return to the Application repository, and review and stage the Application Source Issue replacements. If the Modules are mounted as Git submodules, also review the updated gitlink in the outer repository.
6. Commit the result in the Application repository through the ordinary commit workflow.

Following this sequence guarantees that the Application repository only ever points to Module commits that anyone else can already fetch from the remote. If you committed the Application first, its gitlink or Application Source Issue could reference a local Module commit that has not been pushed.

Once the Module distribution commits are pushed to the remote, both sides of the association are permanently frozen: you may not edit the association fields or propose a different target. On the Application side, the Application Source Issue's delivery target, requirements, acceptance criteria, and blockers are also frozen; from then on, only `arw application sync` may update its mirrored `Status:` and `Downstream changes`. On the Module side, the work record's status, validation evidence, and comments continue to evolve through the normal implementation workflow, while its agreed scope stays locked unless a real blocker requires a formal correction as described next.

## Record necessary corrections during Module implementation

Once published, a Module work record is meant to be implemented against its original requirements. However, if implementation reveals a real flaw in `## What to build`, `## Acceptance criteria`, `## Blocked by`, or the same effort's Git-tracked `spec.md` that prevents the agreed scope from moving forward, you can record a formal downstream correction in the Module. Use this route only to resolve a genuine blocker to the agreed work, never as a shortcut for expanding scope.

To make a correction, the Module Agent first explains the problem and the exact change it proposes, then obtains your explicit authorization. You do not need to explicitly invoke `application-workflow` for a Module correction, but the Agent itself must read that Skill's Module correction guide. Even during a correction, `Application source issue:` remains a hard lock: it cannot be modified, and the Agent may not propose a new association target.

After you authorize the correction, the Agent updates the Module work record or tracked local `spec.md` and maintains a single `### Downstream changes` subsection at the very end of the record's only `## Comments` section (keeping all ordinary comments before that final subsection). Each active list item in `### Downstream changes` records the current problem, the necessary change, and your authorization. Any revoked or superseded correction must be removed; when no active correction remains, the only valid empty list is `- None.`.

After editing the files, run the read-only verification command in the Module repository:

~~~text
arw module check-correction issue:0013:07
~~~

This command compares `HEAD` against the current work record on disk and any applicable Git-tracked local `spec.md` (evaluating staged and unstaged changes together). To pass, it requires at least one real change to protected content, an unchanged association, a modified `Downstream changes` section, and at least one current item in that list.

Note that `arw module check-correction` validates only structure and change scope: it does not judge whether the problem is genuine, authorized, or completely explained by the list item, and it never writes files or modifies the Git index. If the check fails, fix the files according to the diagnostic output and rerun the check before starting your normal diff review and commit.

## Synchronize published Module results

As each Module finishes a stage of work and pushes its commits to `application.submoduleDistributionBranch`, the Application Leader pulls those shared updates back into the Application repository. Before running synchronization, make sure every configured Module has a clean work tree and Git index and is checked out on `application.submoduleDistributionBranch`.

From the Application Repository, run:

~~~text
arw application sync
~~~

`arw application sync` always processes every configured Module and every Application Source Issue together; you cannot sync a subset. It first fetches `submoduleRemote/submoduleDistributionBranch` for each Module, then acts on how each Module's local branch compares to the remote:

| Observed relationship | Result and next step |
| --- | --- |
| Local equals remote | Keep the Module as it is and check the next one. |
| Local is behind remote | Fast-forward only, then verify the final `HEAD` equals the remote tip. |
| Local is ahead of remote | Stop. Review the local commits, obtain push authorization, publish them, then retry. |
| Local and remote have diverged | Stop. Decide how to reconcile Git history and finish that work before retrying. |
| Fetch, fast-forward, or final verification fails | Keep confirmed results, correct the failure, then retry from the current state. |

If an earlier Module fast-forwards cleanly and a later Module stops on an error, the completed fast-forward stays in place (so the corresponding gitlink in the Application repository may already show a change). The command never rewinds a Module backward; it begins updating Application Source Issues only after every configured Module has reached its remote tip.

Once all Modules are at their remote tips, ARW updates the Application Source Issues:

- Each Module work record's current `Status:` is mirrored as-is to its Application Source Issue, including nonterminal advancement or rollback, `completed`, and `wontfix`.
- The Module's complete current `Downstream changes` list replaces the old list on the Application side (or writes `- None.` when the Module has no current items), while ordinary Application comments stay above that final subsection.
- Synchronization does not copy ordinary Module work history or validation evidence, nor does it automatically alter the Application specification or completion eligibility based on downstream corrections.

Before modifying any file on disk, ARW validates every Application Source Issue replacement; a single broken association or malformed list structure blocks the entire batch. The file transaction uses the bytes in the Application repository's Git index as its recovery baseline. When the transaction succeeds, both the work-record replacements and any gitlink updates from Module fast-forwards remain unstaged in the work tree, leaving the Git index unchanged. Review the batch and commit it through the ordinary commit workflow.

If a file write fails after the Application file transaction begins, the command reports which writes completed and the recovery result for each file. When all files recover cleanly, the Application files return to the index baseline; if recovery is incomplete, inspect every reported path and compare it against the Git index. Completed Module fast-forwards and their resulting gitlink changes are not rolled back by the Application file transaction.

## Complete Application-level validation and update JIRA

Synchronizing brings each Module's published status into the Application repository, but individual Module results do not prove that the integrated system works as a whole. For that reason, every Application effort containing an Application Source Issue must designate exactly one local, undistributed work record in `spec.md` as its validation issue:

~~~text
Application validation issue: 02
~~~

This Application validation issue is an ordinary implementation work record inside the Application repository that is never distributed to a Module. Its `Blocked by` field lists every other work record in the same effort, so it cannot start until all sibling work records reach `completed` or `wontfix`. Furthermore, the Application validation issue itself must finish as `completed`; marking it `wontfix` cannot complete the effort.

To complete the effort and update JIRA:

1. Run `arw application sync` and review the mirrored Module statuses and `Downstream changes`. (`Downstream changes` helps the Application Leader judge whether higher-level follow-up work is needed, though it does not act as an extra completion condition.)
2. Run the integration validation required by the Application validation issue and record only the necessary validation evidence in that local work record.
3. Commit and push the approved effort and validation evidence so that your current branch's upstream contains the exact same effort directory tree as local `HEAD`. As with JIRA acceptance, the Agent shows you the exact staged paths, upstream, JIRA key, complete completion comment, and target status, and obtains explicit authorization for this exact set of commits, pushes, and JIRA writes.
4. After the commit and push succeed, run:

~~~text
arw jira complete spec:0007
~~~

`arw jira complete` does not automatically run `arw application sync`, commit, or push. Instead, it recalculates completion eligibility from the committed configuration and effort files, verifies the effort directory tree in the live upstream, posts the exact completion comment to JIRA, transitions the JIRA Story from `acceptedStatus` to `completedStatus`, and confirms again that both the comment and status exist in JIRA.

Once `arw jira complete` succeeds, each layer holds its own authoritative facts without manual status copying: the Module repositories own their code and local evidence, the Application effort owns the overall specification and integration evidence, and JIRA reflects the accepted and completed state of the published result.

## Continue from the last confirmed result

Because cross-repository Git operations and JIRA requests span independent systems, no single rollback can undo a partially completed workflow. Commits, pushes, Module fast-forwards, JIRA comments, and JIRA status transitions that have already succeeded stay in place. Whenever an operation fails mid-way, identify the last result you can confirm and resume from the first incomplete step:

| Failure point | Fact to retain or confirm | Recovery action |
| --- | --- | --- |
| Configuration or pre-write business check | The command has not changed business files. | Correct configuration, branch, clean state, or input, then rerun the applicable check. |
| File write by `application associate` | The Git index is unchanged; diagnostics list any unrecovered paths. | Compare each named path with the index, review and restore the exact baseline, then associate again. |
| Module branch switch | The command reports each Module's final branch and `HEAD`. | Repair from the observed final state; do not assume reverse recovery completed. |
| Module convergence in `application sync` | Earlier completed fast-forwards remain. | Correct the later Module's ahead, divergence, or access problem, then retry full synchronization from the current state. |
| Application file transaction in `application sync` | The index is unchanged; Module fast-forwards and gitlink changes remain. | Review each recovery result, compare unrecovered paths with the index, then retry synchronization. |
| Uncertain commit or push result | Successful Git writes are not automatically undone. | Read local `HEAD`, upstream, Module distribution branches, and gitlinks; continue from the first unconfirmed step. |
| JIRA comment or status update | Comments and status are two separate requests. | Read JIRA again. Keep any exact comment or target status that already exists, then rerun the same `accept` or `complete` command to fill in the missing part. |
| Uncertain HTTP request result | An error response does not prove that the remote write did not happen. | Read the current Git and JIRA state before another write. Do not delete a valid comment or reverse a valid status. |

Any new commit, push, JIRA write, or destructive recovery step still requires its applicable authorization. If your recovery changes the candidate bytes, upstream, or JIRA target, obtain fresh authorization before continuing.

This manual covers all the operations needed to run the multi-repository and JIRA workflow. The [long-term specification for multi-repository work and JIRA synchronization (Chinese)](../specs/agent-repository-workflow-application-jira/spec.md) owns the exact field rules, complete behavior, and architectural boundaries. Any Agent carrying out the work must also follow the current [repository rules (Chinese)](../../AGENTS.md) and the [`application-workflow` Skill (Chinese)](../../.agents/skills/application-workflow/SKILL.md).
