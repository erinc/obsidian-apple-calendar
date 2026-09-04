# Apple Calendar (Read-Only) — Obsidian plugin

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
a one-line `time · calendar` summary (no location). Fetched days are cached
for 5 minutes.

## Helper CLI

```bash
./bin/apple-calendar-helper --days 7 --json
./bin/apple-calendar-helper calendars
```
