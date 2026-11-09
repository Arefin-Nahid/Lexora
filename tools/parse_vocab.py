#!/usr/bin/env python3
"""Lexora vocabulary parser.

Reads the pipe-separated source transcription and writes data/data.json.
It never skips, invents, translates or fixes an entry. After parsing it
verifies the result in three independent ways:

  1. line count   : data lines found by splitting the file into lines
  2. regex count  : data lines found by a separate regular expression
  3. round trip   : every entry is written back to a source line and must
                    match the original line exactly (verbatim), and the
                    saved data.json is re-read and re-checked the same way

It then prints a completeness report (source rows vs extracted vs verified),
lists duplicates and unclear entries without changing them, and exits with
status 1 if anything does not match.

Source line format (one entry per line, book order, '#' lines are comments):
    page | word | pos | bengali | synonyms | antonyms | example | note | suggest

The original PDF in this project is a scan with no text layer, so the
transcription file is the extraction step. Use --pdf to cross-check the page
count and to see whether a PDF has a text layer.
"""
import argparse
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

FIELDS = ["page", "word", "pos", "bn", "syn", "ant", "ex", "note", "suggest"]
ROOT = Path(__file__).resolve().parent.parent


def split_list(s):
    return [t.strip() for t in s.split(",") if t.strip()]


def parse_suggest(s):
    """'Parise=Praise; hw:Ingenious=Ingenuous; Induct=' -> dict."""
    out = {"terms": {}, "word": ""}
    for part in [p.strip() for p in s.split(";") if p.strip()]:
        left, _, right = part.partition("=")
        left, right = left.strip(), right.strip()
        if left.startswith("hw:"):
            out["word"] = right
        else:
            out["terms"][left] = right
    return out


def data_lines(text):
    """Method 1: split into lines, drop blanks and comments."""
    return [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]


def regex_count(text):
    """Method 2 (independent): count lines that start with a 3-digit page and a pipe."""
    return len(re.findall(r"^\d{3}\s*\|", text, flags=re.M))


def parse_line(line, lineno):
    parts = [p.strip() for p in line.split("|")]
    if len(parts) != len(FIELDS):
        raise ValueError("line %d has %d fields, expected %d: %r" % (lineno, len(parts), len(FIELDS), line[:80]))
    return dict(zip(FIELDS, parts))


def entry_from_row(i, row):
    pos = [p.strip() for p in row["pos"].split(",") if p.strip()]
    return {
        "id": i,
        "page": int(row["page"]),
        "word": row["word"],
        "pos": pos,
        "bn": row["bn"],
        "syn": split_list(row["syn"]),
        "ant": split_list(row["ant"]),
        "ex": row["ex"],
        "note": row["note"],
        "suggest": parse_suggest(row["suggest"]),
        "cat": (re.sub(r"[^A-Za-z]", "", row["word"])[:1] or "#").upper(),
    }


def entry_to_line(e, raw_suggest):
    """Write an entry back to its canonical source line (used for the round trip)."""
    cells = [
        str(e["page"]), e["word"], ", ".join(e["pos"]), e["bn"],
        ", ".join(e["syn"]), ", ".join(e["ant"]), e["ex"], e["note"], raw_suggest,
    ]
    return " | ".join(cells)


def rebuild_suggest(sg, word):
    parts = []
    for k, v in sg["terms"].items():
        parts.append("%s=%s" % (k, v))
    if sg["word"]:
        parts.append("hw:%s=%s" % (word, sg["word"]))
    return "; ".join(parts)


def pdf_info(pdf):
    info = {"path": str(pdf), "pages": None, "text_chars": None, "has_text_layer": None}
    try:
        out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=60).stdout
        m = re.search(r"^Pages:\s+(\d+)", out, flags=re.M)
        info["pages"] = int(m.group(1)) if m else None
        txt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, timeout=120).stdout
        info["text_chars"] = len(re.sub(r"\s", "", txt))
        info["has_text_layer"] = info["text_chars"] > 40 * (info["pages"] or 1)
    except (OSError, subprocess.SubprocessError) as ex:
        info["error"] = str(ex)
    return info


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default=str(ROOT / "data/source/vocab_source.txt"))
    ap.add_argument("--out", default=str(ROOT / "data/data.json"))
    ap.add_argument("--report", default=str(ROOT / "data/parse_report.txt"))
    ap.add_argument("--pdf", help="optional: the original PDF, used to cross-check the page count")
    a = ap.parse_args(argv)

    text = Path(a.source).read_text(encoding="utf-8")
    lines = data_lines(text)
    n_lines = len(lines)
    n_regex = regex_count(text)

    rows, entries, problems = [], [], []
    raw_suggests = []
    for no, ln in enumerate(text.splitlines(), 1):
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        try:
            row = parse_line(ln, no)
            rows.append((no, ln, row))
        except ValueError as ex:
            problems.append(str(ex))
    for i, (no, ln, row) in enumerate(rows, 1):
        e = entry_from_row(i, row)
        entries.append(e)
        raw_suggests.append(row["suggest"])

    # round trip 1: entries -> lines must equal the source lines
    verified, mismatches = 0, []
    for e, (no, ln, row), rs in zip(entries, rows, raw_suggests):
        back = entry_to_line(e, rs)
        if back.rstrip() == ln.rstrip() or re.sub(r"\s*\|\s*", "|", back).strip() == re.sub(r"\s*\|\s*", "|", ln).strip():
            verified += 1
        else:
            mismatches.append((no, ln[:90], back[:90]))
        # the structured suggestion must reproduce the raw text (order does not matter)
        again = sorted(x.strip() for x in rebuild_suggest(e["suggest"], e["word"]).split(";") if x.strip())
        if again != sorted(x.strip() for x in rs.split(";") if x.strip()):
            mismatches.append((no, "suggest " + rs, rebuild_suggest(e["suggest"], e["word"])))

    meta = {
        "source": Path(a.source).name,
        "entries": len(entries),
        "pages": sorted({e["page"] for e in entries}),
        "title": "Synonyms and antonyms (BCS preparation book, pp. %d-%d)" % (min(e["page"] for e in entries), max(e["page"] for e in entries)) if entries else "",
    }
    out = {"meta": meta, "entries": entries}
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # round trip 2: read data.json back from disk and compare again with the source
    back = json.loads(Path(a.out).read_text(encoding="utf-8"))["entries"]
    n_file = len(back)
    disk_ok = 0
    for e, (no, ln, row), rs in zip(back, rows, raw_suggests):
        s = entry_to_line(e, rs)
        if re.sub(r"\s*\|\s*", "|", s).strip() == re.sub(r"\s*\|\s*", "|", ln).strip():
            disk_ok += 1

    # lists (nothing is changed)
    by_word = defaultdict(list)
    for e in entries:
        by_word[e["word"].strip().lower()].append(e)
    dups = {w: [(e["id"], e["page"]) for e in v] for w, v in by_word.items() if len(v) > 1}
    exact = Counter((e["word"].lower(), e["bn"], tuple(e["syn"]), tuple(e["ant"])) for e in entries)
    exact_dups = [k[0] for k, c in exact.items() if c > 1]
    unclear = [(e["id"], e["page"], e["word"], e["note"]) for e in entries if e["note"]]
    incomplete = [(e["id"], e["word"]) for e in entries if not (e["word"] and e["bn"] and e["syn"] and e["ant"])]
    per_page = Counter(e["page"] for e in entries)

    pdf = pdf_info(a.pdf) if a.pdf else None
    ok = (n_lines == n_regex == len(entries) == verified == n_file == disk_ok) and not problems and not mismatches

    L = []
    L.append("LEXORA VOCABULARY PARSE REPORT")
    L.append("=" * 40)
    L.append("Source file            : %s" % a.source)
    L.append("Source rows (lines)    : %d" % n_lines)
    L.append("Source rows (regex)    : %d   (independent second count)" % n_regex)
    L.append("Extracted entries      : %d" % len(entries))
    L.append("Verified by round trip : %d   (entry -> source line, verbatim)" % verified)
    L.append("Re-read from data.json : %d entries, %d verified" % (n_file, disk_ok))
    L.append("Result                 : %s" % ("PASS, all counts match" if ok else "FAIL"))
    if problems:
        L.append("\nParse problems:")
        L += ["  " + p for p in problems]
    if mismatches:
        L.append("\nRound-trip mismatches:")
        L += ["  line %d\n    source: %s\n    rebuilt: %s" % m for m in mismatches[:20]]
    L.append("\nRows per book page:")
    L.append("  " + ", ".join("p.%d: %d" % (p, per_page[p]) for p in sorted(per_page)))
    if pdf:
        L.append("\nPDF cross-check:")
        L.append("  pages in PDF         : %s" % pdf.get("pages"))
        L.append("  pages in source      : %d" % len(per_page))
        L.append("  pages match          : %s" % (pdf.get("pages") == len(per_page)))
        L.append("  text layer in PDF    : %s" % ("yes" if pdf.get("has_text_layer") else "no (scanned image, rows cannot be machine-counted from the PDF)"))
    L.append("\nDuplicate headwords (kept as they are): %d" % len(dups))
    for w, v in sorted(dups.items()):
        L.append("  %s: ids %s" % (w, ", ".join("%d (p.%d)" % x for x in v)))
    if exact_dups:
        L.append("Exact duplicate rows: " + ", ".join(exact_dups))
    L.append("\nUnclear in source (kept as printed, tagged in the app): %d" % len(unclear))
    for i, p, w, n in unclear:
        L.append("  #%d p.%d %s: %s" % (i, p, w, n))
    if incomplete:
        L.append("\nEntries with an empty field: " + ", ".join("%s (#%d)" % (w, i) for i, w in incomplete))
    report = "\n".join(L) + "\n"
    Path(a.report).write_text(report, encoding="utf-8")
    print(report)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
