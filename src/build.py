"""Copies src/pay-shared.js into index.html and admin.html (between the PAY:BEGIN / PAY:END markers).
Run from the project folder:  python3 src/build.py"""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
shared = (root / "src" / "pay-shared.js").read_text().strip()
pat = re.compile(r"/\* PAY:BEGIN \*/.*?/\* PAY:END \*/", re.S)
for name in ("index.html", "admin.html"):
    f = root / name
    if not f.exists():
        continue
    text = f.read_text()
    if not pat.search(text):
        raise SystemExit(f"{name}: PAY markers not found")
    f.write_text(pat.sub(lambda _: "/* PAY:BEGIN */\n" + shared + "\n/* PAY:END */", text, count=1))
    print("updated", name)
