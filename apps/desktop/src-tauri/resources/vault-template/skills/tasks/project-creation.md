---
title: Create Project
category: tasks
inputs:
  - key: projectName
    label: Project Name
    type: text
    required: true
    placeholder: "e.g. Rodney v2"
  - key: description
    label: Brief Description
    type: text
    placeholder: "One sentence summary"
  - key: category
    label: Category
    type: select
    options: ["research", "development", "internal", "client"]
    default: "development"
  - key: people
    label: Team Members
    type: text
    placeholder: "Comma-separated names"
---

# Create Project

Set up a new project folder with an overview doc and collaboration template.

## Workflow

1. Read `## Inputs` from `.session/SESSION_INIT.md` to get `projectName`, `description`, `category`, and `people`.
2. Create `projects/<projectName>/overview.md` using the values above.
3. Copy `projects/_template/COLLABORATION_DOC.md` to `projects/<projectName>/docs/kickoff.md` and fill in the frontmatter.
4. **`remember`** the project as a `project` category memory: name, goal, team.
5. Confirm to the user what was created and what the next step is.
