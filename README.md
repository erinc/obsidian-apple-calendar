# Apple Calendar — Obsidian plugin

Shows your macOS Apple Calendar events in Obsidian's sidebar, following
whichever journal note you have open. Read-only: it never creates, edits,
or deletes anything.

How it works, in plain terms:

- A tiny Swift helper (`bin/apple-calendar-helper`) asks macOS for your
  events through EventKit — the same official API Calendar.app itself uses —
  and prints them as JSON.
- The plugin runs that helper, then renders one compact row per event:
  title plus a one-line summary (`6–9 PM · Personal`, or `Sep 4 – Sep 7`
  for multi-day events). No location, no clutter.
- Click a title to jump to that event in Calendar.app.
- The plugin only runs on macOS desktop. There is nothing to sync, no
  account to connect, and no network involved — everything stays on your Mac.

## Install

Prerequisites: macOS with Xcode command-line tools (`xcode-select
--install`), plus Node.js 20+ and npm.

```bash
npm install
npm run helper:build   # compiles the Swift helper into bin/
npm run build           # bundles the plugin into main.js
```

Then install into your vault:

```bash
VAULT_PLUGINS="<vault>/.obsidian/plugins/obs-apple-calendar"
mkdir -p "$VAULT_PLUGINS/bin"
cp manifest.json main.js styles.css "$VAULT_PLUGINS/"
cp bin/apple-calendar-helper "$VAULT_PLUGINS/bin/"
```

In Obsidian: Settings → Community plugins → turn off Safe mode if needed →
enable "Apple Calendar". A calendar-icon ribbon button opens the sidebar
view; it also opens automatically on startup.

## First run: one permission

The first fetch triggers a macOS prompt asking for Calendars access. Allow
it under System Settings → Privacy & Security → Calendars, then press Retry
in the sidebar (or run the "Refresh Apple Calendar" command). If you deny
it by accident, same place to fix it — the sidebar tells you exactly this.

No other permission is needed. Opening events uses Calendar's own link
format, not automation, so there is no Automation prompt.

## Daily use

- Open a journal note named with a date (`2026-09-04`, or whatever your
  Daily Notes format is) and the sidebar shows that day's events.
- Open a note without a date and the sidebar keeps showing the last day,
  so browsing around doesn't yank the list. With nothing open, it shows
  today.
- The date is read from Daily Notes' own date-format setting when possible,
  so `YYYY-MM-DD`, `DD-MM-YYYY`, `M-D-YYYY`, and similar numeric formats
  just work. Formats with month or weekday names can't be matched — the
  fallback pattern in settings covers those cases.
- Each row's summary line: times for single-day events (`6–9 PM`),
  date spans for multi-day events (`Sep 4 – Sep 7`; all-day spans shift
  back one day because all-day end dates are exclusive, e.g. `Sep 4 – Sep 6`
  for an event through the 6th). Single-day all-day events show just the
  calendar name.
- Fetched days are cached for 5 minutes; switching between already-seen
  notes is instant. Auto-refresh re-checks the shown day every 15 minutes.

## Settings

- **Helper path** — where the Swift binary lives. Blank means the plugin's
  own `bin/` folder; set it explicitly if you installed the binary
  elsewhere.
- **Auto-refresh (minutes)** — background re-fetch of the shown day.
  `0` disables it.
- **Hide tab header when alone** — hides this pane's tab strip when it is
  the only tab in its group, so it sits flush under other sidebar panes
  (e.g. the Calendar plugin). The header returns automatically if another
  tab joins the group.
- **Use Daily Notes format** — derive the note-date matcher from Daily
  Notes' setting (recommended). The tab shows what was detected.
- **Fallback date pattern** — regex with `(year, month, day)` groups, used
  when Daily Notes is disabled or uses an unmatchable format.
- **Calendars** — one toggle per macOS calendar, loaded live. Unchecked
  calendars are hidden immediately. New calendars appear checked.

## Troubleshooting

- *"Helper not found"* — the binary isn't where the plugin expects. Run
  `npm run helper:build`, or point "Helper path" at it.
- *"Calendar access denied"* — grant access under System Settings →
  Privacy & Security → Calendars, then Retry.
- *Sidebar shows today instead of the note's day* — the note name doesn't
  match Daily Notes' format. Check "Use Daily Notes format" status in
  settings, or adjust the fallback pattern.
- *Clicked event doesn't open* — the sidebar shows the reason in a notice.
  Recurring occurrences open their series (occurrences share one ID).
- *Empty day* — "No events this day." Hidden calendars are the usual
  suspect; check the Calendars toggles.

## Helper CLI

The helper is also usable on its own for scripting:

```bash
./bin/apple-calendar-helper --days 7 --json
./bin/apple-calendar-helper --from 2026-09-04T00:00:00 --to 2026-09-05T00:00:00 --json
./bin/apple-calendar-helper calendars
```
