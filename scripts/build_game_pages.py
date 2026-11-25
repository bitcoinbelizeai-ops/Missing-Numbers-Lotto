"""Build the four game pages (/boledo/, /fantasy-5/, /pick-3/, /sunday-jackpot/) from index.html.

Each page is the same app as the home page, opened on one game, with its own Google title,
description, address (canonical), a game heading, a short "About" panel and the latest result
written into the page. app.js refreshes that latest-result line when the page opens.

Run it after any change to index.html (and whenever you like to refresh the latest results):
    python scripts/build_game_pages.py
"""
import datetime
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://missingnumbers.bz"

# draw days and times: keep in step with SCHEDULE in app.js
GAMES = {
    "boledo": {
        "slug": "boledo",
        "label": "Boledo",
        "h1": "Belize Boledo Results",
        "when": "Drawn Monday to Friday at 9:00 pm, Belize time",
        "title": "Belize Boledo Results: Today's Winning Number | Missing Numbers",
        "desc": "Latest Belize Boledo result, drawn Monday to Friday at 9:00 pm. See the winning number "
                "within minutes of the draw, past results and which numbers haven't played lately.",
        "about": [
            "Boledo is drawn Monday to Friday at 9:00 pm, Belize time. There is normally no draw on public holidays.",
            "This page shows each winning number within minutes of the draw, the past results, and which numbers "
            "from 00 to 99 haven't played lately.",
        ],
    },
    "fantasy5": {
        "slug": "fantasy-5",
        "label": "Fantasy 5",
        "h1": "Fantasy 5 Belize Results",
        "when": "Drawn Tuesday, Thursday and Saturday at 8:00 pm, Belize time",
        "title": "Fantasy 5 Belize Results: Latest Winning Numbers | Missing Numbers",
        "desc": "Latest Fantasy 5 Belize numbers, drawn Tuesday, Thursday and Saturday at 8:00 pm. See the five "
                "winning numbers and letter, past results and which numbers haven't played lately.",
        "about": [
            "Fantasy 5 is drawn Tuesday, Thursday and Saturday at 8:00 pm, Belize time. Five numbers from 1 to 39 "
            "are drawn, plus a letter.",
            "This page shows the winning numbers within minutes of the draw, the next jackpot when it is announced, "
            "the past results, and which numbers haven't played lately.",
        ],
    },
    "pick3": {
        "slug": "pick-3",
        "label": "Pick 3",
        "h1": "Pick 3 Belize Results",
        "when": "Drawn Monday to Friday at 8:30 pm, Belize time",
        "title": "Pick 3 Belize Results: Today's Winning Numbers | Missing Numbers",
        "desc": "Latest Pick 3 Belize result, drawn Monday to Friday at 8:30 pm. See the three winning digits "
                "within minutes of the draw, past results and which digits haven't played lately.",
        "about": [
            "Pick 3 is drawn Monday to Friday at 8:30 pm, Belize time. Three digits from 0 to 9 are drawn, in order. "
            "There is normally no draw on public holidays.",
            "This page shows the winning digits within minutes of the draw, the past results, and which digits "
            "haven't played lately in each position.",
        ],
    },
    "lottery": {
        "slug": "sunday-jackpot",
        "label": "Sunday Jackpot",
        "h1": "Belize Sunday Jackpot Results",
        "when": "Drawn Sunday at 10:00 am, Belize time",
        "title": "Belize Sunday Jackpot Results: Latest Prize Numbers | Missing Numbers",
        "desc": "Latest Belize Sunday Jackpot result, drawn Sunday at 10:00 am. See the 1st, 2nd and 3rd prize "
                "numbers, past results and which 2-digit endings haven't played lately.",
        "about": [
            "The Sunday Jackpot is drawn on Sunday at 10:00 am, Belize time. If a Sunday draw is postponed, it can "
            "be held on Monday instead.",
            "This page shows the 1st, 2nd and 3rd prize numbers, the past results, and which 2-digit endings of the "
            "1st prize haven't played lately.",
        ],
    },
}
ORDER = ["boledo", "fantasy5", "pick3", "lottery"]

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def latest_sentence(d):
    """Same wording as latestSentence() in app.js."""
    t = datetime.date.fromisoformat(d["date"])
    day = f"{DAYS[t.weekday()]} {t.day} {MONTHS[t.month - 1]} {t.year}"
    n = [str(x) for x in d["nums"]]
    g = d["game"]
    if g == "boledo":
        val = n[0].zfill(2)
    elif g == "pick3":
        val = "-".join(n)
    elif g == "fantasy5":
        val = " ".join(x.zfill(2) for x in n) + (f", letter {d['letter']}" if d.get("letter") else "")
    else:
        val = "1st prize " + n[0].zfill(4)
        if len(n) > 1:
            val += ", 2nd " + n[1].zfill(4)
        if len(n) > 2:
            val += ", 3rd " + n[2].zfill(4)
    return f"Latest result: <b>{esc(val)}</b>, drawn {day}."


def latest_draw(draws, game):
    ok = [d for d in draws if d.get("game") == game and not d.get("nodraw") and d.get("nums")]
    return max(ok, key=lambda d: d["date"]) if ok else None


def sub_once(pattern, repl, text, what):
    new, n = re.subn(pattern, repl, text, count=1, flags=re.S)
    if n != 1:
        sys.exit(f"build_game_pages: could not find {what} in index.html")
    return new


def build(home, game, draws):
    G = GAMES[game]
    url = f"{SITE}/{G['slug']}/"
    page = home
    page = sub_once(r'<html lang="en">', f'<html lang="en" data-page-game="{game}">', page, "<html>")
    page = sub_once(r'<meta charset="utf-8">',
                    '<meta charset="utf-8">\n<!-- Built by scripts/build_game_pages.py from index.html. '
                    'Do not edit by hand: change index.html, then run the script. -->\n<base href="/">',
                    page, "charset")
    page = sub_once(r"<title>.*?</title>", f"<title>{esc(G['title'])}</title>", page, "title")
    page = sub_once(r'<meta name="description" content="[^"]*">',
                    f'<meta name="description" content="{esc(G["desc"])}">', page, "description")
    page = sub_once(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{url}">', page, "canonical")
    page = sub_once(r'<meta property="og:title" content="[^"]*">',
                    f'<meta property="og:title" content="{esc(G["h1"])}">', page, "og:title")
    page = sub_once(r'<meta property="og:description" content="[^"]*">',
                    f'<meta property="og:description" content="{esc(G["desc"])}">', page, "og:description")
    page = sub_once(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{url}">',
                    page, "og:url")
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "WebPage", "@id": url + "#page", "url": url, "name": G["title"], "description": G["desc"],
             "inLanguage": "en", "isPartOf": {"@id": f"{SITE}/#site"}, "about": f"{G['label']} (Belize lottery)"},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Missing Numbers", "item": f"{SITE}/"},
                {"@type": "ListItem", "position": 2, "name": G["h1"], "item": url}]},
        ],
    }
    page = sub_once(r'<script type="application/ld\+json">.*?</script>',
                    '<script type="application/ld+json">\n' + json.dumps(ld, ensure_ascii=False) + "\n</script>",
                    page, "JSON-LD")
    # wordmark stays the same look but is no longer the page's main heading
    page = sub_once(r"<h1>Missing <em>Numbers</em></h1>", '<p class="bname">Missing <em>Numbers</em></p>',
                    page, "brand h1")
    page = sub_once(r"(</header>)",
                    r'\1' + f'\n    <div class="game-hd"><h1>{esc(G["h1"])}</h1><p>{esc(G["when"])}</p></div>',
                    page, "</header>")
    d = latest_draw(draws, game)
    latest = latest_sentence(d) if d else "The latest result appears here after the next draw."
    about = "".join(f"<p>{esc(p)}</p>" for p in G["about"])
    panel = (f'  <section class="panel gameabout" aria-labelledby="gaTitle">\n'
             f'    <div class="panel-head"><h2 id="gaTitle">About {esc(G["label"])} results</h2></div>\n'
             f'    <p id="gaLatest">{latest}</p>\n'
             f'    {about}\n'
             f'  </section>\n\n')
    page = sub_once(r"(  <footer>)", lambda m: panel + m.group(1), page, "<footer>")
    # footer links: mark this page instead of the home page
    page = sub_once(r'<a href="/" aria-current="page">', '<a href="/">', page, "home link")
    page = sub_once(rf'<a href="/{G["slug"]}/">', f'<a href="/{G["slug"]}/" aria-current="page">', page, "game link")
    return page


def main():
    home = (ROOT / "index.html").read_text(encoding="utf-8")
    draws = json.loads((ROOT / "draws.json").read_text(encoding="utf-8")).get("draws", [])
    for game in ORDER:
        out = ROOT / GAMES[game]["slug"] / "index.html"
        out.parent.mkdir(exist_ok=True)
        html = build(home, game, draws)
        old = out.read_text(encoding="utf-8") if out.exists() else ""
        if html != old:
            out.write_text(html, encoding="utf-8", newline="\n")
            print("updated", out.relative_to(ROOT).as_posix())
        else:
            print("unchanged", out.relative_to(ROOT).as_posix())


if __name__ == "__main__":
    main()
