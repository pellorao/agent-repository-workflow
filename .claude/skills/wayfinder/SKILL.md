---
description: Plan a huge chunk of work — more than one agent session can hold — as a shared map of decision tickets on your issue tracker, and resolve them until the way to the destination is clear.
disable-model-invocation: true
name: wayfinder
---

A loose idea has arrived — too big for one agent session, and wrapped in fog: the way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map** on the repo's issue tracker, then works its **decision tickets** — questions whose resolution is a decision, not slices of a build to execute — until the route is clear.

The destination varies per effort, and naming it is the first act of charting — it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place like a data-structure migration. The map is domain-agnostic — engineering work, course content, whatever fits the shape.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the map is done when the way is clear — nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the map and it's time to hand off. An effort can override this in its **Notes** — carrying execution into the map itself — but absent that, produce decisions, not deliverables.

Resolving a Wayfinder issue does not generate Gate 1 or Gate 2. Record its answer and terminal status through the tracker workflow. When the user asks for a Git commit, follow the candidate classification in the `commit` Skill. A candidate containing only eligible non-implementation content uses its mechanical non-implementation commit workflow. A candidate containing implementation work uses the implementation issue workflow for the complete candidate. Stop when content is unclassified; do not infer that it is implementation work.

## Refer by name

Every map and ticket has a **name**: its title. In everything the human reads, including narration and the map's Decisions-so-far, refer to it by that name, never by a bare id, number, or slug. Names read at a glance; use the tracker's identifier or link alongside the name when a precise reference is needed.

## The Map

The map is one canonical map artifact on this repo's issue tracker. Its decision tickets are Wayfinder issues in the same effort. Read the `issue-tracking` Skill before creating or updating either artifact.

The map is an **index**, not a store. It lists the decisions made and points at the tickets that hold their detail; a decision lives in exactly one place — its ticket — so the map never restates it, only gists it and links.

**Where the map, tickets, blocking, claiming, and frontier queries physically live is tracker-specific.** The issue tracker should have been provided to you. If it is missing, run read-only `arw workflow verify`. If verification reports that the Repository is not initialized, tell the user to run `arw workflow init` separately. Use the local tracker's Wayfinding rules for how _this_ repo expresses these operations. Do not select or write a fallback tracker configuration from this skill.

### The map body

The whole map at low resolution, loaded once per session. Open tickets are **not** listed in Decisions-so-far; find the current frontier through the local tracker.

```markdown
## Destination

<what reaching the end of this map looks like — the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index: one line per resolved in-scope decision ticket, enough to judge relevance before reading the linked detail -->

- [<resolved in-scope ticket title>](link): <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; resolved, never graduates -->
```

### Tickets

Each ticket is a Wayfinder issue in the map's effort; its tracker id is its identity. Size the question to one agent session. The local tracker owns the issue fields, question heading, answer location, and terminal status.

Choose `research`, `prototype`, `grilling`, or `task` according to [Ticket Types](#ticket-types), and record the type through the local tracker. Claim the ticket before work and record dependencies through that tracker. A ticket is **unblocked** when every ticket blocking it is resolved; the **frontier** is the unresolved, unblocked, unclaimed issues in the effort, at the edge of the known. Link assets created while resolving a ticket from its issue.

## Ticket Types

Every ticket is either **HITL** — human in the loop, worked *with* a human who speaks for themselves — or **AFK**, driven by the agent alone. A HITL ticket only resolves through that live exchange; the agent never stands in for the human's side of it (a grilling agent that answers its own questions has broken this).

- **Research** (AFK): Reading documentation, third-party APIs, or local resources like knowledge bases to surface facts a decision waits on. Have the Main Agent allocate a `/research` collaborator and save its findings under the corresponding effort's `.scratch/<NNNN>-<effort-slug>/research/<name>/` directory. Use when knowledge outside the current working directory is required.
- **Prototype** (HITL): Raise the fidelity of the discussion by making a cheap, rough, concrete artifact to react to - an outline, a rough take, a stub, or UI/logic code via the `/prototype` skill. Links the prototype as an asset. Use when "how should it look" or "how should it behave" is the key question.
- **Grilling** (HITL): Conversation via the `/grilling` and `/domain-modeling` skills, following the current frontier in rounds. The default case.
- **Task** (HITL or AFK): Manual work that must happen before a *decision* can be made — nothing to decide, prototype, or research, but the discussion is blocked until it's done. Signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. This is the one type that *does* rather than decides — and it earns its place by unblocking a decision, not by delivering the destination. The agent drives it alone where it can (AFK); otherwise it hands the human a precise checklist (HITL). Once the work is done, the answer records what was done and any resulting facts (credentials location, new URLs, row counts) later tickets depend on.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war** — the dim view of decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets — one at a time, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. It's the undiscovered frontier _toward_ the destination — everything here is in scope, just not sharp enough to ticket. Write as loosely or as fully as the view allows; it doubles as a signpost for collaborators reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now — _not_ whether you can answer it now.

- **Ticket when** the question is already sharp — even if it's blocked and you can't act on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't pre-slice the fog into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a live ticket, and what's out of scope (the next section).

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work beyond it is **out of scope** — it isn't fog, and it doesn't belong in **Not yet specified**. It gets its own **Out of scope** section on the map: work you've consciously ruled out of _this_ effort. Scope, not sharpness, lands it here.

Out-of-scope work never graduates — the frontier stops at the destination — so it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the route. When an existing ticket turns out to sit past the destination, record that outcome as `## Answer` through the local tracker, then leave one line in the **Out of scope** section with the gist, reason, and link to the ticket. Only after updating the map, set the ticket's `Status:` to `resolved` through the local tracker. It stays out of **Decisions so far**, which records the route actually walked.

## Invocation

Two modes. Each agent session resolves at most one ticket. Independent Research tickets may run in parallel in separate collaborator sessions.

### Chart the map

User invokes with a loose idea.

1. **Name the destination.** Run a `/grilling` and `/domain-modeling` session to pin down what this map is finding its way to — the spec, decision, or change. The destination fixes the scope, so it's settled first.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** — the way to the destination is already clear, the whole journey small enough for one session — you don't need a map. Stop and ask the user how they'd like to proceed.
3. **Create the map** using the local tracker: Destination and Notes filled in, Decisions-so-far empty, the fog sketched into **Not yet specified**.
4. **Create the tickets you can specify now** as Wayfinder issues in the same effort, then record blockers through the local tracker in a **second pass** (issues need ids before they can reference each other). This sorts them into the frontier and the blocked; everything you can't yet specify stays in the fog under **Not yet specified**.
5. **Start the research collaborators.** For each Research ticket created in this session, the Main Agent allocates or reuses a `/research` collaborator under `docs/agents/subagent-allocation.md`; a subagent requests that allocation from the Main Agent. Save each result under the corresponding effort's `.scratch/<NNNN>-<effort-slug>/research/<name>/` directory and record the result through the tracker workflow.
6. Stop — charting is one session's work; Research collaborators resolve their own tickets in separate sessions.

### Work through the map

User invokes with a map reference, which the local tracker resolves. A ticket is **optional** — without one, you pick the next decision, not the user.

1. Load the **map** — the low-res view, not every ticket body.
2. Choose the ticket. If the user named one, use it. Otherwise take the first frontier ticket in order. **Claim it** through the local tracker before any work.
3. Work through the question — **zoom as needed**: fetch the full body of any related or closed ticket on demand; invoke the skills the `## Notes` block names. If in doubt, use `/grilling` and `/domain-modeling`.
4. Finish the ticket through the local tracker. If it belongs on the route, record `## Answer`, **append a context pointer** to the map's Decisions-so-far, then set `Status:` to `resolved`. If it lies beyond the destination, follow [Out of scope](#out-of-scope) instead. Follow the `issue-tracking` Skill for the answer location and fields.
5. Add newly-surfaced tickets, then record their blockers; graduate any fog the answer has made specifiable, clearing each graduated patch from **Not yet specified** so it lives only as its new ticket. If the answer reveals that another ticket sits beyond the destination, leave its resolution for a separate session. If the decision invalidates other parts of the map, update the affected tickets through the local tracker.

The user may run unblocked tickets in parallel, so expect other sessions to be editing the tracker concurrently.
