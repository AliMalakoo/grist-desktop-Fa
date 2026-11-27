/**
 * Support for the Jalali calendar (هجری شمسی), the Persian solar calendar used in Iran and
 * Afghanistan, in the parts of Grist that show and accept dates:
 *
 *   - Date/DateTime cell values shown in grids, cards, forms and the record panel
 *     (see app/common/ValueFormatter.ts).
 *   - Parsing of dates typed into a Date/DateTime cell, or pasted into a column
 *     (see app/common/parseDate.ts).
 *   - The drop-down calendar attached to a date cell (see app/client/ui/JalaliDatePicker.ts).
 *
 * Values are always *stored* as plain Gregorian timestamps (seconds since the epoch, exactly as
 * Grist normally stores them, and what the Python data engine, formulas, filters and exports use).
 * This module only converts on the way in and on the way out, so a Jalali document stays fully
 * compatible with documents that use the Gregorian calendar.
 *
 * The calendar arithmetic is the well-known 33-year leap-cycle algorithm used by jalaali-js
 * (MIT), valid for Jalali years -61 to 2816, which covers every date Grist can represent.
 */

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Jalali month names, in order (فروردین ... اسفند). */
export const JALALI_MONTHS_FA = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/** Short Jalali month names, for the "MMM" format token. */
export const JALALI_MONTHS_SHORT_FA = [
  "فرو", "ارد", "خرد", "تی", "مور", "شهر",
  "مهر", "آبا", "آذر", "دی", "بهم", "اسف",
];

/** Latin transliterations, so that "Farvardin 1405" can be typed and understood too. */
export const JALALI_MONTHS_EN = [
  "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
  "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand",
];

/** Weekdays, in the Jalali order: the week starts on Saturday (شنبه). */
export const JALALI_WEEKDAYS_FA = [
  "شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه",
];

/** Two-letter weekday labels used as column headings in the calendar. */
export const JALALI_WEEKDAYS_SHORT_FA = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

/** Weekday names starting on Sunday, for documents that keep the Gregorian week order. */
export const JALALI_WEEKDAYS_SHORT_SUN_FIRST = ["ی", "د", "س", "چ", "پ", "ج", "ش"];

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Index of Saturday within the Jalali week (0 = Saturday). */
export const JALALI_FIRST_WEEKDAY = 0;

// ---------------------------------------------------------------------------
// Calendar arithmetic
// ---------------------------------------------------------------------------

export interface JalaliDate {
  /** Jalali year, e.g. 1405. */
  jy: number;
  /** Jalali month, 1 (فروردین) to 12 (اسفند). */
  jm: number;
  /** Day of month, 1 to 31. */
  jd: number;
}

export interface GregorianDate {
  gy: number;
  gm: number;  // 1-12
  gd: number;  // 1-31
}

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
  1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

/** The range of Jalali years the tables above can represent. */
const MIN_JALALI_YEAR = BREAKS[0];
const MAX_JALALI_YEAR = BREAKS[BREAKS.length - 1] - 1;

/**
 * Day-number epoch: the Julian day number of 1970-01-01, so that "day numbers" here can be
 * turned into unix timestamps by subtracting it.
 */
const DAY_ZERO = gregorianToJdn(1970, 1, 1);

/** Jalali years we are willing to read from user input, so that Gregorian years stay intact. */
const MIN_PLAUSIBLE_JALALI_YEAR = 1200;
const MAX_PLAUSIBLE_JALALI_YEAR = 1500;

// Truncating division, toward zero. The calendar functions below must use it, not floor
// division: they are ported from jalaali-js, whose `div`/`mod` truncate, and the difference
// shows up whenever an operand is negative (January to February, and years before 100).
function truncDiv(a: number, b: number): number { return Math.trunc(a / b); }
function truncMod(a: number, b: number): number { return a - Math.trunc(a / b) * b; }

// Rounding down, for the arithmetic that is ours (week indices, month arithmetic).
function positiveMod(a: number, b: number): number { return a - Math.floor(a / b) * b; }

interface JalCal {
  /** 0 if jy is a leap year, otherwise the number of years since the last one (0-4). */
  leap: number;
  /** Gregorian year in which 1 Farvardin of jy falls. */
  gy: number;
  /** Day of March on which Nowruz of jy falls. */
  march: number;
}

/**
 * Where the Jalali year `jy` begins, and whether it is a leap year. Ported from jalaali-js
 * (MIT), which implements the 33-year leap cycle with the correction years of the Persian
 * mathematical calendar.
 */
function jalCal(jy: number, withLeap: boolean = true): JalCal | null {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  if (!Number.isFinite(jy) || jy < jp || jy >= BREAKS[bl - 1]) { return null; }

  // Find the limiting years for the Jalali year jy.
  let jump = 0;
  for (let i = 1; i < bl; i++) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) { break; }
    leapJ = leapJ + truncDiv(jump, 33) * 8 + truncDiv(truncMod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;

  // Number of leap years from 621 AD to the start of jy, in the Persian calendar...
  leapJ = leapJ + truncDiv(n, 33) * 8 + truncDiv(truncMod(n, 33) + 3, 4);
  if (truncMod(jump, 33) === 4 && jump - n === 4) { leapJ += 1; }
  // ...and in the Gregorian calendar, up to the year gy.
  const leapG = truncDiv(gy, 4) - truncDiv((truncDiv(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (!withLeap) { return {leap: 0, gy, march}; }

  // How many years have passed since the last leap year.
  if (jump - n < 6) { n = n - jump + truncDiv(jump + 4, 33) * 33; }
  let leap = truncMod(truncMod(n + 1, 33) - 1, 4);
  if (leap === -1) { leap = 4; }
  return {leap, gy, march};
}

/** Proleptic Gregorian date to Julian day number (the noon-based JDN of the date). */
export function gregorianToJdn(gy: number, gm: number, gd: number): number {
  let d = truncDiv((gy + truncDiv(gm - 8, 6) + 100100) * 1461, 4) +
    truncDiv(153 * truncMod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - truncDiv(truncDiv(gy + 100100 + truncDiv(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** Julian day number to the proleptic Gregorian date it names. */
export function jdnToGregorian(jdn: number): GregorianDate {
  let j = 4 * jdn + 139361631;
  j = j + truncDiv(truncDiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = truncDiv(truncMod(j, 1461), 4) * 5 + 308;
  const gd = truncDiv(truncMod(i, 153), 5) + 1;
  const gm = truncMod(truncDiv(i, 153), 12) + 1;
  const gy = truncDiv(j, 1461) - 100100 + truncDiv(8 - gm, 6);
  return {gy, gm, gd};
}

export function jalaliToJdn(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy, false);
  if (!r) { throw new Error(`Unsupported Jalali year: ${jy}`); }
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) {
    throw new Error(`Unsupported Jalali date: ${jy}/${jm}/${jd}`);
  }
  return gregorianToJdn(r.gy, 3, r.march) + (jm - 1) * 31 - truncDiv(jm, 7) * (jm - 7) + jd - 1;
}

/** Julian day number to Jalali date. Throws for days outside the supported range. */
export function jdnToJalali(jdn: number): JalaliDate {
  const {gy} = jdnToGregorian(jdn);
  let jy = gy - 621;
  const r = jalCal(jy);
  if (!r) { throw new Error(`Unsupported Jalali year: ${jy}`); }
  const jdn1f = gregorianToJdn(gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm: number;
  let jd: number;
  if (k >= 0) {
    if (k <= 185) {
      return {jy, jm: 1 + truncDiv(k, 31), jd: truncMod(k, 31) + 1};
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) { k += 1; }
  }
  jm = 7 + truncDiv(k, 30);
  jd = truncMod(k, 30) + 1;
  return {jy, jm, jd};
}

export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  return jdnToJalali(gregorianToJdn(gy, gm, gd));
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): GregorianDate {
  return jdnToGregorian(jalaliToJdn(jy, jm, jd));
}

export function isJalaliLeapYear(jy: number): boolean {
  const r = jalCal(jy);
  return r !== null && r.leap === 0;
}

/** True if the Jalali year is one we can convert (see BREAKS above). */
export function isConvertibleJalaliYear(jy: number): boolean {
  return Number.isFinite(jy) && jy >= MIN_JALALI_YEAR && jy <= MAX_JALALI_YEAR;
}

/** Number of days in the given Jalali month. */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) { return 31; }
  if (jm <= 11) { return 30; }
  return isJalaliLeapYear(jy) ? 30 : 29;
}

/** Days between the epoch (1970-01-01 Gregorian) and the given Jalali date. */
export function jalaliToUnixDays(jy: number, jm: number, jd: number): number {
  return jalaliToJdn(jy, jm, jd) - DAY_ZERO;
}

/** Inverse of jalaliToUnixDays. */
export function unixDaysToJalali(days: number): JalaliDate {
  return jdnToJalali(Math.floor(days) + DAY_ZERO);
}

/** Seconds since the epoch at midnight, UTC, of the given Jalali date. */
export function jalaliToUtcSeconds(jy: number, jm: number, jd: number): number {
  return jalaliToUnixDays(jy, jm, jd) * 86400;
}

/**
 * Weekday of a Jalali date, counted from Saturday: 0 = شنبه ... 6 = جمعه.
 */
export function jalaliWeekdayIndex(jy: number, jm: number, jd: number): number {
  const g = jalaliToGregorian(jy, jm, jd);
  const sundayFirst = new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay();
  return positiveMod(sundayFirst + 1, 7);
}

// ---------------------------------------------------------------------------
// Digits
// ---------------------------------------------------------------------------

/** Replace Persian (۰-۹), Arabic-Indic (٠-٩) and fullwidth digits with ASCII digits. */
export function toLatinDigits(text: string): string {
  return text.replace(/[\u06F0-\u06F9\u0660-\u0669\uFF10-\uFF19]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= 0xFF10 ? 0xFF10 : (code >= 0x06F0 ? 0x06F0 : 0x0660);
    return String(code - base);
  });
}

/** Replace ASCII digits with Persian digits. */
export function toPersianDigits(text: string): string {
  return text.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

// ---------------------------------------------------------------------------
// Month names
// ---------------------------------------------------------------------------

const _monthNameIndex = new Map<string, number>();
JALALI_MONTHS_FA.forEach((name, i) => _registerMonthName(name, i));
JALALI_MONTHS_SHORT_FA.forEach((name, i) => _registerMonthName(name, i));
JALALI_MONTHS_EN.forEach((name, i) => _registerMonthName(name, i));
// The ZWFJ in "سه‌شنبه" and friends: harmless here, but normalize anyway.
function _registerMonthName(name: string, index: number) {
  for (const key of [name, name.replace(/\u200c/g, ""), name.replace(/[\s.\u200c]/g, "")]) {
    const norm = normalizeMonthName(key);
    if (!_monthNameIndex.has(norm)) { _monthNameIndex.set(norm, index); }
  }
}

/**
 * Spellings that mean the same month but differ in codepoint: آ/أ/إ/ٱ all get typed as ا (and the
 * month names in JALALI_MONTHS_FA carry the madda), ی/ک are the Persian letters whose Arabic
 * forms also show up in pasted text, and ة in final position is written ه.
 */
function normalizeMonthName(name: string): string {
  return toLatinDigits(name)
    .replace(/[آأإاٱ]/g, "ا")   // any alef form -> bare alef
    .replace(/ی/g, "ي")                             // Persian yeh -> Arabic yeh
    .replace(/ک/g, "ك")                             // Persian keheh -> Arabic kaf
    .replace(/ة/g, "ه")                             // ta marbuta -> heh
    .replace(/\u200c/g, "")                                   // ZWNJ carries no meaning here
    .replace(/^(ماه|month of)\s+/i, "")
    .replace(/\s*(ماه|مه)$/g, "")                             // "آذر ماه" is just Azar
    .replace(/[.\-\s]+$/g, "")
    .trim()
    .toLowerCase();
}

/** Month number (1-12) for a Persian or transliterated month name, or null if unrecognized. */
export function jalaliMonthFromName(name: string): number | null {
  const key = normalizeMonthName(name);
  const direct = _monthNameIndex.get(key);
  if (direct !== undefined) { return direct + 1; }
  const flat = key.replace(/[\s.\u200c-]/g, "");
  const fallback = _monthNameIndex.get(flat);
  return fallback === undefined ? null : fallback + 1;
}

// ---------------------------------------------------------------------------
// Whether Jalali is in force
// ---------------------------------------------------------------------------

/**
 * Language codes whose readers expect the Jalali calendar: Persian in its three subtags (fa, the
 * legacy pes, and Dari/prs), Pashto, Uyghur, Kurdish (Sorani) and the Arabic-script variants that
 * officially use the Solar Hijri calendar. Turkmen is deliberately absent -- it writes in Latin and
 * uses the Gregorian calendar.
 */
const JALALI_LANGS = /^(fa|pes|prs|ps|ug|ku|ar-IQ|ar-IR|az-IR)([-_]|$)/i;

// A client-side hint, set from the document's locale (app/client/models/DocModel.ts), so that
// every code path -- including the one used when pasting a column of dates -- agrees on the
// calendar in force for the document currently being edited.
let _docLocale: string | undefined;

/** Called by the client when a document's settings (which carry its locale) are loaded. */
export function setJalaliDocLocale(locale: string | null | undefined): void {
  _docLocale = locale || undefined;
}

/** The locale the client currently has loaded, if any. */
export function getJalaliDocLocale(): string | undefined {
  return _docLocale;
}

export function isJalaliLocale(locale: string | null | undefined): boolean {
  return Boolean(locale) && JALALI_LANGS.test(String(locale));
}

/**
 * The interface language, as recorded on the <html> element by setupLocale() and by the server
 * when it renders the page. Reading the DOM attribute (rather than importing the i18n module)
 * keeps this file usable from shared code that also runs on the server, where there is no DOM.
 */
function getUiLang(): string | undefined {
  // Set while the interface language is being applied, when <html lang> still holds the previous
  // one and reading it would answer a question about a state that is about to change.
  if (_uiLangOverride !== undefined) { return _uiLangOverride; }
  const doc = (globalThis as any).document;
  if (!doc || !doc.documentElement) { return undefined; }
  const lang = doc.documentElement.getAttribute("lang");
  if (lang && JALALI_LANGS.test(lang)) { return lang; }
  // The calendar preference may also be stated directly, which is how the server flags it.
  return doc.documentElement.getAttribute("data-calendar") === "jalali" ? "fa" : undefined;
}

let _uiLangOverride: string | undefined;

/**
 * Tell the calendar which interface language is being switched to. Only needed by code that decides
 * *while* changing the language (app/client/lib/localization.ts); the attribute on <html> is the
 * source of truth afterwards.
 */
export function setJalaliUiLangOverride(lng: string | null): void {
  _uiLangOverride = lng === null ? undefined : lng;
}

/**
 * Whether dates should be shown and read in the Jalali calendar.
 *
 * Precedence:
 *   1. an explicit per-column choice (`jalali` widget option), so a single column can opt in or
 *      out whatever the rest of the document does;
 *   2. the document's locale, which is what Grist already uses for number formats;
 *   3. the interface language, so that a Persian user gets a Persian calendar in a document
 *      whose locale was never set.
 */
export function shouldUseJalali(explicit?: boolean | null, docLocale?: string | null): boolean {
  if (explicit === true || explicit === false) { return explicit; }
  return isJalaliLocale(docLocale) || isJalaliLocale(_docLocale) || isJalaliLocale(getUiLang());
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export type JalaliDigitMode = "latin" | "persian";

export interface JalaliFormatOptions {
  /** Digits to write; Persian by default, since that is what a Persian reader expects. */
  digits?: JalaliDigitMode;
  /** Which set of month names to use for MMMM/MMM. */
  monthNames?: "fa" | "en";
  /** Which set of weekday names to use for dddd/ddd/dd. */
  weekdayNames?: "fa" | "en";
  /**
   * First day of the week for the weekday tokens, counted from Saturday (0) -- the Jalali
   * default -- or Sunday (6 in this counting, i.e. index of شنبه ... see JALALI_FIRST_WEEKDAY).
   */
  weekdayOffset?: number;
}

/**
 * The part of Grist's date/time formatting that this module takes over: anything a moment.js
 * object can do, minus the date tokens, which are reinterpreted on the Jalali scale.
 */
export interface MomentLike {
  year(): number;
  month(): number;      // 0-11, as in moment
  date(): number;       // 1-31
  format(format: string): string;
}

const TIME_TOKENS = new Set([
  "HH", "H", "hh", "h", "kk", "k", "mm", "m", "ss", "s", "SSS", "A", "a", "ZZ", "Z", "z", "X", "x",
]);

// Longest alternatives first, so that YYYY wins over YY, MMMM over MMM over MM over M, etc.
const FORMAT_TOKEN_RE = new RegExp([
  "\\[[^\\]]*\\]",                 // [literal]
  "YYYY", "YY", "Y",
  "MMMMM", "MMMM", "MMM", "MM", "M",
  "dddd", "ddd", "dd", "DD", "Do", "D",
  "HH", "H", "hh", "h", "kk", "k",
  "mm", "m", "ss", "s", "SSS",
  "A", "a", "ZZ", "Z", "z", "X", "x",
].join("|"), "g");

/**
 * Splits a moment format string at the first time token, e.g.
 *   "YYYY-MM-DD HH:mm" -> {date: "YYYY-MM-DD ", time: "HH:mm"}
 * Everything before that point is ours to format; everything from it on is handed to moment
 * unchanged, so time zones, am/pm and custom time formats keep working as before.
 */
export function splitDateFormat(format: string): {date: string, time: string} {
  const re = new RegExp(FORMAT_TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(format)) !== null) {
    if (TIME_TOKENS.has(match[0])) {
      // Trim the joiner: "YYYY/MM/DD HH:mm" is a date format plus a time format, not a date
      // format with a trailing space (which a widget would then render as one).
      return {date: format.slice(0, match.index).trim(), time: format.slice(match.index).trim()};
    }
  }
  return {date: format, time: ""};
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function pad4(n: number): string { return String(Math.abs(n)).padStart(4, "0"); }

function dateTokenValue(token: string, j: JalaliDate, weekday: number, opts: JalaliFormatOptions): string | null {
  const months = opts.monthNames === "en" ? JALALI_MONTHS_EN : JALALI_MONTHS_FA;
  const monthsShort = opts.monthNames === "en" ? JALALI_MONTHS_EN.map(m => m.slice(0, 3)) : JALALI_MONTHS_SHORT_FA;
  const weekdays = opts.weekdayNames === "en" ?
    ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] : JALALI_WEEKDAYS_FA;
  const weekdaysShort = opts.weekdayNames === "en" ?
    ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] : JALALI_WEEKDAYS_SHORT_FA;
  switch (token) {
    case "YYYY": case "Y": return pad4(j.jy);
    case "YY": return pad2(j.jy % 100);
    case "MMMMM": return months[j.jm - 1].slice(0, 1);
    case "MMMM": return months[j.jm - 1];
    case "MMM": return monthsShort[j.jm - 1];
    case "MM": return pad2(j.jm);
    case "M": return String(j.jm);
    case "DD": return pad2(j.jd);
    case "D": return String(j.jd);
    case "Do": return String(j.jd);          // Persian dates carry no ordinal suffix.
    case "dddd": return weekdays[weekday];
    case "ddd": return weekdaysShort[weekday];
    case "dd": return weekdaysShort[weekday].slice(0, 1);
    default: return null;
  }
}

/**
 * Whether Jalali dates are written with Persian digits (۱۴۰۵) or ASCII ones (1405). Some
 * Persian documents prefer ASCII digits because they survive copying into other systems; flip
 * this constant for a build-wide change, or pass `digits` at the call site for a single one.
 */
export const JALALI_PERSIAN_DIGITS: boolean = true;

/** The format options Grist uses for Jalali dates, with room to override any of them. */
export function jalaliFormatOptions(extra: JalaliFormatOptions = {}): JalaliFormatOptions {
  return {digits: JALALI_PERSIAN_DIGITS ? "persian" : "latin", monthNames: "fa", weekdayNames: "fa", ...extra};
}

/** Formats just the date tokens of `format`, using Jalali values. */
export function formatJalaliDatePart(
  j: JalaliDate, weekday: number, format: string, opts: JalaliFormatOptions = {},
): string {
  if (!format) { return ""; }
  return format.replace(FORMAT_TOKEN_RE, (token) => {
    if (token.startsWith("[")) { return token.slice(1, -1); }
    const value = dateTokenValue(token, j, weekday, opts);
    return value === null ? token : value;
  });
}

/**
 * Formats a moment-like object as a Jalali date, following the moment format string the column
 * is configured with (its date tokens are read on the Jalali scale, its time tokens are left to
 * moment). Returns null when the date is too far out for the calendar to represent.
 */
export function formatJalaliMoment(
  m: MomentLike, format: string, opts: JalaliFormatOptions = {},
): string | null {
  let j: JalaliDate;
  try {
    j = gregorianToJalali(m.year(), m.month() + 1, m.date());
  } catch (e) {
    return null;
  }
  if (!isConvertibleJalaliYear(j.jy)) { return null; }
  const {date, time} = splitDateFormat(format);
  const weekday = positiveMod(jalaliWeekdayIndex(j.jy, j.jm, j.jd) + (opts.weekdayOffset || 0), 7);
  const datePart = formatJalaliDatePart(j, weekday, date, opts);
  const timePart = time ? m.format(time) : "";
  const joined = datePart + timePart;
  return (opts.digits ?? "persian") === "persian" ? toPersianDigits(withPersianDayPeriod(joined)) : joined;
}

/** moment's locale data is not part of a core Grist build, so render am/pm ourselves. */
function withPersianDayPeriod(text: string): string {
  return text.replace(/\b([AaPp])\.?\s?[Mm]\b/g, (match) => {
    return match.trim().toLowerCase().startsWith("a") ? "ق.ظ" : "ب.ظ";
  });
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface JalaliParsed extends JalaliDate {
  /** True if the year had to be taken from today, because the input gave none. */
  yearGuessed?: boolean;
  /** True if the month had to be taken from today, because the input gave none. */
  monthGuessed?: boolean;
  /** True if the day had to be taken from today, because the input gave none. */
  dayGuessed?: boolean;
  /** A time of day ("14:30") found after the date, for the caller to parse on its own. */
  time?: string;
}

/** Invisible bidi controls a copied Persian string may carry (RLM, RLE, word joiner, ZWSP). */
const BIDI_CONTROL_RE = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** A trailing "14:30" (optionally with seconds and am/pm), which is not ours to interpret. */
const TRAILING_TIME_RE = /\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(\s*[AaPp]\.?\s?[Mm]\.?)?\s*$/;

/**
 * Expands a 2-digit Jalali year around the current one, so that "03" means 1403 while "83"
 * means 1383. Mirrors how Grist expands 2-digit Gregorian years (see TWO_DIGIT_YEAR_THRESHOLD
 * in app/common/parseDate.ts), but centred on the Jalali year instead of the Gregorian one.
 */
export function expandTwoDigitJalaliYear(yy: number, currentJy: number = jalaliToday().jy): number {
  const century = Math.floor(currentJy / 100) * 100;
  // The candidates are the same two digits in this century, the previous one, or the next. The
  // nearest wins; equidistant goes forward, matching how moment treats two-digit years.
  let best = century + yy;
  for (const candidate of [century - 100 + yy, century + 100 + yy]) {
    const bestDist = Math.abs(best - currentJy);
    const dist = Math.abs(candidate - currentJy);
    if (dist < bestDist || (dist === bestDist && candidate > best)) { best = candidate; }
  }
  return best;
}


/** Words that may follow a Jalali date without making it something else, e.g. "1405 ه.ش". */
function isJalaliQualifier(word: string): boolean {
  const flat = word.replace(/[\s.]/g, "");
  return flat === "ه.ش" || flat === "ه‍.ش" || flat === "شمسی" || flat === "جلالی" ||
    flat === "هجری" || flat === "SH" || flat === "J" || flat === "JS" || flat === "AH" ||
    flat === "AP" || flat === "AHs";
}

function pickYearMonthDay(
  nums: number[], order: string,
): { jy: number | null, jm: number | null, jd: number | null } {
  const [a, b, c] = nums;
  // A number over 31 cannot be a month or a day, so it is the year whatever the column's format
  // claims -- which is what lets "1405/9/6" be understood in a MM/DD/YYYY column, and "6/9/1405"
  // in a DD/MM/YYYY one.
  const yearIndex = nums.findIndex((n) => n > 31);
  if (yearIndex >= 0) {
    const year = nums[yearIndex];
    const rest = nums.filter((n) => n !== year);
    if (yearIndex === 0) { return {jy: year, jm: rest[0], jd: rest[1]}; }
    // Year last: only the format can say which of the first two numbers is the month.
    return order === "DMY" ? {jy: year, jm: rest[1], jd: rest[0]} : {jy: year, jm: rest[0], jd: rest[1]};
  }
  if (order === "MDY") { return {jy: c, jm: a, jd: b}; }
  if (order === "DMY") { return {jy: c, jm: b, jd: a}; }
  return {jy: a, jm: b, jd: c};
}

/**
 * Reads a Jalali date from a string a user typed, e.g. "1405/09/06", "۱۴۰۵-۹-۶", "6 آذر 1405",
 * "آذر 6", or "1405". Returns null when the string is not a Jalali date we should claim to
 * understand -- notably a Gregorian date such as "2026-11-27" -- so the caller can fall back to
 * ordinary parsing.
 *
 * `dateFormat` (the column's moment format) is used only to tell the numbers apart, never to
 * constrain them: typing "1405/9/6" into a column formatted "MM/DD/YYYY" still works.
 */
export function parseJalaliDateString(input: string, dateFormat?: string): JalaliParsed | null {
  if (!input) { return null; }
  // Bidi control marks come along for the ride whenever Persian text is copied out of a chat
  // client or an email; they are invisible, so they must not decide whether a date parses. The
  // ZWNJ of Persian orthography (\u200c) is deliberately left alone -- it is inside words.
  let text = toLatinDigits(String(input).replace(BIDI_CONTROL_RE, ""))
    .replace(/[\u060C\u066B]/g, " ").trim();
  if (!text) { return null; }

  let time: string | undefined;
  const timeMatch = TRAILING_TIME_RE.exec(text);
  if (timeMatch) {
    time = timeMatch[0].trim();
    text = text.slice(0, timeMatch.index).trim();
  }
  if (!text) { return null; }

  // Strip the qualifiers a Persian writer may append ("۱۴۰۵ ه.ش", "1405 AP"), then look only
  // at letter runs, so that separators and punctuation never count as words.
  text = text
    .replace(/ه\s*\.?\s*ش\.?/g, " ")
    .replace(/(شمسی|جلالی|خورشیدی|هجری)/g, " ")
    .replace(/\b(AH|AP|SH|J|JS)\.?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text.match(/[A-Za-z\u0600-\u06FF\u200c]+/gu) || [];
  let monthFromName: number | null = null;
  for (const word of words) {
    const found = jalaliMonthFromName(word);
    if (found !== null) { monthFromName = found; break; }
    if (!isJalaliQualifier(word)) { return null; }
  }

  const nums = (text.match(/\d+/g) || []).map(s => parseInt(s, 10)).filter(Number.isFinite);
  if (!nums.length) { return null; }

  const today = jalaliToday();
  let jy: number | null = null;
  let jm: number | null = monthFromName;
  let jd: number | null = null;
  let yearGuessed = false;
  let monthGuessed = false;
  let dayGuessed = false;

  if (monthFromName !== null) {
    const year = nums.find(n => n > 31);
    const day = nums.find(n => n >= 1 && n <= 31);
    if (nums.length >= 2 && year !== undefined && day !== undefined) {
      jy = year;
      jd = day;
    } else if (nums.length === 1 && day !== undefined) {
      jd = day;
      jy = today.jy;
      yearGuessed = true;
    } else if (year !== undefined) {
      // A month name with only a year: the first day of that month.
      jy = year;
      jd = 1;
      dayGuessed = true;
    } else {
      return null;
    }
  } else if (nums.length >= 3) {
    ({jy, jm, jd} = pickYearMonthDay(nums.slice(0, 3), dateFormatOrder(dateFormat)));
  } else if (nums.length === 2) {
    const [a, b] = nums;
    if (a > 31 || b > 31) {
      // One of the two is the year; the other is a month or a day, which the column's format
      // tells apart (a number over 12 settles it on its own).
      const order = dateFormatOrder(dateFormat);
      const yearFirst = a > 31;
      const other = yearFirst ? b : a;
      const otherIsMonth = other <= 12 && (yearFirst ? order === "YMD" : order !== "DMY");
      jy = yearFirst ? a : b;
      if (otherIsMonth) {
        jm = other;
        jd = today.jd;
        dayGuessed = true;
      } else {
        jd = other;
        if (jm === null) { jm = today.jm; monthGuessed = true; }
      }
    } else {
      // A month and a day, in the order the format suggests; the year is this year.
      const order = dateFormatOrder(dateFormat);
      if (order === "DMY") { jd = a; jm = b; }
      else { jm = a; jd = b; }
      jy = today.jy;
      yearGuessed = true;
    }
  } else {
    const only = nums[0];
    if (only > 31) {
      jy = only; jm = 1; jd = 1;
      monthGuessed = true;
      dayGuessed = true;
    } else {
      // A bare day means the 27th of this month, matching Grist's behaviour with Gregorian dates.
      jy = today.jy;
      jm = today.jm;
      jd = only;
      yearGuessed = true;
    }
  }

  if (jy === null) { return null; }
  if (jy < 100) { jy = expandTwoDigitJalaliYear(jy, today.jy); }
  if (jm === null) { jm = today.jm; monthGuessed = true; }
  if (jd === null) { jd = today.jd; dayGuessed = true; }

  // A swapped month and day is the most likely slip, so correct it rather than fail.
  if ((jm < 1 || jm > 12) && jd >= 1 && jd <= 12) { const t = jm; jm = jd; jd = t; }
  if (jm < 1 || jm > 12 || jd < 1 || jd > jalaliMonthLength(jy, jm)) { return null; }
  // Out of the plausible Jalali range means it was a Gregorian date after all.
  if (jy < MIN_PLAUSIBLE_JALALI_YEAR || jy > MAX_PLAUSIBLE_JALALI_YEAR) { return null; }

  return {jy, jm, jd, yearGuessed, monthGuessed, dayGuessed, time};
}

/**
 * The order in which the column's format lists year, month and day, used only to tell the numbers
 * in the input apart. Returns "" when the format does not name all three.
 */
export function dateFormatOrder(dateFormat?: string): "YMD" | "MDY" | "DMY" | "" {
  if (!dateFormat) { return ""; }
  const seen = new Map<string, number>();
  const re = /Y+|M+|D+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(dateFormat)) !== null) {
    const kind = match[0][0];
    if (!seen.has(kind)) { seen.set(kind, match.index); }
  }
  if (seen.size !== 3) { return ""; }
  const y = seen.get("Y")!;
  const m = seen.get("M")!;
  const d = seen.get("D")!;
  if (y < m && m < d) { return "YMD"; }
  if (d < m) { return "DMY"; }
  return "MDY";
}

/**
 * Converts a Jalali date string to the equivalent Gregorian date, or null if the input is not a
 * Jalali date. This is the entry point used by app/common/parseDate.ts, which then parses the
 * result with its ordinary rules -- so the output has to look exactly like what a Gregorian user
 * would have typed, including a time of day:
 *
 *     "1405/09/06"          -> "2026-11-27"
 *     "1405-09-06 14:30"    -> "2026-11-27 14:30"
 *
 * Dropping the time here would be wrong twice over: parseDateStrict() would then accept the
 * date-only string it is handed, and parseDateTime() would never get to split the time off.
 */
export function jalaliDateStringToGregorian(input: string, dateFormat?: string): string | null {
  const j = parseJalaliDateString(input, dateFormat);
  if (!j) { return null; }
  let g: GregorianDate;
  try {
    g = jalaliToGregorian(j.jy, j.jm, j.jd);
  } catch (e) {
    return null;
  }
  const iso = `${pad4(g.gy)}-${pad2(g.gm)}-${pad2(g.gd)}`;
  // Keep any time of day the user typed in the same field (already latin digits, and separated
  // from the date the way Grist's own formats expect). When the time comes from DateTimeEditor as
  // a separate `options.time`, there is nothing here to append.
  return j.time ? `${iso} ${j.time}` : iso;
}

/** The Jalali date for a unix timestamp (seconds), read in UTC. */
export function unixSecondsToJalali(seconds: number): JalaliDate {
  return jdnToJalali(Math.floor(seconds / 86400) + DAY_ZERO);
}

/** Today, in the Jalali calendar. */
export function jalaliToday(now: Date = new Date()): JalaliDate {
  return gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Whether two Jalali dates fall in the same month of the same year. */
export function isSameJalaliMonth(a: JalaliDate, b: JalaliDate): boolean {
  return a.jy === b.jy && a.jm === b.jm;
}

/** The day of the month, clamped to the length of the target month (for "same day next month"). */
export function addJalaliMonths(j: JalaliDate, months: number): JalaliDate {
  const total = (j.jy * 12 + (j.jm - 1)) + months;
  const jy = Math.floor(total / 12);
  const jm = positiveMod(total, 12) + 1;
  return {jy, jm, jd: Math.min(j.jd, jalaliMonthLength(jy, jm))};
}
