#!/usr/bin/env python3
"""Fill in missing Belize lottery results in draws.json using the magayo API.

Runs from GitHub Actions every morning (see .github/workflows/update-results.yml).
- Looks at the last LOOKBACK_DAYS of scheduled draws, up to yesterday (Belize time).
- Skips any draw already in draws.json (including "no draw" markers).
- Calls the magayo API only for missing draws, newest first, and never more
  than MONTHLY_API_LIMIT calls in a calendar month (tracked in data/api-usage.json).

Needs only the Python standard library. Settings come from environment variables:
  MAGAYO_API_KEY      (required) your magayo API key, stored as a GitHub secret
  MONTHLY_API_LIMIT   (optional) default 10 (free plan); set 100 for Bronze
  LOOKBACK_DAYS       (optional) default 14
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAWS_FILE = os.path.join(ROOT, "draws.json")
USAGE_FILE = os.path.join(ROOT, "data", "api-usage.json")
API_URL = "https://www.magayo.com/api/results.php"

# Draw days (Monday=0 ... Sunday=6), worked out from past results.
SCHEDULE = {
    "boledo": {0, 1, 2, 3, 4},
    "pick3": {0, 1, 2, 3, 4},
    "fantasy5": {1, 3, 5},
    "lottery": {6},
}
GAME_CODES = {"boledo": "bz_boledo", "lottery": "bz_jackpot", "fantasy5": "bz_fantasy", "pick3": "bz_pick3"}
LABELS = {"boledo": "Boledo", "lottery": "Sunday Lottery", "fantasy5": "Fantasy 5", "pick3": "Pick 3"}
BELIZE = timezone(timedelta(hours=-6))  # Belize has no daylight saving time


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")


def missing_draws(draws, today, lookback):
    """Scheduled draws from the last `lookback` days (up to yesterday) with no entry, newest first."""
    have = {d["id"] for d in draws}
    out = []
    for i in range(1, lookback + 1):
        day = today - timedelta(days=i)
        iso = day.isoformat()
        for game in ("boledo", "lottery", "fantasy5", "pick3"):
            if day.weekday() in SCHEDULE[game] and f"{game}-{iso}" not in have:
                out.append((game, iso))
    return out


def parse_result(game, date, text):
    """Turn the API's results string into a draws.json entry, or None if it doesn't fit."""
    parts = [p.strip() for p in re.split(r"[,\s;]+", str(text)) if p.strip()]
    digits = [p for p in parts if p.isdigit()]
    entry = {"id": f"{game}-{date}", "game": game, "date": date}
    if game == "boledo":
        if not digits or len(digits[0]) > 2:
            return None
        entry["nums"] = [digits[0].zfill(2)]
    elif game == "lottery":
        nums = [d.zfill(4) for d in digits if len(d) <= 4][:3]
        if not nums:
            return None
        entry["nums"] = nums
    elif game == "fantasy5":
        nums = sorted({int(d) for d in digits if 1 <= int(d) <= 39})
        if len(nums) != 5:
            return None
        entry["nums"] = [str(n).zfill(2) for n in nums]
        letter = next((p.upper() for p in parts if re.fullmatch(r"[A-Za-z]", p)), None)
        if letter:
            entry["letter"] = letter
    elif game == "pick3":
        seq = digits[0] if len(digits) == 1 and len(digits[0]) == 3 else "".join(d for d in digits if len(d) == 1)
        if len(seq) != 3:
            return None
        entry["nums"] = list(seq)
    return entry


def call_api(key, game, date):
    query = urllib.parse.urlencode({"api_key": key, "game": GAME_CODES[game], "draw": date})
    req = urllib.request.Request(f"{API_URL}?{query}", headers={"User-Agent": "belize-number-board/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def main():
    key = os.environ.get("MAGAYO_API_KEY", "").strip()
    if not key:
        print("MAGAYO_API_KEY is not set. Add it under Settings > Secrets and variables > Actions.")
        return 1
    limit = int(os.environ.get("MONTHLY_API_LIMIT") or 10)
    lookback = int(os.environ.get("LOOKBACK_DAYS") or 14)

    now = datetime.now(BELIZE)
    month = now.strftime("%Y-%m")
    data = load_json(DRAWS_FILE, {"updated": None, "draws": []})
    draws = data.setdefault("draws", [])
    usage = load_json(USAGE_FILE, {"month": month, "calls": 0})
    if usage.get("month") != month:
        usage = {"month": month, "calls": 0}

    todo = missing_draws(draws, now.date(), lookback)
    report = [f"Missing draws in the last {lookback} days: {len(todo)}",
              f"API calls used this month before this run: {usage['calls']} of {limit}"]
    added, nodraw, skipped = [], [], []

    for game, date in todo:
        if usage["calls"] >= limit:
            skipped.append(f"{LABELS[game]} {date} (monthly limit reached)")
            continue
        try:
            usage["calls"] += 1  # every call counts, even failed ones
            reply = call_api(key, game, date)
        except Exception as e:  # network trouble: try again tomorrow
            skipped.append(f"{LABELS[game]} {date} (could not reach magayo: {type(e).__name__})")
            continue
        err = int(reply.get("error", -1))
        if err == 0:
            if reply.get("draw") != date:
                skipped.append(f"{LABELS[game]} {date} (API returned a different date: {reply.get('draw')})")
                continue
            entry = parse_result(game, date, reply.get("results", ""))
            if entry:
                draws.append(entry)
                added.append(f"{LABELS[game]} {date}: {' '.join(entry['nums'])}{' ' + entry['letter'] if entry.get('letter') else ''}")
            else:
                skipped.append(f"{LABELS[game]} {date} (couldn't read result: {reply.get('results')!r})")
        elif err == 401:  # magayo: no draw on that date
            draws.append({"id": f"{game}-{date}", "game": game, "date": date, "nums": [], "nodraw": True})
            nodraw.append(f"{LABELS[game]} {date}")
        elif err == 303:  # magayo: quota used up
            usage["calls"] = max(usage["calls"], limit)
            skipped.append(f"{LABELS[game]} {date} (magayo says the monthly limit is reached)")
        else:
            skipped.append(f"{LABELS[game]} {date} (magayo error {err})")

    if added or nodraw:
        draws.sort(key=lambda d: (d["date"], d["game"]))
        data["updated"] = now.date().isoformat()
        save_json(DRAWS_FILE, data)
    usage["updated"] = now.isoformat(timespec="minutes")
    save_json(USAGE_FILE, usage)

    report.append(f"API calls used this month after this run: {usage['calls']} of {limit}")
    report += ["", "Added:"] + [f"- {a}" for a in added or ["nothing new"]]
    if nodraw:
        report += ["", "No draw (confirmed by magayo):"] + [f"- {n}" for n in nodraw]
    if skipped:
        report += ["", "Still missing:"] + [f"- {s}" for s in skipped]
    text = "\n".join(report)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## Belize results update\n\n" + text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
