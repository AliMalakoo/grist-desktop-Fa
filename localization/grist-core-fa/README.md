# لایهٔ فارسی vendored

این پوشه یک **عکس فوری (snapshot)** از لایهٔ فارسی مخزن
[`AliMalakoo/grist-core-fa`](https://github.com/AliMalakoo/grist-core-fa) است که همراه
Grist Desktop فارسی توزیع می‌شود. مخزن اصلی لایه خصوصی است و build دسکتاپ نباید برای
دسترسی به آن به شبکه نیاز داشته باشد؛ به همین دلیل فایل‌ها اینجا نگه داشته شده‌اند.

| مسیر | معنی |
| --- | --- |
| `REVISION` | commit لایه در مخزن `grist-core-fa` که این عکس از آن گرفته شده |
| `UPSTREAM.lock` | نسخهٔ `grist-core` که لایه روی آن ساخته شده (`v1.7.22`) |
| `overlay/` | ۱۹ فایل نهایی لایه (۵ فایل جدید + ۱۴ فایل دست‌خورده) |
| `patch/` | همان ۱۴ تغییر به‌صورت patch، به‌همراه فهرست فایل‌ها |
| `LICENSE.txt` | مجوز `grist-core` (Apache-2.0) |

`scripts/apply-persian.js` این عکس را روی submodule `core` اعمال می‌کند. ترتیب کار:

1. بررسی اینکه `core` دقیقاً روی commit ثبت‌شده در دسکتاپ است و فایل‌های مربوطه تمیزند.
2. `git apply` روی `patch/fa-modified.patch` و کپی ۵ فایل جدید از `overlay/`.
3. افزودن قلاب‌های مخصوص دسکتاپ: زبان پیش‌فرض `fa` داخل Electron، فونت Vazirmatn، و
   لینک CSS فونت در `static/app.html`.
4. بررسی اینکه نتیجهٔ نهایی بایت‌به‌بایت با `overlay/` می‌خواند و نوشتن فایل وضعیت
   `core/.grist-desktop-fa-state.json`.

پس از `yarn run setup` می‌توانید با `node scripts/apply-persian.js --check` هر زمان
بررسی کنید که درخت آماده‌شده هنوز دست‌نخورده و کامل است.

## به‌روزرسانی لایه

با هر نسخهٔ تازهٔ `grist-core-fa`:

1. `UPSTREAM.lock` و `overlay/` و `patch/` و `REVISION` را از مخزن لایه کپی کنید
   (`bin/rerecord.sh` در خود مخزن لایه این‌ها را می‌سازد).
2. اگر `UPSTREAM.lock` عوض شده، commit مربوط به submodule `core` در دسکتاپ هم باید همان
   نسخه را بگیرد و `ext/` دوباره تست شود.
3. `core` را به نسخهٔ تمیز برگردانید (بدون پاک‌کردن `node_modules`) و
   `yarn run setup && yarn run build` را اجرا کنید.
4. `node scripts/apply-persian.js --check` باید سبز شود و آزمون‌های جلالی و
   `sendAppPage` هم باید پاس شوند.

هیچ‌کدام از اسکریپت‌های `bin/` مخزن لایه اینجا کپی نشده‌اند؛ کار آن‌ها را
`scripts/apply-persian.js` برای حالت ثابت (pinned) دسکتاپ انجام می‌دهد.
