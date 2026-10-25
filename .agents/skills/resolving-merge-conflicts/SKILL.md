---
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
name: resolving-merge-conflicts
---

1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the merge's stated goal and note the trade-off. Do **not** invent new behaviour. Always resolve; never `--abort`.

4. Discover the project's **automated checks** and run them — typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Hand off Git writes.** If you are a subagent, report the resolved paths, checks, and remaining conflict state to the Main Agent. The Main Agent stages only the authorized paths under `docs/agents/agent-writes.md`. Merge or rebase continuation can create a commit, so the Main Agent handles it under the applicable Git authorization. Enter the `commit` Skill workflow only after the user explicitly requests a Git commit.
