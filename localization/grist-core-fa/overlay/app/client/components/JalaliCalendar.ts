/**
 * A Jalali (هجری شمسی) calendar for documents whose calendar is the Persian one. It replaces the
 * ToastUI grid (CalendarWrapper) when shouldUseJalali() is in force: the layout, the month
 * arithmetic and the labels are Jalali, and the whole widget runs right-to-left, Saturday first,
 * Friday last.
 *
 * Why a second engine rather than a reskin of TUI: ToastUI's month matrix is computed from the
 * Gregorian "current month", and a Jalali month does not line up with any Gregorian month. There
 * is no option to hand it a different date matrix, so the grid itself had to be reimplemented.
 * What is deliberately kept from the TUI engine is everything Grist needs around the grid: the
 * CalendarWidget interface (which CalendarView and CalendarRenderer talk to), the event model (the
 * EventObject shape the renderer builds, with the same row ids), the TZDate handles the date index
 * works with, and the draw/select/count surface.
 *
 * Scope, by design:
 *   - Month view: 6 rows x 7 columns, Saturday to Friday. Events appear as chips inside the day
 *     cells, three visible per cell and the rest folded behind a "+N more" popover. Multi-day
 *     events repeat their chip on every day they cover.
 *   - Week view: seven day columns, شنبه..جمعه, with timed and all-day events listed in each
 *     column, all-day first and the rest by start time. There is no hour grid.
 *   - Day view: the same list for one day.
 *   - There is no drag-to-create, drag-to-move or drag-to-resize. Creation happens on
 *     double-click (all-day in month view, 09:00-10:00 otherwise); editing happens through the
 *     Record Card that a double-click on an event opens, as everywhere else in Grist.
 *
 * Digits and names in the grid and the title are Persian, always: a reader opening this widget
 * chose the Jalali calendar, so آذر ۱۴۰۵ and ۲۷ are what they expect, regardless of the digits
 * used elsewhere in the document.
 */
import { CalendarDate } from "app/client/components/CalendarSource";
import { CalendarHost, CalendarWidget, PERSPECTIVES, Perspective } from "app/client/components/CalendarWrapper";
import { loadToastUICalendar, ToastUICalendarModule } from "app/client/lib/imports";
import { detectCurrentLang } from "app/client/lib/localization";
import { reportError } from "app/client/models/errors";
import { theme } from "app/client/ui2018/cssVars";

import { Disposable, dom, styled } from "grainjs";
import {
  addJalaliMonths, gregorianToJalali, JALALI_MONTHS_FA, JALALI_WEEKDAYS_FA,
  JALALI_WEEKDAYS_SHORT_FA, jalaliToGregorian, jalaliToUnixDays,
  jalaliToday, jalaliWeekdayIndex, toPersianDigits, unixDaysToJalali,
} from "app/common/jalali";

import type { EventObject, TZDate } from "@toast-ui/calendar";

// The interface of this widget is Persian by design (it only mounts in Jalali mode), so its
// strings are Persian literals; the fork does not invent i18n keys (see docs/UPSTREAM.md).
const NO_EVENTS = "رویدادی نیست";
const moreLabel = (count: number) => `+${toPersianDigits(String(count))} مورد دیگر`;

const DAY_MS = 24 * 60 * 60 * 1000;
const CHIP_LIMIT = 3;
const DAYS_IN_GRID = 42;

// One day the widget can show: a local-midnight anchor for the date arithmetic, the Jalali date
// it stands for, and whether it belongs to the displayed month (a month view always has cells
// from the months either side).
interface DayCell {
  date: Date;        // local midnight
  jy: number;
  jm: number;
  jd: number;
  inMonth: boolean;
  isToday: boolean;
  key: string;       // dayKey(date) — the same format CalendarRenderer uses for hidden counts
  dayStartMs: number;
  dayEndMs: number;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// The 1st of the given Jalali month, as a local-midnight Date together with the Jalali day count
// of the Saturday that opens the 6-row grid around it.
function monthGridStart(j: { jy: number; jm: number }): { start: Date; startUd: number } {
  const wd1 = jalaliWeekdayIndex(j.jy, j.jm, 1);
  const firstUd = jalaliToUnixDays(j.jy, j.jm, 1);
  const g = jalaliToGregorian(j.jy, j.jm, 1);
  const start = new Date(g.gy, g.gm - 1, g.gd - wd1);
  return { start, startUd: firstUd - wd1 };
}

// The Jalali date and grid position of cell `index` of a grid that opened at `gridStart` on
// Jalali day `startUd`. Gregorian and Jalali arithmetic stay in step because both index the same
// day count.
function cellAt(gridStart: Date, startUd: number, index: number): DayCell {
  const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
  const jd = unixDaysToJalali(startUd + index);
  const today = jalaliToday();
  const dayStart = startOfDay(date);
  return {
    date: dayStart,
    jy: jd.jy,
    jm: jd.jm,
    jd: jd.jd,
    inMonth: true,
    isToday: jd.jy === today.jy && jd.jm === today.jm && jd.jd === today.jd,
    key: dayKey(dayStart),
    dayStartMs: dayStart.getTime(),
    dayEndMs: dayStart.getTime() + DAY_MS,
  };
}

export class JalaliCalendar extends Disposable implements CalendarWidget {
  /**
   * Loads the TUI module, but only for its TZDate class: the date index (CalendarSource) works
   * with TZDate instances, and reusing the same class keeps the write path identical to the
   * Gregorian engine. No TUI calendar is created.
   */
  public static async load(
    host: CalendarHost, container: HTMLElement, titleDom: HTMLElement, perspective: Perspective,
  ): Promise<JalaliCalendar | null> {
    const { TZDate: TZDateCtor } = await loadToastUICalendar();
    if (host.isDisposed()) { return null; }
    return new JalaliCalendar(TZDateCtor, host, container, titleDom, perspective);
  }

  private _root: HTMLElement;
  private _tzDateCtor: ToastUICalendarModule["TZDate"];

  private _view: Perspective;
  // The day the widget is anchored on (a month view shows the month containing it).
  private _anchor: Date;
  private _readOnly: boolean;
  private _allDayOnly: boolean = false;

  // The events the renderer has drawn, keyed by row id. Everything the widget paints comes from
  // this map; it owns no other copy of the data.
  private _events = new Map<number, EventObject>();
  private _selectedId: number | null = null;
  // How many events each day of Day/Week could not show, keyed as in CalendarRenderer's dayKey.
  private _hiddenPerDay = new Map<string, number>();
  // The "+N more" popover; kept out of the grainjs tree on purpose (it is absolutely positioned,
  // and outside-click dismissal is handled by a document listener).
  private _popover: HTMLElement | null = null;
  private _closePopoverOnClick: ((ev: MouseEvent) => void) | null = null;

  private constructor(
    TZDateCtor: ToastUICalendarModule["TZDate"],
    private _host: CalendarHost,
    private _container: HTMLElement,
    private _titleDom: HTMLElement,
    perspective: Perspective,
  ) {
    super();
    this._view = perspective;
    this._anchor = startOfDay(new Date());
    this._readOnly = this._host.isReadOnly();
    this._tzDateCtor = TZDateCtor;

    this._container.setAttribute("dir", "rtl");
    this._container.classList.add("jcal");
    this._root = cssJcalRoot();
    this._container.appendChild(this._root);

    // Delegated interaction: the DOM inside the root is rebuilt on every render, so listeners
    // belong one level up.
    this._root.addEventListener("click", (ev) => this._onClick(ev));
    this._root.addEventListener("dblclick", (ev) => this._onDoubleClick(ev));

    this.onDispose(() => {
      this._closePopover();
      this._root.remove();
      this._container.classList.remove("jcal");
      this._container.removeAttribute("dir");
    });

    this.render();
  }

  // ---------------------------------------------------------------- CalendarWidget

  public tzDate(date: CalendarDate): TZDate {
    return new this._tzDateCtor(date as never) as unknown as TZDate;
  }

  public getViewName(): Perspective { return this._view; }

  public capsEventsPerDay(): boolean { return this._view !== "month"; }

  public getDate(): TZDate { return this.tzDate(this._anchor); }

  public setDate(date: Date | TZDate) {
    this._anchor = startOfDay(new Date(date.valueOf()));
    this.render();
  }

  public getVisibleRange(): { fromMs: number; toMs: number } {
    const first = this._gridStart();
    const spanDays = this._view === "month" ? DAYS_IN_GRID : (this._view === "week" ? 7 : 1);
    return { fromMs: first.start.getTime(), toMs: first.start.getTime() + spanDays * DAY_MS - 1 };
  }

  public render() {
    this._closePopover();
    this._titleDom.textContent = this._titleText();
    if (this._view === "month") {
      this._renderMonth();
    } else {
      this._renderAgenda(this._view === "week" ? 7 : 1);
    }
    this._repaintSelected();
  }

  public setTheme() { this.render(); }

  public setReadOnly(isReadOnly: boolean) { this._readOnly = isReadOnly; }

  public updateTitle() { this._titleDom.textContent = this._titleText(); }

  public changeView(view: Perspective) {
    if (!PERSPECTIVES.includes(view)) { return; }
    this._view = view;
    this.updateUIAfterNavigation();
  }

  public go(method: "prev" | "next" | "today") {
    const a = this._anchor;
    if (method === "today") {
      this._anchor = startOfDay(new Date());
    } else {
      const sign = method === "next" ? 1 : -1;
      this._anchor = this._view === "month"
        ? moveJalaliMonth(this._anchor, sign)
        : new Date(a.getFullYear(), a.getMonth(), a.getDate() + sign * (this._view === "week" ? 7 : 1));
    }
    this.updateUIAfterNavigation();
  }

  public updateUIAfterNavigation() {
    this.render();
    // The host draws whatever entered the new range, so the accent goes on afterwards. It has to
    // be painted again even for an event that stayed on screen, because render() rebuilds the
    // DOM and would otherwise lose the selection class.
    this._host.onNavigate();
    this._repaintSelected();
  }

  public setAllDayOnly(allDayOnly: boolean) {
    this._allDayOnly = allDayOnly;
    // The agenda hides time labels in this mode; re-render so the rows pick it up.
    if (this._view !== "month") { this.render(); }
  }

  public createEvents(events: EventObject[]) {
    for (const event of events) {
      if (event.id === undefined) { continue; }
      this._events.set(Number(event.id), event);
    }
    this.render();
  }

  public updateEvent(rowId: number, event: EventObject) {
    this._events.set(rowId, event);
    this.render();
  }

  public deleteEvent(rowId: number) {
    this._events.delete(rowId);
    this.render();
  }

  public clearEvents() {
    this._events.clear();
    this.render();
  }

  public getEvent(rowId: number): EventObject | null {
    return this._events.get(rowId) ?? null;
  }

  public setSelected(rowId: number | null) {
    this._selectedId = rowId;
    this._repaintSelected();
  }

  public setHiddenCounts(hiddenPerDay: Map<string, number>) {
    this._hiddenPerDay = hiddenPerDay;
    if (this._view !== "month") { this.render(); }
  }

  // ---------------------------------------------------------------- grid math

  // The Saturday the visible grid begins on, and its Jalali day count. One, seven and no Jalali
  // month ever starts elsewhere: the week view opens on the شنبه of the anchor's week, the day
  // view is the anchor itself, and the month view opens on the شنبه of the week containing the
  // 1st of the anchor's month.
  private _gridStart(): { start: Date; startUd: number } {
    const a = this._anchor;
    const j = gregorianToJalali(a.getFullYear(), a.getMonth() + 1, a.getDate());
    if (this._view === "month") { return monthGridStart(j); }
    const wd = this._view === "week" ? jalaliWeekdayIndex(j.jy, j.jm, j.jd) : 0;
    const start = new Date(a.getFullYear(), a.getMonth(), a.getDate() - wd);
    return { start, startUd: jalaliToUnixDays(j.jy, j.jm, j.jd) - wd };
  }

  private _cells(): DayCell[] {
    const { start, startUd } = this._gridStart();
    const count = this._view === "month" ? DAYS_IN_GRID : (this._view === "week" ? 7 : 1);
    const j = gregorianToJalali(this._anchor.getFullYear(), this._anchor.getMonth() + 1, this._anchor.getDate());
    const cells: DayCell[] = [];
    for (let i = 0; i < count; i++) {
      const cell = cellAt(start, startUd, i);
      cell.inMonth = this._view !== "month" || (cell.jm === j.jm && cell.jy === j.jy);
      cells.push(cell);
    }
    return cells;
  }

  private _titleText(): string {
    const a = this._anchor;
    const j = gregorianToJalali(a.getFullYear(), a.getMonth() + 1, a.getDate());
    const yearText = toPersianDigits(String(j.jy));
    if (this._view === "month") {
      return `${JALALI_MONTHS_FA[j.jm - 1]} ${yearText}`;
    }
    if (this._view === "day") {
      return `${JALALI_WEEKDAYS_FA[jalaliWeekdayIndex(j.jy, j.jm, j.jd)]} ` +
        `${toPersianDigits(String(j.jd))} ${JALALI_MONTHS_FA[j.jm - 1]} ${yearText}`;
    }
    // Week: the شنبه..جمعه range of the week containing the anchor.
    const { startUd } = this._gridStart();
    const startJ = unixDaysToJalali(startUd);
    const endJ = unixDaysToJalali(startUd + 6);
    const dayName = (d: { jy: number; jm: number; jd: number }) =>
      `${toPersianDigits(String(d.jd))} ${JALALI_MONTHS_FA[d.jm - 1]}`;
    if (startJ.jy === endJ.jy) {
      return `${dayName(startJ)} – ${dayName(endJ)} ${toPersianDigits(String(endJ.jy))}`;
    }
    return `${dayName(startJ)} ${toPersianDigits(String(startJ.jy))} – ` +
      `${dayName(endJ)} ${toPersianDigits(String(endJ.jy))}`;
  }

  // ---------------------------------------------------------------- month view

  private _renderMonth() {
    const cells = this._cells();
    const eventsByDay = this._eventsByDay(cells);

    const grid = dom("div.jcal_grid");
    for (const name of JALALI_WEEKDAYS_SHORT_FA) {
      grid.appendChild(dom("div.jcal_weekday", name));
    }
    for (const cell of cells) {
      const events = eventsByDay.get(cell.dayStartMs) ?? [];
      const cls = "jcal_cell" + (cell.inMonth ? "" : " jcal_cell_outside") + (cell.isToday ? " jcal_cell_today" : "");
      const cellEl = dom(
        "div." + cls.split(" ").join("."),
        { "data-date": dataDate(cell.date) },
      );
      cellEl.appendChild(dom(
        "div.jcal_daynum",
        dom("span.jcal_daynum_value", toPersianDigits(String(cell.jd))),
      ));
      const eventWrap = dom("div.jcal_cell_events");
      const visible = events.slice(0, CHIP_LIMIT);
      for (const event of visible) {
        eventWrap.appendChild(this._chip(event, "jcal_chip_month"));
      }
      const hidden = events.length - visible.length;
      if (hidden > 0) {
        eventWrap.appendChild(dom(
          "button.jcal_more",
          dom.text(moreLabel(hidden)),
          dom.on("click", (ev) => {
            ev.stopPropagation();
            this._openDayPopover(ev.currentTarget as HTMLElement, cell, events);
          }),
        ));
      }
      cellEl.appendChild(eventWrap);
      grid.appendChild(cellEl);
    }
    this._root.replaceChildren(grid);
  }

  // ---------------------------------------------------------------- week & day (agenda)

  private _renderAgenda(columns: 1 | 7) {
    const cells = this._cells();
    const eventsByDay = this._eventsByDay(cells);

    const wrap = dom("div.jcal_agenda" + (columns === 1 ? ".jcal_agenda_day" : ""));
    for (const cell of cells) {
      const events = eventsByDay.get(cell.dayStartMs) ?? [];
      const el = dom(
        "div.jcal_col" + (cell.isToday ? ".jcal_col_today" : ""),
        { "data-date": dataDate(cell.date) },
      );
      el.appendChild(dom(
        "div.jcal_colhead",
        dom("div.jcal_colhead_name", JALALI_WEEKDAYS_FA[jalaliWeekdayIndex(cell.jy, cell.jm, cell.jd)]),
        dom(
          "div.jcal_colhead_date",
          dom("span.jcal_colhead_num", toPersianDigits(String(cell.jd))),
          dom("span.jcal_colhead_month", ` ${JALALI_MONTHS_FA[cell.jm - 1]}`),
        ),
      ));
      const body = dom("div.jcal_colbody");
      if (events.length === 0) {
        body.appendChild(dom("div.jcal_empty", NO_EVENTS));
      } else {
        for (const event of events) { body.appendChild(this._agendaRow(event)); }
      }
      const hidden = this._hiddenPerDay.get(cell.key) ?? 0;
      if (hidden > 0) {
        body.appendChild(dom("div.jcal_hidden_more", moreLabel(hidden)));
      }
      el.appendChild(body);
      wrap.appendChild(el);
    }
    this._root.replaceChildren(wrap);
  }

  private _agendaRow(event: EventObject): HTMLElement {
    const isAllDay = Boolean(event.isAllday) || this._allDayOnly;
    const time = isAllDay ? "" : formatTime(eventStartDate(event));
    return dom(
      "button.jcal_event_row" + (isAllDay ? ".jcal_event_row_allday" : ""),
      { "data-event-id": String(event.id) },
      dom.style("--jcal-bg", event.backgroundColor ?? theme.inputReadonlyBorder.toString()),
      dom.style("--jcal-fg", event.color ?? theme.text.toString()),
      isAllDay ? undefined : dom("span.jcal_event_time", time),
      dom("span.jcal_event_title", event.title ?? ""),
    );
  }

  // ---------------------------------------------------------------- chips and popover

  private _chip(event: EventObject, extraClass: string): HTMLElement {
    return dom(
      "button.jcal_chip." + extraClass,
      { "data-event-id": String(event.id) },
      dom.style("--jcal-bg", event.backgroundColor ?? theme.inputReadonlyBorder.toString()),
      dom.style("--jcal-fg", event.color ?? theme.text.toString()),
      dom("span.jcal_chip_title", event.title ?? ""),
    );
  }

  private _openDayPopover(anchor: HTMLElement, cell: DayCell, events: EventObject[]) {
    this._closePopover();
    const pop = dom("div.jcal_popover", { role: "dialog" }) as HTMLElement;
    pop.appendChild(dom(
      "div.jcal_popover_title",
      `${JALALI_WEEKDAYS_FA[jalaliWeekdayIndex(cell.jy, cell.jm, cell.jd)]} ` +
      `${toPersianDigits(String(cell.jd))} ${JALALI_MONTHS_FA[cell.jm - 1]} ${toPersianDigits(String(cell.jy))}`,
    ));
    for (const event of events) { pop.appendChild(this._chip(event, "jcal_chip_popover")); }
    const containerRect = this._root.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const width = Math.min(260, Math.max(180, containerRect.width - 16));
    pop.style.position = "absolute";
    pop.style.top = `${anchorRect.bottom - containerRect.top + 4}px`;
    pop.style.width = `${width}px`;
    // Keep the popover inside the widget horizontally.
    const right = Math.max(8, Math.min(containerRect.width - width - 8, containerRect.right - anchorRect.right));
    pop.style.right = `${right}px`;
    this._root.appendChild(pop);
    this._popover = pop;
    this._closePopoverOnClick = (ev: MouseEvent) => {
      if (this._popover && !this._popover.contains(ev.target as Node)) { this._closePopover(); }
    };
    // Defer so the click that opened the popover does not close it again.
    setTimeout(() => {
      if (this._closePopoverOnClick) { document.addEventListener("mousedown", this._closePopoverOnClick, true); }
    }, 0);
  }

  private _closePopover() {
    if (this._closePopoverOnClick) {
      document.removeEventListener("mousedown", this._closePopoverOnClick, true);
      this._closePopoverOnClick = null;
    }
    this._popover?.remove();
    this._popover = null;
  }

  private _repaintSelected() {
    this._root.querySelectorAll("[data-event-id]").forEach((el) => {
      el.classList.toggle("jcal_selected", Number(el.getAttribute("data-event-id")) === this._selectedId);
    });
  }

  // ---------------------------------------------------------------- events plumbing

  // For each of the given cells, the events overlapping its day, sorted with all-day events
  // first and timed events by start time.
  private _eventsByDay(cells: DayCell[]): Map<number, EventObject[]> {
    const out = new Map<number, EventObject[]>();
    for (const cell of cells) {
      const list: EventObject[] = [];
      for (const event of this._events.values()) {
        const start = eventStartDate(event).getTime();
        const end = eventEndDate(event).getTime();
        if (start < cell.dayEndMs && end >= cell.dayStartMs) { list.push(event); }
      }
      list.sort((a, b) => {
        const aAll = Boolean(a.isAllday);
        const bAll = Boolean(b.isAllday);
        if (aAll !== bAll) { return aAll ? -1 : 1; }
        return eventStartDate(a).getTime() - eventStartDate(b).getTime();
      });
      out.set(cell.dayStartMs, list);
    }
    return out;
  }

  private _onClick(ev: MouseEvent) {
    const target = ev.target as HTMLElement;
    const chip = target.closest<HTMLElement>("[data-event-id]");
    if (chip) {
      const rowId = Number(chip.getAttribute("data-event-id"));
      if (rowId) { this._host.onSelect(rowId); }
      this._closePopover();
    }
  }

  private _onDoubleClick(ev: MouseEvent) {
    const target = ev.target as HTMLElement;
    const chip = target.closest<HTMLElement>("[data-event-id]");
    if (chip) {
      const rowId = Number(chip.getAttribute("data-event-id"));
      if (rowId) {
        this._host.onSelect(rowId);
        this._host.onOpen(rowId);
      }
      return;
    }
    if (this._readOnly) { return; }
    // Double-click an empty cell/column: create a row seeded with its date.
    const dayEl = target.closest<HTMLElement>("[data-date]");
    if (!dayEl || target.closest(".jcal_colhead")) { return; }
    const [gy, gm, gd] = dayEl.getAttribute("data-date")!.split("-").map(Number);
    if (!gy || !gm || !gd) { return; }
    const isAllDay = this._view === "month" || this._allDayOnly;
    const start = new Date(gy, gm - 1, gd, isAllDay ? 0 : 9, 0, 0, 0);
    const end = isAllDay ? new Date(gy, gm - 1, gd, 0, 0, 0, 0) : new Date(gy, gm - 1, gd, 10, 0, 0, 0);
    this._host.onCreate(this.tzDate(start), this.tzDate(end), isAllDay)
      .then((rowId) => { if (rowId) { this._host.onSelect(rowId); } })
      .catch((err) => reportError(err as Error));
  }
}

// ---------------------------------------------------------------- helpers

// "YYYY-M-D", local — matches the format dayKey and the hidden-counts map use.
function dataDate(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function moveJalaliMonth(anchor: Date, months: number): Date {
  const j = gregorianToJalali(anchor.getFullYear(), anchor.getMonth() + 1, anchor.getDate());
  const moved = addJalaliMonths(j, months);
  const g = jalaliToGregorian(moved.jy, moved.jm, moved.jd);
  return new Date(g.gy, g.gm - 1, g.gd);
}

// TUI events carry their dates as plain Dates (built by buildEvent) or as TZDates once the grid
// has stored them; both reduce to a millisecond instant here.
function eventMs(date: EventObject["start"]): number {
  if (date === undefined || date === null) { return NaN; }
  if (date instanceof Date) { return date.getTime(); }
  const asAny = date as unknown as { toDate?: () => Date };
  if (typeof asAny.toDate === "function") { return asAny.toDate().getTime(); }
  return new Date(date as string | number).getTime();
}

function eventStartDate(event: EventObject): Date {
  const ms = eventMs(event.start);
  return Number.isFinite(ms) ? new Date(ms) : new Date();
}

function eventEndDate(event: EventObject): Date {
  const endMs = eventMs(event.end ?? event.start);
  if (Number.isFinite(endMs)) { return new Date(endMs); }
  return eventStartDate(event);
}

function formatTime(d: Date): string {
  try {
    return new Intl.DateTimeFormat(
      detectCurrentLang() || undefined, { hour: "2-digit", minute: "2-digit" }).format(d);
  } catch (e) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

// ---------------------------------------------------------------- styles

const cssJcalRoot = styled("div.jcal_root", `
  direction: rtl;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: inherit;

  /* ---------- month ---------- */
  & .jcal_grid {
    display: grid;
    grid-auto-flow: row;
    grid-auto-rows: minmax(96px, 1fr);
    grid-template-columns: repeat(7, minmax(0, 1fr));
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
    padding: 8px;
    gap: 4px;
    align-content: start;
  }
  & .jcal_weekday {
    position: sticky;
    top: 0;
    z-index: 2;
    background-color: ${theme.mainPanelBg};
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    color: ${theme.lightText};
    padding: 4px 0 6px;
    border-bottom: 1px solid ${theme.tableBodyBorder};
  }
  & .jcal_cell {
    display: flex;
    flex-direction: column;
    background-color: ${theme.inputBg};
    border: 1px solid ${theme.tableBodyBorder};
    border-radius: 6px;
    padding: 4px 6px;
    gap: 2px;
    overflow: hidden;
  }
  & .jcal_cell_outside {
    opacity: 0.4;
  }
  & .jcal_cell_today {
    border-color: ${theme.controlPrimaryBg};
    box-shadow: inset 0 0 0 1px ${theme.controlPrimaryBg};
  }
  & .jcal_daynum {
    display: flex;
    justify-content: flex-start;
    min-height: 22px;
  }
  & .jcal_daynum_value {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 4px;
    border-radius: 11px;
    font-size: 11px;
    font-weight: 600;
  }
  & .jcal_cell_today .jcal_daynum_value {
    background-color: ${theme.controlPrimaryBg};
    color: ${theme.controlPrimaryFg};
  }
  & .jcal_cell_events {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
  }
  & .jcal_chip {
    display: flex;
    align-items: center;
    width: 100%;
    border: 0;
    border-radius: 4px;
    padding: 0 6px;
    height: 18px;
    font-size: 11px;
    line-height: 18px;
    cursor: pointer;
    background-color: var(--jcal-bg);
    color: var(--jcal-fg);
    text-align: start;
  }
  & .jcal_chip_title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  & .jcal_chip.jcal_selected,
  & .jcal_event_row.jcal_selected {
    outline: 2px solid ${theme.controlPrimaryBg};
  }
  & .jcal_more {
    border: 0;
    background: transparent;
    color: ${theme.lightText};
    font-size: 11px;
    text-align: start;
    padding: 0 6px;
    height: 18px;
    cursor: pointer;
    border-radius: 4px;
  }
  & .jcal_more:hover {
    background-color: ${theme.hover};
    color: ${theme.text};
  }

  /* ---------- week & day (agenda) ---------- */
  & .jcal_agenda {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
    padding: 8px;
    gap: 6px;
  }
  & .jcal_agenda_day {
    grid-auto-columns: minmax(0, 1fr);
  }
  & .jcal_col {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background-color: ${theme.inputBg};
    border: 1px solid ${theme.tableBodyBorder};
    border-radius: 6px;
    overflow: hidden;
  }
  & .jcal_col_today {
    border-color: ${theme.controlPrimaryBg};
  }
  & .jcal_colhead {
    padding: 6px 8px;
    border-bottom: 1px solid ${theme.tableBodyBorder};
    text-align: center;
    flex: none;
  }
  & .jcal_colhead_name {
    font-size: 11px;
    color: ${theme.lightText};
    font-weight: 600;
  }
  & .jcal_colhead_date {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 4px;
    font-size: 15px;
    font-weight: 600;
  }
  & .jcal_colhead_num {
    font-variant-numeric: tabular-nums;
  }
  & .jcal_colhead_month {
    font-size: 12px;
    font-weight: 400;
    color: ${theme.lightText};
  }
  & .jcal_colbody {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    overflow: auto;
    flex: 1 1 0;
    min-height: 0;
  }
  & .jcal_empty {
    color: ${theme.lightText};
    font-size: 11px;
    text-align: center;
    padding: 12px 4px;
  }
  & .jcal_event_row {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: 4px;
    padding: 2px 6px;
    min-height: 22px;
    font-size: 11px;
    line-height: 1.4;
    cursor: pointer;
    background-color: var(--jcal-bg);
    color: var(--jcal-fg);
    text-align: start;
  }
  & .jcal_event_time {
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
    flex: none;
  }
  & .jcal_event_title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  & .jcal_hidden_more {
    color: ${theme.lightText};
    font-size: 10px;
    text-align: center;
    padding-top: 2px;
    border-top: 1px dashed ${theme.tableBodyBorder};
  }

  /* ---------- popover ---------- */
  & .jcal_popover {
    position: absolute;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    background-color: ${theme.mainPanelBg};
    border: 1px solid ${theme.tableBodyBorder};
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
    max-height: 60%;
    overflow: auto;
  }
  & .jcal_popover_title {
    font-size: 11px;
    font-weight: 700;
    color: ${theme.lightText};
    padding: 0 2px 4px;
    border-bottom: 1px solid ${theme.tableBodyBorder};
  }
  & .jcal_chip_popover {
    flex: none;
  }
`);
