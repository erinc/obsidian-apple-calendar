# Apple Calendar — Obsidian plugin

macOS desktop-only. Reads events via a tiny Swift EventKit helper, shows them in the right sidebar. No writes.

## Build

```bash
npm install
npm run helper:build   # swift build -c release, copies to bin/
npm run build
```

Copy `manifest.json`, `main.js`, `styles.css`, and `bin/` into
`<vault>/.obsidian/plugins/obs-apple-calendar/` and enable in Obsidian.

First run prompts for Calendars access (System Settings → Privacy & Security → Calendars).

## Day following

The sidebar shows events for the day of the currently open note. By default
the date matcher is derived from Daily Notes' own date format setting
("Use Daily Notes format"), so numeric formats like `YYYY-MM-DD`,
`DD-MM-YYYY`, or `M-D-YYYY` just work. Formats with month/weekday names
can't be matched, nor can a disabled Daily Notes — then the "Fallback
date pattern" regex is used. Notes without a date keep the last shown day;
with nothing open it falls back to today. Each event shows its title plus
a one-line summary (no location): `6–9 PM · Personal` for single-day events
(single-day all-day events show just the calendar), `Sep 4 – Sep 7` for
multi-day events (`Sep 4 – Sep 6` when all-day, whose end dates are
exclusive). Fetched days are cached for 5 minutes.

## Calendars

Settings lists every macOS calendar with a toggle; unchecked calendars are
hidden (new calendars show by default). Hiding uses stable calendar IDs, so
two calendars with the same name are treated independently.

## Opening events

Click an event title to open it in Calendar.app via its `ical://ekevent/…`
deep link (no Automation permission needed). A recurring occurrence opens
its series, since occurrences share one identifier.

## Helper CLI

```bash
./bin/apple-calendar-helper --days 7 --json
./bin/apple-calendar-helper calendars
```
