"""Send draw alerts (web push) for new results in draws.json. Added 22 Nov 2026.

Runs at the end of both results jobs (BBN and magayo). It never changes draws.json and never
fails the job: any problem is printed and the job carries on.

Rules (agreed with the owner, 22 Nov 2026):
- One alert per draw, only to phones that picked that game. Draws that land close together
  (one run) go out as ONE alert.
- Each alert shows the winning number(s) plus a hook only the site answers:
  a Lucky Number that hit, a Lucky Number still out, a number that came back after a long wait,
  or the number missing the longest.
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
CAME_BACK = {"boledo": 150, "lottery": 150, "fantasy5": 25, "pick3": 25}  # "came back after N draws" is news
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
def hook_for(d, seq, mine):
    """One line that makes the tap worth it. Personal first."""
    g, ks = d["game"], keys(d)
    idx = next(i for i, x in enumerate(seq) if x["id"] == d["id"])
    hit = [k for k in ks if k in mine]
    if hit:
        return "hit", f"Your Lucky Number {label(g, hit[0])} played! 🎉"
    if mine:
        outs = [(k, draws_out(seq, k)) for k in mine]
        outs = [(k, len(seq) if o is None else o, "+" if o is None else "") for k, o in outs]
        k, o, more = max(outs, key=lambda x: x[1])
        if o >= 3:
            return "mine", f"Your {label(g, k)} is still out: {o}{more} draws →"
    back = [(k, draws_out(seq, k, idx)) for k in ks]
    back = [(k, o) for k, o in back if o is not None and o >= CAME_BACK[g]]
    if back:
        k, o = max(back, key=lambda x: x[1])
        return "back", f"{label(g, k)} came back after {plural(o)}! See what's still missing →"
    k, o = longest_out(seq, g)
    more = "+" if draws_out(seq, k) is None else ""
    return "out", f"{label(g, k)} hasn't played in {o}{more} draws, the longest wait →"


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
        scored.append((0 if kind == "hit" else 1, d, kind, line))
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
