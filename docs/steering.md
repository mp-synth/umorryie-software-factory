# After the PRs: steer once, then teach the factory

When you read the PRs and want something changed, write it once in the
initiative's **Feedback** with **Whole initiative** selected and press **Send
to the PRs**. This works while the initiative builds and after it is done. A
fresh, read-only steering router (Opus) reads your words, the brief, the plan
and every ticket's diff, and sends each change to the ticket whose diff adds
that code. When several stacked tickets touch it, the change goes to the lowest
open one, because the stack carries it up. Each of those tickets gets the
router's numbered instructions with your words quoted as binding feedback, and
a fresh fixer runs them through checks, the verifier and a push as usual.
Merged or canceled tickets can't take changes: the router says which part went
nowhere and needs a follow-up initiative. Before the plan is approved, the same
box still re-plans.

Feedback about the code inside the tickets (names, comments, deleting unused
code, moving a helper into the ticket that first calls it, splitting a
refactor out, the rules in `agents/code-style.md`) always goes to the existing
PRs as fixes, never to a re-plan, so no PR is replaced. A rule you state with
an example is applied to every instance in every open ticket. When a helper
moves into a ticket that tickets beside it also call, the router restacks
those tickets onto it (`## Restack` in route.md): each keeps its PR, which is
retargeted, and the stack sync merges the new base into it.

Dropping a ticket you name ("the last PR can go") and putting a ticket's new
behaviour behind a feature flag are fixes too, not re-plans: the router lists
the dropped ticket under `## Drop`, the factory closes its PR and cancels it,
and the flag goes to that ticket's fixer. A ticket another open ticket still
builds on is only dropped once that one is restacked. When your feedback names
the PRs to change, only those change.

A stacked ticket's fixer waits while a ticket below it still has feedback to
fix or is being fixed, and starts once that fix is pushed and merged into its
branch, so it sees, for example, a function the ticket below just removed.

When your words change the plan rather than code inside a ticket (another
approach or architecture, a changed API or contract, scope added),
the router re-plans instead. A fresh planner revises the plan with your words
and `tickets.md`, the built tickets with their PRs and diffs. Steps already
running finish, but no new ticket starts. The revised plan goes through plan
review and approval as usual. Then:

- tickets whose text is unchanged keep building;
- tickets whose text changed are rebuilt from their base and pushed to their
  existing PR as one new commit, and so is every ticket stacked on them;
- tickets the plan drops are canceled, with their PRs closed;
- new tickets start.

Merged tickets stay as they are.

## Merging PRs in any order

You can merge an approved PR before the others. Within about five minutes the
PR sync sees it, retargets the PRs that were stacked on it to the base branch,
and merges the latest base branch into every open ticket of the initiative
that now builds on it (the ones above take it through their stack). Those
tickets keep their approval and are not reviewed again. Only a merge conflict
sends a ticket to a fixer, and once the verifier approves that fix it is
approved again.

Feedback that arrives while a ticket is busy (building, in review, being fixed)
is not left behind: once the ticket's last step ends, a fixer picks it up.

Every time you had to steer, the factory missed something. With **Retro once a
steered PR merges or queues** on (the default, in Autopilot), a ticket whose PR
merges or enters the merge queue gets a retro: a fresh Opus agent that never
saw the work. It only runs when you steered that ticket: your feedback or notes,
sending work back, approving or overruling a step by hand, routed feedback, or
review comments people left on the PR (bot findings don't count). It reads:

- a timeline of every step with what you said in between, in bold;
- the people's PR comments the fixer got;
- the brief, the plan and the ticket;
- each step's output, the diff and the repo's own rules;
- the rules learned so far.

For each steering item it writes what was wrong, which step should have caught
it first, and why that step didn't: a rule was missing, a rule exists and was
ignored, or the agent couldn't have known. Then it proposes at most three
durable rules, often none. A rule names its scope and the agent it is for:

- **this project**: kept in the database and added to the system prompt of
  every matching agent in this project, under "Rules learned in this project";
- **every project**: written into the role file (`agents/<role>.md`, or
  `repo-rules.md`, `code-style.md` or `writing.md`) under `## Learned rules`.
  That edits your factory checkout: commit it, or a `git checkout` or reset
  drops the rule while the database still lists it as active.

Once every PR of the initiative is merged or in the queue, and you steered the
plan or the whole initiative, one more retro looks at the plan. It runs after
the ticket retros and reads what they found. Retros never hold a ticket, and a
merge doesn't stop them. To run one yourself, use **Retro: learn from my
steering** in a ticket's menu or **More → Retro on the plan**.

Proposed rules wait in the initiative's **Learned rules** card. Nothing changes
until you act on one:

- **Accept** applies the rule from the next step on.
- **Edit** changes its text, scope or agent before you accept it.
- **Reject** drops it, and later retros see the rejection so they don't propose
  it again.
- **Retire**, on a rule that is already active, takes it out again; for an
  every-project rule it also removes the line from the role file.

The card also lists every rule active in the project.

