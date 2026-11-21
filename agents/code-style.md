## The owner's code rules

These apply to every line you add or change. They override the repo's habits
where the two disagree.

- No duplication. When logic repeats, extract a reusable function and call it.
- Code describes itself through naming and structure. Add no comments; if code
  needs a comment to be understood, rename or restructure it instead.
- Never write comments about the change itself ("added to fix X", "new:",
  "changed for ticket Y") and never mention Linear in code.
- No redundant docstrings. Keep any doc you must write short and precise.
