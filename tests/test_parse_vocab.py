"""Parser tests: counts, verbatim round trip, duplicates, bad rows, and the real data file."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import parse_vocab  # noqa: E402

SAMPLE = """# comment line
231 | Absurd |  | অযৌক্তিক | Unreasonable, Illogical | Reasonable, Sensible |  |  | 
231 | Calm |  | শান্ত | Serene, Quiet | Agitated |  | Antonym printed as "Agitatd". | Agitatd=Agitated
232 | Calm |  | স্থির | Still | Restless |  |  | 
"""


def run(text, extra=None):
    d = Path(tempfile.mkdtemp())
    src = d / "s.txt"
    src.write_text(text, encoding="utf-8")
    out, rep = d / "d.json", d / "r.txt"
    code = parse_vocab.main(["--source", str(src), "--out", str(out), "--report", str(rep)] + (extra or []))
    return code, json.loads(out.read_text(encoding="utf-8")), rep.read_text(encoding="utf-8")


class ParserTests(unittest.TestCase):
    def test_counts_and_roundtrip(self):
        code, data, report = run(SAMPLE)
        self.assertEqual(code, 0)
        self.assertEqual(len(data["entries"]), 3)
        self.assertIn("Source rows (lines)    : 3", report)
        self.assertIn("Source rows (regex)    : 3", report)
        self.assertIn("Verified by round trip : 3", report)

    def test_nothing_is_changed_or_dropped(self):
        _, data, _ = run(SAMPLE)
        e = data["entries"][1]
        self.assertEqual(e["syn"], ["Serene", "Quiet"])
        self.assertEqual(e["suggest"]["terms"], {"Agitatd": "Agitated"})
        self.assertEqual(e["ant"], ["Agitated"])          # as written, not replaced by the suggestion
        self.assertEqual(data["entries"][0]["bn"], "অযৌক্তিক")

    def test_duplicates_are_listed_not_removed(self):
        _, data, report = run(SAMPLE)
        self.assertEqual([e["word"] for e in data["entries"]].count("Calm"), 2)
        self.assertIn("Duplicate headwords (kept as they are): 1", report)

    def test_unclear_entries_are_listed(self):
        _, _, report = run(SAMPLE)
        self.assertIn("Unclear in source (kept as printed, tagged in the app): 1", report)

    def test_bad_row_fails_loudly(self):
        code, _, report = run(SAMPLE + "233 | Broken | only | three | fields\n")
        self.assertEqual(code, 1)
        self.assertIn("FAIL", report)

    def test_ids_follow_file_order(self):
        _, data, _ = run(SAMPLE)
        self.assertEqual([e["id"] for e in data["entries"]], [1, 2, 3])
        self.assertEqual([e["cat"] for e in data["entries"]], ["A", "C", "C"])


class RealDataTests(unittest.TestCase):
    def test_real_parse_passes(self):
        r = subprocess.run([sys.executable, "-I", str(ROOT / "tools/parse_vocab.py"),
                            "--out", str(Path(tempfile.mkdtemp()) / "d.json"),
                            "--report", str(Path(tempfile.mkdtemp()) / "r.txt")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout[-400:])
        self.assertIn("PASS", r.stdout)

    def test_committed_data_matches_source(self):
        src = (ROOT / "data/source/vocab_source.txt").read_text(encoding="utf-8")
        lines = [l for l in src.splitlines() if l.strip() and not l.startswith("#")]
        data = json.loads((ROOT / "data/data.json").read_text(encoding="utf-8"))
        self.assertEqual(len(lines), len(data["entries"]))
        self.assertEqual(len(data["entries"]), 571)
        for line, e in zip(lines, data["entries"]):
            self.assertEqual(line.split("|")[1].strip(), e["word"])


if __name__ == "__main__":
    unittest.main()
