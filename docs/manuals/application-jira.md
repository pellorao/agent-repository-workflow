# Distribute Work Across Repositories and Sync JIRA

[English](application-jira.md) | [简体中文](application-jira.zh-CN.md)

This manual is for readers who use a terminal and Git but are new to ARW's multi-repository workflow. It starts by helping you decide whether this route fits, explains the responsibilities of each repository and work record, and then walks through preparation, JIRA acceptance, cross-repository association, publication, synchronization, and Application-level validation. Start with the [project entry point](../../README.md) for general ARW installation and daily work. This manual does not repeat that route.

When you need an Agent to coordinate an Application repository, Module repositories, and JIRA, explicitly ask it to use the [`application-workflow` Skill (Chinese)](../../.agents/skills/application-workflow/SKILL.md). Repository configuration or a JIRA request does not trigger that Skill automatically. Invoking the Skill gives the Agent this route's working method; it does not replace the separate authorization required for file writes, Git operations, browser actions, or JIRA writes.

## Decide whether this route fits

Use this route when one JIRA Story requires work across multiple Git repositories, and you want one authoritative location for the overall requirements, each implementation repository to keep only its own changes and evidence, and one repository to aggregate the release result. This addresses the risk that cross-repository requirements get copied, statuses drift, and final validation lacks a single entry point.

That benefit has a clear cost. You must maintain the Application configuration and records on both sides, commit and push in dependency order, confirm each exact candidate before it causes an external effect, and run Application-level validation after all Modules are released. If a request changes only one repository, the ordinary ARW workflow is enough; do not add this coordination layer.

After deciding to use this route, identify:

- Which repository owns the requirements spanning Modules and coordinates JIRA. This is the Application Repository.
- Which repositories own actual product changes and their validation evidence. These are Module Repositories.
- Which JIRA project, Story type, and status changes represent a candidate, acceptance, and completion.
- Which remote and branch all Modules use to publish results that the Application can read.

Once these choices are clear, do not distribute code immediately. First understand why the two repository types need different work records.

## Understand the Application and Module responsibilities

The Application repository holds cross-repository design, the overall specification, work breakdown, and final integration validation. When the root `arw.config.json` contains a complete, valid `application` object, ARW treats the current repository as an Application-type repository and assigns it the Application Leader role. The Application Leader coordinates work but does not implement Module code in an Application Source Issue.

A Module repository holds one Module's product code, local implementation records, work history, and validation evidence. When the repository has no `application` object, ARW treats it as a Module-type repository and assigns it the Application Member role. These roles describe the work the current repository may perform; they do not authenticate the person operating it.

An Application repository stores an effort under `.scratch/<NNNN>-<effort-slug>/`, a group of work organized around one goal. Its `spec.md` states the result the whole effort must achieve, and files under `issues/` divide that result into work records. The four-digit effort number is a stable identity. A specification's command Canonical ID looks like `spec:0007`. A Canonical ID is ARW's stable identifier for a registered record used by commands.

For example, an Application effort could contain:

~~~text
.scratch/0007-payment-retry/spec.md
.scratch/0007-payment-retry/issues/01-prepare-billing.md
.scratch/0007-payment-retry/issues/02-validate-application.md
~~~

When the first Application work record is distributed to a Module named `billing`, the two sides form a one-to-one association:

~~~text
Module implementation issue: `issue:billing:0013:07`
Application source issue: `issue:payments:0007:01`
~~~

The first line is in the Application repository. It turns the original ordinary work record into an Application Source Issue. From then on, that record keeps only its place in the overall plan, its blocking relationships, the `Status:` mirrored from the Module, and current downstream corrections. The second line is in the Module repository. It records where the implementation came from; the Module implementation record still owns the actual changes, status, work history, and evidence.

A Module is usually placed in the Application repository as a Git submodule. A Git submodule is an independent Git repository at a path in the outer repository, with its own work tree, index, branch, commits, and remote. The outer repository records only the commit currently selected by the Module. This pointer is called a gitlink. Therefore, publish the Module commit before the Application records its gitlink and aggregated status.

The Application effort also names one local implementation record in `spec.md` that is not distributed, as the Application validation issue. It waits for the other work in the same effort to finish, then validates the integrated result across Modules. This keeps Module evidence in the Module, integration validation in the Application, and JIRA limited to the accepted and completed state of a published, validated result.

## Prepare the Application repository

Before reading JIRA or associating work records, prepare the Application configuration, display limit, credentials, and each Module branch. Configuration validation proves that the file structure is valid; it does not prove that remotes, branches, Git submodules, or the JIRA service are usable. Prepare those prerequisites separately.

### Configure participating repositories and JIRA

Before the first run of `arw workflow init`, create a complete `arw.config.json` at the Application repository root. This example connects the `payments` Application to `modules/billing` and specifies the exact project and status names in JIRA:

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

`application.name` is the Application name used in association fields and JIRA comments. `application.modules` lists participating implementation repositories. For each entry, `name` is the short name used in association identifiers, and `path` is a safe relative path from the Application repository root. Names may contain lowercase English letters, digits, and hyphens, and may not start with a hyphen. Module names and paths must be unique, and paths may not contain one another.

`application.submoduleRemote` and `application.submoduleDistributionBranch` together specify where every Module publishes results. They do not specify which remote or branch the Application repository itself uses.

`application.jira` specifies the JIRA URL, project, work item type, and three lifecycle statuses. `issueType` and each status must exactly match the strings returned by JIRA. `baseUrl` must be an absolute HTTP or HTTPS URL. It may include a path, but not a username, password, query, or fragment.

After preparing the configuration, run the separately authorized `arw workflow init` to initialize the repository workflow. Initialization writes repository workflow files and validates the existing configuration in the same transaction. For an already initialized Application repository, the following command only validates the current configuration and does not contact JIRA:

~~~text
arw workflow verify
~~~

Only `configVersion: 2` is supported; there is no migration from an older configuration version. Configuration validation does not check whether the configured remote, branch, or Module paths are actually usable. If the configuration is invalid, later Application operations stop before business writes. Correct it and validate again before continuing.

### Set the list display limit and access credentials

The global `config.json` in the ARW installation directory can set how many items `arw jira list` displays at once:

~~~json
{
  "jira": {
    "listLimit": 50
  }
}
~~~

`jira.listLimit` must be a positive safe integer and defaults to `50`. To temporarily display a different number, use `arw jira list --limit <N>`; this overrides the setting for that command only.

Except for `arw jira open`, JIRA commands read the nonempty `JIRA_ACCESS_TOKEN` from the current process and use Bearer authentication. Keep the token only in the current process environment. Do not write it to repository configuration, global configuration, specifications, work records, comments, logs, or commit messages.

In Bash, set it for the current terminal session with:

~~~text
export JIRA_ACCESS_TOKEN="<token>"
~~~

In PowerShell, use:

~~~powershell
$env:JIRA_ACCESS_TOKEN = "<token>"
~~~

Each JIRA REST request has a 10-second timeout, and ARW does not retry automatically. If the token is missing, the command stops before making a network request. If JIRA redirects a request, ARW also stops instead of sending the token to another address. After a command fails, first confirm the current JIRA state before deciding whether to retry; do not assume the request had no effect.

### Put Modules on the distribution branch

Association and synchronization require every configured Module to be on `application.submoduleDistributionBranch`. This keeps association records and later implementation results on the same release line agreed by the Application.

If all configured Modules need to switch together, first confirm that every Module work tree and Git index are clean, then run:

~~~text
arw submodule switch-branch <branch>
~~~

The command checks all Modules before switching any of them and does not fetch remote updates. If the target branch exists locally, it uses it. If it does not, the command creates a tracking branch only when that branch exists on the configured remote. A failed pre-write check switches no Module. If a switch fails after writing starts, the command tries to restore already-switched Modules in reverse order and reports each Module's final branch and `HEAD`. Use those final results to resolve the problem; do not infer that the repositories were restored from the original plan.

## Establish and accept the overall requirements from JIRA

Once the configuration, token, and JIRA connection are ready, first find candidate Stories, then read the complete details of the selected Story:

~~~text
arw jira list
arw jira list --limit 20
arw jira print PAY-123
arw jira open PAY-123
~~~

`arw jira list` strictly filters by the configured project, work item type, and candidate status, sorts by key, and reads one page. The output first shows the total number of matches JIRA returned, then the keys and titles on that page. If the total exceeds the displayed count, more candidates remain. `arw jira print` reads the item details and every required page. It prints complete JSON only if all pages succeed; a page failure does not produce partial output. `arw jira open` only attempts to open the page in the default browser. It does not read the token or confirm in advance that the item exists.

The commands only read; they do not create ARW files from JIRA descriptions automatically. Discuss the request with your Agent and confirm that the JIRA item's project, type, and status still exactly match the configuration. Then decide the Application effort name, specification, and work breakdown. One JIRA Story corresponds to one Application effort. The effort may initially contain only a specification, but it must have at least one work record before completion.

The first metadata line after the H1 in the Application `spec.md` stores the exact JIRA link:

~~~text
JIRA issue: [`PAY-123`](https://jira.example.test/browse/PAY-123)
~~~

The Agent prepares the full diff through the ordinary specification and work-record process. You review and approve the exact paths and content. Before accepting the JIRA item, the approved Application effort must already be committed and pushed, so the current branch's upstream contains exactly the same effort directory tree as `HEAD`. The upstream is the remote branch tracked by the current local branch; `HEAD` is the current local commit.

Commit, push, and JIRA acceptance form one continuous result. Before acting, the Agent shows you the exact staged paths, upstream, JIRA key, complete acceptance comment, and target status, and obtains one explicit authorization. If any input changes, authorization is required again. After the commit and push succeed, run:

~~~text
arw jira accept spec:0007
~~~

The command does not commit or push for the Agent. It first validates the effort directory tree in the upstream, then adds the exact acceptance comment, and finally moves the JIRA status from `candidateStatus` to `acceptedStatus`. Success means the overall requirements are published in Git and the exact comment and target status both exist in JIRA. If the comment succeeds but the status transition fails, the comment remains. Correct the cause and rerun the same command; it recognizes the existing comment and completes only the missing step.

## Associate implementation work with Module repositories

After the overall requirements are accepted, the Application Leader can distribute implementation work to Modules. First prepare an ordinary implementation work record in the Application repository and another in the target Module repository. The records may use different efforts and numbers, but must have exactly the same nonterminal `Status:`. A Module work record cites only applicable governance sources in its own repository. The Application specification does not become implementation authorization across repository boundaries.

Before association, confirm:

- Every configured Module is on the distribution branch.
- The affected Application effort and all related Module efforts have no unstaged or untracked content.
- Each repository's Git index is clean or contains an Agent-prepared staged baseline. You do not need to stage the two work records just to run the association command.
- Work records in one Module effort distributed from the same Application effort use the same Module effort.

The command always treats the Git index bytes in each repository at invocation time as the recovery baseline. It analyzes the full impact before writing and starts only if all replacements can be made.

Run this in the Application Repository:

~~~text
arw application associate issue:0007:01 issue:billing:0013:07
~~~

The first argument is the Application repository's local work-record Canonical ID. The second contains the configured Module name and that Module's work-record Canonical ID. The command analyzes all potentially affected records, then writes the association in both directions. If blocked work is in the same Module effort, the Module work record uses a local identifier. If the work remains in another repository, it uses `External dependency` with a nonempty explanation that points to the actual work location.

After success, the Application work record becomes an Application Source Issue, while the Module work record remains an ordinary implementation work record. All replacement content stays in the work tree, unstaged, for you to review and stage separately by affected effort. The command does not run `git add`, commit, or push.

If any association write fails, the command tries to restore all affected files to the bytes in each Git index at invocation time; the index itself stays unchanged. If recovery is incomplete, it lists the paths that still differ from the baseline. Review each path and restore the confirmed baseline before retrying the association. Do not stage or publish while the result is uncertain.

## Publish association results in the correct order

Association results span independent Git repositories. The Module is the source of implementation facts, and the Application records only Module commits that are already published. Therefore, publish in this order:

1. Review the complete association result in each affected Module and stage the relevant effort files.
2. Commit the distribution result in each Module separately.
3. Obtain separate authorization to push those commits to `application.submoduleRemote` and `application.submoduleDistributionBranch`.
4. Confirm that the configured remote contains each Module commit.
5. Return to the Application repository and review and stage the Application Source Issue replacements. If Modules are Git submodules, also review the gitlink observed in the outer repository.
6. Commit the result in the Application repository through the ordinary commit workflow.

This order makes the Application record only Module facts already present on the remote. If the Application is committed first, its gitlink or source record may point to a Module commit that other people cannot fetch.

Once the Module distribution commits have been pushed, both sides of the association are permanently frozen; do not modify them or propose a different target. The Application Source Issue's delivery target, requirements, acceptance criteria, and blockers also remain frozen. Only the later synchronization command may mirror its `Status:` and current `Downstream changes`. The Module work record's ordinary status, validation, and comments continue to change under the ordinary implementation workflow. The agreed scope may be corrected only for a real blocker, as described in the next section.

## Record necessary corrections during Module implementation

A published Module work record proceeds under its original requirements. Use the correction route only when there is a real problem in `## What to build`, `## Spec Requirement`, `## Acceptance criteria`, `## Blocked by`, or the same effort's Git-tracked `spec.md`, and that problem prevents the agreed scope from continuing. This is not a general route for expanding scope.

The Module Agent first explains the problem and the exact proposed change, then obtains your explicit authorization. You do not need to explicitly invoke `application-workflow` for this route, but the Agent must read that Skill's Module correction guide. `Application source issue:` is a hard lock: it cannot be modified, and the Agent cannot propose a new association target.

After authorization, the Agent changes the actual Module work record or local specification and maintains a single `### Downstream changes` at the end of that record's only `## Comments` section. Each current list item records the problem, necessary change, and user authorization. Remove a revoked or superseded correction. If there is no current correction, the only valid empty list is `- None.`. Ordinary comments always go before this final subsection.

After the changes, run the read-only check:

~~~text
arw module check-correction issue:0013:07
~~~

The command compares `HEAD` with the current work record on disk and any applicable tracked local specification. The current files may contain staged and unstaged changes together. The check requires at least one real change to protected content, an unchanged association, a changed `Downstream changes` section, and at least one current item in that list.

The command checks only structure and change scope. It does not decide whether the problem is real, authorized, or fully explained by the list item, and it does not write files or change the Git index. If it fails, correct the files based on the diagnostic and rerun it before starting the ordinary diff review and commit.

## Synchronize published Module results

The Application Leader can retrieve a shared status only after each Module completes a stage of work and pushes the commit to the configured distribution branch. Before synchronization, each configured Module's work tree and Git index must be clean, and its current branch must equal `application.submoduleDistributionBranch`.

Run this in the Application Repository:

~~~text
arw application sync
~~~

The command always processes every configured Module and every Application Source Issue; you cannot select a subset. It explicitly fetches the remote state of `submoduleRemote/submoduleDistributionBranch`, then proceeds based on each Module's local and remote relationship:

| Observed relationship | Result and next step |
| --- | --- |
| Local equals remote | Keep the Module as it is and check the next one. |
| Local is behind remote | Fast-forward only, then verify the final `HEAD` equals the remote tip. |
| Local is ahead of remote | Stop. Review the local commits, obtain push authorization, publish them, then retry. |
| Local and remote have diverged | Stop. Decide how to reconcile Git history and finish that work before retrying. |
| Fetch, fast-forward, or final verification fails | Keep confirmed results, correct the failure, then retry from the current state. |

If an earlier Module fast-forwards but a later Module fails, the completed fast-forward remains, and the corresponding gitlink in the Application may already show a change. The command does not move those Modules backward. It starts updating Application Source Issues only after every Module reaches its configured remote tip.

During that update, each Module work record's current `Status:` is mirrored as-is to its Application Source Issue, including nonterminal advancement or rollback, `completed`, and `wontfix`. The complete current `Downstream changes` from the Module replaces the old list on the Application side. If the Module has no current items, the Application side receives `- None.`. Ordinary Application comments stay before that final subsection. Synchronization does not copy ordinary Module work history or validation evidence, and it does not automatically change the Application specification or completion eligibility based on downstream corrections.

All Application Source Issue replacements are validated before any file is replaced. An invalid association or list structure blocks the entire batch. The file transaction uses the bytes in the Application Git index as its recovery baseline. On success, work-record replacements and gitlinks produced by Module fast-forwards remain unstaged, and the index stays unchanged. Review the batch before saving it through the ordinary commit workflow.

If a file write fails after the Application transaction starts, the command reports completed writes and each recovery result. If recovery is incomplete, first review every reported path and compare it with the index. Completed Module fast-forwards and their gitlink changes are not rolled back by this file transaction.

## Complete Application-level validation and update JIRA

Synchronization shows what each Module has published, but does not prove that the integrated product result is correct. Every effort that contains an Application Source Issue must name exactly one local Application validation issue in `spec.md`:

~~~text
Application validation issue: 02
~~~

This is an ordinary implementation work record in the Application repository that is not distributed. Its `Blocked by` contains every other work record in the same effort, so it starts only after all other work is `completed` or `wontfix`. The Application validation issue itself must end as `completed`; `wontfix` cannot complete the effort.

First run `arw application sync` and review the mirrored statuses and `Downstream changes`. Then perform the integration validation required by the Application validation issue and save only the necessary evidence in that local work record. `Downstream changes` helps the Application Leader decide whether higher-level work is needed, but it is not an extra completion condition.

Before completing JIRA, the approved full effort and validation evidence must already be committed and pushed, so the current branch's upstream contains exactly the same effort directory tree as `HEAD`. The Agent shows the exact staged paths, upstream, JIRA key, complete completion comment, and target status again, and obtains explicit authorization for this exact set of commits, pushes, and JIRA writes.

After the commit and push succeed, run:

~~~text
arw jira complete spec:0007
~~~

The command does not automatically run `arw application sync`, commit, or push. It recalculates completion eligibility from the committed configuration and effort files, then validates the effort directory tree in the live upstream. When eligible, it first creates the exact completion comment, then moves JIRA from `acceptedStatus` to `completedStatus`, and finally confirms again that both the comment and status exist.

After success, Module repositories still own their implementation and evidence, the Application effort owns the overall requirements and integration evidence, and JIRA owns the acceptance and completion status of the published result. Each layer keeps its own facts, so status does not need to be copied manually.

## Continue from the last confirmed result

Cross-repository Git and JIRA operations cannot be recovered with one general rollback. Successful commits, pushes, Module fast-forwards, JIRA comments, and status transitions remain in place. After a failure, identify the last result you can confirm and continue from the first incomplete step:

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

New commits, pushes, JIRA writes, and destructive recovery still require the applicable authorization. If the candidate bytes, upstream, or JIRA target changes, obtain authorization again before continuing.

This manual contains the operations and results needed to complete this newcomer route. The [long-term specification for multi-repository work and JIRA synchronization (Chinese)](../specs/agent-repository-workflow-application-jira/spec.md) owns the exact fields, complete behavior, and all boundaries. An Agent carrying out the work must also follow the current [repository rules (Chinese)](../../AGENTS.md) and the [`application-workflow` Skill (Chinese)](../../.agents/skills/application-workflow/SKILL.md).
