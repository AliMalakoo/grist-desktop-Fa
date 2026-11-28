import { CellValue } from "app/common/DocActions";
import { DocData } from "app/common/DocData";
import { DocumentSettings } from "app/common/DocumentSettings";
import { isObject } from "app/common/gristTypes";
import { countIf } from "app/common/gutil";
import { NumberFormatOptions } from "app/common/NumberFormat";
import NumberParse from "app/common/NumberParse";
import {
  jalaliDateStringToGregorian,
  shouldUseJalali,
  toLatinDigits,
} from "app/common/jalali";
import { dateTimeWidgetOptions, guessDateFormat, guessDateFormats, parseDateStrict, parseDateTime } from "app/common/parseDate";
import { MetaRowRecord } from "app/common/TableData";
import { createFormatter } from "app/common/ValueFormatter";
import { createParserRaw, ValueParser } from "app/common/ValueParser";

import * as moment from "moment-timezone";

interface GuessedColInfo {
  type: string;
  widgetOptions?: object;
}

export interface GuessResult {
  values?: CellValue[];
  colInfo: GuessedColInfo;
}

type ColMetadata = Partial<MetaRowRecord<"_grist_Tables_column">>;

export interface GuessColMetadata {
  values: CellValue[];
  colMetadata?: ColMetadata;    // omitted if no changes are proposed.
}

/**
 * Class for guessing if an array of values should be interpreted as a specific column type.
 * T is the type of values that strings should be parsed to and is stored in the column.
 */
abstract class ValueGuesser<T> {
  /**
   * Guessed column type and maybe widget options.
   */
  public abstract colInfo(): GuessedColInfo;

  /**
   * Parse a single string to a typed value in such a way that formatting the value returns the original string.
   * If the string cannot be parsed, return the original string.
   */
  public abstract parse(value: string): T | string;

  /**
   * Attempt to parse at least 90% the string values losslessly according to the guessed colInfo.
   * Return null if this cannot be done.
   */
  public guess(values: (string | null)[], docSettings: DocumentSettings): GuessResult | null {
    const colInfo = this.colInfo();
    const { type, widgetOptions } = colInfo;
    const formatter = createFormatter(type, widgetOptions || {}, docSettings);
    const result: any[] = [];
    // max number of non-parsed strings to allow before giving up
    const maxUnparsed = countIf(values, v => Boolean(v)) * 0.1;
    let unparsed = 0;

    for (const value of values) {
      if (!value) {
        if (this.allowBlank()) {
          result.push(null);
          continue;
        } else {
          return null;
        }
      }

      const parsed = this.parse(value);
      // Give up if too many strings failed to parse or if the parsed value changes when converted back to text
      if ((typeof parsed === "string" && ++unparsed > maxUnparsed) ||
        !this.isEqualFormatted(formatter.formatAny(parsed), value)) {
        return null;
      }
      result.push(parsed);
    }
    return { values: result, colInfo };
  }

  /**
   * Whether this type of column can store nulls directly.
   */
  protected allowBlank(): boolean {
    return true;
  }

  protected isEqualFormatted(formatted1: string, formatted2: string): boolean {
    return formatted1 === formatted2;
  }
}

class BoolGuesser extends ValueGuesser<boolean> {
  public colInfo(): GuessedColInfo {
    return { type: "Bool" };
  }

  public parse(value: string): boolean | string {
    if (value === "true") {
      return true;
    } else if (value === "false") {
      return false;
    } else {
      return value;
    }
  }

  /**
   * This is the only type that can't store nulls, it converts them to false.
   */
  protected allowBlank(): boolean {
    return false;
  }
}

class NumericGuesser extends ValueGuesser<number> {
  private _parser: ValueParser;
  constructor(docSettings: DocumentSettings, private _options: NumberFormatOptions) {
    super();
    this._parser = createParserRaw("Numeric", _options, docSettings);
  }

  public colInfo(): GuessedColInfo {
    const result: GuessedColInfo = { type: "Numeric" };
    if (Object.keys(this._options).length) {
      result.widgetOptions = this._options;
    }
    return result;
  }

  public parse(value: string): number | string {
    return this._parser.cleanParse(value);
  }

  protected isEqualFormatted(formatted1: string, formatted2: string): boolean {
    // Consider format guessing successful if it returns the typed-in numeric value exactly or
    // differing only in whitespace; digits are compared in Latin, so that a Persian-digit
    // rendering of what the user typed in Latin digits still counts as a match.
    const strip = (s: string) => toLatinDigits(s).replace(NumberParse.removeCharsRegex, "");
    return strip(formatted1) === strip(formatted2);
  }
}

class DateGuesser extends ValueGuesser<number> {
  private _jalali: boolean;

  // _format should be a full moment format string
  // _tz should be the document's default timezone
  constructor(private _format: string, private _tz: string, docSettings?: DocumentSettings) {
    super();
    this._jalali = shouldUseJalali(null, docSettings?.locale);
  }

  public colInfo(): GuessedColInfo {
    const widgetOptions = dateTimeWidgetOptions(this._format, false);
    let type;
    if (widgetOptions.timeFormat) {
      type = "DateTime:" + this._tz;
    } else {
      type = "Date";
      this._tz = "UTC";
    }
    return { widgetOptions, type };
  }

  // Note that this parsing is much stricter than parseDate to prevent loss of information.
  // Dates which can be parsed by parseDate based on the guessed widget options may not be parsed here.
  public parse(value: string): number | string {
    if (this._jalali) {
      return this._parseJalali(value) ?? value;
    }
    const m = moment.tz(value, this._format, true, this._tz);
    return m.isValid() ? m.valueOf() / 1000 : value;
  }

  protected isEqualFormatted(formatted1: string, formatted2: string): boolean {
    if (this._jalali) {
      // A Persian rendering writes its digits in Persian; compare them in Latin digits, and
      // ignore any bidi control marks copied along with the text.
      const strip = (s: string) => toLatinDigits(s).replace(/[\u200e\u200f\u202a-\u202e]/g, "").trim();
      return strip(formatted1) === strip(formatted2);
    }
    return super.isEqualFormatted(formatted1, formatted2);
  }

  /**
   * Reads a Jalali date typed in the column's guessed format. The value stored is an ordinary
   * timestamp, so the Jalali layer only has to produce the Gregorian equivalent for the rest of
   * the pipeline to work with.
   */
  private _parseJalali(value: string): number | null {
    const iso = jalaliDateStringToGregorian(value, this._format);
    if (iso === null) {
      return null;
    }
    const hasTime = /\d{1,2}:\d{2}/.test(iso);
    if (hasTime) {
      const ts = parseDateTime(iso, { timezone: this._tz });
      return ts === undefined ? null : ts;
    }
    // Dates store UTC midnight, matching how DateParser and the Date formatter work.
    return parseDateStrict(iso, "YYYY-MM-DD", undefined, "UTC") ?? null;
  }
}

// The same invisible marks parseJalaliDateString tolerates. moment trips over them.
const BIDI_CONTROL_RE = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * The format to offer as a Jalali guess. moment-guess works out the positions of the numbers
 * without caring which calendar they belong to, and Persian readers write the day before the
 * month, so among equally good candidates prefer a day-first format (or a year-first one) over
 * month-first.
 */
function guessJalaliDateFormat(values: (string | null)[], timezone: string): string {
  // moment only reads Latin digits and trips over bidi control marks, so the guess is made from
  // normalized copies. The values themselves flow on untouched: NumberParse knows Persian digits
  // and digit-groups of its own, and the date comparisons happen in Latin digits anyway.
  const normalized = values.map(
    v => (typeof v === "string" && v ? toLatinDigits(v).replace(BIDI_CONTROL_RE, "") : v));
  const formats = guessDateFormats(normalized, timezone);
  if (!formats) {
    return "YYYY-MM-DD";
  }
  // Formats are sorted lexicographically; a year-first one is unambiguous and stays as it is, and
  // so does a day-before-month one. Otherwise pick the first day-first candidate.
  const preferred = formats.find(f => f.startsWith("Y") || f.indexOf("D") < f.indexOf("M"));
  return preferred ?? formats[formats.length - 1];
}

export function guessColInfoWithDocData(values: (string | null)[], docData: DocData) {
  return guessColInfo(values, docData.docSettings(), docData.docInfo().timezone);
}

export function guessColInfo(
  values: (string | null)[], docSettings: DocumentSettings, timezone: string,
): GuessResult {
  // Use short-circuiting of || to only do as much work as needed,
  // in particular not guessing date formats before trying other types.
  const jalali = shouldUseJalali(null, docSettings.locale);
  const dateFormat = jalali ? guessJalaliDateFormat(values, timezone) : guessDateFormat(values, timezone);
  return (
    new BoolGuesser()
      .guess(values, docSettings) ||
      new NumericGuesser(
        docSettings,
        NumberParse.fromSettings(docSettings).guessOptions(values),
      )
        .guess(values, docSettings) ||
        new DateGuesser(dateFormat, timezone, docSettings)
          .guess(values, docSettings) ||
    // Don't return the same values back if there's no conversion to be done,
    // as they have to be serialized and transferred over a pipe to Python.
          { colInfo: { type: "Text" } }
  );
}

/**
 * Guess column info for a new column, returning the metadata suitable for using with AddTable or
 * AddColumn user actions. In particular, widgetOptions, if any, are returned as a JSON string.
 * Will suggest turning the column to an empty one if all the values are empty (null or "").
 */
export function guessColInfoForImports(values: CellValue[], docData: DocData): GuessColMetadata {
  if (values.every(v => (v === null || v === ""))) {
    // Suggest empty column.
    return { values, colMetadata: { type: "Any", isFormula: true, formula: "" } };
  }
  if (values.some(isObject)) {
    // Suggest no changes.
    return { values };
  }
  const strValues = values.map(v => (v === null || typeof v === "string" ? v : String(v)));
  const guessed = guessColInfoWithDocData(strValues, docData);
  values = guessed.values || values;

  const opts = guessed.colInfo.widgetOptions;
  const colMetadata: ColMetadata = { ...guessed.colInfo, widgetOptions: opts && JSON.stringify(opts) };
  if (!colMetadata.widgetOptions) {
    delete colMetadata.widgetOptions;     // Omit widgetOptions unless it is actually valid JSON.
  }
  return { values, colMetadata };
}
