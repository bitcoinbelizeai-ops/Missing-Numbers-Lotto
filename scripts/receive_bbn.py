"""Receive one lottery result read from a BBN Belize Facebook post (sent by Make.com).

TEST MODE: results are saved to data/bbn-results.json and compared with draws.json.
Nothing here changes draws.json. A result reaches the site only when the admin
adds it from the Admin page.

Input (from the GitHub job):
  PAYLOAD_JSON  the repository_dispatch client_payload:
                {"answer": {...GPT answer...}, "post_id": "...", "post_time": "..."}
  TEST_ANSWER   (manual test runs only) an answer JSON pasted into the Run workflow form
"""
import datetime as dt
import json
import os
import re
import sys

RESULTS = "data/bbn-results.json"
DRAWS = "draws.json"
LABELS = {"boledo": "Boledo", "lottery": "Sunday Jackpot", "fantasy5": "Fantasy 5", "pick3": "Pick 3"}
KEEP = 400  # newest entries kept in the test file
BELIZE = dt.timezone(dt.timedelta(hours=-6))


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


def main():
    payload = as_obj(os.environ.get("PAYLOAD_JSON") or "{}")
    test = os.environ.get("TEST_ANSWER", "").strip()
    if test:
        payload = {"answer": test, "post_id": "manual-test-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M%S"), "post_time": ""}
    try:
        ans = as_obj(payload.get("answer", payload))
    except json.JSONDecodeError as e:
        print(f"Could not read the answer: {e}")
        return 0
    post_id = str(payload.get("post_id") or "")[:80]
    post_time = str(payload.get("post_time") or "")[:40]

    if not ans.get("is_result", True) or ans.get("game") == "none":
        print("Not a result picture. Nothing saved.")
        return 0

    store = load(RESULTS, {"note": "TEST: results read from BBN Belize Facebook posts. Not used by the site.", "results": []})
    results = store.setdefault("results", [])
    if post_id and any(r.get("post_id") == post_id for r in results):
        print(f"Post {post_id} was already received. Nothing saved.")
        return 0

    entry = {
        "received": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
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
            site = load(DRAWS, {"draws": []}).get("draws", [])
            entry["status"], entry["site"] = compare(draw, site)
            if entry["site"] is None:
                entry.pop("site")

    results.append(entry)
    store["results"] = results[-KEEP:]
    store["updated"] = entry["received"]
    save(RESULTS, store)
    label = LABELS.get(entry["game"], entry["game"])
    print(f"Saved: {label} {entry['date']} -> {entry['status']}" + (f" ({entry.get('detail')})" if entry.get("detail") else ""))
    out = os.environ.get("GITHUB_STEP_SUMMARY")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"### BBN test result\n\n**{label} {entry['date']}**: {entry['status']}\n\n")
            if entry.get("draw"):
                f.write(f"- BBN: {' '.join(entry['draw']['nums'])} {entry['draw'].get('letter', '')}\n")
            if entry.get("site"):
                f.write(f"- Site: {' '.join(entry['site']['nums'] or [])} {entry['site'].get('letter') or ''}\n")
            if entry.get("detail"):
                f.write(f"- Note: {entry['detail']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
