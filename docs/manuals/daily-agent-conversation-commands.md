# Ready-to-Send Content for Agent Conversations

[English](daily-agent-conversation-commands.md) | [简体中文](daily-agent-conversation-commands.zh-CN.md)

If you are already in an Agent conversation, this manual gives you ready-to-send messages for your next step so you can state goals, boundaries, and checkpoints clearly without losing control of the work. The sections follow the natural arc of a session: clarifying requirements, shaping a design or prototype, implementing an authorized issue, and reviewing how the session went. Before copying an example, replace `XXX`, `NNNN:NN`, and any paths with actual values. These prompts steer the conversation; they do not replace the project's complete Agent rules or Skills.

## Discuss and confirm requirements

Start here when your goal is still rough, or when a decision could affect product behavior, data, security, a public Interface, or long-term maintenance responsibility. Ask the Agent to work through the problem with you before anything is built:

> I want to do XXX. Please use $grill-with-docs to discuss it with me until we reach agreement. Each round, explain the current facts, feasible options, your recommendation, and the effects, then wait for my reply.

`$grill-with-docs` tests your plan through multiple rounds of questions, and records terms or decisions that need to last only after you explicitly confirm them. Because the Agent's questions or explanations can get too technical, you can ask it to translate the jargon first:

> I do not understand these terms yet. First explain what they mean in this specific situation using ordinary language, then continue with the questions.

Even when the language is clear, a process explanation can still be hard to follow if it reads like a flat list of facts with sudden jumps. To see how the process actually works, ask the Agent to trace the cause-and-effect chain from the initial trigger through normal execution and failure recovery:

> I do not understand your process explanation. Start with what triggers the process and explain each step: why it happens, what input it needs, what action it takes, what result it produces, and how that result leads to the next step. If a step fails, also explain what has and has not happened and where to correct or retry.

Once you understand the proposal, check its scope. If the Agent reaches beyond your current goal or designs too deeply for a first pass, pull it back to the shallowest implementation that works now and leave extensions for when they are actually needed:

> Keep the proposal within the current goal; do not expand the scope on your own. Choose the shallowest implementation that meets the current need. Explain which extensions are deferred and what would make them necessary later.

When a recommendation sounds reasonable on the surface, you may still wonder whether it holds up under edge cases. Ask the Agent to argue against its own judgment:

> Challenge the recommendation you just made. Find the assumptions, counterexamples, and side effects most likely to make it fail, then explain whether the original recommendation still holds or how it should change.

Sometimes a debate stalls because a choice depends on project facts that nobody has checked yet. Instead of guessing, send the Agent to inspect the codebase or authoritative sources read-only and bring the evidence back:

> First, investigate the current facts and authoritative sources for XXX without writing anything. Bring the evidence, uncertainty, and its effect on the current choice back to this discussion. Do not start implementation.

Before wrapping up the discussion, take stock of where you stand so nothing slips through the cracks. Ask for a summary based strictly on what is visible in the current conversation:

> List the decisions already confirmed, their important reasons, and the issues that remain unresolved. Report only what the currently visible record supports, and mark uncertain project facts as unknown.

Finally, if the discussion produced decisions that need to last beyond this task, make sure they land in the durable documents that own those responsibilities. This prompt asks for a checklist and a draft first so you can review the changes before any document is edited:

> Check the decisions and important reasons confirmed in the current session and whether they are recorded in the durable documents that own those responsibilities. First show me a checklist and a proposed supplement, and wait for my review and approval. After making the supplement, check again and show the final checklist.

## Shape a design and prototype

Once you and the Agent agree on the requirements, the next step is to turn that conversation into an implementable specification and, if needed, test uncertain ideas with a prototype or trim excess complexity.

To turn the agreed discussion into an effort specification, send:

> We have reached overall agreement on XXX. Please use $to-spec to organize the current conversation into an effort specification. Before publishing it, check whether the test boundaries match what I expect.

`$to-spec` consolidates what you have already discussed rather than starting a new requirements interview. So if an open choice could still change an important result, go back to the discussion instead of letting the specification decide it silently.

Sometimes written reasoning is not enough to judge a state model or a UI presentation. Before locking in the design, ask for an explicitly disposable prototype to answer a specific question:

> Please use $prototype to build a disposable prototype that answers only this question: XXX. First explain what the prototype can and cannot validate. When it is done, report the observations, unresolved decisions, and recommendations. Do not treat the prototype as a production implementation.

A prototype reduces design uncertainty, not production work. Whether your current platform also provides image generation, a browser, or other display capabilities is not an ARW guarantee. If you need those capabilities, first confirm that they are actually available in the current session, and treat their output only as supporting input rather than confirmed product behavior.

When you want to explore a UI from initial visual concepts to an interactive page, you can chain image generation, a page prototype, and your own feedback into one loop:

> First use imagegen to explore a UI design for the XXX module, then use $prototype to make an interactive page prototype. Show me each round and wait for human feedback; revise it based on that feedback until I explicitly confirm the design decision. The final prototype is still disposable reference material. Record confirmed and validated design decisions separately; do not treat the prototype as production implementation or implementation authorization.

As the design takes shape, watch out for over-engineering. If a design meets the goal but its structure or workflow feels too heavy, ask the Agent to lay out a simpler option alongside its concrete trade-offs so you can choose:

> Check whether a simpler option can still meet the current goal. Compare its responsibilities, mechanisms, and maintenance costs with the current option, and list the concrete side effects of simplifying it. Side effects that do not change confirmed results and have no concrete risk may be marked as acceptable candidates, for me to decide.

In the same vein, if a proposal starts adding a separate process, gate, or evidence record for every internal step, strip it back to the boundaries required by an existing contract or a concrete risk:

> Check whether the current proposal creates unnecessary separate processes, validation, or evidence chains for internal steps. Keep only the boundaries required by the existing contract or a concrete foreseeable risk, and explain which result each retained boundary protects. Do not keep adding mechanisms just because a step could be split further.

And when a design produces its final result through multiple internal layers, keep validation focused on what users can actually observe rather than checking every step along the internal chain:

> Prefer validating the complete design through its final observable result. Do not automatically make every intermediate representation, internal call, or implementation stage a separate checkpoint. Add an intermediate check only when the value itself is a public contract, durable evidence, authorization boundary, or security boundary, or when the final result cannot prove the governed property; explain why it is needed.

Once the specification is solid and simplified, use `$to-tickets` separately to split it into implementation issues. Ask the Agent to show the vertical slices, blocking relationships, and governing basis for each issue first, and review and approve that split before it is published to the tracker.

## Implement an existing issue

With an authorized implementation issue in the tracker, you are ready to build. Send:

> Please use $implement to implement issue:NNNN:NN.

During implementation and commit, ARW uses independent review gates that each check a different concern. Before implementation, Spec Readiness checks whether the governance preparation is complete. Later, for implementation commits that require Commit Audit, the workflow freezes a candidate and runs both Code Review axes in parallel: Code Standards checks repository standards, while the requirements review checks governance requirements. The Agent must not omit or rewrite these or any other applicable gates on its own; only your explicit decision and active authorization can create an exception.

If you are confident in the code or document prepared for commit and accept the risk of skipping independent review altogether, you can grant a one-time exception for the current work:

> I authorize this implementation and commit workflow to run without any Reviewers. This exception applies once only.

Wait to use that full bypass until you are sure about both the design and the output. If the goal and implementation approach are already clear, so you do not need an independent review of the implementation design, but you are still unsure about the final generated code or documents, you can keep only the two Reviewers that directly review the final candidate:

> I authorize this implementation and commit workflow to omit Spec Readiness and the requirements review, retaining only the Code Standards Reviewer. This exception applies once only.

Because every exception carries risk, you must actively send one of these authorizations yourself for the task at hand. The Agent must never infer an exception on its own or reuse a one-time authorization for later work.

## Review and summarize this work

After the commit workflow finishes, you may want to see how much review effort it took and what the Reviewers actually caught. Ask the Agent to tally the run counts, time spent, and fixes strictly from the workflow records available right now:

> Summarize the number of runs and available total time for each Reviewer type in this commit workflow, and the problems found and fixed. Use a table for Reviewer name, run count, and total time. After the table, give the available total time for the commit workflow. List each fixed problem with its description and the fix, then give the total number of problems.

Looking beyond a single commit, if the same collaboration friction keeps coming up across sessions, you can use the session records to improve your rules or Skills. Because a one-off mistake does not justify a permanent new mechanism, ask the Agent to separate recurring patterns from isolated slips and propose changes before touching any durable tool:

> Analyze only the session records currently available for reading. Find recurring collaboration problems and separate them from one-time problems. For each problem worth addressing long term, identify the specific Skill, Agent rule, or other tool that should change; propose a change; and explain its expected effect and side effects. Show me the analysis and plan first and wait for approval. Do not directly change any durable tool.
