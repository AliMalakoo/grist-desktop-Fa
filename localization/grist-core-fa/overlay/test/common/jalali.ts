/**
 * Tests for the Jalali (Persian calendar) support: the day-number conversion that everything else
 * is built on, the month/leap/year facts, digits, the format and parse layer used by date cells,
 * and the gating that decides when dates are shown in the Persian calendar at all.
 *
 * The conversion is checked against fixed anchors taken from the Persian calendar as published by
 * the Iranian and Afghan governments (which is what jalaali-js, ICU's `persian` calendar, and
 * moment-jalaali all implement), and then day by day across two and a half centuries: a conversion
 * that is right on Nowruz but wrong in Esfand would pass the anchors and fail the sweep.
 */
import {
  gregorianToJalali,
  jalaliToGregorian,
  gregorianToJdn,
  jdnToGregorian,
  jalaliToJdn,
  jdnToJalali,
  isJalaliLeapYear,
  isConvertibleJalaliYear,
  jalaliMonthLength,
  jalaliToUnixDays,
  unixDaysToJalali,
  jalaliToUtcSeconds,
  unixSecondsToJalali,
  jalaliWeekdayIndex,
  toLatinDigits,
  toPersianDigits,
  jalaliMonthFromName,
  setJalaliDocLocale,
  getJalaliDocLocale,
  isJalaliLocale,
  shouldUseJalali,
  splitDateFormat,
  formatJalaliDatePart,
  formatJalaliMoment,
  jalaliFormatOptions,
  jalaliDateStringToGregorian,
  parseJalaliDateString,
  expandTwoDigitJalaliYear,
  dateFormatOrder,
  jalaliToday,
  isSameJalaliMonth,
  addJalaliMonths,
  JALALI_MONTHS_FA,
  JALALI_WEEKDAYS_SHORT_FA,
} from "app/common/jalali";

import { parseDate, parseDateTime } from "app/common/parseDate";
import { assert } from "chai";
import moment from "moment-timezone";

/** The date part of a parse result, dropping the "was this guessed?" flags the parser reports. */
function dates(parsed: {jy: number, jm: number, jd: number} | null) {
  return parsed && {jy: parsed.jy, jm: parsed.jm, jd: parsed.jd};
}

/** Days between two Unix-day numbers; used to turn a date pair into a single arithmetic fact. */
function gregorianDays(gy: number, gm: number, gd: number) {
  return Math.round(Date.UTC(gy, gm - 1, gd) / 86400000);
}

describe("jalali", function() {

  describe("conversion", function() {
    it("should map well-known dates to the Jalali calendar", function() {
      assert.deepEqual(gregorianToJalali(2026, 11, 27), {jy: 1405, jm: 9, jd: 6});
      // Nowruz 1403, the year of the big Persian-new-year fireworks: 20 March 2024.
      assert.deepEqual(gregorianToJalali(2024, 3, 20), {jy: 1403, jm: 1, jd: 1});
      assert.deepEqual(gregorianToJalali(2000, 1, 1), {jy: 1378, jm: 10, jd: 11});
      // The Iranian revolution, as every Persian-language history page dates it.
      assert.deepEqual(gregorianToJalali(1979, 2, 11), {jy: 1357, jm: 11, jd: 22});
      // The Unix epoch, which is what Grist actually stores.
      assert.deepEqual(gregorianToJalali(1970, 1, 1), {jy: 1348, jm: 10, jd: 11});
    });

    it("should map the other way", function() {
      assert.deepEqual(jalaliToGregorian(1405, 9, 6), {gy: 2026, gm: 11, gd: 27});
      assert.deepEqual(jalaliToGregorian(1403, 1, 1), {gy: 2024, gm: 3, gd: 20});
      assert.deepEqual(jalaliToGregorian(1348, 10, 11), {gy: 1970, gm: 1, gd: 1});
    });

    it("should round-trip every day of 1379-1465 (2000-2086)", function() {
      // A decade on either side of "now" is what a document is likely to hold; the sweep is cheap
      // enough to cover it all, and covers every leap-year pattern boundary in the range.
      const start = gregorianDays(2000, 1, 1);
      const end = gregorianDays(2086, 12, 31);
      let mismatches = 0;
      for (let days = start; days <= end; days++) {
        const date = new Date(days * 86400000);
        const j = gregorianToJalali(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
        const back = jalaliToGregorian(j.jy, j.jm, j.jd);
        const backDays = gregorianDays(back.gy, back.gm, back.gd);
        if (backDays !== days) { mismatches++; }
      }
      assert.equal(mismatches, 0);
    });

    it("should agree with the JDN path", function() {
      for (const [gy, gm, gd] of [[1970, 1, 1], [2026, 11, 27], [2024, 3, 20], [2100, 12, 31]]) {
        const jdn = gregorianToJdn(gy, gm, gd);
        assert.deepEqual(jdnToGregorian(jdn), {gy, gm, gd}, `${gy}-${gm}-${gd}`);
        const j = gregorianToJalali(gy, gm, gd);
        assert.equal(jalaliToJdn(j.jy, j.jm, j.jd), jdn);
        assert.deepEqual(jdnToJalali(jdn), j);
      }
      // 1970-01-01 is JDN 2440588, the canonical epoch.
      assert.equal(gregorianToJdn(1970, 1, 1), 2440588);
    });

    it("should convert to and from Unix days and seconds", function() {
      const j = {jy: 1405, jm: 9, jd: 6};
      const days = jalaliToUnixDays(j.jy, j.jm, j.jd);
      assert.equal(days, gregorianDays(2026, 11, 27));
      assert.deepEqual(unixDaysToJalali(days), j);
      assert.equal(jalaliToUtcSeconds(j.jy, j.jm, j.jd), days * 86400);
      assert.deepEqual(unixSecondsToJalali(days * 86400 + 42), j);
    });
  });

  describe("calendar facts", function() {
    it("should know the month names and lengths", function() {
      assert.deepEqual(JALALI_MONTHS_FA.slice(0, 3), ["فروردین", "اردیبهشت", "خرداد"]);
      assert.deepEqual(JALALI_MONTHS_FA.slice(6, 9), ["مهر", "آبان", "آذر"]);
      for (let jm = 1; jm <= 6; jm++) {
        assert.equal(jalaliMonthLength(1405, jm), 31, `month ${jm}`);
      }
      for (let jm = 7; jm <= 11; jm++) {
        assert.equal(jalaliMonthLength(1405, jm), 30, `month ${jm}`);
      }
      assert.equal(jalaliMonthLength(1405, 12), 29, "Esfand of a common year");
    });

    it("should give Esfand 30 days in a leap year", function() {
      assert.isTrue(isJalaliLeapYear(1403));
      assert.isFalse(isJalaliLeapYear(1404));
      assert.equal(jalaliMonthLength(1403, 12), 30);
      assert.equal(jalaliMonthLength(1405, 12), 29);
    });

    it("should count the week from Saturday", function() {
      // 1 Azar 1405 is a Sunday: the second day of a Saturday-first week.
      assert.equal(jalaliWeekdayIndex(1405, 9, 1), 1);
      // 6 Azar 1405 is a Friday, the last day of the week.
      assert.equal(jalaliWeekdayIndex(1405, 9, 6), 6);
      // 7 Azar 1405 is a Saturday again.
      assert.equal(jalaliWeekdayIndex(1405, 9, 7), 0);
      assert.deepEqual(JALALI_WEEKDAYS_SHORT_FA.slice(0, 2), ["ش", "ی"]);
    });

    it("should convert even far-past years, and refuse nonsense", function() {
      // The leap-cycle table spans -61..3177 of the Jalali era, so historical dates work too; the
      // round trip is the point, since no external authority is available for 12th-century dates.
      assert.isTrue(isConvertibleJalaliYear(1405));
      assert.isTrue(isConvertibleJalaliYear(500));
      const j = gregorianToJalali(1121, 3, 21);
      assert.deepEqual(jalaliToGregorian(j.jy, j.jm, j.jd), {gy: 1121, gm: 3, gd: 21});
      assert.isFalse(isConvertibleJalaliYear(4000));
      assert.isFalse(isConvertibleJalaliYear(NaN));
    });
  });

  describe("digits", function() {
    it("should convert both ways", function() {
      assert.equal(toPersianDigits("1405/09/06"), "۱۴۰۵/۰۹/۰۶");
      assert.equal(toLatinDigits("۱۴۰۵/۰۹/۰۶"), "1405/09/06");
      assert.equal(toPersianDigits("no digits here"), "no digits here");
      assert.equal(toLatinDigits(toPersianDigits("2026")), "2026");
    });

    it("should recognize month names in Persian and in English", function() {
      assert.equal(jalaliMonthFromName("آذر"), 9);
      assert.equal(jalaliMonthFromName("اذر"), 9);        // without the hamza
      assert.equal(jalaliMonthFromName("آذر ماه"), 9);
      assert.equal(jalaliMonthFromName("Azar"), 9);
      assert.equal(jalaliMonthFromName("farvardin"), 1);
      assert.isNull(jalaliMonthFromName("September"));
    });
  });

  describe("formatting", function() {
    const j = {jy: 1405, jm: 9, jd: 6};
    // A Date cell hands the widget a moment and the column's format; jalaliFormatOptions() says
    // "Persian words, Persian digits", which is what a Persian reader expects.
    const m = moment.utc("2026-11-27");
    const like = {year: () => m.year(), month: () => m.month(), date: () => m.date(),
                  format: (f: string) => m.format(f)};
    const fmt = (format: string, opts = {}) =>
      formatJalaliMoment(like, format, jalaliFormatOptions(opts))!;

    it("should render the tokens Grist offers for Date columns", function() {
      assert.equal(fmt("YYYY/MM/DD"), "۱۴۰۵/۰۹/۰۶");
      assert.equal(fmt("YYYY/MM/DD", {digits: "latin"}), "1405/09/06");
      assert.equal(fmt("MMMM D, YYYY"), "آذر ۶, ۱۴۰۵");
      assert.equal(fmt("MMM YYYY"), "آذر ۱۴۰۵");
      assert.equal(fmt("DD MMMM YYYY"), "۰۶ آذر ۱۴۰۵");
      assert.equal(fmt("dddd D MMMM"), "جمعه ۶ آذر");
      assert.equal(fmt("ddd"), "ج");
      assert.equal(fmt("YY"), "۰۵");
      assert.equal(fmt("M/D"), "۹/۶");
      assert.equal(fmt("MMMM YYYY", {monthNames: "en", digits: "latin"}), "Azar 1405");
    });

    it("should leave the digits to the caller when asked for the date part alone", function() {
      // formatJalaliDatePart is the token substitution; the digit pass happens on the joined
      // date+time string in formatJalaliMoment, so a time is converted the same way.
      assert.equal(
        formatJalaliDatePart(j, jalaliWeekdayIndex(j.jy, j.jm, j.jd), "YYYY/MM/DD"),
        "1405/09/06");
    });

    it("should keep quoted literals and separators as written", function() {
      assert.equal(fmt("[year] YYYY"), "year ۱۴۰۵");
      assert.equal(fmt("YYYY"), "۱۴۰۵");
    });

    it("should keep the separator between the date and the time", function() {
      // The split trims the joiner for the widget, but the joined render must put it back:
      // without it the cell shows "۱۴۰۵/۰۹/۰۶۱۴:۳۰".
      const m2 = moment.utc("2026-11-27 14:30");
      const like2 = {year: () => m2.year(), month: () => m2.month(), date: () => m2.date(),
                     format: (f: string) => m2.format(f)};
      assert.equal(formatJalaliMoment(like2, "YYYY/MM/DD HH:mm", jalaliFormatOptions()),
        "۱۴۰۵/۰۹/۰۶ ۱۴:۳۰");
      assert.equal(formatJalaliMoment(like2, "YYYY/MM/DD HH:mm", jalaliFormatOptions({digits: "latin"})),
        "1405/09/06 14:30");
    });

    it("should split a combined date+time format", function() {
      assert.deepEqual(splitDateFormat("YYYY/MM/DD HH:mm"),
        {date: "YYYY/MM/DD", time: "HH:mm", joiner: " "});
      assert.deepEqual(splitDateFormat("YYYY-MM-DD HH:mm:ss"),
        {date: "YYYY-MM-DD", time: "HH:mm:ss", joiner: " "});
      assert.deepEqual(splitDateFormat("YYYY-MM-DD"), {date: "YYYY-MM-DD", time: "", joiner: ""});
    });
  });

  describe("parsing", function() {
    it("should read Persian digits, English digits and month names", function() {
      assert.equal(jalaliDateStringToGregorian("1405/09/06", "YYYY/MM/DD"), "2026-11-27");
      assert.equal(jalaliDateStringToGregorian("۱۴۰۵/۹/۶", "YYYY/M/D"), "2026-11-27");
      assert.equal(jalaliDateStringToGregorian("۶ آذر ۱۴۰۵", "D MMMM YYYY"), "2026-11-27");
      assert.equal(jalaliDateStringToGregorian("Azar 6, 1405", "MMMM D, YYYY"), "2026-11-27");
    });

    it("should accept a bare year as the first of Farvardin", function() {
      assert.deepEqual(dates(parseJalaliDateString("1403")), {jy: 1403, jm: 1, jd: 1});
      assert.deepEqual(dates(parseJalaliDateString("۱۴۰۵ ه.ش")), {jy: 1405, jm: 1, jd: 1});
    });

    it("should swap the month and day when the month would be impossible", function() {
      // A Persian user typing 1405/13/06 means the 6th of Dey; 13 is not a month.
      assert.deepEqual(dates(parseJalaliDateString("1405/13/06")), {jy: 1405, jm: 6, jd: 13});
      assert.deepEqual(dates(parseJalaliDateString("1405-30-2")), {jy: 1405, jm: 2, jd: 30});
    });

    it("should reject dates that do not exist and non-Jalali ones", function() {
      assert.isNull(parseJalaliDateString("1405/09/31"));    // Azar has 30 days
      assert.isNull(parseJalaliDateString("1404/12/30"));    // not a leap year
      assert.isNull(jalaliDateStringToGregorian("2026-11-27", "YYYY-MM-DD"));
      assert.isNull(jalaliDateStringToGregorian("hello", "YYYY-MM-DD"));
    });

    it("should follow the column's format order when both readings are possible", function() {
      assert.equal(dateFormatOrder("YYYY/MM/DD"), "YMD");
      assert.equal(dateFormatOrder("MM/DD/YYYY"), "MDY");
      assert.equal(dateFormatOrder("DD.MM.YYYY"), "DMY");
      assert.equal(dateFormatOrder(undefined), "");
      // "6/9/1405" in a DD/MM/YYYY column is the 6th of Azar; the format only tells the three
      // numbers apart, it never restricts what may be typed.
      assert.deepEqual(dates(parseJalaliDateString("6/9/1405", "DD/MM/YYYY")),
        {jy: 1405, jm: 9, jd: 6});
      assert.deepEqual(dates(parseJalaliDateString("1405/9/6", "MM/DD/YYYY")),
        {jy: 1405, jm: 9, jd: 6});
    });

    it("should expand two-digit years around the current one", function() {
      assert.equal(expandTwoDigitJalaliYear(5, 1405), 1405);
      assert.equal(expandTwoDigitJalaliYear(95, 1405), 1395);
      assert.equal(expandTwoDigitJalaliYear(20, 1405), 1420);
    });

    it("should hand a converted date to the ordinary parser", function() {
      // What Grist stores is a Gregorian date; the Jalali string only decides which one.
      const iso = jalaliDateStringToGregorian("1405/09/06", "YYYY/MM/DD");
      assert.equal(iso, "2026-11-27");
      const m = moment.utc(iso, "YYYY-MM-DD");
      assert.equal(m.unix(), jalaliToUtcSeconds(1405, 9, 6));
    });

    it("should hand a time typed with the date on to the ordinary parser", function() {
      // The rewrite has to keep the time: a string carrying one must not match a date-only
      // format, so that parseDateTime() splits it off the way it does for "2026-11-27 14:30".
      assert.equal(jalaliDateStringToGregorian("1405-09-06 14:30", "YYYY-MM-DD"),
        "2026-11-27 14:30");
      // Marks copied out of a chat client must not decide whether the time is seen at all.
      assert.equal(jalaliDateStringToGregorian("\u200e۱۴۰۵-۹-۶ ۱۴:۳۰\u200f", "YYYY-MM-DD"),
        "2026-11-27 14:30");
      assert.equal(jalaliDateStringToGregorian("\u061c۱۴۰۵/۹/۶", "YYYY/M/D"), "2026-11-27");
      const expected = Math.floor(Date.UTC(2026, 10, 27, 14, 30, 0) / 1000);
      // Date and time typed in one field (parseDateTime), and in the two boxes of the DateTime
      // widget (parseDate with options.time), arrive at the same timestamp.
      setJalaliDocLocale("fa");
      try {
        assert.equal(parseDateTime("1405-09-06 14:30", {jalali: true}), expected);
      } finally {
        setJalaliDocLocale(null);
      }
      assert.equal(parseDate("1405/09/06", {
        jalali: true, time: "14:30", timeFormat: "HH:mm", dateFormat: "YYYY/MM/DD",
      }), expected);
    });
  });

  describe("month arithmetic", function() {
    it("should compare and shift months", function() {
      const a = {jy: 1405, jm: 9, jd: 6};
      assert.isTrue(isSameJalaliMonth(a, {jy: 1405, jm: 9, jd: 30}));
      assert.isFalse(isSameJalaliMonth(a, {jy: 1404, jm: 9, jd: 6}));
      assert.deepEqual(addJalaliMonths(a, 1), {jy: 1405, jm: 10, jd: 6});
      assert.deepEqual(addJalaliMonths(a, -8), {jy: 1405, jm: 1, jd: 6});
      assert.deepEqual(addJalaliMonths(a, 4), {jy: 1406, jm: 1, jd: 6});   // wraps the year
      // Clamped to the last day of the shorter month, the way every calendar widget does it:
      // Farvardin 31 + 11 months lands on a 30-day Esfand.
      assert.deepEqual(addJalaliMonths({jy: 1403, jm: 1, jd: 31}, 11), {jy: 1403, jm: 12, jd: 30});
    });

    it("should today in the Jalali calendar", function() {
      const today = jalaliToday(new Date(Date.UTC(2026, 10, 27)));
      assert.deepEqual(today, {jy: 1405, jm: 9, jd: 6});
    });
  });

  describe("gating", function() {
    afterEach(function() {
      setJalaliDocLocale(null);
    });

    it("should let the column's own setting win", function() {
      setJalaliDocLocale("fa");
      assert.isTrue(shouldUseJalali(true, "en"));
      assert.isFalse(shouldUseJalali(false, "fa"));
    });

    it("should follow the document locale when the column says nothing", function() {
      setJalaliDocLocale("fa");
      assert.isTrue(shouldUseJalali(null, null));
      assert.isTrue(shouldUseJalali(undefined, "en"));   // explicit locale argument first
      setJalaliDocLocale("en");
      assert.isFalse(shouldUseJalali(null, null));
      setJalaliDocLocale("de-DE");
      assert.isFalse(shouldUseJalali(null, null));
    });

    it("should accept the document locale passed in directly", function() {
      setJalaliDocLocale("en");
      assert.isTrue(shouldUseJalali(null, "fa"));
      assert.isTrue(shouldUseJalali(null, "fa-IR"));
      assert.isTrue(shouldUseJalali(null, "prs"));
      assert.isFalse(shouldUseJalali(null, "ar"));      // Arabic readers use the Hijri lunar calendar
      assert.isFalse(shouldUseJalali(null, "he"));
      assert.isFalse(shouldUseJalali(null, "en"));
      assert.isFalse(shouldUseJalali(null, null));
    });

    it("should recognize Jalali locales on its own", function() {
      assert.isTrue(isJalaliLocale("fa"));
      assert.isTrue(isJalaliLocale("FA_ir"));
      assert.isTrue(isJalaliLocale("pes"));
      assert.isFalse(isJalaliLocale("en"));
      assert.isFalse(isJalaliLocale(""));
      assert.isFalse(isJalaliLocale(null));
      assert.isFalse(isJalaliLocale("fabric"));    // must be a subtag, not a substring
    });

    it("should remember the locale the client loaded", function() {
      assert.isUndefined(getJalaliDocLocale());
      setJalaliDocLocale("fa");
      assert.equal(getJalaliDocLocale(), "fa");
      setJalaliDocLocale(null);
      assert.isUndefined(getJalaliDocLocale());
    });
  });
});
