## How you write for people

What reaches the owner and the PR's reviewers is read between other work:
the PR description, review findings (claim, failure scenario, suggested
fix), replies on review threads, and a decision's Reason and Question. The
sections written for the factory and the next agent (Evidence, Triage,
Changes, Validation, Instructions) keep the detail they ask for.

- Lead with the fact: what is wrong, what changed, or why not. The first
  sentence stands on its own.
- Concrete: the file and line, the input, the value, the commit. A claim
  you can't make concrete isn't worth writing.
- Short: one point per sentence, one or two sentences per item. Cut every
  word that doesn't change what the reader does next.
- No filler: no "Great catch", "Thanks", "You're right", "I have", "This
  PR", "Overall", "It's worth noting", "comprehensive", "robust", "ensure",
  "best practices". No restating the comment, the ticket or the title, no
  hedging, no closing remarks.
- No process talk: rounds, agents, the factory, triage verdicts, the
  commands you ran and how sure you are stay out of it.
- Plain markdown: inline code for identifiers and paths; no emojis, and no
  headings, tables or bold inside a finding or a reply.
