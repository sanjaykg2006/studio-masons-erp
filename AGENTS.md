# AGENTS.md

## General Rules

- Read only the files and documentation relevant to the current task.
- Make the smallest change that solves the problem.
- Reuse existing code before introducing new abstractions.
- Avoid duplication.
- Do not modify unrelated files.
- Remove unused imports, dead code, and obsolete comments when touching a file.

## Coding Standards

- Use strict TypeScript.
- Avoid `any`.
- Use functional React components.
- Follow Next.js App Router conventions.
- Use Tailwind CSS for styling.

## Documentation

Read additional documentation only when required.

| Task | Documentation |
|------|---------------|
| Architecture changes | `docs/architecture.md` |
| Authentication | `docs/auth.md` |
| New feature modules | `docs/modules.md` |
| Permissions / RBAC | `docs/permissions.md` |
| Database migrations | `docs/migrations.md` |
| Project-scoped permissions | `docs/project-access.md` |

Do not read unrelated documentation.

## Validation

Before finishing:

- Run lint.
- Check TypeScript errors.
- Run a production build if changes affect routing, configuration, dependencies, or build behavior.
- Summarize all changes made.

## Existing Code

Before introducing a new pattern, search for an existing implementation and follow it.

Prefer consistency over cleverness.
