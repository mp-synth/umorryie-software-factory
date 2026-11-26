#!/usr/bin/env python3
"""Tier-1 test selection for EnactServices: the tests a branch most likely breaks.

usage: enactservices-select-tests.py [BASE_REF ...]    (default: $FACTORY_BASE)

Prints test files, one per line, for the changes between HEAD and its merge base with each BASE_REF:
  - test files the branch changed, and every test under a conftest.py it changed or deleted;
  - test_<module>.py and test_<module>_*.py in the same service, for each changed module;
  - tests and conftest subtrees that import a changed module directly (one hop of `ruff analyze graph`)
    or name its dotted path, when they mention a name the diff touches. A new or deleted module, or a
    changed top-level statement that defines no name, keeps all of them.
The selection is not capped: a wide one marks a foundation change, and one wide run there is right.
Without an import graph it falls back to the test directories that mirror the changed files.
A one-line summary, and a note when CI would run every test, go to stderr.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path, PurePosixPath

GRAPH_TIMEOUT_SECONDS = 40
DEFINITION = re.compile(r"^\s*(?:async\s+)?def\s+(\w+)|^\s*class\s+(\w+)|^(\w+)\s*(?::[^=]+)?=(?!=)")
NOT_A_STATEMENT = ("import ", "from ", "#", ")", "]", "}", "@", '"""', "'''")
DOTTED_NAME = re.compile(r"(?<![\w.])[A-Za-z_]\w*(?:\.\w+)+")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def quoted_list(pyproject: str, key: str) -> list[str]:
    match = re.search(rf"^{key}\s*=\s*\[(.*?)\]", pyproject, re.M | re.S)
    if not match:
        return []
    body = "\n".join(line.split("#", 1)[0] for line in match.group(1).splitlines())
    return re.findall(r'"([^"]+)"', body)


def is_test(path: str) -> bool:
    name = PurePosixPath(path).name
    return name.startswith("test_") and name.endswith(".py")


def is_conftest(path: str) -> bool:
    return PurePosixPath(path).name == "conftest.py"


def service_root(path: str) -> str:
    return "/".join(path.split("/")[:2])


def dotted(path: str) -> str | None:
    parts = path[:-3].split("/")
    if parts[0] == "packages" and "src" in parts[:3]:
        parts = parts[parts.index("src") + 1 :]
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts) if len(parts) > 1 else None


def changed_files(base: str) -> dict[str, str]:
    """Path -> A, M or D."""
    fields = git("diff", "--name-status", "--no-renames", "-z", base, "HEAD").split("\0")
    return {path: state[0] for state, path in zip(fields[::2], fields[1::2]) if path}


def touched_names(base: str, changes: dict[str, str]) -> dict[str, set[str] | None]:
    """The names each modified module's diff touches; None when the change cannot be tied to names."""
    names: dict[str, set[str] | None] = {}
    path = None
    for line in git("diff", "-U0", "--no-renames", base, "HEAD", "--", "*.py").splitlines():
        if line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else None
            if path and changes.get(path) == "M":
                names[path] = set()
            continue
        if path is None or names.get(path) is None or line.startswith(("--- ", "diff ", "index ")):
            continue
        if line.startswith("@@"):
            found = DEFINITION.match(line.split("@@", 2)[-1].strip())
        elif line[:1] in "+-":
            body = line[1:]
            found = DEFINITION.match(body)
            if not found and body.strip() and not body[0].isspace() and not body.startswith(NOT_A_STATEMENT):
                names[path] = None
                continue
        else:
            continue
        if found:
            names[path].add(next(group for group in found.groups() if group))
    return {f: (None if found is None else {n for n in found if len(n) > 2}) for f, found in names.items()}


def graph_cache() -> Path | None:
    """The graph depends only on the tree, so worktrees at the same clean tree share one."""
    if git("status", "--porcelain"):
        return None
    home = Path(os.environ.get("FACTORY_HOME", Path.home() / ".software-factory"))
    return home / "cache" / "enactservices-graph" / f"{git('rev-parse', 'HEAD^{tree}').strip()}.json"


def import_graph() -> tuple[dict[str, list[str]] | None, str]:
    """File -> the files that import it, from the repo's own ruff; and how it was obtained."""
    cache = graph_cache()
    if cache and cache.exists():
        return json.loads(cache.read_text()), "cached graph"
    ruff = [".venv/bin/ruff"] if Path(".venv/bin/ruff").exists() else ["uv", "run", "--frozen", "--no-sync", "ruff"]
    started = time.monotonic()
    try:
        result = subprocess.run(
            [*ruff, "analyze", "graph", "--direction=dependents"],
            capture_output=True,
            text=True,
            timeout=GRAPH_TIMEOUT_SECONDS,
        )
        graph = json.loads(result.stdout) if result.returncode == 0 else None
    except subprocess.TimeoutExpired:
        return None, f"ruff took over {GRAPH_TIMEOUT_SECONDS} s"
    except (OSError, json.JSONDecodeError) as error:
        return None, f"ruff failed: {error}"
    if graph is None:
        return None, f"ruff failed: {(result.stderr.strip().splitlines() or ['no output'])[-1]}"
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        for old in cache.parent.glob("*.json"):
            if time.time() - old.stat().st_mtime > 86400:
                old.unlink(missing_ok=True)
        partial = cache.with_suffix(f".{os.getpid()}")
        partial.write_text(json.dumps(graph))
        partial.replace(cache)
    return graph, f"graph {time.monotonic() - started:.1f} s"


class Selector:
    def __init__(self, testpaths: list[str]) -> None:
        tracked = git("ls-files", "-z").split("\0")
        roots = tuple(p.rstrip("/") + "/" for p in testpaths)
        self.tests = sorted(f for f in tracked if is_test(f) and f.startswith(roots))
        self.conftests = [f for f in tracked if is_conftest(f)]
        self.text = {f: Path(f).read_text(encoding="utf-8", errors="ignore") for f in self.tests + self.conftests}
        self.reasons: dict[str, int] = {}
        self.selected: set[str] = set()

    def add(self, reason: str, files: set[str] | list[str]) -> None:
        new = set(files) - self.selected
        if new:
            self.reasons[reason] = self.reasons.get(reason, 0) + len(new)
            self.selected |= new

    def subtree(self, conftest: str) -> list[str]:
        directory = str(PurePosixPath(conftest).parent)
        return [t for t in self.tests if t.startswith(directory + "/")]

    def module_tests(self, path: str) -> list[str]:
        root, stem = service_root(path), PurePosixPath(path).stem
        pattern = re.compile(rf"test_{re.escape(stem)}(_|$)")
        return [t for t in self.tests if t.startswith(root + "/") and pattern.match(PurePosixPath(t).stem)]

    def mirror_tests(self, path: str) -> list[str]:
        root = service_root(path)
        relative = re.sub(r"^src/[^/]+/", "", path[len(root) + 1 :])
        directory = str(PurePosixPath(relative).parent)
        if directory != ".":
            return [t for t in self.tests if t.startswith(f"{root}/tests/{directory}/")]
        return [t for t in self.tests if t.startswith(f"{root}/tests/") and PurePosixPath(t).name == f"test_{PurePosixPath(path).name}"]

    def service_tests(self, path: str) -> list[str]:
        root = service_root(path)
        return [test for test in self.tests if test.startswith(f"{root}/")]

    def string_references(self, modules: set[str]) -> dict[str, set[str]]:
        found: dict[str, set[str]] = {m: set() for m in modules}
        for f, body in self.text.items():
            for name in set(DOTTED_NAME.findall(body)):
                parts = name.split(".")
                for i in range(2, len(parts) + 1):
                    prefix = ".".join(parts[:i])
                    if prefix in found:
                        found[prefix].add(f)
        return found

    def expand(self, users: set[str]) -> set[str]:
        """Test files stand for themselves, a conftest for its subtree (the root one is CI's to run)."""
        out = {u for u in users if is_test(u)}
        for u in users:
            if is_conftest(u) and u != "conftest.py":
                out |= set(self.subtree(u))
        return out


def mentioning(names: set[str], users: set[str], text: dict[str, str]) -> set[str]:
    if not names:
        return set()
    pattern = re.compile(r"\b(?:%s)\b" % "|".join(map(re.escape, sorted(names))))
    return {u for u in users if pattern.search(text[u])}


def importers_mentioning_touched_names(
    names: set[str] | None, users: set[str], text: dict[str, str]
) -> set[str]:
    return mentioning(names, users, text) if names else users


def branch_changes(bases: list[str]) -> tuple[dict[str, str], dict[str, set[str] | None]]:
    """The union over all bases; an added or deleted file stays so, and an unknown name set wins."""
    changes: dict[str, str] = {}
    names: dict[str, set[str] | None] = {}
    for base in bases:
        merge_base = git("merge-base", base, "HEAD").strip()
        these = changed_files(merge_base)
        for f, state in these.items():
            if changes.get(f, "M") == "M":
                changes[f] = state
        for f, found in touched_names(merge_base, these).items():
            known = names.get(f, set())
            names[f] = None if found is None or known is None else found | known
    return changes, names


def main() -> int:
    bases = sys.argv[1:] or [os.environ.get("FACTORY_BASE", "")]
    if not all(bases):
        print("usage: enactservices-select-tests.py BASE_REF ... (or set FACTORY_BASE)", file=sys.stderr)
        return 2
    started = time.monotonic()
    pyproject = Path("pyproject.toml").read_text(encoding="utf-8")
    static_deps = tuple(quoted_list(pyproject, "affected_static_deps"))
    selector = Selector(quoted_list(pyproject, "testpaths") or ["service", "test/unit", "packages"])
    existing = set(selector.tests)
    changes, names = branch_changes(bases)

    full_run = sorted(f for f in changes if f.startswith(static_deps) or f == "conftest.py")
    sources = [f for f in changes if f.endswith(".py") and not is_test(f) and not is_conftest(f)]
    selector.add("changed tests", {f for f, s in changes.items() if is_test(f) and s != "D" and f in existing})
    for f in changes:
        if is_conftest(f) and f != "conftest.py":
            selector.add("changed conftest subtrees", selector.subtree(f))
    for f in sources:
        if PurePosixPath(f).stem != "__init__":
            selector.add("test_<module> files", selector.module_tests(f))
        if changes[f] == "D":
            selector.add("deleted module service tests", selector.service_tests(f))

    graph, graph_note = (
        import_graph() if sources or any(not f.endswith(".py") for f in changes) else ({}, "no graph needed")
    )

    if graph is None:
        for f in sources:
            selector.add("mirror directories (no import graph)", selector.mirror_tests(f))
    else:
        modules = {f: dotted(f) for f in sources}
        references = selector.string_references({m for m in modules.values() if m})
        for f in sources:
            users = {u for u in graph.get(f, []) if u in selector.text}
            users |= references.get(modules[f] or "", set())
            touched = names.get(f) if changes[f] == "M" else None
            users = importers_mentioning_touched_names(touched, users, selector.text)
            selector.add("importers and string references", selector.expand(users))
        if changes.get("conftest.py") == "M":
            root_names = names.get("conftest.py") or set()
            selector.add("tests naming a changed root fixture", mentioning(root_names, existing, selector.text))
        for f in changes:
            if not f.endswith(".py"):
                selector.add("declared file dependencies", {u for u in graph.get(f, []) if is_test(u) and u in existing})

    selection = sorted(selector.selected & existing)
    if selection:
        print("\n".join(selection))
    why = ", ".join(f"{count} {reason}" for reason, count in selector.reasons.items()) or "no Python change with tests"
    if graph is None:
        graph_note = f"no import graph ({graph_note}), so the mirror-directory rule"
    print(
        f"tier-1 selection: {len(selection)} test files from {len(changes)} changed files ({why}; "
        f"{graph_note}; {time.monotonic() - started:.1f} s)",
        file=sys.stderr,
    )
    if full_run:
        print(f"CI runs every test for this change ({', '.join(full_run)}); the gate runs tier 1 only.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
