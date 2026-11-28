/**
 * A drop-down calendar that reads and writes Jalali (هجری شمسی) dates. It replaces
 * bootstrap-datepicker for Date and DateTime cells in documents that use the Persian calendar;
 * see app/client/widgets/DateEditor.ts.
 *
 * It deals only in calendar dates: it never touches timestamps or time zones. What a picked day
 * means (which time zone, whether the column is a Date or a DateTime) is the editor's business,
 * exactly as it is for a date typed by hand.
 *
 * The week starts on Saturday and the grid follows the interface direction, so in a Persian
 * document the month runs right-to-left and the "previous" arrow points right (the arrows flip
 * themselves with the [dir="rtl"] rule in this component's own styles; app/client/ui/Rtl.css
 * carries the rest of the mirroring for the whole interface).
 */
import {
  JalaliDate,
  JALALI_MONTHS_FA,
  JALALI_WEEKDAYS_SHORT_FA,
  jalaliMonthLength,
  jalaliToday,
  jalaliWeekdayIndex,
  toLatinDigits,
  toPersianDigits,
} from "app/common/jalali";

import { IconName } from "app/client/ui2018/IconList";
import { icon } from "app/client/ui2018/icons";

import { Disposable, dom, DomContents, observable, styled } from "grainjs";

export interface JalaliPickerOptions {
  /** The date to open on, i.e. what the cell being edited holds. */
  initial: JalaliDate | null;
  /** Called when the user picks a day (also for "today"). */
  onPick: (date: JalaliDate) => void;
  /** Called when the calendar is dismissed without picking: Escape, or a click outside. */
  onClose: () => void;
  /** Write numbers with Persian digits; on unless the caller says otherwise. */
  persianDigits?: boolean;
}

type Panel = "days" | "months" | "years";

/** Years offered at a time in the year list. */
const YEARS_PER_PAGE = 12;

function positiveMod(a: number, b: number): number { return a - Math.floor(a / b) * b; }

export class JalaliDatePicker extends Disposable {
  private _view = observable<JalaliDate>(jalaliToday());
  private _selected = observable<JalaliDate | null>(null);
  private _panel = observable<Panel>("days");
  private _page = observable<number>(0);
  private _yearAnchor: number;

  constructor(private _options: JalaliPickerOptions) {
    super();
    const start = this._options.initial || jalaliToday();
    this._view.set(start);
    this._selected.set(this._options.initial);
    this._yearAnchor = start.jy;
  }

  private get _num(): (text: string) => string {
    return this._options.persianDigits === false ? (t) => t : toPersianDigits;
  }

  public getDom(): HTMLElement {
    return cssPicker(
      // The calendar lives inside the cell editor's popup; without this, a click on it would be
      // an "outside" click and the editor would close before the click lands.
      dom.on("mousedown", (e) => e.stopPropagation()),
      dom.on("click", (e) => e.stopPropagation()),
      dom.on("dblclick", (e) => e.stopPropagation()),
      dom.onKeyDown({
        Escape: () => this._options.onClose(),
        Enter: () => this._pick(this._view.get()),
        ArrowLeft: () => this._moveDay(1),      // right-to-left: the next day sits to the left
        ArrowRight: () => this._moveDay(-1),
        ArrowUp: () => this._moveDay(-7),
        ArrowDown: () => this._moveDay(7),
        PageUp: () => this._shiftMonths(-1),
        PageDown: () => this._shiftMonths(1),
      }),
      {tabIndex: "-1"},
      this._buildHeader(),
      this._buildWeekdays(),
      dom.domComputed((use) => {
        switch (use(this._panel)) {
          case "months": return this._buildMonthPanel();
          case "years": return this._buildYearPanel();
          default: return this._buildDayPanel();
        }
      }),
      cssFooter(
        cssFooterBtn({type: "button"},
          dom.text("امروز"),
          dom.on("click", () => this._pick(jalaliToday())),
        ),
        cssFooterBtn(cssFooterBtn.cls("-secondary"), {type: "button"},
          dom.text("بستن"),
          dom.on("click", () => this._options.onClose()),
        ),
      ),
    );
  }

  private _pick(j: JalaliDate) {
    this._selected.set(j);
    this._options.onPick(j);
  }

  private _moveDay(days: number) {
    let {jy, jm, jd} = this._view.get();
    jd += days;
    while (jd < 1) {
      jm -= 1;
      if (jm < 1) { jm = 12; jy -= 1; }
      jd += jalaliMonthLength(jy, jm);
    }
    while (jd > jalaliMonthLength(jy, jm)) {
      jd -= jalaliMonthLength(jy, jm);
      jm += 1;
      if (jm > 12) { jm = 1; jy += 1; }
    }
    this._view.set({jy, jm, jd});
  }

  private _shiftMonths(count: number) {
    const j = this._view.get();
    const total = j.jy * 12 + (j.jm - 1) + count;
    this._view.set({jy: Math.floor(total / 12), jm: positiveMod(total, 12) + 1, jd: 1});
  }

  private _buildHeader(): DomContents {
    return cssHeader(
      cssNavBtn("ArrowLeft", "یک سال قبل", () => this._shiftMonths(-12), true),
      cssNavBtn("ArrowLeft", "ماه قبل", () => this._shiftMonths(-1)),
      cssTitle({type: "button", title: "انتخاب ماه و سال"},
        dom.text((use) => {
          const j = use(this._view);
          return `${JALALI_MONTHS_FA[j.jm - 1]} ${this._num(String(j.jy))}`;
        }),
        dom.on("click", () => this._setPanel("months")),
      ),
      cssNavBtn("ArrowRight", "ماه بعد", () => this._shiftMonths(1)),
      cssNavBtn("ArrowRight", "یک سال بعد", () => this._shiftMonths(12), true),
    );
  }

  private _setPanel(panel: Panel) {
    this._panel.set(this._panel.get() === panel && panel !== "days" ? "days" : panel);
  }

  private _buildWeekdays(): DomContents {
    return cssWeekRow(
      JALALI_WEEKDAYS_SHORT_FA.map((name) => cssWeekDay(name)),
    );
  }

  private _buildDayPanel(): DomContents {
    return cssDayGrid(
      dom.domComputed((use) => {
        const view = use(this._view);
        const selected = use(this._selected);
        const today = jalaliToday();
        const len = jalaliMonthLength(view.jy, view.jm);
        const lead = jalaliWeekdayIndex(view.jy, view.jm, 1);
        const cells: DomContents[] = [];
        for (let i = 0; i < lead; i++) {
          cells.push(cssDaySpacer());
        }
        for (let day = 1; day <= len; day++) {
          const j: JalaliDate = {jy: view.jy, jm: view.jm, jd: day};
          cells.push(
            cssDay({type: "button"},
              dom.text(this._num(String(day))),
              cssDay.cls("-today", today.jy === j.jy && today.jm === j.jm && today.jd === j.jd),
              cssDay.cls("-selected", Boolean(selected) &&
                selected!.jy === j.jy && selected!.jm === j.jm && selected!.jd === j.jd),
              dom.on("click", () => this._pick(j)),
            ),
          );
        }
        return cells;
      }),
    );
  }

  private _buildMonthPanel(): DomContents {
    const current = this._view.get();
    return cssMonthGrid(
      JALALI_MONTHS_FA.map((name, i) => {
        const jm = i + 1;
        return cssCell({type: "button"},
          dom.text(name),
          cssCell.cls("-selected", current.jm === jm),
          dom.on("click", () => {
            const j = this._view.get();
            this._view.set({jy: j.jy, jm, jd: Math.min(j.jd, jalaliMonthLength(j.jy, jm))});
            this._panel.set("days");
          }),
        );
      }),
    );
  }

  private _buildYearPanel(): DomContents {
    const start = this._yearAnchor + this._page.get() * YEARS_PER_PAGE;
    const years: number[] = [];
    for (let i = 0; i < YEARS_PER_PAGE; i++) { years.push(start + i); }
    const current = this._view.get();
    return cssYearPanel(
      cssYearNav(
        cssNavBtn("ArrowLeft", "سال‌های گذشته", () => this._page.set(this._page.get() - 1)),
        cssYearInput(
          {type: "text", placeholder: "سال", enterKeyHint: "search"},
          dom.on("keydown", (e) => {
            if (e.key !== "Enter") { return; }
            const value = parseInt(toLatinDigits(String((e.target as HTMLInputElement).value)), 10);
            if (Number.isFinite(value)) {
              this._view.set({...this._view.get(), jy: value});
              this._panel.set("days");
            }
          }),
        ),
        cssNavBtn("ArrowRight", "سال‌های آینده", () => this._page.set(this._page.get() + 1)),
      ),
      cssYearGrid(
        years.map((jy) => cssCell({type: "button"},
          dom.text(this._num(String(jy))),
          cssCell.cls("-selected", current.jy === jy),
          dom.on("click", () => {
            this._view.set({...this._view.get(), jy});
            this._panel.set("days");
          }),
        )),
      ),
    );
  }

}

/**
 * Opens the calendar under `anchor` (the text input being edited) as a popup owned by the caller,
 * and returns its element so the caller can position and dispose it. Kept deliberately simple --
 * Grist's cell editor already sizes itself around the picker.
 */
export function buildJalaliPicker(options: JalaliPickerOptions): HTMLElement {
  return new JalaliDatePicker(options).getDom();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function cssNavBtn(iconName: IconName, label: string, onClick: () => void, double?: boolean) {
  return cssNav(cssNav.cls("-double", Boolean(double)),
    {type: "button", title: label, "aria-label": label},
    icon(iconName),
    dom.on("click", onClick),
  );
}

const cssPicker = styled("div", `
  /* Anchored to the cell editor (.cell_editor), so the calendar hangs below the cell it belongs
   * to and is never clipped by the editor's own overflow. */
  position: absolute;
  top: 100%;
  inset-inline-start: 0;
  z-index: 1001;
  display: flex;
  flex-direction: column;
  padding: 8px;
  margin-top: 2px;
  background: var(--grist-theme-menu-bg, #fff);
  color: var(--grist-theme-text, #333);
  border: 1px solid var(--grist-theme-menu-border, #c8c8c8);
  border-radius: var(--grist-theme-border-radius, 3px);
  box-shadow: 0 2px 20px 0 var(--grist-theme-menu-shadow, rgba(0, 0, 0, 0.2));
  font-family: var(--grist-font-family-data, inherit);
  font-size: 13px;
  width: 268px;
  outline: none;
  user-select: none;
`);

const cssHeader = styled("div", `
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 4px;
`);

const cssTitle = styled("button", `
  flex: 1;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  color: inherit;
  padding: 4px;
  border-radius: 3px;
  &:hover { background: var(--grist-theme-hover-bg, rgba(0, 0, 0, 0.06)); }
`);

const cssNav = styled("button", `
  border: none;
  background: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  color: inherit;
  &:hover { background: var(--grist-theme-hover-bg, rgba(0, 0, 0, 0.06)); }
  & .icon { --icon-size: 16px; --icon-color: var(--grist-theme-text, #333); }
  &-double { opacity: 0.8; }
  [dir="rtl"] & { transform: scaleX(-1); }
`);

const cssWeekRow = styled("div", `
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 11px;
  opacity: 0.7;
  padding-bottom: 2px;
`);

const cssWeekDay = styled("div", `
  padding: 2px 0;
`);

const cssDayGrid = styled("div", `
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  min-height: 168px;
`);

/* Placeholder for the days before the 1st of the month: sized like a day cell, inert. */
const cssDaySpacer = styled("div", `
  height: 26px;
`);

const cssDay = styled("button", `
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  height: 26px;
  line-height: 26px;
  border-radius: 3px;
  text-align: center;
  padding: 0;
  &:hover { background: var(--grist-theme-hover-bg, rgba(0, 0, 0, 0.07)); }
  &-today { box-shadow: inset 0 0 0 1px var(--grist-theme-date-picker-today-bg, #f1a417); }
  &-selected {
    background: var(--grist-theme-date-picker-selected-bg, #286090);
    color: var(--grist-theme-date-picker-selected-fg, #fff);
    &:hover { background: var(--grist-theme-date-picker-selected-bg, #286090); }
  }
`);

const cssMonthGrid = styled("div", `
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
`);

const cssYearPanel = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 4px;
`);

const cssYearNav = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
`);

const cssYearInput = styled("input", `
  flex: 1;
  font: inherit;
  color: inherit;
  text-align: center;
  border: 1px solid var(--grist-theme-input-border, rgba(0, 0, 0, 0.2));
  border-radius: 3px;
  padding: 2px 4px;
  background: none;
  outline: none;
  &:focus { border-color: var(--grist-color-link, #2b67c7); }
`);

const cssYearGrid = styled("div", `
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
`);

const cssCell = styled("button", `
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  padding: 4px 2px;
  border-radius: 3px;
  &:hover { background: var(--grist-theme-hover-bg, rgba(0, 0, 0, 0.07)); }
  &-selected {
    background: var(--grist-theme-date-picker-selected-bg, #286090);
    color: var(--grist-theme-date-picker-selected-fg, #fff);
    &:hover { background: var(--grist-theme-date-picker-selected-bg, #286090); }
  }
`);

const cssFooter = styled("div", `
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  padding-top: 6px;
`);

const cssFooterBtn = styled("button", `
  border: none;
  background: none;
  font: inherit;
  color: var(--grist-theme-link, #2b67c7);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  &:hover { background: var(--grist-theme-hover-bg, rgba(43, 103, 199, 0.1)); }
  &-secondary { color: inherit; opacity: 0.7; }
`);
