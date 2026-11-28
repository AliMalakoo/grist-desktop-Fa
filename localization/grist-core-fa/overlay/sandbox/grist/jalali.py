# -*- coding: utf-8 -*-
"""Jalali (Solar Hijri, هجری شمسی) calendar support for the Python data engine.

This is the Python twin of app/common/jalali.ts. The two implementations must agree on every
date they both claim, so the calendar arithmetic below is the same 33-year leap-cycle algorithm
(ported from jalaali-js, MIT), valid for Jalali years -61 to 2816.

Values are always *stored* as plain Gregorian timestamps; this module only converts on the way
in. It exists so that a date literal typed into a formula in a Jalali document -- e.g.
DATEDIF("۱۴۰۳/۰۱/۰۱", TODAY(), "D") -- is read on the calendar the document displays instead of
being silently reinterpreted as Gregorian year 1403.
"""
import json
import re
from datetime import date as _date

import docmodel

# ---------------------------------------------------------------------------
# Digits
# ---------------------------------------------------------------------------

_PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_FULLWIDTH_DIGITS = "０１２３４５６７８９"
_DIGIT_MAP = {}
for _block, _base in [("۰۱۲۳۴۵۶۷۸۹", 0x06F0), ("٠١٢٣٤٥٦٧٨٩", 0x0660), ("０１２３４５６７８９", 0xFF10)]:
    for _i, _ch in enumerate(_block):
        _DIGIT_MAP[ord(_ch)] = _base, _i

def to_latin_digits(text):
    out = []
    for ch in text:
        mapped = _DIGIT_MAP.get(ord(ch))
        out.append(str(mapped[1]) if mapped is not None else ch)
    return "".join(out)

def to_persian_digits(text):
    return "".join(_PERSIAN_DIGITS[int(ch)] if ch.isdigit() else ch for ch in text)

_BIDI_CONTROL_RE = re.compile(
    "[\u061C\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]")

# A trailing "14:30" (optionally with seconds and am/pm), which is not ours to interpret.
_TRAILING_TIME_RE = re.compile(
    r"\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(\s*[AaPp]\.?\s?[Mm]\.?)?\s*$")

# ---------------------------------------------------------------------------
# Month names
# ---------------------------------------------------------------------------

JALALI_MONTHS_FA = [
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
]
JALALI_MONTHS_SHORT_FA = [
    "فرو", "ارد", "خرد", "تی", "مور", "شهر",
    "مهر", "آبا", "آذر", "دی", "بهم", "اسف",
]
JALALI_MONTHS_EN = [
    "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
    "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand",
]


def _normalize_month_name(name):
    name = to_latin_digits(name)
    name = re.sub("[آأإاٱ]", "ا", name)     # any alef form -> bare alef
    name = name.replace("ی", "ي")            # Persian yeh -> Arabic yeh
    name = name.replace("ک", "ك")            # Persian keheh -> Arabic kaf
    name = name.replace("ة", "ه")            # ta marbuta -> heh
    name = name.replace("‌", "")         # ZWNJ
    name = re.sub(r"^(ماه|month of)\s+", "", name, flags=re.I)
    name = re.sub(r"\s*(ماه|مه)$", "", name)
    name = name.strip(".- \t").lower()
    return name


def _register(index_map, name, index):
    for key in {name, name.replace("‌", ""), re.sub(r"[\s.‌]", "", name)}:
        index_map.setdefault(_normalize_month_name(key), index)

_MONTH_NAME_INDEX = {}
for _i, _nm in enumerate(JALALI_MONTHS_FA):
    _register(_MONTH_NAME_INDEX, _nm, _i)
for _i, _nm in enumerate(JALALI_MONTHS_SHORT_FA):
    _register(_MONTH_NAME_INDEX, _nm, _i)
for _i, _nm in enumerate(JALALI_MONTHS_EN):
    _register(_MONTH_NAME_INDEX, _nm, _i)

def jalali_month_from_name(name):
    key = _normalize_month_name(name)
    direct = _MONTH_NAME_INDEX.get(key)
    if direct is not None:
        return direct + 1
    flat = re.sub(r"[\s.‌-]", "", key)
    found = _MONTH_NAME_INDEX.get(flat)
    return found + 1 if found is not None else None

# ---------------------------------------------------------------------------
# Calendar arithmetic
# ---------------------------------------------------------------------------

_BREAKS = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
]

MIN_JALALI_YEAR = _BREAKS[0]
MAX_JALALI_YEAR = _BREAKS[-1] - 1
# Jalali years we are willing to read from user input, so that Gregorian years stay intact.
MIN_PLAUSIBLE_JALALI_YEAR = 1200
MAX_PLAUSIBLE_JALALI_YEAR = 1500


def _trunc_div(a, b):
    q = abs(a) // abs(b)
    return q if (a < 0) == (b < 0) else -q


def _trunc_mod(a, b):
    return a - _trunc_div(a, b) * b


def gregorian_to_jdn(gy, gm, gd):
    d = _trunc_div((gy + _trunc_div(gm - 8, 6) + 100100) * 1461, 4) + \
        _trunc_div(153 * _trunc_mod(gm + 9, 12) + 2, 5) + gd - 34840408
    d = d - _trunc_div(_trunc_div(gy + 100100 + _trunc_div(gm - 8, 6), 100) * 3, 4) + 752
    return d


def jdn_to_gregorian(jdn):
    j = 4 * jdn + 139361631
    j = j + _trunc_div(_trunc_div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
    i = _trunc_div(_trunc_mod(j, 1461), 4) * 5 + 308
    gd = _trunc_div(_trunc_mod(i, 153), 5) + 1
    gm = _trunc_mod(_trunc_div(i, 153), 12) + 1
    gy = _trunc_div(j, 1461) - 100100 + _trunc_div(8 - gm, 6)
    return gy, gm, gd


def _jal_cal(jy, with_leap=True):
    bl = len(_BREAKS)
    gy = jy + 621
    leap_j = -14
    jp = _BREAKS[0]
    if not isinstance(jy, (int, float)) or jy != int(jy):
        return None
    jy = int(jy)
    if jy < jp or jy >= _BREAKS[-1]:
        return None

    jump = 0
    for i in range(1, bl):
        jm = _BREAKS[i]
        jump = jm - jp
        if jy < jm:
            break
        leap_j = leap_j + _trunc_div(jump, 33) * 8 + _trunc_div(_trunc_mod(jump, 33), 4)
        jp = jm
    n = jy - jp

    leap_j = leap_j + _trunc_div(n, 33) * 8 + _trunc_div(_trunc_mod(n, 33) + 3, 4)
    if _trunc_mod(jump, 33) == 4 and jump - n == 4:
        leap_j += 1
    leap_g = _trunc_div(gy, 4) - _trunc_div((_trunc_div(gy, 100) + 1) * 3, 4) - 150
    march = 20 + leap_j - leap_g
    if not with_leap:
        return (0, gy, march)

    if jump - n < 6:
        n = n - jump + _trunc_div(jump + 4, 33) * 33
    leap = _trunc_mod(_trunc_mod(n + 1, 33) - 1, 4)
    if leap == -1:
        leap = 4
    return (leap, gy, march)


def jalali_to_jdn(jy, jm, jd):
    r = _jal_cal(jy, with_leap=False)
    if r is None:
        raise ValueError("Unsupported Jalali year: %r" % (jy,))
    jy, jm, jd = int(jy), int(jm), int(jd)
    if jm < 1 or jm > 12 or jd < 1 or jd > 31:
        raise ValueError("Unsupported Jalali date: %d/%d/%d" % (jy, jm, jd))
    gy, march = r[1], r[2]
    return gregorian_to_jdn(gy, 3, march) + (jm - 1) * 31 - _trunc_div(jm, 7) * (jm - 7) + jd - 1


def jalali_to_gregorian(jy, jm, jd):
    return jdn_to_gregorian(jalali_to_jdn(jy, jm, jd))


def jdn_to_jalali(jdn):
    gy, _, _ = jdn_to_gregorian(jdn)
    jy = gy - 621
    r = _jal_cal(jy)
    if r is None:
        raise ValueError("Unsupported Jalali year: %r" % (jy,))
    leap, gy, march = r
    jdn1f = gregorian_to_jdn(gy, 3, march)
    k = jdn - jdn1f
    if k >= 0:
        if k <= 185:
            return jy, 1 + _trunc_div(k, 31), _trunc_mod(k, 31) + 1
        k -= 186
    else:
        jy -= 1
        k += 179
        if leap == 1:
            k += 1
    return jy, 7 + _trunc_div(k, 30), _trunc_mod(k, 30) + 1


def gregorian_to_jalali(gy, gm, gd):
    return jdn_to_jalali(gregorian_to_jdn(gy, gm, gd))


def is_jalali_leap_year(jy):
    r = _jal_cal(jy)
    return r is not None and r[0] == 0


def jalali_month_length(jy, jm):
    if jm <= 6:
        return 31
    if jm <= 11:
        return 30
    return 30 if is_jalali_leap_year(jy) else 29


def jalali_today():
    today = _date.today()
    return gregorian_to_jalali(today.year, today.month, today.day)


# ---------------------------------------------------------------------------
# Whether Jalali is in force for this document
# ---------------------------------------------------------------------------

# Language codes whose readers expect the Solar Hijri calendar. Mirrors JALALI_LANGS in
# app/common/jalali.ts; keep the two in sync.
_JALALI_LANGS_RE = re.compile(
    r"^(fa|pes|prs|ps|ug|ku|ar-IQ|ar-IR|az-IR)([-_]|$)", re.IGNORECASE)

def is_jalali_locale(locale):
    return bool(locale) and bool(_JALALI_LANGS_RE.match(str(locale)))


def doc_uses_jalali():
    """Whether the current document displays dates on the Jalali calendar.

    Reads the document locale from _grist_DocInfo.documentSettings, the same place the client
    reads it. Returns False when there is no document (e.g. unit tests that never load one) --
    matching upstream behaviour, where every input parses on the Gregorian calendar.
    """
    dm = docmodel.global_docmodel
    if dm is None:
        return False
    try:
        record = dm.doc_info.lookupOne(id=1)
        raw = record and getattr(record, "documentSettings", None)
        settings = json.loads(raw) if raw else {}
        return is_jalali_locale(settings.get("locale"))
    except Exception:
        return False

# ---------------------------------------------------------------------------
# Parsing a user-typed date
# ---------------------------------------------------------------------------

# Words that may follow a Jalali date without making it something else, e.g. "1405 ه.ش".
_QUALIFIERS = {"ه.ش", "ه‍.ش", "شمسی", "جلالی", "هجری", "خورشیدی", "sh", "j", "js", "ah", "ap", "ahs"}

_WORD_RE = re.compile(r"[A-Za-z\u0600-\u06FF‌]+", re.UNICODE)
_NUM_RE = re.compile(r"\d+")

def expand_two_digit_jalali_year(yy, current_jy=None):
    if current_jy is None:
        current_jy, _, _ = jalali_today()
    century = (current_jy // 100) * 100
    best = century + yy
    for candidate in (century - 100 + yy, century + 100 + yy):
        if abs(candidate - current_jy) < abs(best - current_jy) or (
                abs(candidate - current_jy) == abs(best - current_jy) and candidate > best):
            best = candidate
    return best


def _date_format_order(fmt):
    if not fmt:
        return ""
    seen = {}
    for match in re.finditer(r"Y+|M+|D+", fmt):
        seen.setdefault(match.group(0)[0], match.start())
    if len(seen) != 3:
        return ""
    return "".join(sorted(seen, key=seen.get))


def _pick_year_month_day(nums, order):
    a, b, c = nums[0], nums[1], nums[2]
    # A number over 31 cannot be a month or a day, so it is the year whatever the format claims.
    year_index = next((i for i, n in enumerate(nums) if n > 31), -1)
    if year_index >= 0:
        year = nums[year_index]
        rest = [n for i, n in enumerate(nums) if i != year_index]
        if year_index == 0:
            return year, rest[0], rest[1]
        if order == "DMY":
            return year, rest[1], rest[0]
        return year, rest[0], rest[1]
    if order == "MDY":
        return c, a, b
    if order == "DMY":
        return c, b, a
    return a, b, c


def parse_jalali_string(text, date_format=""):
    """Parse a Jalali date typed by the user. Returns (gy, gm, gd, time) -- time may be None --
    or None when the string is not a Jalali date (notably a Gregorian date)."""
    if not text:
        return None
    text = to_latin_digits(_BIDI_CONTROL_RE.sub("", str(text))).replace("،", " ").replace("٫", " ").strip()
    if not text:
        return None

    time = None
    time_match = _TRAILING_TIME_RE.search(text)
    if time_match:
        time = time_match.group(0).strip()
        text = text[:time_match.start()].strip()
    if not text:
        return None

    # Strip qualifiers: "۱۴۰۵ ه.ش", "1405 AP", "... شمسی", ...
    text = re.sub(r"ه\s*\.?\s*ش\.?", " ", text)
    text = re.sub(r"(شمسی|جلالی|خورشیدی|هجری)", " ", text)
    text = re.sub(r"\b(AH|AP|SH|J|JS)\.?\b", " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()

    words = _WORD_RE.findall(text)
    month_from_name = None
    for word in words:
        found = jalali_month_from_name(word)
        if found is not None:
            month_from_name = found
            break
        if word.replace(" ", "").lower() not in _QUALIFIERS:
            return None

    nums = [int(n) for n in _NUM_RE.findall(text)]
    if not nums:
        return None
    order = _date_format_order(date_format)

    today_jy, today_jm, today_jd = jalali_today()
    jy = jm = jd = None

    if month_from_name is not None:
        year = next((n for n in nums if n > 31), None)
        day = next((n for n in nums if 1 <= n <= 31), None)
        if len(nums) >= 2 and year is not None and day is not None:
            jy, jd = year, day
            jm = month_from_name
        elif len(nums) == 1 and day is not None:
            jd = day
            jy = today_jy
            jm = month_from_name
        elif year is not None:
            jy = year
            jd = 1
            jm = month_from_name
        else:
            return None
    elif len(nums) >= 3:
        jy, jm, jd = _pick_year_month_day(nums[:3], order)
    elif len(nums) == 2:
        a, b = nums
        if a > 31 or b > 31:
            year_first = a > 31
            other = b if year_first else a
            other_is_month = other <= 12 and (order == "YMD" if year_first else order != "DMY")
            jy = a if year_first else b
            if other_is_month:
                jm = other
                jd = today_jd
            else:
                jd = other
                jm = today_jm
        else:
            if order == "DMY":
                jd, jm = a, b
            else:
                jm, jd = a, b
            jy = today_jy
    else:
        only = nums[0]
        if only > 31:
            jy, jm, jd = only, 1, 1
        else:
            jy, jm, jd = today_jy, today_jm, only

    if jy is not None and jy < 100:
        jy = expand_two_digit_jalali_year(jy, today_jy)
    if jm is not None and jm < 1 or (jm is not None and jm > 12):
        # A swapped month and day is the most likely slip; correct it rather than fail.
        if jd is not None and 1 <= jd <= 12:
            jm, jd = jd, jm
    if jy is None or jm is None or jd is None:
        return None
    if jm < 1 or jm > 12 or jd < 1 or jd > jalali_month_length(jy, jm):
        return None
    # Out of the plausible Jalali range means it was a Gregorian date after all.
    if jy < MIN_PLAUSIBLE_JALALI_YEAR or jy > MAX_PLAUSIBLE_JALALI_YEAR:
        return None

    gy, gm, gd = jalali_to_gregorian(jy, jm, jd)
    return (gy, gm, gd, time)


_DAY_ZERO = gregorian_to_jdn(1970, 1, 1)

def jalali_to_unix_days(jy, jm, jd):
    return jalali_to_jdn(jy, jm, jd) - _DAY_ZERO
