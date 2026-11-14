#!/usr/bin/env python3
"""Fill in missing Belize lottery results in draws.json using the magayo API.

Runs from GitHub Actions on a schedule matched to the draw times
(see .github/workflows/update-results.yml).
- Looks at the last LOOKBACK_DAYS of scheduled draws (Belize time), but only draws
  whose draw time was at least READY_HOURS ago, so magayo has had time to post them.
- Skips any draw already in draws.json (including "no draw" markers).
- Calls the magayo API only for missing draws, newest first.

Safeguards against using too many calls (count kept in data/api-usage.json):
- Stops at MONTHLY_API_LIMIT minus SAFETY_RESERVE (100 - 5 = 95 on Bronze).
- At most MAX_CALLS_PER_RUN calls in one run (a normal run needs 1 to 3).
- Older gaps (more than 3 days old) are only filled while enough calls are left to
  cover every draw still to come before the plan resets, so new draws always get fetched.
- Each draw is asked for at most MAX_TRIES times; after that it's left for a person.
- Stops the run on magayo's "limit reached" answer, on a bad key, or after
  2 failed connections in a row.
- If the usage file is damaged, it makes no calls at all and shows a red X.
- The count resets on API_RESET_DAY of each month (default 1). If your magayo plan
  renews on another day, set that day so the count matches magayo's.

Needs only the Python standard library. Settings come from environment variables:
  MAGAYO_API_KEY      (required) your magayo API key, stored as a GitHub secret
  MONTHLY_API_LIMIT   (optional) default 10 (free plan); 100 for Bronze
  SAFETY_RESERVE      (optional) default 5: calls kept spare each month
  MAX_CALLS_PER_RUN   (optional) default 10
  API_RESET_DAY       (optional) default 1: day of the month the magayo count resets
  LOOKBACK_DAYS       (optional) default 14
  READY_HOURS         (optional) default 3: wait this long after a draw before asking for it
"""
import calendar
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date as Date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAWS_FILE = os.path.join(ROOT, "draws.json")
USAGE_FILE = os.path.join(ROOT, "data", "api-usage.json")
API_URL = "https://www.magayo.com/api/results.php"

# Draw days (Monday=0 ... Sunday=6) and draw times, Belize time.
# Sources (checked Nov 14, 2026): Belize Government Lotteries (Boledo, Sunday Lottery),
# the game operator's site (Fantasy 5, Pick 3).
SCHEDULE = {
    "boledo": {0, 1, 2, 3, 4},   # Mon-Fri 9:10 pm
    "pick3": {0, 1, 2, 3, 4},    # Mon-Fri 8:30 pm
    "fantasy5": {1, 3, 5},       # Tue, Thu, Sat 8:00 pm
    "lottery": {6},              # Sun 10:00 am (a postponed draw can move to Monday)
}
DRAW_TIME = {"boledo": (21, 10), "pick3": (20, 30), "fantasy5": (20, 0), "lottery": (10, 0)}
# A "no draw" answer for a draw younger than this is treated as "not posted yet" and retried next run.
NODRAW_MIN_AGE_HOURS = 24
FRESH_DAYS = 3        # draws newer than this are always fetched first (within the limits)
MAX_TRIES = 3         # never ask magayo about the same draw more than this
GAME_CODES = {"boledo": "bz_boledo", "lottery": "bz_jackpot", "fantasy5": "bz_fantasy", "pick3": "bz_pick3"}
LABELS = {"boledo": "Boledo", "lottery": "Sunday Lottery", "fantasy5": "Fantasy 5", "pick3": "Pick 3"}
BELIZE = timezone(timedelta(hours=-6))  # Belize has no daylight saving time


class DamagedFile(Exception):
    pass


def load_json(path, default):
    """Read a JSON file. A missing file gives `default`; a damaged one raises DamagedFile."""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise DamagedFile(f"{os.path.relpath(path, ROOT)} can't be read ({e})")


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")


def env_int(name, default, low, high):
    try:
        v = int(str(os.environ.get(name) or default).strip())
    except ValueError:
        v = default
    return max(low, min(high, v))


def period_bounds(today, reset_day):
    """First and last day of the current magayo counting period."""
    def on(y, m):
        return Date(y, m, min(reset_day, calendar.monthrange(y, m)[1]))
    start = on(today.year, today.month)
    if today < start:
        y, m = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
        start = on(y, m)
    y, m = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    return start, on(y, m) - timedelta(days=1)


def draws_still_to_come(now, period_end):
    """How many scheduled draws are left between now and the end of the counting period."""
    n, day = 0, now.date()
    while day <= period_end:
        for game, days in SCHEDULE.items():
            if day.weekday() in days and draw_moment(game, day.isoformat()) > now:
                n += 1
        day += timedelta(days=1)
    return n


def draw_moment(game, iso):
    h, m = DRAW_TIME[game]
    y, mo, d = map(int, iso.split("-"))
    return datetime(y, mo, d, h, m, tzinfo=BELIZE)


def missing_draws(draws, now, lookback, ready_hours):
    """Scheduled draws from the last `lookback` days that are old enough to be posted
    and have no entry yet, newest first."""
    by_id = {d["id"]: d for d in draws}
    ready_before = now - timedelta(hours=ready_hours)
    out = []
    for i in range(0, lookback + 1):
        day = now.date() - timedelta(days=i)
        iso = day.isoformat()
        for game in ("boledo", "lottery", "fantasy5", "pick3"):
            on_schedule = day.weekday() in SCHEDULE[game]
            if game == "lottery" and day.weekday() == 0:
                # A Sunday Lottery draw postponed to Monday: only look if Sunday had no draw.
                sun = by_id.get(f"lottery-{(day - timedelta(days=1)).isoformat()}")
                on_schedule = bool(sun and sun.get("nodraw"))
            if on_schedule and f"{game}-{iso}" not in by_id and draw_moment(game, iso) <= ready_before:
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
    limit = env_int("MONTHLY_API_LIMIT", 10, 0, 100000)
    reserve = env_int("SAFETY_RESERVE", 5, 0, limit)
    per_run = env_int("MAX_CALLS_PER_RUN", 10, 0, 1000)
    reset_day = env_int("API_RESET_DAY", 1, 1, 31)
    lookback = env_int("LOOKBACK_DAYS", 14, 1, 60)
    ready_hours = float(os.environ.get("READY_HOURS") or 3)
    stop_at = limit - reserve

    now = datetime.now(BELIZE)
    p_start, p_end = period_bounds(now.date(), reset_day)
    period = p_start.isoformat()

    try:
        data = load_json(DRAWS_FILE, {"updated": None, "draws": []})
        usage = load_json(USAGE_FILE, None)
    except DamagedFile as e:
        print(f"STOPPED before any API call: {e}. Fix or restore the file, then run again.")
        return 2
    draws = data.setdefault("draws", [])
    if usage is None:
        usage = {"period": period, "calls": 0}
    if "period" not in usage and "month" in usage:  # older file format: calendar months
        usage["period"] = usage.pop("month") + "-01"
    usage.setdefault("calls", 0)
    usage.setdefault("tries", {})
    new_period = usage.get("period") != period
    if new_period and int(usage.get("reset_day", 1)) != reset_day:
        # API_RESET_DAY was changed: we can't tell how many calls magayo has counted
        # in its current period, so carry the count over instead of starting at 0.
        usage["period"] = period
    elif new_period:
        usage = {"period": period, "calls": 0, "tries": {}}
    usage["reset_day"] = reset_day
    tries = usage["tries"]
    oldest = (now.date() - timedelta(days=lookback + 1)).isoformat()
    for k in [k for k in tries if k.split("-", 1)[1] < oldest]:
        del tries[k]  # forget tries for draws outside the window

    todo = missing_draws(draws, now, lookback, ready_hours)
    calls_before = usage["calls"]
    to_come = draws_still_to_come(now, p_end)
    fresh_after = (now.date() - timedelta(days=FRESH_DAYS)).isoformat()
    report = [f"Counting period: {p_start} to {p_end}",
              f"Missing draws in the last {lookback} days: {len(todo)}",
              f"API calls used before this run: {calls_before} of {limit} (stops at {stop_at}; {to_come} draws still to come this period)"]
    added, nodraw, skipped = [], [], []
    fatal = None
    run_calls = 0
    conn_fail = 0

    for i, (game, date) in enumerate(todo):
        did = f"{game}-{date}"
        label = f"{LABELS[game]} {date}"
        left = stop_at - usage["calls"]
        if left <= 0:
            skipped.append(f"{label} (monthly limit reached, keeping {reserve} spare)")
            continue
        if run_calls >= per_run:
            skipped.append(f"{label} (left for the next run: {per_run} calls per run)")
            continue
        if tries.get(did, 0) >= MAX_TRIES:
            skipped.append(f"{label} (asked {MAX_TRIES} times with no usable answer; add it by hand)")
            continue
        if date < fresh_after and left <= to_come:
            skipped.append(f"{label} (older gap: saving calls for the {to_come} draws still to come)")
            continue
        usage["calls"] += 1  # every call counts, even failed ones
        run_calls += 1
        tries[did] = tries.get(did, 0) + 1
        try:
            reply = call_api(key, game, date)
            conn_fail = 0
        except Exception as e:
            conn_fail += 1
            skipped.append(f"{label} (could not reach magayo: {type(e).__name__})")
            if conn_fail >= 2:
                for g2, d2 in todo[i + 1:]:
                    skipped.append(f"{LABELS[g2]} {d2} (not tried: magayo unreachable, next run will try)")
                break
            continue
        try:
            err = int(reply.get("error", -1))
        except (TypeError, ValueError, AttributeError):
            err = -1
        if err == 0:
            if reply.get("draw") != date:
                skipped.append(f"{label} (API returned a different date: {reply.get('draw')})")
                continue
            entry = parse_result(game, date, reply.get("results", ""))
            if entry:
                draws.append(entry)
                tries.pop(did, None)
                added.append(f"{label}: {' '.join(entry['nums'])}{' ' + entry['letter'] if entry.get('letter') else ''}")
            else:
                skipped.append(f"{label} (couldn't read result: {reply.get('results')!r})")
        elif err == 401 and now - draw_moment(game, date) < timedelta(hours=NODRAW_MIN_AGE_HOURS):
            # Probably just not posted yet: don't mark it, ask again on the next run.
            skipped.append(f"{label} (not posted yet, will try again next run)")
        elif err == 401:  # magayo: no draw on that date
            draws.append({"id": did, "game": game, "date": date, "nums": [], "nodraw": True})
            tries.pop(did, None)
            nodraw.append(label)
        elif err in (100, 101, 102, 300):  # key missing, wrong or suspended: stop, nothing else will work
            usage["calls"] -= 1  # magayo can't charge an unrecognised key, so don't count it
            run_calls -= 1
            tries[did] -= 1
            fatal = {100: "API key not provided", 101: "invalid API key", 102: "API key not found",
                     300: "magayo account suspended"}[err]
            skipped.append(f"{label} (magayo error {err}: {fatal})")
            for g2, d2 in todo[i + 1:]:
                skipped.append(f"{LABELS[g2]} {d2} (not tried: {fatal})")
            break
        elif err == 303:  # magayo: quota used up. Stop and don't call again this period.
            usage["calls"] = max(usage["calls"], limit)
            skipped.append(f"{label} (magayo says the monthly limit is reached)")
            for g2, d2 in todo[i + 1:]:
                skipped.append(f"{LABELS[g2]} {d2} (not tried: magayo limit reached)")
            break
        else:
            skipped.append(f"{label} (magayo error {err})")

    if added or nodraw:
        draws.sort(key=lambda d: (d["date"], d["game"]))
        data["updated"] = now.date().isoformat()
        save_json(DRAWS_FILE, data)
    if usage["calls"] != calls_before or new_period or run_calls:  # no calls, no commit
        usage["limit"] = limit
        usage["updated"] = now.isoformat(timespec="minutes")
        save_json(USAGE_FILE, usage)

    report.append(f"API calls this run: {run_calls}. Used this period: {usage['calls']} of {limit}")
    if usage["calls"] >= 0.8 * limit:
        report.append(f"WARNING: {usage['calls']} of {limit} calls used. The count resets on {p_end + timedelta(days=1)}.")
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
            f.write("## Belize results update\n\n" + text.replace("\n", "  \n") + "\n")
    if fatal:
        print(f"\nSTOPPED: {fatal}. Check the MAGAYO_API_KEY secret (Settings > Secrets and variables > Actions).")
        return 2  # makes the run show a red X so it gets noticed
    return 0


if __name__ == "__main__":
    sys.exit(main())
