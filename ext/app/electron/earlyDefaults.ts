// Desktop defaults for the Persian edition.
//
// This module must be imported first by main.ts. Several core modules read their defaults from the
// environment while they are being imported (for example ActiveDoc captures GRIST_DEFAULT_LOCALE at
// module load, and AppMenu captures GRIST_DESKTOP_USE_UPDATE), so a value set later in main() would
// be too late for them. The imports in a CommonJS build run in source order, which is why this file
// is imported before anything else.
import { localeCodes } from "app/common/LocaleCodes";
import * as dotenv from "dotenv";
import * as electron from "electron";

// config.ts loads .env too, but it runs too late for the defaults below. Loading it here first means
// a GRIST_DEFAULT_LOCALE or GRIST_DESKTOP_USE_UPDATE in .env wins over the edition's defaults.
dotenv.config();

// New documents get the Persian locale (Jalali dates in cells) unless the user asks otherwise.
// Only complete codes such as "fa-IR" or "en-US" are accepted by grist-core; anything else would
// silently fall back to en-US, so replace it here with the edition's default.
const configuredLocale = process.env.GRIST_DEFAULT_LOCALE;
if (!configuredLocale || !localeCodes.has(configuredLocale)) {
  process.env.GRIST_DEFAULT_LOCALE = "fa-IR";
}

// The upstream auto-updater would download the English desktop build over this one. It stays off
// unless the user explicitly turns it on.
process.env.GRIST_DESKTOP_USE_UPDATE ??= "false";

// Chromium takes navigator.language and the Accept-Language header from these switches. That is
// what makes the very first HTML the server sends right-to-left, instead of a left-to-right page
// that flips after the client bundle has loaded. An explicit language in the account settings or
// the grist_user_locale cookie still wins in the interface.
electron.app.commandLine.appendSwitch("lang", "fa");
electron.app.commandLine.appendSwitch("accept-lang", "fa,en;q=0.9");
