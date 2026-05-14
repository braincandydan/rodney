---
title: Startup onboarding skill
category: tasks
---

# Startup onboarding

Use this skill when a new user or new agent needs to set up identity, collaboration style, and durable memory.

## Goal

By the end of this session, Rodney should:

1. Understand who the user is and how they work.
2. Understand who Rodney is (tone, values, boundaries).
3. Store high-value memories for continuity.
4. Leave clear next steps and no open-loop confusion.

## Flow

1. Confirm session intent:
   - "Startup onboarding for both user and agent memory."
2. Run onboarding interview (sections A-D below).
3. Write durable memories using `remember` and `observe_user`.
4. Update mood/state using `update_mood` if it meaningfully changes.
5. End with a short onboarding summary and explicit next actions.

## A) User profile interview (ask concise questions)

Collect these minimum fields:

- Name / preferred name
- Role and team context
- Current priorities (this week + this quarter)
- Working style (fast iterate vs deep planning)
- Communication preference (short/direct vs detailed)
- Decision style (options first vs recommendation first)
- Friction points with agents/tools
- Non-negotiables (things the agent should always/never do)

Memory guidance:

- Use `observe_user` for behavioral patterns and collaboration preferences.
- Use `remember` category `relationship` for durable relationship patterns.

Suggested tags:

- `user_profile`, `communication`, `decision_style`, `friction`, `non_negotiable`

## B) Agent identity alignment

Confirm and align on:

- Tone
- Brevity level
- Disagreement policy (how direct to be)
- Proactivity level
- Check-in cadence and reminders

Then store:

- `remember` category `core` for stable identity rules.
- `remember` category `procedural` for behavioral rules ("when X, do Y").

Suggested tags:

- `agent_identity`, `tone`, `brevity`, `disagreement`, `proactivity`

## C) Collaboration contract

Define and record how work will run:

- How to start a task (what context user provides)
- How progress is reported (frequency + format)
- How docs are reviewed (inline notes, status updates)
- How to handle uncertainty and blockers
- Definition of done for typical tasks

Memory guidance:

- Use `remember` category `procedural`.
- Use `remember` category `project` if contract is project-specific.

Suggested tags:

- `workflow`, `reporting`, `feedback_loop`, `definition_of_done`

## D) Initial operating context

Capture what Rodney should prioritize now:

- Top 3 active initiatives
- Immediate next task
- Known blockers
- Any deadlines to track

Memory guidance:

- `remember` category `project` for initiative-specific context.
- `remember` category `semantic` for reusable organizational context.

Suggested tags:

- `active_initiatives`, `next_step`, `deadline`, `blocker`

## Output format

At the end, provide:

- **User profile snapshot** (5-8 bullets)
- **Agent identity snapshot** (5-8 bullets)
- **Collaboration contract** (checklist)
- **Top next 3 actions**
- **Open questions** (only unresolved items)

## Completion checklist

Before closing the session, verify:

- [ ] At least 5 durable memories stored with meaningful tags
- [ ] At least 3 user-behavior observations stored
- [ ] Disagreement policy explicitly confirmed
- [ ] Collaboration contract documented
- [ ] Next actions are unambiguous

## Guardrails

- Keep questions short and practical.
- Avoid long motivational text.
- If user is uncertain, propose defaults and ask for quick confirm/deny.
- Do not over-store noise; keep only memory-worthy facts and patterns.
