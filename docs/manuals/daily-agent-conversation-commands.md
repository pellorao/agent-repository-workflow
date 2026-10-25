# Ready-to-Send Content for Agent Conversations

[English](daily-agent-conversation-commands.md) | [简体中文](daily-agent-conversation-commands.zh-CN.md)

This quick-reference manual is for people already working with an Agent who want to choose the next message for their current situation. Before copying an example, replace `XXX`, `NNNN:NN`, and any paths with actual values. These messages help you state goals and checkpoints clearly; they do not replace the project's complete Agent rules or Skills.

## Discuss and confirm requirements

When the goal is unclear, or a choice could affect product behavior, data, security, a public Interface, or long-term maintenance responsibility, you can send:

> I want to do XXX. Please use $grill-with-docs to discuss it with me until we reach agreement. Each round, explain the current facts, feasible options, your recommendation, and the effects, then wait for my reply.

`$grill-with-docs` asks questions over multiple rounds to test a plan and records terms or decisions that need to last only after you explicitly confirm them. If the description is too technical, you can add:

> I do not understand these terms yet. First explain what they mean in this specific situation using ordinary language, then continue with the questions.

If the Agent's proposal may exceed the current goal or designs too deeply for an initial implementation, you can first limit the scope and depth, leaving future extensions for when they are actually needed:

> Keep the proposal within the current goal; do not expand the scope on your own. Choose the shallowest implementation that meets the current need. Explain which extensions are deferred and what would make them necessary later.

When a recommendation seems reasonable but you are not sure it withstands counterexamples, ask the Agent to challenge its own judgment:

> Challenge the recommendation you just made. Find the assumptions, counterexamples, and side effects most likely to make it fail, then explain whether the original recommendation still holds or how it should change.

If a conclusion depends on project facts that have not been checked, send:

> First, investigate the current facts and authoritative sources for XXX without writing anything. Bring the evidence, uncertainty, and its effect on the current choice back to this discussion. Do not start implementation.

Before ending the discussion, you can check for omissions based on what is visible in the current conversation:

> List the decisions already confirmed, their important reasons, and the issues that remain unresolved. Report only what the currently visible record supports, and mark uncertain project facts as unknown.

When the discussion has produced decisions that should last, you can also check whether they are recorded in the durable documents that own those responsibilities. This check first gives you a proposal to review; it does not immediately edit the documents:

> Check the decisions and important reasons confirmed in the current session and whether they are recorded in the durable documents that own those responsibilities. First show me a checklist and a proposed supplement, and wait for my review and approval. After making the supplement, check again and show the final checklist.

When a process explanation is hard to follow, a list of facts alone may still leave sudden jumps. Ask the Agent to start with the trigger and explain the normal cause-and-effect sequence and recovery:

> I do not understand your process explanation. Start with what triggers the process and explain each step: why it happens, what input it needs, what action it takes, what result it produces, and how that result leads to the next step. If a step fails, also explain what has and has not happened and where to correct or retry.

## Shape a design and prototype

When overall agreement has been reached and you need to turn the discussion into an implementable specification, you can send:

> We have reached overall agreement on XXX. Please use $to-spec to organize the current conversation into an effort specification. Before publishing it, check whether the test boundaries match what I expect.

`$to-spec` combines what has already been discussed; it does not repeat requirements discovery. If a choice could still change an important result, return to the discussion instead of letting the specification decide it silently.

Use `$to-tickets` separately to split an agreed specification into implementation issues. First ask the Agent to show the vertical slices, blocking relationships, and governing basis for each issue. Review and approve the split before it is published to the tracker.

When written reasoning is not enough to judge a state model or UI presentation, ask for an explicitly disposable prototype:

> Please use $prototype to build a disposable prototype that answers only this question: XXX. First explain what the prototype can and cannot validate. When it is done, report the observations, unresolved decisions, and recommendations. Do not treat the prototype as a production implementation.

A prototype reduces design uncertainty. Whether the current platform also provides image generation, browser, or other display capabilities is not an ARW guarantee. If you need those capabilities, first confirm that they are actually available in the current session. Use them only as supporting input, not as confirmed product behavior.

If you want to explore a UI and narrow from a visual direction to an interactive page, you can connect image concepts, a page prototype, and human evaluation:

> First use imagegen to explore a UI design for the XXX module, then use $prototype to make an interactive page prototype. Show me each round and wait for human feedback; revise it based on that feedback until I explicitly confirm the design decision. The final prototype is still disposable reference material. Record confirmed and validated design decisions separately; do not treat the prototype as production implementation or implementation authorization.

When a design can meet its goal but its structure or process seems overly complex, ask the Agent to compare simpler options and include their side effects for you to judge:

> Check whether a simpler option can still meet the current goal. Compare its responsibilities, mechanisms, and maintenance costs with the current option, and list the concrete side effects of simplifying it. Side effects that do not change confirmed results and have no concrete risk may be marked as acceptable candidates, for me to decide.

When a proposal starts adding a process, gate, or evidence record for every internal step, ask it to keep only the independent boundaries required by the existing contract or a concrete risk:

> Check whether the current proposal creates unnecessary separate processes, validation, or evidence chains for internal steps. Keep only the boundaries required by the existing contract or a concrete foreseeable risk, and explain which result each retained boundary protects. Do not keep adding mechanisms just because a step could be split further.

When a design produces its final result through multiple implementation layers, prioritize checking the result users can observe instead of repeating checks across the whole internal chain:

> Prefer validating the complete design through its final observable result. Do not automatically make every intermediate representation, internal call, or implementation stage a separate checkpoint. Add an intermediate check only when the value itself is a public contract, durable evidence, authorization boundary, or security boundary, or when the final result cannot prove the governed property; explain why it is needed.

## Implement an existing issue

When an authorized implementation issue already exists, you can send:

> Please use $implement to implement issue:NNNN:NN.

The implementation gates address different concerns. Spec Readiness checks governance preparation before implementation. Code Review separately checks repository standards and governance requirements before a commit. Commit Audit checks the frozen commit candidate against the requirements. The Agent must not omit or rewrite these or other applicable gates on its own. Only an explicit user decision and applicable authorization from the user can create an exception.

If you are confident in the document or code prepared for commit and accept the risk of not having an independent review, you can explicitly grant an exception for this work only:

> I authorize this implementation and commit workflow to run without any Reviewers. This exception applies once only.

If the goal and implementation approach are clear and you do not need an independent review of the implementation design, but you are unsure about the final generated code or documents, you can keep only the two Reviewers that directly review the final candidate:

> I authorize this implementation and commit workflow to omit Spec Readiness and the requirements review, retaining only the Code Standards Reviewer. This exception applies once only.

You must actively send one of these authorizations based on the risk of the current work. The Agent must not infer an exception or reuse a one-time authorization for later work.

## Review and summarize this work

If you need to understand how much Reviewer work a commit workflow involved and what the reviews resolved, ask the Agent to summarize only from the currently available workflow records:

> Summarize the number of runs and available total time for each Reviewer type in this commit workflow, and the problems found and fixed. Use a table for Reviewer name, run count, and total time. After the table, give the available total time for the commit workflow. List each fixed problem with its description and the fix, then give the total number of problems.

When the same collaboration problem seems to recur and you want to improve a tool or rule used over time, first ask the Agent to analyze only the session records currently available for reading. A one-time mistake may not justify a permanent mechanism, so the analysis should separate recurring problems from one-time problems:

> Analyze only the session records currently available for reading. Find recurring collaboration problems and separate them from one-time problems. For each problem worth addressing long term, identify the specific Skill, Agent rule, or other tool that should change; propose a change; and explain its expected effect and side effects. Show me the analysis and plan first and wait for approval. Do not directly change any durable tool.
