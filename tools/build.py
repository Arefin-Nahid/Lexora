#!/usr/bin/env python3
"""Build step: parse and verify the vocabulary, embed data.json into the HTML template, stamp a version.

    python3 tools/build.py            # parse + verify + build index.html and refresh sw.js
    python3 tools/build.py --no-parse # reuse the existing data/data.json (still checks it)

The build stops if the parser's counts do not match."""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import parse_vocab  # noqa: E402

ASSETS = ["index.html", "manifest.webmanifest", "css/app.css", "js/srs.js", "js/quiz.js", "js/store.js", "js/session.js",
          "js/sync.js", "js/firebase-config.js", "js/firebase-adapter.js", "js/app.js",
          "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"]


def main():
    if "--no-parse" not in sys.argv:
        if parse_vocab.main([]) != 0:
            print("Parser reported a mismatch. Build stopped.", file=sys.stderr)
            return 1
    data_path = ROOT / "data/data.json"
    data = json.loads(data_path.read_text(encoding="utf-8"))
    if data["meta"]["entries"] != len(data["entries"]) or not data["entries"]:
        print("data.json is inconsistent. Build stopped.", file=sys.stderr)
        return 1

    h = hashlib.sha1()
    for rel in ["data/data.json", "src/index.template.html", "css/app.css"] + sorted(str(p.relative_to(ROOT)) for p in (ROOT / "js").glob("*.js")):
        h.update((ROOT / rel).read_bytes())
    version = h.hexdigest()[:8]

    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    html = (ROOT / "src/index.template.html").read_text(encoding="utf-8")
    html = html.replace("__VERSION__", version).replace("__DATA__", payload)
    (ROOT / "index.html").write_text(html, encoding="utf-8")

    # service worker: version and the list of files to keep for offline use
    shell = []
    for a in ASSETS:
        if a in ("index.html", "manifest.webmanifest") or a.startswith("icons/"):
            shell.append(a)
        else:
            shell.append("%s?v=%s" % (a, version))
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    sw = re.sub(r"const VERSION = '[^']*';", "const VERSION = 'lexora-%s';" % version, sw)
    sw = re.sub(r"/\*SHELL_START\*/.*?/\*SHELL_END\*/", "/*SHELL_START*/" + json.dumps(["./"] + shell) + "/*SHELL_END*/", sw, flags=re.S)
    (ROOT / "sw.js").write_text(sw, encoding="utf-8")
    print("Built index.html (version %s, %d entries, %d KB)" % (version, len(data["entries"]), len(html) // 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
