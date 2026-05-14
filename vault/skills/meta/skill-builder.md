---
title: Skill Builder
category: meta
tags: [skill-builder, create-skill, meta]
trigger: "user wants to create a new skill, add a skill to Rodney OS, build a workflow"
description: Interactively build a new Rodney OS skill — guided interview, file creation, memory registration.
---

# Skill Builder

Use when the user wants to create a new skill that will appear as a card in the Rodney OS.

## Workflow

### 1. Interview

Ask these questions (can be one message):

- **Name** — kebab-case slug (e.g., `client-onboarding`)
- **Title** — display name shown on the OS card
- **Category** — pick existing or propose new:
  - `tasks` — task/project work
  - `research` — information gathering
  - `content` — writing/drafting
  - `ops` — operations/checklists
  - `tickets` — issue/ticket management
  - `meta` — skills about Rodney itself
- **Trigger** — when should this skill activate? (complete sentence: "when user wants to...")
- **Description** — one-line summary for the OS card
- **Workflow steps** — what does Rodney do? (numbered steps)
- **Output** — what does the user receive at the end?
- **Tags** — 2–5 keywords (drive memory prefetch when skill launches)

### 2. Confirm

Show the user a preview of the skill file. Get approval or iterate.

### 3. Create the file

Write to `skills/{category}/{name}.md` using this template:

```markdown
---
title: {Title}
category: {category}
tags: [{tag1}, {tag2}]
trigger: "{trigger sentence}"
description: {one-line description}
---

# {Title}

{Trigger description — one sentence on when to use this.}

## Workflow

1. ...
2. ...
3. **`remember`** relevant facts under appropriate category + tags.

## Output

- ...
```

### 4. Register in memory

Call `remember` with:
- `category`: `procedural`
- `content`: "Rodney skill: {title}. Trigger: {trigger}. File: skills/{category}/{name}.md"
- `tags`: skill tags + `rodney-skill`
- `importance`: 3

### 5. Confirm to user

Tell them:
- Skill card will appear in Rodney OS on next refresh (no restart needed)
- How to invoke it (click the card in the OS under the {category} group)
- Ask if they want to build another skill

## Notes

- `tags` in frontmatter = what memories get prefetched when the skill launches from OS
- Category = the subdirectory name = the group label shown in OS
- If proposing a new category, create the directory implicitly by using it in the file path
- Always `remember` new skills so agent can `recall` them by task context in future sessions
