import { CommandGroup, createGroup } from "app/client/components/commands";
import { loadScript } from "app/client/lib/loadScript";
import { detectCurrentLang } from "app/client/lib/localization";
import { JalaliPickerOptions, buildJalaliPicker } from "app/client/ui/JalaliDatePicker";
import { FieldOptions } from "app/client/widgets/NewBaseEditor";
import { NTextEditor } from "app/client/widgets/NTextEditor";
import { CellValue } from "app/common/DocActions";
import {
  formatJalaliDatePart,
  gregorianToJalali,
  formatJalaliMoment,
  jalaliFormatOptions,
  jalaliWeekdayIndex,
  JalaliDate,
  splitDateFormat,
  shouldUseJalali,
} from "app/common/jalali";
import { parseDate, TWO_DIGIT_YEAR_THRESHOLD } from "app/common/parseDate";

import { dom } from "grainjs";
import moment from "moment-timezone";

// These are all the locales available for the datepicker. Having a prepared list lets us find a
// suitable one without trying combinations that don't exist. This list can be rebuilt using:
//    ls bower_components/bootstrap-datepicker/dist/locales/bootstrap-datepicker.* | cut -d. -f2 | xargs echo
//
// eslint-disable-next-line @stylistic/max-len
const availableLocales = "ar-tn ar az bg bm bn br bs ca cs cy da de el en-AU en-CA en-GB en-IE en-NZ en-ZA eo es et eu fa fi fo fr-CH fr gl he hi hr hu hy id is it-CH it ja ka kh kk km ko kr lt lv me mk mn ms nl-BE nl no oc pl pt-BR pt ro rs-latin rs ru si sk sl sq sr-latin sr sv sw ta tg th tk tr uk uz-cyrl uz-latn vi zh-CN zh-TW";

monkeyPatchDatepicker();

/**
 * DateEditor - Editor for Date type. Includes a dropdown datepicker.
 *  See reference: http://bootstrap-datepicker.readthedocs.org/en/latest/index.html
 *
 * In documents that use the Jalali (Persian solar) calendar, the cell shows and takes Jalali
 * dates, and the drop-down is Grist's own calendar (app/client/ui/JalaliDatePicker.ts) instead of
 * bootstrap-datepicker, which has no way to display another calendar. Only the *presentation*
 * changes: what is stored is the same Gregorian timestamp the data engine works with, so a
 * document can mix columns on either calendar, and formulas, filters and exports are unaffected.
 */
export class DateEditor extends NTextEditor {
  protected safeFormat: string;     // Format that specifies a complete date.
  protected jalali: boolean;        // Whether to read and write dates on the Jalali calendar.

  private _dateFormat: string | undefined = this.options.field.widgetOptionsJson.peek().dateFormat;
  private _locale = detectCurrentLang();
  private _keyboardNav = false;     // Whether keyboard navigation is active for the datepicker.
  private _jalaliPicker: HTMLElement | null = null;

  constructor(
    options: FieldOptions,
    protected timezone: string = "UTC",     // For use by the derived DateTimeEditor.
  ) {
    super(options);

    // Update moment format string to represent a date unambiguously.
    this.safeFormat = makeFullMomentFormat(this._dateFormat || "");
    this.jalali = shouldUseJalali(this.options.field.widgetOptionsJson.peek().jalali);

    // Set placeholder to current date(time), unless in read-only mode.
    if (!options.readonly) {
      // Use the default local timezone to format the placeholder date.
      // TODO: this.timezone is better for DateTime; gristDoc.docInfo.timezone.peek() is better for Date.
      const defaultTimezone = moment.tz.guess();
      const placeholder = this._formatMoment(moment.tz(defaultTimezone), this.safeFormat);
      this.textInput.setAttribute("placeholder", placeholder);
    }

    const cellValue = this.formatValue(options.cellValue, this.safeFormat, true);

    // Set the edited value, if not explicitly given, to the formatted version of cellValue.
    this.textInput.value = options.state ?? options.editValue ?? cellValue;

    if (!options.readonly) {
      // When the up/down arrow is pressed, modify the datepicker options to take control of
      // the arrow keys for date selection.
      const datepickerCommands = {
        ...options.commands,
        datepickerFocus: () => { this._allowKeyboardNav(true); },
      };
      const datepickerCommandGroup = this.autoDispose(createGroup(datepickerCommands, this, true));
      if (this.jalali) {
        this._attachJalaliPicker();
      } else {
        this._attachDatePicker(datepickerCommandGroup)
          .catch(e => console.error("Error attaching datepicker", e));
      }
    }
  }

  public getCellValue() {
    const timestamp = parseDate(this.textInput.value, {
      dateFormat: this.safeFormat,
      timezone: this.timezone,
      jalali: this.jalali,
    });
    return timestamp !== null ? timestamp : this.textInput.value;
  }

  // Moment value formatting helper.
  protected formatValue(value: CellValue, formatString: string | undefined, shouldFallBackToValue: boolean) {
    if (typeof value === "number" && formatString) {
      return this._formatMoment(moment.tz(value * 1000, this.timezone), formatString);
    } else {
      // If value is AltText, return it unchanged. This way we can see it and edit in the editor.
      return (shouldFallBackToValue && typeof value === "string") ? value : "";
    }
  }

  /**
   * Formats a moment in the calendar this column uses. Time-only formats are left to moment:
   * the Jalali calendar has no say over the time of day, and the time editor parses what moment
   * writes back.
   */
  protected _formatMoment(time: moment.Moment, formatString: string): string {
    if (this.jalali && splitDateFormat(formatString).date) {
      const jalali = formatJalaliMoment(time, formatString, jalaliFormatOptions());
      if (jalali !== null) { return jalali; }
    }
    return time.format(formatString);
  }

  // Helper to allow/disallow keyboard navigation within the datepicker.
  private _allowKeyboardNav(bool: boolean) {
    // With the Jalali picker the calendar handles its own keys, and there is no bootstrap
    // datepicker instance to reconfigure; the command group is harmless to leave installed.
    const datepicker = $(this.textInput).data().datepicker;
    if (!datepicker) { return; }
    if (this._keyboardNav !== bool) {
      this._keyboardNav = bool;
      datepicker.o.keyboardNavigation = bool;
      // Force parse must be turned on with keyboard navigation, since it forces the highlighted date
      // to be used when enter is pressed. Otherwise, keyboard date selection will have no effect.
      datepicker.o.forceParse = bool;
    }
  }

  /**
   * Shows the Jalali calendar under the input. The picked date is written into the input in the
   * column's own format, and the editor saves it from there -- the same route a typed date takes,
   * so the time zone and time of day keep being the editor's business rather than the calendar's.
   */
  private _attachJalaliPicker() {
    const options: JalaliPickerOptions = {
      initial: this._currentJalaliDate(),
      persianDigits: true,
      onPick: (j: JalaliDate) => {
        this.textInput.value = this._formatJalali(j);
        this._closeJalaliPicker();
        this.textInput.focus();
        this.onInput();
      },
      onClose: () => { this._closeJalaliPicker(); this.textInput.focus(); },
    };
    const picker = buildJalaliPicker(options);
    picker.classList.add("clipboard_allow_focus");
    this._jalaliPicker = picker;
    // Put it next to the editor's own box: .cell_editor is the positioned ancestor, so the
    // calendar hangs below the cell without being clipped by the editor's overflow.
    (this.getDom() || this.cellEditorDiv).appendChild(picker);
    this.onDispose(() => this._closeJalaliPicker());
  }

  private _closeJalaliPicker() {
    if (this._jalaliPicker) {
      this._jalaliPicker.remove();
      this._jalaliPicker = null;
    }
  }

  /** Formats a Jalali date with this column's own format, e.g. "۱۴۰۵-۰۹-۰۶". */
  private _formatJalali(j: JalaliDate): string {
    const weekday = jalaliWeekdayIndex(j.jy, j.jm, j.jd);
    const {date} = splitDateFormat(this.safeFormat);
    return formatJalaliDatePart(j, weekday, date, jalaliFormatOptions());
  }

  /** The date currently in the input, in the Jalali calendar, or null if it doesn't read as one. */
  private _currentJalaliDate(): JalaliDate | null {
    const value = this.options.cellValue;
    if (typeof value === "number") {
      const time = moment.tz(value * 1000, this.timezone);
      return gregorianToJalali(time.year(), time.month() + 1, time.date());
    }
    const text = this.textInput.value;
    if (!text) { return null; }
    const timestamp = parseDate(text, {dateFormat: this.safeFormat, timezone: this.timezone, jalali: true});
    if (timestamp === null) { return null; }
    const time = moment.tz(timestamp * 1000, this.timezone);
    return gregorianToJalali(time.year(), time.month() + 1, time.date());
  }

  // Attach the datepicker.
  private async _attachDatePicker(datepickerCommands: CommandGroup) {
    const localeToUse = await loadLocale(this._locale);
    if (this.isDisposed()) { return; }    // Good idea to check after 'await'.
    const datePickerWidget = $(this.textInput).datepicker({
      keyboardNavigation: false,
      forceParse: false,
      todayHighlight: true,
      todayBtn: "linked",
      assumeNearbyYear: TWO_DIGIT_YEAR_THRESHOLD,
      language: localeToUse,
      // Use the stripped format converted to one suitable for the datepicker.
      format: {
        toDisplay: (date: string, format: unknown, lang: unknown) => moment.utc(date).format(this.safeFormat),
        toValue: (date: string, format: unknown, lang: unknown) => {
          const timestampSec = parseDate(date, {
            dateFormat: this.safeFormat,
            // datepicker reads date in utc (ie: using date.getUTCDate()).
            timezone: "UTC",
          });
          return (timestampSec === null) ? null : new Date(timestampSec * 1000);
        },
      },
    });
    this.onDispose(() => datePickerWidget.datepicker("destroy"));

    // NOTE: Datepicker interferes with normal enter and escape functionality. Add an event handler
    // to the DatePicker to prevent interference with normal behavior.
    datePickerWidget.on("keydown", (e) => {
      // If enter or escape is pressed, destroy the datepicker and re-dispatch the event.
      if (e.keyCode === 13 || e.keyCode === 27) {
        datePickerWidget.datepicker("destroy");
        // The current target of the event will be the textarea.
        setTimeout(() => e.currentTarget?.dispatchEvent(e.originalEvent!), 0);
      }
    });

    datePickerWidget.on("show", () => {
      // A workaround to allow clicking in the datepicker without losing focus.
      const datepickerElem: HTMLElement | null = document.querySelector(".datepicker");
      if (datepickerElem) {
        dom.update(datepickerElem,
          dom.attr("tabIndex", "0"),      // allows datepicker to gain focus
          dom.cls("clipboard_allow_focus"),      // tells clipboard to not steal focus from us
        );
      }

      // Attach command group to the input to allow switching keyboard focus to the datepicker.
      dom.update(this.textInput,
        // If the user inputs text into the textbox, take keyboard focus from the datepicker.
        dom.on("input", () => { this._allowKeyboardNav(false); }),
        datepickerCommands.attach(),
      );
    });
    datePickerWidget.datepicker("show");
  }
}

// Updates the given Moment format to specify a complete date, so that the datepicker sees an
// unambiguous date in the textbox input. If the format is incomplete, fall back to YYYY-MM-DD.
function makeFullMomentFormat(mFormat: string): string {
  let safeFormat = mFormat;
  if (!safeFormat.includes("Y")) {
    safeFormat += " YYYY";
  }
  if (!safeFormat.includes("D") || !safeFormat.includes("M")) {
    safeFormat = "YYYY-MM-DD";
  }
  return safeFormat;
}

let availableLocaleSet: Set<string> | undefined;
const loadedLocaleMap = new Map<string, string>();    // Maps requested locale to the one to use.

// Datepicker supports many languages. They just need to be loaded. Here we load the language we
// need on-demand, taking care not to load any language more than once (we don't need to assume
// there is only one language being used on the page, though in practice that may well be true).
async function loadLocale(locale: string): Promise<string> {
  return loadedLocaleMap.get(locale) ||
    loadedLocaleMap.set(locale, await doLoadLocale(locale)).get(locale)!;
}

async function doLoadLocale(locale: string): Promise<string> {
  if (!availableLocaleSet) {
    availableLocaleSet = new Set(availableLocales.split(/\s+/));
  }
  if (!availableLocaleSet.has(locale)) {
    const shortLocale = locale.split("-")[0];            // If "xx-YY" is not available, try "xx"
    if (!availableLocaleSet.has(shortLocale)) {
      // No special locale available. (This is even true for "en", which is fine since that's
      // loaded by default.)
      return locale;
    }
    locale = shortLocale;
  }

  console.debug(`DateEditor: loading locale ${locale}`);
  try {
    await loadScript(`bootstrap-datepicker/dist/locales/bootstrap-datepicker.${locale}.min.js`);
  } catch (e) {
    console.warn(`DateEditor: failed to load ${locale}`);
  }
  return locale;
}

// DatePicker unfortunately requires an <input> (not <textarea>). But textarea is better for us,
// because sometimes it's taller than a line, and an <input> looks worse. The following
// unconsionable hack tricks Datepicker into thinking anything it's attached to is an input.
// It's more reasonable to just modify boostrap-datepicker, but that has its own downside (with
// upgrading and minification). This hack, however, is simpler than other workarounds.
function monkeyPatchDatepicker() {
  const Datepicker = ($.fn as any).datepicker?.Constructor;
  if (Datepicker?.prototype) {
    // datepicker.isInput can now be set to anything, but when read, always returns true. Tricksy.
    Object.defineProperty(Datepicker.prototype, "isInput", {
      get: function() { return true; },
      set: function(v) {},
    });
  }
}
