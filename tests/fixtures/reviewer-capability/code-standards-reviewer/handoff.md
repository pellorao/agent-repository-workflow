{{isolationPrompt}}

Read the canonical Role from this exact path relative to the scenario root: docs/agents/roles/code-standards-reviewer.md. Review the staged HEAD-to-index comparison using the applicable Agent instructions inside this scenario Repository and the canonical Role's implementation quality standards. No separate Standards input set is supplied. No additional validation facts are supplied for this capability scenario. The included changed paths are exactly {{includedChangedPaths}}.

From the scenario root, use `git diff --cached --no-ext-diff HEAD --` for the complete staged comparison and `git show :<repository-relative-path>` when exact staged bytes for one path are needed. Use staged bytes as comparison evidence.

Write the complete review to the bound resultPath: {{resultPath}}. After completing the review and writing the required final file content, return only {"status":"ready"}. If the review cannot be completed, return only {"status":"incomplete","reason":"..."} with the exact condition.
