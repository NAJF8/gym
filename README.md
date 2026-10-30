# AL ASAS FIT

واجهة أولية قابلة للتشغيل لنظام إدارة الكباتن والمشتركين والبرامج الرياضية.

## التشغيل

```bash
npm install
npm run dev
```

المسارات:

- `/admin/` لوحة الكابتن.
- `/` بوابة المشترك المستقلة.
- `/admin/` لوحة الإدارة المحمية.

## حدود هذه النسخة

## حالة التكامل الآمن

- `/admin/` محمي برمجياً: لا تظهر بيانات الإدارة قبل Google Auth ثم قراءة `admins/{uid}` الفعالة.
- `/` يستخدم خدمة PIN موثوقة اختيارية عبر `VITE_PIN_SERVICE_ENDPOINT`؛ إذا لم يُضبط العنوان يبقى المسار متوقفاً fail-closed.
- قواعد RTDB موجودة في `database.rules.json` ومغلقة افتراضياً. لا تُنشر قبل تشغيل Emulator Rules Tests ومراجعة bootstrap للـ Super Admin.
- Bootstrap الأول يتم خارج المتصفح عبر `functions/scripts/bootstrap-super-admin.mjs` باستخدام UID وEmail محددين وService Account من متغيرات بيئية؛ يتحقق من Firebase Auth والـ email الموثق ومشروع `gym1-4f1bb`، ويرفض التشغيل ما لم يُضبط `ALASAS_BOOTSTRAP_APPROVED=true` صراحة، كما يرفض أي `admins` موجودة.
- إدارة دعوات المدراء لا تكتب `admins/{uid}` من المتصفح. المسار المعتمد هو Worker/D1 المحلي أو المنشور المصرح به، مع تحقق Firebase ID Token والبريد الموثق وGoogle provider، ثم قبول idempotent عبر حالات الدعوة الموثقة أدناه.

## Structural member storage and invitation cutover

- The canonical member collection is `appData/membersById/{memberId}`. Each record carries a monotonic `version`; a stale write fails with `MEMBER_CONFLICT` instead of replacing the collection.
- Deletions write `appData/deletedMemberIds/{memberId}` before removing the keyed record. The RTDB rules reject a later write for a tombstoned ID. The old `appData/members` array remains readable only as a migration source and is no longer writable.
- Prepare a local migration with `node scripts/migrate-members-keyed.mjs input.json output.json`. Missing, invalid, and duplicate IDs fail explicitly. The script is idempotent; do not delete the legacy source until post-cutover verification and a separate rollback decision.
- Admin invitations are canonical in the Worker D1 `admin_invitations` table. Acceptance uses `PENDING -> CLAIMED -> APPLIED`; RTDB writes are retried idempotently only for the same verified UID and exact role. Existing admin records, expired invites, replay, self-invitation, and Manager administration are rejected. `0000_initial_pin_schema.sql` makes fresh local D1 setup reproducible; apply migrations before starting a local Worker.
- Google Provider وAuthorized Domains إعدادات Firebase Console خارج التغيير المحلي. قبل أي Bootstrap أو نشر يجب تسجيل دخول Google فعلي بالحسابين واستخراج UID من `User.uid`/Admin SDK، ثم توثيق قراءة Auth وRTDB الراجعة. لا تعتبر قيم البريد أو build دليلاً على UID أو Provider.
- قواعد RTDB تشترط الآن `email_verified=true` و`firebase.sign_in_provider === 'google.com'` لمسارات الإدارة، مع منع كتابة `admins` من العميل.
- Firestore مغلق حالياً (`allow read, write: if false`) لأن مخطط التطبيق الحالي يستخدم RTDB فقط.
- لا توجد قيم Firebase حقيقية في المستودع. انسخ `.env.example` إلى إعداد بيئة محلي/CI مناسب، ولا تضع secrets أو GitHub tokens في `VITE_*`.
- البيانات الحالية في `localStorage` لم تُرحّل تلقائياً إلى Production؛ ما زالت عملية Migration وقراءة/كتابة RTDB الفعلية `NOT_VERIFIED` حتى تُختبر على Emulator ثم تُراجع قبل أي نشر.

### خطة دخول المشترك الآمن

- حالة بوابة `/` تبقى `BLOCKED` إلى أن يعتمد المستخدم طريقة الدخول.
- يصدر Worker الموجود في `worker/` PIN عشوائياً من 4 أرقام، ويحفظ في D1 فقط salt واشتقاق PBKDF2-SHA-256، ويقفل التخمين بعد 5 محاولات لمدة 15 دقيقة.
- ينشئ المدير سجل المشترك، ثم يطلب الإصدار من `/v1/admin/member-pin` بعد تحقق Google/UID والصلاحية عبر Firebase. تسجيل الدخول والـ`me` وتسجيل الخروج تستخدم `/v1/member/*`. لا يكتب العميل PIN أو `membersByUid`.
- يعيد `/v1/member/login` ملف المشترك المطابق للهاتف فقط بعد نجاح التحقق الخادمي؛ يعزل العضويات ولا يعرض `authUid` للمشترك.
- تبقى قواعد RTDB معتمدة على `auth.uid` و`active`، ولا يُعاد أي برنامج قبل نجاح Auth وقراءة السجل المخصص لذلك UID. لا نفعّل إنشاء الحسابات قبل اعتماد هذا التدفق واختباره على Emulator.

### خطة صور التمارين العامة

- ترفع الصور العامة فقط إلى مجلد مضبوط داخل GitHub عبر مراجعة Pull Request أو Workflow يدوي بصلاحية `contents: write` عند الحاجة، مع allowlist للامتدادات والحجم ومنع الملفات الشخصية.
- لا يوضع GitHub Token أو `GITHUB_TOKEN` داخل الواجهة أو أي `VITE_*`. يخزن RTDB رابط HTTPS العام فقط، وتُراجع الروابط محلياً قبل استخدامها.
- لا يوجد في هذه المرحلة Workflow رفع صور مفعّل، ولا تم نشر صورة حقيقية؛ لذلك تبقى `GITHUB_IMAGES` بحالة `BLOCKED`.

### حالة PIN الحالية

- الإصلاح المحلي واختبارات Emulator وcrypto نجحت، لكن Worker غير منشور، و`VITE_PIN_SERVICE_ENDPOINT` غير مضبوط، ولم يُتحقق من أسرار Cloudflare أو Firebase الإنتاجية.
- لا تنفذ `wrangler deploy` أو تنشئ D1 أو تضع service-account secrets قبل موافقة مستقلة وفحص إنتاجي/نسخة احتياطية مناسبين.

### تشغيل Emulator محلياً

```bash
npx --yes firebase-tools@15.34.2 emulators:start --only auth,database --project demo-gym --config firebase.json
npm run test:rules
```

إعداد `firebase.json` يثبت RTDB Emulator على `127.0.0.1:9000` ويعطل Emulator UI وبقية الخدمات. يجب التحقق من جاهزية المنفذ قبل الاختبار وإيقاف PID الخاص بالـ Emulator بعد الانتهاء.

### التحقق المحلي

```bash
npm ci
npm run build -- --base=/
npm run build -- --base=/gym/
npm run test:rules
```

اختبار القواعد يحتاج Java وFirebase Database Emulator محلياً. السكربت يشغّل اختبارات الرفض/السماح وعزل العضويات ومزامنة جلستين مستقلتين على مشروع `demo-gym`، ولا يتصل بـ Production.

نجاح البناء لا يثبت المصادقة أو قواعد الوصول أو مزامنة الأجهزة أو النشر. أي اختبار Production يحتاج إعدادات Firebase وصلاحيات واضحة وقراءة راجعة فعلية.

### إعداد محلي للحسابات بدون Production

1. في Firebase Console، راجع Authentication > Sign-in method > Google للمشروع `gym1-4f1bb` وسجّل النتيجة؛ لا تُنفذ `deploy --only auth` ضمن هذا الإعداد المحلي.
2. شغّل التطبيق مع `VITE_USE_FIREBASE_EMULATORS=true` وسجّل الدخول بالحساب الحقيقي فقط إذا كان الهدف اختبار Google الفعلي؛ Emulator لا يستخرج UID Google حقيقياً.
3. بعد أن يسجل `alasastech0@gmail.com` دخول Google فعلياً، احفظ UID الناتج في متغير محلي مؤقت، ثم نفّذ bootstrap على Emulator فقط باستخدام `ALASAS_BOOTSTRAP_DRY_RUN=true` و`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` و`FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000`.
4. بعد تسجيل دخول `mohameadalhaear100@gmail.com` فعلياً، نفّذ provisioning الإداري خارج المتصفح فقط بعد تحقق UID/Google/emailVerified؛ لا يوجد زر Production لإضافة Manager في نسخة Spark-only.
5. لا تشغّل `ALASAS_BOOTSTRAP_APPROVED=true` على `gym1-4f1bb`، ولا تنفذ Rules deploy أو Functions deploy أو Git Push قبل موافقة منفصلة.
