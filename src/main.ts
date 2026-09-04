import { App, FileSystemAdapter, ItemView, Platform, Plugin, PluginSettingTab, WorkspaceLeaf, Notice, Setting } from "obsidian";
import { compactTimeRange, dayStamp, momentFormatToRegex, parseDateFromBasename, startOfDay, toLocalISO } from "./dates";

// Node APIs are only available on desktop. Import lazily so mobile never parses them.
declare const require: (id: string) => any;

export const VIEW_TYPE = "apple-calendar-view";

interface CalEvent {
  id: string;
  title: string;
  start: string; // ISO8601
  end: string; // ISO8601
  allDay: boolean;
  calendar: string;
  location?: string;
  url?: string;
}

interface HelperResult {
  events: CalEvent[];
}

interface AppleCalSettings {
  helperPath: string;
  refreshMinutes: number;
  useDailyNotesFormat: boolean;
  datePattern: string;
}

const DEFAULT_SETTINGS: AppleCalSettings = {
  helperPath: "",
  refreshMinutes: 15,
  useDailyNotesFormat: true,
  datePattern: "(\\d{4})-(\\d{2})-(\\d{2})",
};

export default class AppleCalendarPlugin extends Plugin {
  settings: AppleCalSettings = { ...DEFAULT_SETTINGS };
  private refreshTimer: number | null = null;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new AppleCalendarView(leaf, this));

    this.addRibbonIcon("calendar", "Open Apple Calendar", () => this.activateView());
    this.addCommand({
      id: "open-apple-calendar",
      name: "Open Apple Calendar",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "refresh-apple-calendar",
      name: "Refresh Apple Calendar",
      callback: () => this.refreshAllViews(false, true),
    });

    this.addSettingTab(new AppleCalSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("file-open", () => this.onActiveFileChanged()));

    this.app.workspace.onLayoutReady(() => {
      this.updateDayFromActiveFile();
      this.activateView(true);
      this.refreshAllViews(true);
    });

    this.scheduleRefresh();
  }

  onunload() {
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.scheduleRefresh();
  }

  scheduleRefresh() {
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
    if (this.settings.refreshMinutes > 0) {
      this.refreshTimer = window.setInterval(
        () => this.refreshAllViews(true),
        this.settings.refreshMinutes * 60 * 1000
      );
    }
  }

  async activateView(passive = false) {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (!passive && leaf) workspace.revealLeaf(leaf);
  }

  refreshAllViews(quiet = false, force = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof AppleCalendarView) void view.refresh(quiet, force);
    }
  }

  /** Resolve the helper binary: explicit setting -> plugin bin/ -> PATH. */
  resolveHelperPath(): string {
    if (this.settings.helperPath.trim()) return this.settings.helperPath.trim();
    try {
      // manifest.dir is vault-relative (".obsidian/plugins/obs-apple-calendar");
      // resolve it against the vault root to an absolute path.
      const dir = (this as any).manifest?.dir as string | undefined;
      const adapter = this.app.vault.adapter;
      if (dir && adapter instanceof FileSystemAdapter) {
        return adapter.getFullPath(`${dir}/bin/apple-calendar-helper`);
      }
    } catch {
      // fall through to PATH
    }
    return "apple-calendar-helper";
  }

  /** Day shown in the sidebar (local start-of-day) and where it came from. */
  currentDay: Date = startOfDay(new Date());
  currentDaySource = "Today";
  private eventCache = new Map<string, { at: number; events: CalEvent[] }>();

  /**
   * Recompute the shown day from the active note. Undated notes keep the
   * current day so browsing non-journal notes doesn't yank the calendar.
   * Returns true when the day changed.
   */
  /** Daily Notes date format (moment-style), or null when unavailable. */
  getDailyNotesFormat(): string | null {
    try {
      const plugin = (this.app as any).internalPlugins?.getPluginById?.("daily-notes");
      const format = plugin?.enabled ? plugin?.instance?.options?.format : null;
      return typeof format === "string" && format ? format : null;
    } catch {
      return null;
    }
  }

  /** Effective matcher: derived from Daily Notes when possible, else the manual fallback. */
  resolveDatePattern(): { pattern: string; source: string } {
    if (this.settings.useDailyNotesFormat) {
      const format = this.getDailyNotesFormat();
      if (format) {
        const derived = momentFormatToRegex(format);
        if (derived) return { pattern: derived, source: `Daily Notes (${format})` };
      }
    }
    return { pattern: this.settings.datePattern, source: "fallback pattern" };
  }

  updateDayFromActiveFile(): boolean {
    let day = startOfDay(new Date());
    let source = "Today";
    const f = this.app.workspace.getActiveFile();
    if (f) {
      const parsed = parseDateFromBasename(f.basename, this.resolveDatePattern().pattern);
      if (parsed) {
        day = parsed;
        source = f.basename;
      } else if (this.currentDaySource !== "Today") {
        return false;
      }
    }
    if (+day === +this.currentDay) return false;
    this.currentDay = day;
    this.currentDaySource = source;
    return true;
  }

  onActiveFileChanged() {
    if (this.updateDayFromActiveFile()) this.refreshAllViews(true);
  }

  /** Events for the current day (5-minute in-memory cache per day). */
  fetchEvents(force = false): Promise<CalEvent[]> {
    const key = dayStamp(this.currentDay);
    const cached = this.eventCache.get(key);
    if (!force && cached && Date.now() - cached.at < 5 * 60 * 1000) {
      return Promise.resolve(cached.events);
    }
    return this.runHelperForDay(this.currentDay).then((events) => {
      this.eventCache.set(key, { at: Date.now(), events });
      if (this.eventCache.size > 14) {
        const oldest = [...this.eventCache.keys()].sort()[0];
        this.eventCache.delete(oldest);
      }
      return events;
    });
  }

  /** Run the Swift helper for one local day and parse its JSON. Throws with a human message. */
  private runHelperForDay(day: Date): Promise<CalEvent[]> {
    return new Promise((resolve, reject) => {
      if (!Platform.isDesktop || !Platform.isMacOS) {
        reject(new Error("Apple Calendar view is macOS desktop only."));
        return;
      }
      let spawn: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        spawn = require("child_process").spawn;
      } catch {
        reject(new Error("Node child_process is unavailable in this Obsidian build."));
        return;
      }
      const helper = this.resolveHelperPath();
      const from = new Date(day);
      const to = new Date(day.getTime() + 24 * 60 * 60 * 1000);
      const args = ["--from", toLocalISO(from), "--to", toLocalISO(to), "--json"];
      const child = spawn(helper, args, { timeout: 15000 });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (err: Error) => {
        if ((err as any)?.code === "ENOENT") {
          reject(
            new Error(
              `Helper not found at "${helper}". Build it (npm run helper:build) or set its path in settings.`
            )
          );
        } else {
          reject(err);
        }
      });
      child.on("close", (code: number) => {
        if (code !== 0) {
          const hint = stderr.trim() || stdout.trim() || `exit code ${code}`;
          if (/denied|not authorized|TCC|privacy/i.test(hint)) {
            reject(
              new Error(
                "Calendar access denied. Open System Settings → Privacy & Security → Calendars and allow Obsidian (first run prompts from the helper). " +
                  `Detail: ${hint}`
              )
            );
          } else {
            reject(new Error(`Calendar helper failed: ${hint}`));
          }
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as HelperResult | CalEvent[];
          const events = Array.isArray(parsed) ? parsed : parsed.events ?? [];
          resolve(events);
        } catch {
          reject(new Error(`Calendar helper returned invalid JSON: ${stdout.slice(0, 200)}`));
        }
      });
    });
  }

  /**
   * Open the event in Calendar.app via its ical:// deep link.
   * Deliberately not AppleScript: an unbounded `whose uid` lookup scans
   * entire calendars and hangs on large stores. Failures surface as a Notice.
   */
  openInCalendar(ev: CalEvent): Promise<void> {
    return new Promise((resolve) => {
      let spawn: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        spawn = require("child_process").spawn;
      } catch {
        new Notice("Node child_process is unavailable in this Obsidian build.");
        resolve();
        return;
      }
      const url = `ical://ekevent/${encodeURIComponent(ev.id)}?method=show&options=more`;
      const child = spawn("/usr/bin/open", [url], { timeout: 15000 });
      let stderr = "";
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (err: Error) => {
        new Notice(`Could not open event in Calendar: ${(err as Error)?.message ?? err}`);
        resolve();
      });
      child.on("close", (code: number | null, signal: string | null) => {
        if (code !== 0) {
          const detail =
            stderr.trim() ||
            (signal ? `killed by ${signal} (Calendar may have hung)` : `exit code ${code}`);
          new Notice(`Could not open event in Calendar: ${detail}`);
        }
        resolve();
      });
    });
  }
}

class AppleCalendarView extends ItemView {
  private plugin: AppleCalendarPlugin;
  private events: CalEvent[] = [];
  private error = "";
  private loading = false;

  constructor(leaf: WorkspaceLeaf, plugin: AppleCalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Apple Calendar";
  }

  getIcon() {
    return "calendar";
  }

  async onOpen() {
    this.registerEvent(this.app.workspace.on("layout-change", () => this.updateTabChrome()));
    this.updateTabChrome();
    await this.refresh(true);
  }

  /**
   * Hide our tab header when we're the only tab in the group (e.g. stacked
   * under the calendar pane), so no redundant tab strip separates the views.
   * Restored automatically when grouped with other tabs.
   */
  private updateTabChrome() {
    try {
      const leaf = this.leaf as any;
      const header = (leaf?.tabHeaderEl ?? null) as HTMLElement | null;
      if (!header) return;
      const target = (header.closest(".workspace-tab-header-container") as HTMLElement | null) ?? header;
      const siblings = (leaf?.parent?.children?.length ?? 1) as number;
      target.style.display = siblings <= 1 ? "none" : "";
    } catch {
      // Non-standard layout — leave the chrome alone.
    }
  }

  async refresh(quiet = false, force = false) {
    if (this.loading) return;
    this.loading = true;
    if (!quiet) this.render();
    try {
      this.events = await this.plugin.fetchEvents(force);
      this.error = "";
    } catch (e: any) {
      this.error = e?.message ?? String(e);
      if (!quiet) new Notice(this.error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("obs-apple-calendar");

    if (this.loading && this.events.length === 0) {
      el.createEl("p", { text: "Loading…", cls: "obs-apple-cal-muted" });
      return;
    }
    if (this.error && this.events.length === 0) {
      el.createEl("p", { text: this.error, cls: "obs-apple-cal-error" });
      el.createEl("p", {
        text: "Read-only. Grant Calendars access in System Settings, then retry.",
        cls: "obs-apple-cal-muted",
      });
      const retry = el.createEl("button", { text: "Retry", cls: "obs-apple-cal-retry" });
      retry.onclick = () => void this.refresh(false, true);
      return;
    }
    if (this.events.length === 0) {
      el.createEl("p", { text: "No events this day.", cls: "obs-apple-cal-muted" });
      return;
    }

    const sorted = [...this.events].sort((a, b) => +new Date(a.start) - +new Date(b.start));
    const ul = el.createEl("ul", { cls: "obs-apple-cal-list" });
    for (const ev of sorted) {
      const li = ul.createEl("li", { cls: "obs-apple-cal-item" });
      const title = ev.title || "(no title)";
      const titleEl = li.createEl("div", { text: title, cls: "obs-apple-cal-title obs-apple-cal-open" });
      titleEl.setAttribute("title", `${title} — open in Calendar`);
      titleEl.onclick = () => void this.plugin.openInCalendar(ev);
      const meta = [ev.allDay ? "all-day" : compactTimeRange(ev.start, ev.end)];
      if (ev.calendar) meta.push(ev.calendar);
      const metaEl = li.createEl("div", { text: meta.join(" · "), cls: "obs-apple-cal-meta" });
      metaEl.setAttribute("title", meta.join(" · "));
    }
  }
}



class AppleCalSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AppleCalendarPlugin) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Helper path")
      .setDesc("Path to apple-calendar-helper. Blank = plugin bin/ folder.")
      .addText((t) =>
        t.setValue(this.plugin.settings.helperPath).onChange(async (v) => {
          this.plugin.settings.helperPath = v;
          await this.plugin.saveSettings();
        })
      );
    const detected = this.plugin.getDailyNotesFormat();
    const derived = detected ? momentFormatToRegex(detected) : null;
    new Setting(containerEl)
      .setName("Use Daily Notes format")
      .setDesc(
        detected
          ? derived
            ? `Following Daily Notes ("${detected}").`
            : `Daily Notes uses "${detected}", which has names/times — using the fallback below.`
          : "Daily Notes not enabled — using the fallback below."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.useDailyNotesFormat).onChange(async (v) => {
          this.plugin.settings.useDailyNotesFormat = v;
          await this.plugin.saveSettings();
          this.plugin.updateDayFromActiveFile();
          this.plugin.refreshAllViews(true);
        })
      );
    new Setting(containerEl)
      .setName("Fallback date pattern")
      .setDesc("Regex with (year, month, day) groups, used when Daily Notes is off or unreadable.")
      .addText((t) =>
        t.setValue(this.plugin.settings.datePattern).onChange(async (v) => {
          this.plugin.settings.datePattern = v;
          await this.plugin.saveSettings();
          this.plugin.updateDayFromActiveFile();
          this.plugin.refreshAllViews(true);
        })
      );
    new Setting(containerEl)
      .setName("Auto-refresh (minutes)")
      .setDesc("0 disables auto-refresh.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.refreshMinutes)).onChange(async (v) => {
          this.plugin.settings.refreshMinutes = Number(v) || 0;
          await this.plugin.saveSettings();
        })
      );
  }
}
