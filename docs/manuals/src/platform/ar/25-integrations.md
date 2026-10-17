# 25. Google وMeta وSearch Console (من جانب المنصة)

## الغرض من هذا الفصل

الإعداد الذي يتم مرة واحدة ويتيح لمراكز السبا المشتركة في باقة Premium ربط ملفها التجاري على Google (Google Business Profile) وحساباتها على Instagram وFacebook. وتقوم بهذا مرة واحدة للمنصة كلها، ثم يربط كل سبا حساباته من **Settings** (الإعدادات) → **Instagram & Google** لديه.

## Google

يخدم تطبيق واحد لتسجيل الدخول عبر Google (يُسمى "OAuth client") في مشروعك على Google Cloud جميع مراكز السبا.

1. افتح **console.cloud.google.com** واختر مشروع المنصة.
2. افتح **APIs & Services** (واجهات API والخدمات) وفعّل واجهات API التالية:
   - **My Business Account Management API**
   - **My Business Business Information API**
   - **Google My Business API** (التقييمات والمنشورات)
   - **My Business Place Actions API** (زر "Book" (حجز) على Google)
   - **Google Search Console API**
3. افتح **OAuth consent screen** (شاشة الموافقة) وأضف نطاقَي الصلاحية (scopes) **business.manage** و**webmasters**.
4. ضمن **Credentials** (بيانات الاعتماد)، افتح OAuth client وأضف **Authorized redirect URI** (عنوان إعادة التوجيه المعتمد) التالي: **https://app.spamanagement.co/api/integrations/google/callback**.
5. في شاشة الموافقة، اضبط سياسة الخصوصية على **https://spamanagement.co/privacy** والشروط على **https://spamanagement.co/terms**.
6. أضف معرّف العميل وسرّ العميل (GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET) إلى ملف البيانات السرية المشفّر (الفصل 24، "إضافة بيانات سرية أو تغييرها").
7. بعد التحديث التالي على الخادم، يتحول الصف **GOOGLE_\* (sign-in, Business Profile)** في صفحة Overview (النظرة العامة) إلى الأخضر.

> **مهم:** يجب أن توافق Google على وصولك إلى واجهات Business Profile API (عبر نموذج طلب الوصول الخاص بـ Google) قبل أن تعمل مع مراكز السبا الحقيقية. ونطاقا الصلاحية مصنّفان "حساسين" (sensitive)، لذلك تراجع Google التطبيق أيضاً قبل أن يتمكن المستخدمون الخارجيون من الربط دون رسالة تحذير.

> **نصيحة:** إذا كانت إحدى واجهات API غير مفعّلة، تعرض بطاقة Google لدى السبا "this Google API isn't enabled for the platform yet" (أي: واجهة Google API هذه غير مفعّلة للمنصة بعد). فعّل الواجهة التي تذكرها الرسالة.

ما تحصل عليه مراكز السبا المشتركة في Premium بعد الربط: **Book button on Google** (زر الحجز على Google)، وهو يرتبط بالحجز الإلكتروني للسبا، و**Search Console**، إذ تُرسَل خريطة موقع السبا (sitemap) إلى Google بعد كل نشر.

## Search Console لنطاق spamanagement.co

يتيح هذا لـ Google العثور على الموقع التسويقي وعلى العنوان المجاني لكل سبا.

1. افتح Google Search Console وأضف خاصية من نوع **Domain** (نطاق) لـ **spamanagement.co**.
2. تعطيك Google سجل **TXT**. أضفه في Namecheap ضمن **Advanced DNS** (إعدادات DNS المتقدمة) (الفصل 20).
3. انقر على **Verify** (تحقّق) في Search Console.
4. ضمن **Sitemaps** (خرائط الموقع)، أرسل **https://spamanagement.co/sitemap.xml** مرة واحدة.

> **نصيحة:** تشمل خاصية Domain هذه أيضاً العنوان المجاني لكل سبا ({slug}.spamanagement.co). ولا تستطيع مراكز السبا توثيق هذه العناوين بنفسها.

## Meta (Instagram وFacebook)

يخدم تطبيق Meta واحد جميع مراكز السبا. وله منتجان.

1. في Meta for Developers، افتح تطبيق المنصة.
2. **Instagram API with Instagram Login**:
   - OAuth redirect URI (عنوان إعادة التوجيه): **https://app.spamanagement.co/api/integrations/meta/callback**.
   - Webhook (عنوان الإشعارات التلقائية): **https://app.spamanagement.co/api/integrations/meta/webhook**، مع الحقلين **messages** (الرسائل) و**comments** (التعليقات).
   - Deauthorize callback URL (عنوان إلغاء التفويض): **https://app.spamanagement.co/api/integrations/meta/deauthorize**.
   - Data deletion request URL (عنوان طلب حذف البيانات): **https://app.spamanagement.co/api/integrations/meta/data-deletion**. ويظهر العنوانان أيضاً في بطاقة Instagram لدى السبا.
3. **Facebook Login for Business**:
   - Valid OAuth Redirect URI (عنوان إعادة التوجيه الصالح): **https://app.spamanagement.co/api/integrations/meta/facebook/callback**.
   - اشترك بكائن webhook الخاص بـ **Instagram** في التطبيق في الحقل **comments** (التعليقات). وبذلك تصل التعليقات على حساب Instagram المرتبط بصفحة Facebook إلى صندوق الوارد.
   - اختياري: أنشئ إعداداً (configuration) لـ Login for Business، وأضف معرّفه باسم META_FB_CONFIG_ID إلى ملف البيانات السرية المشفّر (الفصل 24). ومن دونه، تطلب نافذة تسجيل الدخول الصلاحيات مباشرة.
4. ضمن **Settings** (الإعدادات) → **Basic** (أساسي)، اضبط ما يلي:
   - Privacy policy (سياسة الخصوصية): **https://spamanagement.co/privacy**
   - Terms (الشروط): **https://spamanagement.co/terms**
   - Data deletion instructions (تعليمات حذف البيانات): **https://spamanagement.co/data-deletion**
   - App domains (نطاقات التطبيق): **spamanagement.co**
5. قدّم التطبيق إلى **App Review** (مراجعة التطبيق) للحصول على الصلاحيات التي تستخدمها المنصة. ويستطيع Claude أن يعطيك القائمة الدقيقة من ملاحظات الخادم.
6. أضف معرّف التطبيق، وسرّ التطبيق، ورمز التحقق الخاص بـ webhook (META_APP_ID و META_APP_SECRET و META_WEBHOOK_VERIFY_TOKEN) إلى ملف البيانات السرية المشفّر (الفصل 24، "إضافة بيانات سرية أو تغييرها").
7. بعد التحديث التالي على الخادم، يتحول الصف **META_\* (Instagram)** في صفحة Overview إلى الأخضر.

> **مهم:** إلى أن توافق Meta على مراجعة التطبيق، لا يستطيع ربط حساب إلا الأشخاص الذين لديهم دور في تطبيق Meta (المسؤولون، والمطوّرون، والمختبِرون). ولا تستطيع مراكز السبا الربط بعد.

> **نصيحة:** تنتهي صلاحية وصول Meta بعد 90 يوماً من آخر تسجيل دخول للشخص. وتنبّه بطاقة السبا قبل 14 يوماً وتطلب من السبا إعادة الربط.

> **مهم:** لا ترسل المنصة رسائل واتساب تلقائياً أبداً. فرسائل واتساب للعملاء تُرسَل دائماً بنقرة يدوية فقط، حتى مع ربط Meta.
