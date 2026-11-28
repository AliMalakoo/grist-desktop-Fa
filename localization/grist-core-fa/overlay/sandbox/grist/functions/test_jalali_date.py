"""Tests for sandbox/grist/jalali.py and for Jalali date literals in formulas.

The point of the Jalali support is that a document displaying dates on the Solar Hijri
calendar reads date literals typed into formulas on that same calendar, while stored values
(and documents on the Gregorian calendar) are untouched.
"""
import datetime
import unittest

import test_engine
import testutil
import moment

import jalali
from functions import date as _date


class TestJalaliConversion(unittest.TestCase):
  # Spot checks at leap-cycle boundaries, pinning the port of the jalaali-js algorithm.
  CASES = [
      (1400, 12, 29, 2022, 3, 20),   # اسفند بیست‌ونهم
      (1403, 1, 1, 2024, 3, 20),
      (1403, 12, 30, 2025, 3, 20),   # اسفند سی‌امِ کبیسه
      (1404, 12, 29, 2026, 3, 20),   # اسفند بیست‌ونهم
      (1375, 12, 30, 1997, 3, 20),
      (1300, 1, 1, 1921, 3, 21),
  ]

  def test_jalali_to_gregorian(self):
    for jy, jm, jd, gy, gm, gd in self.CASES:
      self.assertEqual(jalali.jalali_to_gregorian(jy, jm, jd), (gy, gm, gd))

  def test_gregorian_round_trip(self):
    for jy, jm, jd, gy, gm, gd in self.CASES:
      self.assertEqual(jalali.gregorian_to_jalali(gy, gm, gd), (jy, jm, jd))
      self.assertEqual(jalali.jalali_to_gregorian(
          *jalali.gregorian_to_jalali(gy, gm, gd)), (gy, gm, gd))

  def test_month_length(self):
    self.assertEqual(jalali.jalali_month_length(1403, 12), 30)   # leap
    self.assertEqual(jalali.jalali_month_length(1404, 12), 29)   # not leap
    self.assertEqual([jalali.jalali_month_length(1403, m) for m in range(1, 13)],
                     [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 30])


class TestParseJalaliString(unittest.TestCase):
  def test_numeric_forms(self):
    self.assertEqual(jalali.parse_jalali_string("۱۴۰۳/۰۱/۰۱"), (2024, 3, 20, None))
    self.assertEqual(jalali.parse_jalali_string("1403-01-01"), (2024, 3, 20, None))
    self.assertEqual(jalali.parse_jalali_string("۱۴۰۳/۵/۱"), (2024, 7, 22, None))
    self.assertEqual(jalali.parse_jalali_string("1403/01/01 14:30"), (2024, 3, 20, "14:30"))

  def test_month_names(self):
    self.assertEqual(jalali.parse_jalali_string("۶ آذر ۱۴۰۵"), (2026, 11, 27, None))
    self.assertEqual(jalali.parse_jalali_string("6 Azar 1405"), (2026, 11, 27, None))
    self.assertEqual(jalali.parse_jalali_string("1 فروردین 1405"), jalali.parse_jalali_string("1405/01/01"))

  def test_qualifiers_and_bidi(self):
    self.assertEqual(jalali.parse_jalali_string("۱۴۰۳/۰۱/۰۱ ه.ش"), (2024, 3, 20, None))
    self.assertEqual(jalali.parse_jalali_string("‎1403/01/01‎"), (2024, 3, 20, None))

  def test_gregorian_rejected(self):
    # A Gregorian date must not be swallowed by the Jalali parser; it falls back to dateutil.
    self.assertIsNone(jalali.parse_jalali_string("2024-11-27"))

  def test_invalid_dates_rejected(self):
    self.assertIsNone(jalali.parse_jalali_string("1404/12/30"))   # اسفند ۲۹ روزه
    self.assertIsNotNone(jalali.parse_jalali_string("1403/12/30"))  # کبیسه
    self.assertIsNone(jalali.parse_jalali_string("۱۴۰۳/۱۳/۱۴"))   # ماه ۱۳ (روز هم >۱۲، پس swap هم بی‌معنی است)


class TestJalaliLiteralsInFormulas(unittest.TestCase):
  def setUp(self):
    self._orig = jalali.doc_uses_jalali
    jalali.doc_uses_jalali = lambda: True

  def tearDown(self):
    jalali.doc_uses_jalali = self._orig

  def test_dtime_jalali_literal(self):
    self.assertEqual(_date.DTIME("۱۴۰۳/۰۱/۰۱", "UTC"),
                     datetime.datetime(2024, 3, 20, tzinfo=moment.tzinfo("UTC")))
    self.assertEqual(_date.DTIME("1403-01-01", "UTC"),
                     datetime.datetime(2024, 3, 20, tzinfo=moment.tzinfo("UTC")))

  def test_dtime_with_time_keeps_time(self):
    self.assertEqual(_date.DTIME("۱۴۰۳/۰۵/۱۲ ۱۴:۳۰", "UTC"),
                     datetime.datetime(2024, 8, 2, 14, 30,
                                       tzinfo=moment.tzinfo("UTC")))

  def test_datedif_jalali_literals(self):
    # ماه‌های بهار ۳۱ روزه‌اند؛ اول فروردین تا اول مهر دقیقاً ۱۸۶ روز است.
    self.assertEqual(_date.DATEDIF("۱۴۰۳/۰۱/۰۱", "۱۴۰۳/۰۷/۰۱", "D"), 186)
    self.assertEqual(_date.DATEDIF("۱۴۰۳/۰۱/۰۱", "۱۴۰۳/۰۷/۰۱", "Y"), 0)
    self.assertEqual(_date.DATEDIF("۱۴۰۳/۰۱/۰۱", "۱۴۱۳/۰۱/۰۱", "Y"), 10)

  def test_datedif_column_values(self):
    # بین فیلدهای تاریخ (که میلادی ذخیره می‌شوند) تفاوت همان است؛ فرمول جلالی بودن نمی‌خواهد.
    a = datetime.date(2024, 3, 20)
    b = datetime.date(2024, 9, 22)
    self.assertEqual(_date.DATEDIF(a, b, "D"), 186)
    self.assertLess(a, b)

  def test_datevalue_jalali_literal(self):
    parsed = _date.DATEVALUE("۱۴۰۳/۰۱/۰۱", "UTC")
    self.assertEqual(parsed.replace(tzinfo=None), datetime.datetime(2024, 3, 20))

  def test_gregorian_literal_still_parses(self):
    # سال ۲۰۲۴ خارج از بازهٔ جلالی است، پس Gregorian می‌ماند.
    self.assertEqual(_date.DTIME("2024-11-27", "UTC"),
                     datetime.datetime(2024, 11, 27, tzinfo=moment.tzinfo("UTC")))


class TestJalaliLiteralsDisabled(unittest.TestCase):
  def test_gregorian_doc_unchanged(self):
    _orig = jalali.doc_uses_jalali
    jalali.doc_uses_jalali = lambda: False
    try:
      self.assertEqual(_date.DTIME("2024-11-27", "UTC"),
                       datetime.datetime(2024, 11, 27, tzinfo=moment.tzinfo("UTC")))
      self.assertEqual(_date.DTIME("1403/05/12", "UTC"),
                       datetime.datetime(1403, 5, 12, tzinfo=moment.tzinfo("UTC")))
    finally:
      jalali.doc_uses_jalali = _orig


class TestJalaliOrderingInEngine(test_engine.EngineTestCase):
  def test_comparison_and_datedif_in_formula_columns(self):
    def D(year, month, day):
      return moment.date_to_ts(datetime.date(year, month, day))

    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Test", [
          [1, "Start",        "Date", False],
          [2, "End",          "Date", False],
          [3, "Days",         "Int",  True, "DATEDIF($Start, $End, \"D\")"],
          [4, "InOrder",      "Bool", True, "$Start < $End"],
          [5, "Overdue",      "Bool", True, "$End > TODAY()"],
        ]]
      ],
      "DATA": {
        "Test": [
          ["id",  "Start",             "End"],
          [1,     D(2024, 3, 20),      D(2024, 9, 22)],
          [2,     D(2024, 9, 22),      D(2024, 3, 20)],
        ]
      }
    }))
    self.assertTableData("Test", cols="subset", data=[
      ["id", "Days", "InOrder"],
      [1,    186,    True],
      [2,    -186,   False],
    ])


if __name__ == "__main__":
  unittest.main()
