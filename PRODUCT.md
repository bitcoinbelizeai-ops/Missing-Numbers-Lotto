# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everyday Belize lottery players, on their phones, often right after a draw. They open the site (or the installed home-screen app) to see the last draw, check which numbers haven't played recently, see which numbers are "hot", and keep an eye on their own lucky numbers.

## Product Purpose

Boledo Missing Numbers (branded on-page as "Missing Numbers") is an independent tracker for Belize lottery games: Boledo, Sunday Jackpot, Fantasy 5 and Pick 3. It shows the latest result, which numbers have not played over a chosen lookback window, the most frequent recent numbers, past results, and a personal "My Lucky Numbers" list saved on the device. Success is a player getting the answer they came for in seconds, on a small screen, and trusting that the numbers are current and correct.

## Positioning

Results arrive within minutes of a draw (BBN Belize posts as the main source since Nov 20, 2026; Love FM as backup for Boledo), and the site is built around the "missing numbers" question players actually ask, while staying honest that every draw is random.

## Operating Context

- Static site on GitHub Pages, installable as a PWA (manifest, service worker, portrait orientation).
- Results are written to `draws.json` and `data/*.json` by GitHub Actions (`update-results.yml`, `bbn-receive.yml`) and committed to `main`.
- Draw schedule (source of truth: `SCHEDULE` in `app.js`): Boledo Mon–Fri 9:10 pm, Pick 3 Mon–Fri 8:30 pm, Fantasy 5 Tue/Thu/Sat 8:00 pm, Sunday Jackpot Sun 10:00 am. Belize time (UTC-6).
- Players can share a result as an image, use a "Mixer" to see ways to play their numbers, and add a result by hand.
- `admin.html` is the owner's results admin page; `preview/` holds a newer in-progress version with privacy and terms pages.

## Capabilities and Constraints

- Plain HTML/CSS/JS, no build step: `index.html`, `app.css`, `app.js`.
- The number logic (missing/hot calculations, draw parsing, schedule, data loading) is fixed product behavior and must not change during design work.
- Data files and the Actions workflows are owned by the automation; design work does not touch them.
- Terminology: "Missing Numbers", "Hot Numbers", "Last Draw", "Past Results", "My Lucky Numbers", "Mixer", game names as above.

## Brand Commitments

- Name and title: "Missing Numbers" with "Belize Lottery" eyebrow; app short name "Boledo".
- Existing blue-and-yellow lottery-ball identity is kept (confirmed). Refinement, not redesign.
- Honesty about chance is binding: "Every draw is random. A number that hasn't played for a while is not more likely to play next." and "No pattern improves your odds."
- Independent: not affiliated with Belize Government Lotteries Ltd. or Game Operators.

## Evidence on Hand

- Real draw history in `draws.json` and `data/bbn-results.json`.
- App icons in `icons/`.
- No testimonials, user counts, or press. Do not invent any.

## Product Principles

1. Answer first: the last draw and the missing numbers are reachable in one glance on a phone.
2. Trust through freshness: always show when results were last updated and what is still pending.
3. Honest about chance: never imply a number is "due" or that patterns improve odds.
4. Familiar to players: keep the recognizable ball-and-board feel and plain, friendly words.

## Accessibility & Inclusion

Mobile-first; many players use mid-range Android phones outdoors. Readable contrast, large tap targets, and reduced-motion support matter. Target WCAG 2.2 AA for the public page.
