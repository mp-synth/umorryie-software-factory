## The owner's code rules

These apply to every line you add or change. They override the repo's habits
where the two disagree.

- No duplication. When logic repeats, extract a reusable function and call it.
- Code describes itself through naming and structure. Add no comments; if code
  needs a comment to be understood, rename or restructure it instead.
- Never write comments about the change itself ("added to fix X", "new:",
  "changed for ticket Y") and never mention Linear in code.
- No redundant docstrings. Keep any doc you must write short and precise.

### Every function is called where it is defined

- Define no function, method, constant, class, enum member, error code or
  model field that nothing in production code calls, raises or reads. Tests
  don't count as a caller: a function only a test calls is unused.
- An error code or enum member lives in the PR that first raises or uses it,
  like a function. Never add a whole catalogue of codes up front.
- A function lives in the PR that first calls it from production code. When
  a later ticket is the first caller, that ticket defines it, even when the
  plan put it in a shared ticket lower in the stack. Never add a function
  "for the next ticket". Delete any you find in your own diff.
- A shared base ticket keeps only what it calls itself; when you remove a
  helper from it because no production code there calls it, the tickets that
  call it define it.

### Names state intent

- A function name is a verb phrase that says what it does, so it needs no
  docstring or comment: `get_oldest_workspace`, not `primary_workspace`;
  `get_failed_admin_result`, not `failed_admin_result`;
  `set_invitation_organization_role`, not `grant_invitation_organization_role`.
- Use the verb that matches the effect: `get_` / `find_` / `build_` return a
  value and change nothing, `set_` assigns a field or role, `create_` /
  `add_` / `remove_` / `delete_` / `send_` change state, `is_` / `has_`
  answer yes or no. Name what the code really returns (oldest, latest,
  first), not a role it might play.
- When a name says what a docstring or comment said, delete that docstring
  or comment.

### No functions passed as arguments

- Don't write a function that takes a callable (a callback, `sender=`, an
  `on_*` hook, a strategy or factory function, a function passed to swap
  behaviour). Write one intent-named function per behaviour and call the
  right one from each flow. Callers that differ only in a step call two
  functions; shared steps go into a plain helper both call.
- Keep functions pure where you can: compute and return values, and do the
  side effects (database writes, emails, API calls) in the flow that calls
  them, not inside a helper chosen by an argument.

### Refactors stay apart from behaviour changes

- A refactor (rename, move, extraction, signature change of existing code)
  never shares a PR with a behaviour change. When a ticket needs one that the
  plan didn't give its own ticket, do the smallest refactor the ticket can't
  do without, in its own commit before the behaviour change, and say in your
  output that it should have been its own ticket.
- A refactor-only PR changes nothing anyone can observe: the same emails and
  their text, messages, error types, database writes and the order of side
  effects (inside or after the transaction, one by one or batched). When an
  extraction needs any of those to change, the change goes to the behaviour
  ticket that needs it.
- Don't rename or restructure code the ticket doesn't need to touch.
- Reuse the helpers and patterns lower PRs or the codebase already have
  (validators, regex patterns, builders) instead of writing a second version.

## Learned rules

The owner accepted these after reviewing the factory's work. They bind like the rest of this prompt.

- Add no constant, function or field to production code that only tests read; keep test-only values such as limits, bounds and fixtures in the test file. This holds even when ticket guidance names a production location for the value.
