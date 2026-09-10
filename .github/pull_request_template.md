## Task

<!-- Number AND title, so the PR reads without opening the tracker. -->
Closes #<number> — <the issue's own title>

Based on `<base branch>` at `<sha>`. <!-- Note any branch this is stacked on, and what it must be rebased past. -->

<!-- One or two paragraphs: what this does, and what a reviewer needs to know before reading the diff.
     If the issue text turned out to be wrong about something, say so here rather than burying it. -->

---

## What changed

<!-- The substance, in sections with bold lead-ins.

     Explain WHY, not just what. The diff already says what changed; what it cannot say is which
     alternative was rejected and on what grounds. That reasoning is the part reviewers need and the
     part that rots first if it is not written down.

     Name files and line numbers. Quote the rule or spec line a decision rests on. -->

## Found while building it

<!-- Defects in existing code found on the way, and anything the issue or the spec got wrong.
     Delete this section if there was nothing. -->

## Documentation

<!-- `docs/animations/` (README, recipes, reference, glossary, extending, backlog), `docs/rules/`,
     `docs/specs/`, and the playground's `Interaction audit` page.

     Per CLAUDE.md the audit page and the written spec are a matched pair with the code — change an
     animation, update both. Delete this section only if none of them were touched. -->

## Testing

<!-- Counts per package, plus lint, stylelint and typecheck.

     Say what was mutation-checked: an assertion nobody has seen fail is not yet evidence. If a test
     was rewritten because it turned out to prove nothing, say that too — it is the most useful line
     in the section. -->

## Known and deliberately not fixed here

<!-- Out of scope, recorded findings, deferred minors, rules questions left open.

     For each: what it is, why it is not fixed here, and what would close it. A gap named with its
     closer is a task; a gap named without one is a complaint.

     Guessing about the rules is forbidden — anything unsettled belongs in `docs/rules/backlog.md`
     with a marker at the paragraph it came from, not resolved by inference here.

     Delete this section if there is genuinely nothing. -->
