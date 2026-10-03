"""Subset the Chinese serif (Noto Serif SC, OFL) to the characters the film uses.

    uv run python fonts.py

The full variable font is 25 MB; the film needs a few dozen characters. Scans app/src for CJK text,
instances the weights we use and writes app/public/fonts/NotoSerifSC-<weight>.ttf (a few tens of KB).
Run it again after adding Chinese text anywhere under app/src.
"""
from __future__ import annotations

import re
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[1]
SRC_URL = "https://github.com/google/fonts/raw/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf"
CACHE = ROOT / "analysis/.cache/NotoSerifSC-VF.ttf"
WEIGHTS = (500, 900)
CJK = re.compile(r"[　-〿㐀-鿿＀-￯—…《》]")


def main():
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {SRC_URL}")
        urllib.request.urlretrieve(SRC_URL, CACHE)
    chars = set()
    for f in (ROOT / "app/src").rglob("*.ts"):
        chars |= set(CJK.findall(f.read_text(encoding="utf-8")))
    # Latin, digits and punctuation too, so a mixed line (e.g. "Opus 5.5，") sits in one face
    text = "".join(sorted(chars)) + "".join(chr(c) for c in range(0x20, 0x7f))
    print(f"{len(chars)} CJK characters: {''.join(sorted(chars))}")
    for w in WEIGHTS:
        vf = TTFont(CACHE)
        f = instancer.instantiateVariableFont(vf, {"wght": w})
        opts = subset.Options()
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        sub = subset.Subsetter(opts)
        sub.populate(text=text)
        sub.subset(f)
        out = ROOT / f"app/public/fonts/NotoSerifSC-{w}.ttf"
        f.save(out)
        print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
