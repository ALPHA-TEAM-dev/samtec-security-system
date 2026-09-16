# Using Claude Code on SAMTEC

Claude Code is set up to act as four senior reviewers on this project. This guide shows how to use them. Everything here is optional: the pull request checklist and CI work without Claude Code.

## What Claude Code reads automatically

When you start Claude Code inside the repository, it reads `CLAUDE.md` at the root. That file tells it the project rules, the commands and where things live. You never need to explain the project from scratch.

## The four review lenses

Each lens is a reviewer agent defined in `.claude/agents/`.

| Lens | Its question | It checks, for example |
|---|---|---|
| `architect-lens` | Does this still fit the design? | Module boundaries, contract first, data rules, roadmap scope |
| `senior-dev-lens` | Is this built well? | Correctness, types, validation, error handling, tests, database queries |
| `fullstack-lens` | Do the frontend and backend fit together? | Generated API client, contract match, mocks, loading and error states, formatting |
| `security-lens` | What would an attacker do? | Access control on every record, sign-in, personal data exposure, secrets, injection, dependencies |

Every reviewer reports findings as **BLOCKER**, **SHOULD FIX** or **NICE TO HAVE**, with the file, the problem, why it matters and how to fix it.

## Run all four at once

Inside Claude Code, type:

```
/lens-review
```

It reviews everything on your branch that is not on `main`, runs the four reviewers in parallel, and combines their verdicts into one table ending with **READY TO MERGE** or **FIX FIRST**.

Variations:

| Command | Reviews |
|---|---|
| `/lens-review` | Your branch compared with `main`, plus uncommitted changes |
| `/lens-review staged` | Only the changes you have staged with `git add` |
| `/lens-review phase` | A full review plus the phase exit gate from the roadmap |

## Ask one reviewer

Write a normal message, for example:

```
Use the security-lens agent to review my changes to the employees page.
```

## Built-in reviews

Claude Code also has general review commands that complement the lenses:

- `/security-review` for a general security pass on your changes
- `/code-review` for a general bug-finding pass

## Good habits

- Run `/lens-review` **before** opening a pull request, and fix every BLOCKER.
- Ask Claude Code to explain code you did not write, for example: "Explain `apps/api/src/common/problem-details.filter.ts` line by line for a beginner." This is excellent defense preparation.
- Ask it to write tests for your changes, then read the tests and make sure you understand them.
- You are responsible for everything you commit. Read and understand the code before you commit it.

## Safety rules

- The shared settings in `.claude/settings.json` stop Claude Code from reading `.env` files. Do not work around this.
- Never paste passwords, tokens or real employee data into a Claude Code conversation.
- Personal settings go in `.claude/settings.local.json`, which git ignores.

Related: [Git and pull requests](06-git-and-pull-requests.md) · [Security and review gates](../plan/06-security-and-review-gates.md)
