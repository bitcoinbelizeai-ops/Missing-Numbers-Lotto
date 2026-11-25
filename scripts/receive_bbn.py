"""Receive one lottery result read from a BBN Belize Facebook post (sent by Make.com).
Since 25 Nov 2026 also Love FM's Facebook text posts (Boledo only): payload {"source": "lovefm", "text_b64": <base64 of the post text>} (or "text");
they go through exactly the same safety rules and are saved with source "lovefm".

MAIN SOURCE since Nov 20, 2026: every result is saved to data/bbn-results.json, and a
good result for a draw the site doesn't have yet is ADDED to draws.json at once
(source "bbn"). Safety rules, all must pass:
- the numbers pass the same checks as the Admin page;
- the date is a scheduled draw day for that game and no more than PUBLISH_DAYS old;
- the Facebook post was made after that draw started (no old pictures or promo graphics);
- the site has nothing for that draw yet: an existing result (or a "no draw" marker)
  is NEVER changed; a disagreement is only recorded (red warning on the Admin page);
- manual test runs (Run workflow button) are never published.
magayo (update_results.py) is the backup and double-checks BBN's results overnight.

Input (from the GitHub job):
  PAYLOAD_JSON  the repository_dispatch client_payload:
                {"answer": {...GPT answer...}, "post_id": "...", "post_time": "..."}
  TEST_ANSWER   (manual test runs only) an answer JSON pasted into the Run workflow form
"""
import base64
import binascii
import datetime as dt
import json
import os
import re
import sys

RESULTS = "data/bbn-results.json"
DRAWS = "draws.json"
LABELS = {"boledo": "Boledo", "lottery": "Sunday Jackpot", "fantasy5": "Fantasy 5", "pick3": "Pick 3"}
KEEP = 400  # newest entries kept in data/bbn-results.json
BELIZE = dt.timezone(dt.timedelta(hours=-6))
PUBLISH_DAYS = 3  # only publish results for draws from today and the last 3 days
HOLIDAYS_FILE = "data/holidays.json"
HOLIDAY_GAMES = ("boledo", "pick3", "fantasy5")  # no draw on public holidays
# Draw days (Monday=0 ... Sunday=6) and draw START times, Belize time (same as the app)
SCHEDULE = {"boledo": ({0, 1, 2, 3, 4}, (21, 0)), "pick3": ({0, 1, 2, 3, 4}, (20, 30)),
            "fantasy5": ({1, 3, 5}, (20, 0)), "lottery": ({6}, (10, 0))}


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")


def as_obj(v):
    """Make.com may send the answer as an object or as JSON text."""
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return {}
        return json.loads(v)
    return v or {}


def check(ans):
    """Return (draw, problem). The same rules as the Admin page."""
    game = str(ans.get("game", "")).strip().lower()
    if game not in LABELS:
        return None, f"unknown game {game!r}"
    date = str(ans.get("date", "")).strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        return None, f"date {date!r} is not YYYY-MM-DD"
    try:
        day = dt.date.fromisoformat(date)
    except ValueError:
        return None, f"date {date!r} is not a real date"
    today = dt.datetime.now(BELIZE).date()
    if day > today:
        return None, f"date {date} is in the future"
    if day.year < 2020:
        return None, f"date {date} is too old"
    nums = [str(x).strip() for x in (ans.get("nums") or [])]
    draw = {"id": f"{game}-{date}", "game": game, "date": date}
    if game == "boledo":
        if len(nums) == 2 and all(re.fullmatch(r"\d", x) for x in nums):
            nums = [nums[0] + nums[1]]  # two single-digit boxes
        if len(nums) != 1 or not re.fullmatch(r"\d{1,2}", nums[0]):
            return None, f"Boledo needs one number 00-99, got {nums}"
        draw["nums"] = [nums[0].zfill(2)]
    elif game == "lottery":
        if len(nums) != 3 or not all(re.fullmatch(r"\d{1,4}", x) for x in nums):
            return None, f"Sunday Jackpot needs three 4-digit prizes, got {nums}"
        draw["nums"] = [x.zfill(4) for x in nums]
    elif game == "fantasy5":
        if len(nums) != 5 or not all(re.fullmatch(r"\d{1,2}", x) for x in nums):
            return None, f"Fantasy 5 needs five numbers, got {nums}"
        vals = sorted(int(x) for x in nums)
        if len(set(vals)) != 5 or not all(1 <= v <= 39 for v in vals):
            return None, f"Fantasy 5 numbers must be 5 different numbers from 1 to 39, got {nums}"
        draw["nums"] = [str(v).zfill(2) for v in vals]
        letter = ans.get("letter")
        if letter:
            letter = str(letter).strip().upper()
            if not re.fullmatch(r"[A-Z]", letter):
                return None, f"free ticket letter {letter!r} is not a single letter"
            draw["letter"] = letter
    else:  # pick3
        if len(nums) == 1 and re.fullmatch(r"\d{3}", nums[0]):
            nums = list(nums[0])
        if len(nums) != 3 or not all(re.fullmatch(r"\d", x) for x in nums):
            return None, f"Pick 3 needs three digits, got {nums}"
        draw["nums"] = nums
    return draw, None


def compare(draw, site):
    have = next((d for d in site if d.get("id") == draw["id"]), None)
    if not have or have.get("nodraw"):
        return "only-bbn", None
    same = have.get("nums") == draw["nums"] and (draw["game"] != "fantasy5" or (have.get("letter") or None) == (draw.get("letter") or None))
    return ("match" if same else "differs"), {"nums": have.get("nums"), "letter": have.get("letter")}


def publish_problem(draw, post_time, manual, site):
    """Why this result must NOT be added to the site automatically, or None if it may be."""
    if manual:
        return "manual test: not published"
    day = dt.date.fromisoformat(draw["date"])
    days, (h, m) = SCHEDULE[draw["game"]]
    if day.weekday() not in days:
        return f"{LABELS[draw['game']]} isn't drawn on a {day.strftime('%A')}: not published, check it"
    today = dt.datetime.now(BELIZE).date()
    if (today - day).days > PUBLISH_DAYS:
        return f"older than {PUBLISH_DAYS} days: not published"
    try:
        posted = dt.datetime.fromisoformat(post_time.replace("Z", "+00:00"))
        if posted.tzinfo is None:
            raise ValueError
    except (ValueError, AttributeError):
        return "Facebook post time missing: not published"
    hol = (load(HOLIDAYS_FILE, {}) or {}).get("days") or {}
    if draw["game"] in HOLIDAY_GAMES and draw["date"] in hol:
        name = (hol[draw["date"]] or {}).get("name", "public holiday")
        return f"that day was a public holiday ({name}), so there's normally no draw: not published, check it"
    start = dt.datetime(day.year, day.month, day.day, h, m, tzinfo=BELIZE)
    if posted < start:
        return "posted before the draw started (old picture or promo?): not published"
    have = next((d for d in site if d.get("id") == draw["id"]), None)
    if have and have.get("nodraw"):
        return "the site says there was no draw that day: not published, check it"
    if have:
        return "the site already has this draw"
    return None


SOURCES = {"bbn": "BBN", "lovefm": "Love FM"}
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
# Love FM's Facebook text post (same wording since at least Feb 2025):
#   "The Winning Boledo Number for Tuesday November 24, 2026 is: 02"
LOVEFM_BOLEDO = re.compile(
    r"Winning\s+Boledo\s+Number\s+for\s+(?:[A-Za-z]+day,?\s+)?([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s*(?:is)?\s*:?\s*(\d{1,2})\b",
    re.IGNORECASE)


def parse_lovefm(text):
    """Turn a Love FM post into the same answer shape the BBN picture reader gives.
    Added 25 Nov 2026 (Love FM = second source, Boledo only). Anything else is 'not a result'."""
    m = LOVEFM_BOLEDO.search(str(text or ""))
    if not m:
        return {"is_result": False, "game": "none"}
    month = MONTHS.get(m.group(1)[:3].lower())
    if not month:
        return {"is_result": True, "game": "boledo", "date": "", "nums": [m.group(4)], "readable": True,
                "notes": f"unknown month {m.group(1)!r}"}
    return {"is_result": True, "game": "boledo", "date": f"{m.group(3)}-{month:02d}-{int(m.group(2)):02d}",
            "nums": [m.group(4)], "letter": None, "readable": True, "notes": ""}


def lovefm_text(payload):
    """Make sends the post text base64-encoded ("text_b64") so line breaks or quotes can't break the JSON;
    a plain "text" field also works (tests)."""
    b64 = str(payload.get("text_b64") or "").strip()
    if b64:
        try:
            return base64.b64decode(b64 + "=" * (-len(b64) % 4)).decode("utf-8", "replace")
        except (ValueError, binascii.Error):
            return ""
    return payload.get("text") or ""


def main():
    payload = as_obj(os.environ.get("PAYLOAD_JSON") or "{}")
    test = os.environ.get("TEST_ANSWER", "").strip()
    if test:
        payload = {"answer": test, "post_id": "manual-test-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M%S"), "post_time": ""}
    source = str(payload.get("source") or "bbn").strip().lower()
    if source not in SOURCES:
        print(f"Unknown source {source!r}. Nothing saved.")
        return 0
    try:
        ans = parse_lovefm(lovefm_text(payload)) if source == "lovefm" else as_obj(payload.get("answer", payload))
    except json.JSONDecodeError as e:
        print(f"Could not read the answer: {e}")
        return 0
    post_id = str(payload.get("post_id") or "")[:80]
    post_time = str(payload.get("post_time") or "")[:40]

    manual = post_id.startswith("manual-test")

    if not ans.get("is_result", True) or ans.get("game") == "none":
        print("Not a result picture. Nothing saved.")
        return 0

    store = load(RESULTS, {"results": []})
    store["note"] = "Results read from BBN Belize (pictures) and Love FM (text, Boledo only) Facebook posts. Good new results are added to the site automatically (BBN main source since Nov 20, 2026; Love FM backup since Nov 25, 2026)."
    results = store.setdefault("results", [])
    if post_id and any(r.get("post_id") == post_id for r in results):
        print(f"Post {post_id} was already received. Nothing saved.")
        return 0

    entry = {
        "received": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
        "post_id": post_id,
        "post_time": post_time,
        "game": str(ans.get("game", ""))[:20],
        "date": str(ans.get("date", ""))[:20],
        "read_as": {"nums": ans.get("nums"), "letter": ans.get("letter")},
    }
    if ans.get("readable") is False:
        entry["status"] = "unreadable"
        entry["detail"] = str(ans.get("notes") or "the picture was unclear")[:300]
    else:
        draw, problem = check(ans)
        if problem:
            entry["status"] = "invalid"
            entry["detail"] = problem
        else:
            entry["draw"] = draw
            site_data = load(DRAWS, {"updated": None, "draws": []})
            site = site_data.setdefault("draws", [])
            entry["status"], entry["site"] = compare(draw, site)
            if entry["site"] is None:
                entry.pop("site")
            why = publish_problem(draw, post_time, manual, site)
            if why is None:
                site.append(dict(draw, source=source, added=entry["received"]))
                site.sort(key=lambda d: (d["date"], d["game"]))
                site_data["updated"] = dt.datetime.now(BELIZE).date().isoformat()
                save(DRAWS, site_data)
                entry["published"] = True
            elif entry["status"] != "match":
                entry["detail"] = why

    results.append(entry)
    store["results"] = results[-KEEP:]
    store["updated"] = entry["received"]
    save(RESULTS, store)
    label = LABELS.get(entry["game"], entry["game"])
    print(f"Saved ({SOURCES[source]}): {label} {entry['date']} -> {entry['status']}" + (" -> ADDED TO THE SITE" if entry.get("published") else "") + (f" ({entry.get('detail')})" if entry.get("detail") else ""))
    out = os.environ.get("GITHUB_STEP_SUMMARY")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"### {SOURCES[source]} result\n\n**{label} {entry['date']}**: {entry['status']}{' (added to the site)' if entry.get('published') else ''}\n\n")
            if entry.get("draw"):
                f.write(f"- {SOURCES[source]}: {' '.join(entry['draw']['nums'])} {entry['draw'].get('letter', '')}\n")
            if entry.get("site"):
                f.write(f"- Site: {' '.join(entry['site']['nums'] or [])} {entry['site'].get('letter') or ''}\n")
            if entry.get("detail"):
                f.write(f"- Note: {entry['detail']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
