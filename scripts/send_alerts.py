"""Send draw alerts (web push) for new results in draws.json. Added 22 Nov 2026.

Runs at the end of both results jobs (BBN and magayo). It never changes draws.json and never
fails the job: any problem is printed and the job carries on.

Rules (agreed with the owner, 22 Nov 2026):
- One alert per draw, only to phones that picked that game. Draws that land close together
  (one run) go out as ONE alert.
- Each alert shows the winning number(s) plus one hook, in this order (23 Nov 2026):
  1. a Lucky Number that hit;
  2. news: the same number again soon (back-to-back, or 2nd time within 5 draws; Fantasy 5 needs
     3 repeats or 3 draws in a row; Pick 3 needs the whole number, or a digit 3 draws in a row),
     a number back after a long break (CAME_BACK), or a new longest-wait record (only once a game
     has RECORD_MIN_DRAWS of history);
  3. a Lucky Number still out;
  4. a plain fact, alternating: the longest wait, or how many numbers haven't played lately.
  Wording reports what happened; it never says a number is "due".
- No alerts 10:30 pm to 6:00 am Belize time: held and sent on the next run after 6:00 am.
- Old results (more than 14 hours after the draw) are never alerted (no late or catch-up spam).
- After 10 alerts in a row not opened, the phone gets one "paused" note and then only a
  weekly roundup (Sunday morning). Tapping any alert turns per-draw alerts back on.

Needs (GitHub secrets): VAPID_PRIVATE_KEY, PUSH_SENDER_TOKEN. Without them it does nothing.
The Supabase address and public key are read from supabase-config.js.
Test without sending: python scripts/send_alerts.py --dry-run [--now 2026-11-23T21:10]
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.request

DRAWS = "draws.json"
BELIZE = dt.timezone(dt.timedelta(hours=-6))
LABELS = {"boledo": "Boledo", "lottery": "Sunday Jackpot", "fantasy5": "Fantasy 5", "pick3": "Pick 3"}
AT = {"boledo": (21, 0), "pick3": (20, 30), "fantasy5": (20, 0), "lottery": (10, 0)}
BOARD = {"boledo": [f"{i:02d}" for i in range(100)], "lottery": [f"{i:02d}" for i in range(100)],
         "fantasy5": [f"{i:02d}" for i in range(1, 40)]}
SPOTS = ["1st", "2nd", "3rd"]
MAX_AGE_H = 14                  # don't alert results older than this (hours after the draw)
QUIET = ((22, 30), (6, 0))      # Belize time: hold alerts in this window
PAUSE_AFTER = 10                # alerts in a row not opened -> weekly roundup only
# Hook thresholds, tuned on the real results (23 Nov 2026) so each fires now and then, not every draw.
CAME_BACK = {"boledo": 30, "lottery": 20, "fantasy5": 20, "pick3": 25}   # "came back after N draws"
REPEAT_WINDOW = 5                 # Boledo / Sunday Jackpot / Pick 3 (whole number): "played again within 5 draws"
# "Longest wait in our results" only once a game has enough history for a record to mean something
# (about 3x the board), and only on the draw the record is broken.
RECORD_MIN_DRAWS = {"boledo": 300, "lottery": 300, "fantasy5": 120, "pick3": 60}
MISSING_WINDOW = {"boledo": 30, "lottery": 30, "fantasy5": 10, "pick3": 10}  # "N numbers haven't played in the last W draws"
SUBJECT = "mailto:contact@missingnumbers.bz"


# ---------- the numbers (same counting as the site: app.js GAMES[...].keys and renderMine) ----------
def keys(d):
    g, n = d["game"], d["nums"]
    if g == "boledo":
        return [f"{int(n[0]):02d}"]
    if g == "lottery":
        return [f"{int(n[0]):04d}"[-2:]]
    if g == "fantasy5":
        return [f"{int(x):02d}" for x in n]
    return [f"{i}:{x}" for i, x in enumerate(n[:3])]          # pick3: spot:digit


def shown(d):
    g, n = d["game"], d["nums"]
    if g == "boledo":
        return f"{int(n[0]):02d}"
    if g == "lottery":
        return " · ".join(f"{int(x):04d}" for x in n)
    if g == "fantasy5":
        return " ".join(f"{int(x):02d}" for x in n) + (f" · {d['letter']}" if d.get("letter") else "")
    return "-".join(str(x) for x in n)


def label(g, key):
    """How a number reads in an alert: '18', or '7 in the 1st spot' for Pick 3."""
    if g == "pick3":
        i, dg = key.split(":")
        return f"{dg} in the {SPOTS[int(i)]} spot"
    return key


def history(all_draws, g):
    return sorted((d for d in all_draws if d["game"] == g and not d.get("nodraw") and d.get("nums")),
                  key=lambda d: d["date"])


def draws_out(seq, key, upto=None):
    """Draws since `key` last played, counting the draws in seq[:upto]. None = never in our results."""
    seq = seq[:upto] if upto is not None else seq
    for i in range(len(seq) - 1, -1, -1):
        if key in keys(seq[i]):
            return len(seq) - 1 - i
    return None


def board(g):
    return [f"{i}:{x}" for i in range(3) for x in "0123456789"] if g == "pick3" else BOARD[g]


def longest_out(seq, g):
    best = None
    for k in board(g):
        o = draws_out(seq, k)
        o = len(seq) if o is None else o
        if best is None or o > best[1]:
            best = (k, o)
    return best


def plural(n):
    return f"{n} draw" + ("" if n == 1 else "s")


# ---------- building one alert ----------
def and_list(items):
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def repeat_hook(g, seq, ks):
    """Same number again within a short time. Stricter for Fantasy 5 and Pick 3, where small repeats are common."""
    cur, prev = seq[-1], seq[:-1]
    if not prev:
        return None
    last = set(keys(prev[-1]))
    if g in ("boledo", "lottery"):
        k = ks[0]
        for back, d in enumerate(reversed(prev[-REPEAT_WINDOW:]), start=1):
            if k in keys(d):
                if back == 1:
                    return f"{k} played again! Back-to-back draws →"
                return f"{k} played again, its 2nd time in {back + 1} draws →"
        return None
    if g == "fantasy5":
        three = [k for k in ks if len(prev) >= 2 and k in last and k in keys(prev[-2])]
        if three:
            return f"{three[0]} played 3 draws in a row! →"
        again = [k for k in ks if k in last]
        if len(again) >= 3:
            return f"{and_list(again)} played again, back-to-back draws →"
        return None
    # pick3: the whole number again, or a digit in the same spot 3 draws in a row
    for back, d in enumerate(reversed(prev[-REPEAT_WINDOW:]), start=1):
        if keys(d) == ks:
            when = "back-to-back draws" if back == 1 else f"its 2nd time in {back + 1} draws"
            return f"{shown(cur)} again! Same number, {when} →"
    three = [k for k in ks if len(prev) >= 2 and k in last and k in keys(prev[-2])]
    if three:
        return f"{label(g, three[0])}, 3 draws in a row! →"
    return None


def comeback_hook(g, seq, ks):
    back = [(k, draws_out(seq, k, len(seq) - 1)) for k in ks]
    back = sorted(((k, o) for k, o in back if o is not None and o >= CAME_BACK[g]), key=lambda x: -x[1])
    if not back:
        return None
    if len(back) == 1:
        k, o = back[0]
        return f"{label(g, k)} came back after {plural(o)}! See what's still missing →"
    parts = [f"{label(g, k)} ({o} draws)" for k, o in back]
    return f"{len(back)} numbers came back after long breaks: {and_list(parts)} →"


def record_hook(g, seq):
    """A number has just been out longer than any number ever was in our results."""
    if len(seq) < RECORD_MIN_DRAWS[g]:
        return None
    best = 0
    for k in board(g):
        pos = [i for i, d in enumerate(seq[:-1]) if k in keys(d)]
        best = max([best] + [b - a - 1 for a, b in zip(pos, pos[1:])])
    for k in board(g):
        seen = any(k in keys(d) for d in seq[:-1])
        if seen and draws_out(seq, k) == best + 1:
            return f"{label(g, k)} is now out {best + 1} draws, the longest wait in all our {LABELS[g]} results →"
    return None


def fallback_hook(g, seq):
    """No news this draw: alternate between two plain facts so alerts don't repeat word for word."""
    if len(seq) % 2 == 0:
        k, o = longest_out(seq, g)
        more = "+" if draws_out(seq, k) is None else ""
        return f"{label(g, k)} hasn't played in {o}{more} draws, the longest wait →"
    if g == "pick3":
        picks = []
        for i in range(3):
            k, o = max(((f"{i}:{x}", draws_out(seq, f"{i}:{x}")) for x in "0123456789"),
                       key=lambda t: len(seq) if t[1] is None else t[1])
            picks.append(k.split(":")[1])
        return f"Longest out by spot: {picks[0]} (1st), {picks[1]} (2nd), {picks[2]} (3rd). See them all →"
    w = min(MISSING_WINDOW[g], len(seq))
    seen = {k for d in seq[-w:] for k in keys(d)}
    n = len([k for k in board(g) if k not in seen])
    return f"{n} numbers haven't played in the last {w} draws. See which →"


def hook_for(d, seq, mine):
    """One line that makes the tap worth it: your numbers first, then real news, then a plain fact."""
    g = d["game"]
    idx = next(i for i, x in enumerate(seq) if x["id"] == d["id"])
    seq = seq[:idx + 1]                       # only what was known when this draw came in
    ks = keys(d)
    hit = [k for k in ks if k in mine]
    if hit:
        return "hit", f"Your Lucky Number {label(g, hit[0])} played! 🎉"
    for kind, line in (("repeat", repeat_hook(g, seq, ks)), ("back", comeback_hook(g, seq, ks)), ("record", record_hook(g, seq))):
        if line:
            return kind, line
    if mine:
        outs = [(k, draws_out(seq, k)) for k in mine]
        outs = [(k, len(seq) if o is None else o, "+" if o is None else "") for k, o in outs]
        k, o, more = max(outs, key=lambda x: x[1])
        if o >= 3:
            return "mine", f"Your {label(g, k)} is still out: {o}{more} draws →"
    return "out", fallback_hook(g, seq)


RANK = {"hit": 0, "repeat": 1, "back": 1, "record": 1, "mine": 2, "out": 3}


def message(new, histories, sub):
    games = [g for g in sub["games"]]
    mine = sub.get("mine") or {}
    mine_draws = [d for d in new if d["game"] in games]
    if not mine_draws:
        return None
    # personal hits first, then the order the draws happened
    scored = []
    for d in mine_draws:
        kind, line = hook_for(d, histories[d["game"]], [str(x) for x in mine.get(d["game"], [])])
        scored.append((RANK[kind], d, kind, line))
    scored.sort(key=lambda x: (x[0], x[1]["date"], AT[x[1]["game"]]))
    top = scored[0]
    d = top[1]
    if len(mine_draws) == 1:
        title = f"{LABELS[d['game']]}: {shown(d)}"
        if top[2] == "hit":
            title += " · your number hit!"
        body = top[3]
    else:
        title = "Results are in"
        if top[2] == "hit":
            title = "Results are in · your number hit!"
        body = "\n".join(f"{LABELS[x['game']]}: {shown(x)}" for _, x, _, _ in sorted(scored, key=lambda s: AT[s[1]["game"]])) + "\n" + top[3]
    return {"title": title, "body": body, "url": f"/?game={d['game']}&alert=1", "tag": "mn-draw"}


def paused_message():
    return {"title": "Draw alerts paused",
            "body": "We'll send a weekly roundup on Sundays instead. Tap here to get an alert after every draw again.",
            "url": "/?alert=1", "tag": "mn-paused"}


def weekly_message(histories, sub):
    parts = []
    for g in [g for g in LABELS if g in sub["games"]]:
        seq = histories[g]
        if not seq:
            continue
        k, o = longest_out(seq, g)
        more = "+" if draws_out(seq, k) is None else ""
        parts.append(f"{LABELS[g]} {label(g, k)} ({o}{more})")
    if not parts:
        return None
    return {"title": "This week's missing numbers",
            "body": "Longest out: " + " · ".join(parts) + ". Tap to turn draw alerts back on.",
            "url": "/?alert=1", "tag": "mn-weekly"}


# ---------- timing ----------
def draw_time(d):
    y, m, dd = map(int, d["date"].split("-"))
    h, mi = AT[d["game"]]
    return dt.datetime(y, m, dd, h, mi, tzinfo=BELIZE)


def quiet(now):
    t = (now.hour, now.minute)
    return t >= QUIET[0] or t < QUIET[1]


# ---------- Supabase + sending ----------
def supabase_cfg():
    txt = open("supabase-config.js", encoding="utf-8").read()
    url = re.search(r"url:\s*'([^']+)'", txt).group(1).rstrip("/")
    key = re.search(r"key:\s*'([^']+)'", txt).group(1)
    return url, key


def rpc(fn, body):
    url, key = supabase_cfg()
    req = urllib.request.Request(f"{url}/rest/v1/rpc/{fn}", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def send(sub, payload, private_key):
    """Returns 'sent', 'gone' (phone unsubscribed; forget it) or 'error'."""
    from pywebpush import webpush, WebPushException
    info = {"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
    try:
        webpush(info, json.dumps(payload), vapid_private_key=private_key, vapid_claims={"sub": SUBJECT},
                ttl=6 * 3600, headers={"Urgency": "high"}, timeout=15)
        return "sent"
    except WebPushException as e:
        code = getattr(e.response, "status_code", None)
        if code in (404, 410):
            return "gone"
        print(f"  push failed ({code}): {str(e)[:160]}")
        return "error"
    except Exception as e:                                  # network trouble etc.
        print(f"  push failed: {str(e)[:160]}")
        return "error"


def main():
    dry = "--dry-run" in sys.argv
    now = dt.datetime.now(BELIZE)
    if "--now" in sys.argv:
        now = dt.datetime.fromisoformat(sys.argv[sys.argv.index("--now") + 1]).replace(tzinfo=BELIZE)
    token, private_key = os.environ.get("PUSH_SENDER_TOKEN", "").strip(), os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    if not dry and not (token and private_key):
        print("Draw alerts: secrets not set, nothing sent.")
        return

    data = json.load(open(DRAWS, encoding="utf-8"))
    all_draws = data.get("draws", [])
    histories = {g: history(all_draws, g) for g in LABELS}
    since = (now - dt.timedelta(days=2)).date().isoformat()
    recent = [d for d in all_draws if d["date"] >= since and d.get("game") in LABELS and not d.get("nodraw") and d.get("nums")]
    weekly_id = f"weekly-{now.date().isoformat()}"
    weekly_due = now.weekday() == 6 and (6, 0) <= (now.hour, now.minute) < (12, 0)
    ids = [d["id"] for d in recent] + ([weekly_id] if weekly_due else [])

    if dry:
        subs, done = json.loads(os.environ.get("DRY_SUBS", "[]")), set()
    else:
        due = rpc("push_due", {"p_token": token, "p_ids": ids})
        subs, done = due["subs"], set(due["done"])

    new = [d for d in recent if d["id"] not in done]
    stale = [d for d in new if (now - draw_time(d)).total_seconds() > MAX_AGE_H * 3600]
    fresh = [d for d in new if d not in stale and now >= draw_time(d)]
    handled = [d["id"] for d in stale]
    if stale:
        print("Too old to alert (marked done): " + ", ".join(d["id"] for d in stale))
    if fresh and quiet(now):
        print("Quiet hours: holding " + ", ".join(d["id"] for d in fresh))
        fresh = []

    sent, gone, paused = [], [], []
    if fresh:
        handled += [d["id"] for d in fresh]
        for s in subs:
            if s.get("mode") == "weekly":
                continue
            if s.get("unopened", 0) >= PAUSE_AFTER:
                if not any(d["game"] in s["games"] for d in fresh):
                    continue
                payload, is_pause = paused_message(), True
            else:
                payload, is_pause = message(fresh, histories, s), False
            if not payload:
                continue
            print(("[dry run] " if dry else "") + f"-> {payload['title']} | {payload['body']}")
            r = "sent" if dry else send(s, payload, private_key)
            if r == "gone":
                gone.append(s["endpoint"])
            elif r == "sent":
                (paused if is_pause else sent).append(s["endpoint"])
    if weekly_due and weekly_id not in done and not quiet(now):
        handled.append(weekly_id)
        for s in subs:
            if s.get("mode") != "weekly":
                continue
            payload = weekly_message(histories, s)
            if not payload:
                continue
            print(("[dry run] " if dry else "") + f"-> {payload['title']} | {payload['body']}")
            r = "sent" if dry else send(s, payload, private_key)
            if r == "gone":
                gone.append(s["endpoint"])

    print(f"Draw alerts: {len(fresh)} new draw(s), {len(sent)} sent, {len(paused)} paused, {len(gone)} removed, {len(subs)} phone(s) signed up.")
    if not dry and handled:
        rpc("push_done", {"p_token": token, "p_ids": handled, "p_sent": sent, "p_gone": gone, "p_paused": paused})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:                                  # never break the results job
        print(f"Draw alerts: skipped because of an error: {e}")
