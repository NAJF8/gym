# AL ASAS FIT

واجهة أولية قابلة للتشغيل لنظام إدارة الكباتن والمشتركين والبرامج الرياضية.

## التشغيل

```bash
npm install
npm run dev
```

المسارات:

- `/admin/` لوحة الكابتن.
- `/member/` بوابة المشترك.

## حدود هذه النسخة

هذه النسخة Frontend prototype تفاعلي ببيانات محلية داخل الذاكرة فقط، وليست نظام Production. لم يتم ربط Firebase أو Supabase أو مصادقة حقيقية أو قواعد وصول أو GitHub Pages في المستودع الحالي؛ لذلك تبقى اختبارات `AUTH_ROLE_ISOLATION` و`DATABASE_SECURITY_TESTS` و`CROSS_PORTAL_SYNC` و`PRODUCTION_DEPLOY` بحالة `NOT_VERIFIED` حتى تتوفر بيئة backend وصلاحيات الربط.
