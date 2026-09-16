---
name: lens-review
description: Run the SAMTEC four-lens review (architect, senior developer, full-stack and security analyst) on the current branch or changes, then combine the results into one verdict. Use before opening or merging a pull request, at a phase gate, or when asked for a "lens review", "four-lens review" or "phase gate review".
argument-hint: "[staged | <base-branch> | phase]"
---

# Four-lens review

Review the current changes through SAMTEC's four review lenses and give one combined verdict. The team includes beginners preparing a final-year defense, so keep the language plain.

## 1. Decide what to review

Argument received: `$ARGUMENTS`

- **No argument:** review everything on this branch that is not on `main`, plus uncommitted work. Run `git diff main...HEAD --stat`, `git status --short` and `git diff HEAD --stat`.
- **`staged`:** review only staged changes (`git diff --cached --stat`).
- **A branch name:** compare against that branch instead of `main`.
- **`phase`:** do a normal review, then the phase gate in step 4.

If there is nothing to review, say so and stop.

## 2. Launch the four reviewers at the same time

In a single message, start these four subagents in parallel. Give each one the base branch and the list of changed files:

- `architect-lens`
- `senior-dev-lens`
- `fullstack-lens`
- `security-lens`

Ask each to review only the changed files, reading nearby code as needed, and to reply in its own output format.

## 3. Combine the results

Reply in this shape:

```
# Four-lens review: <branch name>

| Lens | Verdict | Blockers | Should fix |
|---|---|---|---|
| Architect | ... | ... | ... |
| Senior developer | ... | ... | ... |
| Full-stack | ... | ... | ... |
| Security analyst | ... | ... | ... |
```

Then list the findings by severity: every BLOCKER first, then SHOULD FIX, then NICE TO HAVE. Merge duplicates that several lenses found and name each lens that raised them. Keep the file and line, what is wrong, why it matters and how to fix it.

End with the overall verdict:

- **READY TO MERGE** when no lens returned CHANGES REQUIRED.
- **FIX FIRST** otherwise, followed by the blockers to clear, in order.

## 4. Phase gate (only with `phase`)

1. Find the current phase in `docs/plan/07-roadmap.md`: the first phase whose checklist is not fully ticked.
2. Run `pnpm check` and report the result.
3. Go through that phase's exit demo and mark each item as done, not done or not verifiable.
4. Confirm the documents in `docs/plan/` still describe what was actually built.

## Rules

- Do not edit files during the review. After the report, offer to fix the findings.
- Never open `.env` files.
