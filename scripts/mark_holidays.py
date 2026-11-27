#!/usr/bin/env python3
"""Save "no draw" markers in draws.json for public holidays.

No Boledo, Pick 3 or Fantasy 5 draw is held on a Belize public holiday (Lotteries Control
Regulations; the game operator). Once the draw time has passed, this saves a "no draw" marker
(source "holiday") so the app and the Admin page stop waiting for a result.
The list of holidays lives in data/holidays.json (editable from the Admin page).

Until 27 Nov 2026 this was part of update_results.py (the old backup results job). That API
account was cancelled, so only the holiday part is kept. Needs only the Python standard library.
Runs from .github/workflows/mark-holidays.yml. Optional setting: LOOKBACK_DAYS (default 14).
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAWS_FILE = os.path.join(ROOT, "draws.json")
HOLIDAYS_FILE = os.path.join(ROOT, "data", "holidays.json")

HOLIDAY_GAMES = ("boledo", "pick3", "fantasy5")
# Draw days (Monday=0 ... Sunday=6) and draw times, Belize time.
SCHEDULE = {"boledo": {0, 1, 2, 3, 4}, "pick3": {0, 1, 2, 3, 4}, "fantasy5": {1, 3, 5}}
DRAW_TIME = {"boledo": (21, 0), "pick3": (20, 30), "fantasy5": (20, 0)}
LABELS = {"boledo": "Boledo", "fantasy5": "Fantasy 5", "pick3": "Pick 3"}
BELIZE = timezone(timedelta(hours=-6))  # Belize has no daylight saving time


def load_json(path, default):
    """A missing file gives `default`; a damaged one raises ValueError."""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ValueError(f"{os.path.relpath(path, ROOT)} can't be read ({e})")


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")


def draw_moment(game, iso):
    h, m = DRAW_TIME[game]
    y, mo, d = map(int, iso.split("-"))
    return datetime(y, mo, d, h, m, tzinfo=BELIZE)


def holiday_markers(draws, holidays, now, lookback):
    """Scheduled draws on a public holiday, draw time passed, nothing saved yet: (game, iso, name)."""
    have = {d.get("id") for d in draws}
    out = []
    for i in range(0, lookback + 1):
        day = now.date() - timedelta(days=i)
        iso = day.isoformat()
        h = holidays.get(iso)
        if not isinstance(h, dict):
            continue
        for game in HOLIDAY_GAMES:
            if day.weekday() in SCHEDULE[game] and f"{game}-{iso}" not in have and draw_moment(game, iso) <= now:
                out.append((game, iso, str(h.get("name") or "public holiday")[:60]))
    return out


def main():
    try:
        lookback = max(1, min(60, int(os.environ.get("LOOKBACK_DAYS") or 14)))
    except ValueError:
        lookback = 14
    now = datetime.now(BELIZE)
    try:
        data = load_json(DRAWS_FILE, {"updated": None, "draws": []})
        holidays = (load_json(HOLIDAYS_FILE, {}) or {}).get("days") or {}
    except ValueError as e:
        print(f"STOPPED: {e}. Fix or restore the file, then run again.")
        return 2
    draws = data.setdefault("draws", [])
    marked = []
    for game, iso, name in holiday_markers(draws, holidays, now, lookback):
        draws.append({"id": f"{game}-{iso}", "game": game, "date": iso, "nums": [], "nodraw": True, "source": "holiday",
                      "holiday": name, "added": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
        marked.append(f"{LABELS[game]} {iso} ({name})")
    if marked:
        draws.sort(key=lambda d: (d["date"], d["game"]))
        data["updated"] = now.date().isoformat()
        save_json(DRAWS_FILE, data)
    text = "No draw (public holiday):\n" + "\n".join(f"- {m}" for m in marked) if marked else "No holiday markers needed."
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## Public holidays\n\n" + text.replace("\n", "  \n") + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
