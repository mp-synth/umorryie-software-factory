from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("enactservices-select-tests.py")
SPEC = importlib.util.spec_from_file_location("enactservices_select_tests", SCRIPT)
assert SPEC and SPEC.loader
selector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(selector)


class TouchedNameSelectionTest(unittest.TestCase):
    def touched_names(self, diff: str) -> set[str] | None:
        path = "service/example/module.py"
        with patch.object(selector, "git", return_value=diff):
            return selector.touched_names("base", {path: "M"})[path]

    def assert_keeps_importers(self, diff: str) -> None:
        names = self.touched_names(diff)
        users = {"service/example/tests/test_importer.py"}
        text = {next(iter(users)): "does not mention a changed name"}
        self.assertEqual(selector.importers_mentioning_touched_names(names, users, text), users)

    def test_module_block_with_no_definition_keeps_direct_importers(self) -> None:
        self.assert_keeps_importers(
            """+++ b/service/example/module.py
@@ -1 +1 @@ if TYPE_CHECKING:
-    from example.old import Client
+    from example.new import Client
"""
        )

    def test_short_touched_names_keep_direct_importers(self) -> None:
        self.assert_keeps_importers(
            """+++ b/service/example/module.py
@@ -1 +1 @@
-x = 1
+y = 2
"""
        )

    def test_known_names_still_narrow_direct_importers(self) -> None:
        users = {"mentions.py", "other.py"}
        text = {"mentions.py": "changed_name()", "other.py": "something_else()"}
        self.assertEqual(
            selector.importers_mentioning_touched_names({"changed_name"}, users, text),
            {"mentions.py"},
        )

    def test_deleted_module_selects_every_test_in_its_service(self) -> None:
        instance = selector.Selector.__new__(selector.Selector)
        instance.tests = [
            "service/example/tests/test_api.py",
            "service/example/tests/nested/test_worker.py",
            "service/other/tests/test_api.py",
        ]
        self.assertEqual(
            instance.service_tests("service/example/controllers/deleted.py"),
            instance.tests[:2],
        )


if __name__ == "__main__":
    unittest.main()
