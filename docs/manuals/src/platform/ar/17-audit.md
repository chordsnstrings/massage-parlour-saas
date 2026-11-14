# 17. سجل التدقيق

## الغرض من هذا الفصل

يوضح سجل التدقيق من غيّر ماذا، ومتى، ومن أين، على مستوى المنصة كلها. استخدمه للإجابة عن أسئلة مثل "من سجّل هذه الدفعة؟" أو "متى أُوقف هذا السبا مؤقتاً؟".

## البحث في سجل التدقيق

1. انقر على **Audit log** (سجل التدقيق) في الشريط الجانبي. تعرض الصفحة: "Every change across the platform, newest first." (أي: كل تغيير على مستوى المنصة، الأحدث أولاً).
2. اقرأ الجدول. أعمدته هي:
   - **Action** (الإجراء): ما حدث، في صورة رمز مختصر، مثل **platform.reminder.created**.
   - **Spa** (السبا): اسم عنوان الويب للسبا، مثل **saffron-spa**. ويعرض **platform** (المنصة) للتغييرات التي تخص لوحة الإدارة كلها، مثل إعدادات الشركة.
   - **By** (بواسطة): البريد الإلكتروني للشخص الذي أجرى التغيير، أو "—" للمهام التلقائية.
   - **IP** (عنوان IP): عنوان الشبكة الذي جاء منه التغيير، أو "—" عندما لا يوجد عنوان.
   - **When** (الوقت): التاريخ والوقت.
3. للعثور على شيء، اكتب في **Filter by action, spa or email** (التصفية حسب الإجراء أو السبا أو البريد الإلكتروني) واضغط **Enter**. أمثلة:
   - **platform.payment** يعرض كل دفعة سُجّلت عبر **Record a payment** (تسجيل دفعة)، و**platform.invoice.marked** يعرض كل نقرة على **Mark paid** (تعليم كمدفوعة) و**Mark unpaid** (تعليم كغير مدفوعة). ابحث بالعبارتين لتجد كل الدفعات.
   - **saffron** يعرض كل ما حدث في السبا الذي اسم عنوان الويب الخاص به saffron-spa.
   - عنوان بريد إلكتروني يعرض كل ما فعله ذلك الشخص.
4. لعرض كل شيء مرة أخرى، امسح المربع واضغط **Enter**.

   ![سجل التدقيق.](../../../shots/platform/audit-page.png)

   *في لقطة الشاشة:*

   1. **Filter by action, spa or email**.
   2. **Action**.
   3. **By**.
   4. **When**.

> **نصيحة:** تعرض الصفحة أحدث 200 نتيجة مطابقة. وإذا لم تجد إدخالاً أقدم، فاكتب عبارة تصفية أدق.

> **نصيحة:** يطابق عامل التصفية **Spa** اسم عنوان الويب للسبا (الجزء الذي يسبق .spamanagement.co)، وليس اسمه المعروض. ابحث عن "desert-rose"، وليس "Desert Rose Day Spa".

## معنى الإجراءات الشائعة

الإجراءات التي تبدأ بـ **platform.** هي تغييرات أُجريت في لوحة الإدارة هذه. أما الإجراءات الأخرى فتأتي من داخل لوحات تحكم مراكز السبا، مثل **booking.status** أو **sale.refunded**.

| الإجراء | ما حدث |
|---|---|
| **platform.application.accepted** / **platform.application.rejected** | قُبل طلب انضمام أو رُفض (الفصل 4). |
| **platform.payment.recorded** | سُجّلت دفعة على فاتورة (الفصل 6). |
| **platform.invoice.created** | أُنشئت فاتورة واحدة يدوياً. |
| **platform.invoice.schedule** | أنشأ زر **Generate payment schedule** (إنشاء جدول الدفعات) فواتير. |
| **platform.invoice.marked_paid** / **platform.invoice.marked_unpaid** | عُلِّمت فاتورة كمدفوعة أو غير مدفوعة عبر **Mark paid** / **Mark unpaid** (الفصل 6). |
| **platform.subscription.updated** | حُفظت بطاقة **Subscription** (الاشتراك)، مثلاً عند ضبط فترة جديدة (الفصل 6). |
| **platform.subscription.plan_switched** | نُقل سبا إلى باقة أخرى. |
| **platform.subscription.discounts** | تغيّرت خصومات سبا. |
| **platform.tenant.feature_tier** | جرى تجاوز مستوى الميزات لسبا. |
| **platform.tenant.paused** / **platform.tenant.resumed** | أُوقف سبا مؤقتاً أو استُؤنف عبر **Pause spa** (إيقاف السبا مؤقتاً) (الفصل 6). |
| **platform.billing.paused** / **platform.billing.resumed** | أُوقفت مراحل الفوترة التلقائية لسبا مؤقتاً أو استُؤنفت. |
| **platform.tenant.status** | غُيّرت حالة سبا يدوياً. |
| **platform.tenant.slug_renamed** | غُيّر عنوان الويب لسبا. |
| **platform.tenant.deleted** / **platform.tenant.purged** | حُذف سبا، أو مُحيت بياناته نهائياً. |
| **platform.reminder.created** | أُنشئ تذكير بالدفع. |
| **platform.billing.stage** | انتقل سبا متأخر عن السداد إلى مرحلة فوترة أخرى (متأخرة السداد، فترة السماح، للقراءة فقط). |
| **platform.billing.rules** | غُيّرت قواعد الفوترة (الفصل 7). |
| **platform.plan.created** / **.updated** / **.archived** / **.restored** / **.deleted** | أُضيفت باقة أو غُيّرت أو أُرشفت أو استُعيدت أو حُذفت (الفصل 8). |
| **platform.company.updated** | حُفظت بيانات الشركة (الفصل 15). |
| **platform.email.updated** / **platform.email.test_sent** | حُفظت إعدادات البريد الإلكتروني، أو أُرسلت رسالة اختبار. |
| **platform.turnstile.updated** | حُفظت إعدادات التحقق من الروبوتات. |
| **platform.ai.budget_updated** | غُيّرت ميزانية الذكاء الاصطناعي لسبا (الفصل 16). |
| **platform.ai_model.updated** | غُيّر نموذج ذكاء اصطناعي. |
| **platform.ai.disabled** / **platform.ai.enabled** | أُوقف الذكاء الاصطناعي أو شُغّل للمنصة كلها (الفصل 16). |
| **platform.ai.tenant_disabled** / **platform.ai.tenant_enabled** | أُوقف الذكاء الاصطناعي أو شُغّل لسبا واحد (الفصل 16). |
| **platform.site_template.** يليه ما حدث | حُفظ قالب موقع من سبا، أو استُورد، أو رُفع كتصميم HTML، أو عُدّل، أو غُيّرت صوره أو **Phone fixes** (إصلاحات الهاتف) الخاصة به (الفصل 12). |
| **platform.site_template.version_uploaded** / **.version_signed_off** / **.version_rolled_out** / **.version_discarded** | رُفع إصدار جديد من قالب HTML، أو اعتُمد، أو عُمِّم على مراكز السبا، أو تُجوهل (الفصل 12). |
| **platform.domain_order.purchased** / **platform.domain_order.rejected** | وُوفق على شراء نطاق وتم شراؤه، أو رُفض الطلب (الفصل 13). |
| **platform.announcement.created** / **.updated** / **.ended** / **.deleted** | نُشر إعلان، أو غُيّر، أو أُنهي، أو حُذف (الفصل 14). |
| **platform.flag.created** / **.updated** / **.override** / **.deleted** | أُضيفت علامة ميزة، أو غُيّرت، أو ضُبطت لسبا واحد، أو حُذفت (الفصل 14). |
| **platform.email.domain_setup** | أُعدّ نطاق الإرسال في Resend (الفصل 15). |
| **platform.admin.joined** / **platform.admin.email_verified** | انضم مشرف عام، أو عُلِّم بريده الإلكتروني بأنه موثَّق (الفصل 2). |
| **platform.mcp.client_authorized** | وافق مشرف عام على مساعد ذكاء اصطناعي (Claude أو ChatGPT) (الفصل 11). |
| **platform.mcp.client_revoked** | فُصل اتصال بمساعد ذكاء اصطناعي (Claude أو ChatGPT) (الفصل 11). |
| **site.template_applied** / **site.template_undone** | استُخدم قالب أو بُدِّل في موقع سبا، أو أُلغي التبديل أو الترقية إلى إصدار جديد (الفصل 10). |
| **site.template_upgraded** | نقل التعميم (Roll out) هذا السبا إلى إصدار جديد من قالبه (الفصل 12). |
| **site.design_seed** | غيّر **Fill the CRM from the design** (ملء نظام الإدارة من التصميم) علاجات السبا أو معالِجيه أو صوره (الفصل 10). |
| **site.page.draft_saved** / **site.page.published** | حُفظت مسودة صفحة في المحرر، أو نُشرت صفحة واحدة. |
| **site.published** | نشر **Publish site** كل ما كان ينتظر النشر. |
| **site.ai_texts_written** | كتب **Write texts** مسودة نصوص صفحات الموقع (الفصل 10). |
| **site.page.ai_edit** / **site.page.ai_edit_undone** | غيّرت **Ask AI** مسودة، أو أُلغي التغيير. |
| **site.change_requested** / **site.change_resolved** | أرسل السبا طلب تعديل، أو أغلقه مشرف عام بزر **Mark done** (الفصل 10). |
| **site.page.lock_taken_over** | نقر مشرف عام على **Take over** في المحرر. |
| **site.mcp.** يليه اسم أداة | غيّر Claude أو ChatGPT موقعاً إلكترونياً عبر موصِّل مساعد الذكاء الاصطناعي، نيابة عن الشخص المذكور تحت **By** (بواسطة). ويسجّل الإدخال أيضاً العبارة "via AI assistant (MCP)" (أي: عبر مساعد الذكاء الاصطناعي) واسم المساعد (الفصل 11). |

> **مهم:** لا يمكن تعديل سجل التدقيق أو مسحه من لوحة الإدارة. فهو سجلك لما حدث. ويُسجَّل كل إجراء في لوحة الإدارة، بما في ذلك التغييرات التي تجريها أثناء عرض لوحة تحكم سبا بصفتك مشرفاً عاماً.
