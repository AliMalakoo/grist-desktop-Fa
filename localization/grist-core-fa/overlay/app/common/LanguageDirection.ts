/**
 * Which writing direction a Grist interface language uses.
 *
 * Grist otherwise has no notion of direction: it renders everything left-to-right and lets the
 * browser's bidirectional algorithm handle the text inside each element. For RTL languages
 * (Persian, Arabic, Hebrew, ...) that is not enough -- the chrome of the app should be mirrored,
 * and cells should read right-to-left by default -- so both the server, which writes the
 * `dir` attribute into the page, and the client, which keeps it in step when the language
 * changes, ask this module.
 */

/**
 * Language subtags whose scripts are written right-to-left. This follows the Unicode
 * " bidi class of the script " as used by Intl.Locale.getTextInfo()/CLDR, listed here so that no
 * ICU data is needed at build time or runtime.
 */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  "ar",   // Arabic
  "arc",  // Imperial Aramaic
  "dv",   // Dhivehi
  "fa",   // Persian
  "pes",  // Persian under the legacy subtag, same script
  "he",   // Hebrew
  "prs",  // Dari -- Persian written in Afghanistan, Arabic script
  "khw",  // Khowar
  "ks",   // Kashmiri (Arabic script)
  "ku",   // Kurdish (Sorani, Arabic script)
  "mzn",  // Mazanderani
  "ps",   // Pashto
  "sd",   // Sindhi
  "ug",   // Uyghur (Arabic script)
  "ur",   // Urdu
  "yi",   // Yiddish
]);

/**
 * Languages whose readers use the Jalali (Persian solar) calendar. Turkmen is not among them: it
 * writes in Latin and keeps the Gregorian calendar.
 */
export const JALALI_LANGUAGES: ReadonlySet<string> = new Set([
  "fa",   // Persian (Iran, Afghanistan)
  "pes",  // Persian (legacy subtag)
  "prs",  // Dari
  "ps",   // Pashto
  "ug",   // Uyghur
  "ku",   // Kurdish (Sorani)
]);

/**
 * The language subtag of a locale, e.g. "fa" for "fa-IR", "en_GB" or "zh-Hans".
 */
export function languageSubtag(locale: string | null | undefined): string {
  if (!locale) { return ""; }
  return String(locale).toLowerCase().split(/[-_]/)[0];
}

export function isRtlLanguage(locale: string | null | undefined): boolean {
  return RTL_LANGUAGES.has(languageSubtag(locale));
}

/** "rtl" for the languages above, "ltr" for anything else -- including an unknown language. */
export function languageDir(locale: string | null | undefined): "rtl" | "ltr" {
  return isRtlLanguage(locale) ? "rtl" : "ltr";
}
