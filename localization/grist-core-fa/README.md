# لایهٔ فارسی vendored

این پوشه یک **عکس فوری (snapshot)** از لایهٔ فارسی مخزن
[`AliMalakoo/grist-core-fa`](https://github.com/AliMalakoo/grist-core-fa) است که همراه
Grist Desktop فارسی توزیع می‌شود. build دسکتاپ نباید برای دسترسی به آن به شبکه نیاز
داشته باشد؛ به همین دلیل فایل‌ها اینجا نگه داشته شده‌اند.

| مسیر | معنی |
| --- | --- |
| `REVISION` | commit لایه در مخزن `grist-core-fa` که این عکس از آن گرفته شده (`be6d547`) |
| `UPSTREAM.lock` | نسخهٔ `grist-core` که لایه روی آن ساخته شده (`6346baff`، master پس از v1.7.22) |
| `overlay/` | ۶۸ فایل نهایی لایه (۱۵ فایل جدید + ۵۳ فایل دست‌خورده)، شامل ۵ فونت وزیرمتن |
| `patch/` | همان ۵۳ تغییر به‌صورت patch، به‌همراه فهرست فایل‌ها |
| `LICENSE.txt` | مجوز `grist-core` (Apache-2.0)؛ مجوز فونت‌ها در `overlay/static/fonts/vazirmatn/LICENSE` است |

`scripts/apply-persian.js` این عکس را روی submodule `core` اعمال می‌کند. ترتیب کار:

1. بررسی اینکه `core` دقیقاً روی commit ثبت‌شده در دسکتاپ است و فایل‌های مربوطه تمیزند.
2. `git apply` روی `patch/fa-modified.patch` و کپی ۱۵ فایل جدید از `overlay/`
   (از جمله فونت‌های woff2).
3. افزودن قلاب‌های مخصوص دسکتاپ: زبان پیش‌فرض `fa` داخل Electron و قرار دادن
   `"Vazirmatn"` در ابتدای دو پشتهٔ فونت تم.
4. بررسی اینکه نتیجهٔ نهایی با `overlay/` می‌خواند (متن‌ها مستقل از CRLF/LF، فونت‌ها
   بایت‌به‌بایت) و نوشتن فایل وضعیت `core/.grist-desktop-fa-state.json`.

پس از `yarn run setup` می‌توانید با `node scripts/apply-persian.js --check` هر زمان
بررسی کنید که درخت آماده‌شده هنوز دست‌نخورده و کامل است.

## تفاوت آگاهانه با مخزن لایه

یک تغییر کوچک، مخصوص دسکتاپ، روی `overlay/app/client/widgets/DateTextBox.js` (و patch
مربوط) اعمال شده است: ردیف «تقویم» در پنل تنظیمات ستون تاریخ فقط وقتی رندر می‌شود که
رابط راست‌به‌چپ باشد یا سند روی تقویم جلالی باشد. بدون این شرط، آن ردیف در رابط انگلیسی
هم ارتفاع پنل را عوض می‌کرد و آزمون‌های مرورگری بالادستی (`MultiColumn1/3`) را می‌شکست.
منطق تقویم جلالی و گزینهٔ per-column دست‌نخورده است.

## به‌روزرسانی لایه

با هر نسخهٔ تازهٔ `grist-core-fa`:

1. `UPSTREAM.lock` و `overlay/` و `patch/` را از مخزن لایه کپی کنید (`bin/rerecord.sh`
   در خود مخزن لایه این‌ها را می‌سازد) و `REVISION` را با commit تازه پر کنید.
2. اگر `UPSTREAM.lock` عوض شده، commit مربوط به submodule `core` در دسکتاپ هم باید همان
   نسخه را بگیرد و `ext/` دوباره تست شود.
3. `core` را به نسخهٔ تمیز برگردانید (بدون پاک‌کردن `node_modules`) و
   `yarn run setup && yarn run build` را اجرا کنید.
4. `node scripts/apply-persian.js --check` باید سبز شود و آزمون‌های جلالی و
   `sendAppPage` هم باید پاس شوند.
