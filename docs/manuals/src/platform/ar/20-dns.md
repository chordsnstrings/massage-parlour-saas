# 20. إعدادات DNS لدى Namecheap

## الغرض من هذا الفصل

تخبر سجلات DNS شبكة الإنترنت بمكان وجود spamanagement.co. وبضعة سجلات لدى Namecheap هي التي تجعل الموقع الإلكتروني، والتطبيق، ولوحة الإدارة، والعنوان المجاني لكل سبا، وصندوق البريد ask@spamanagement.co تعمل.

## أين تجد السجلات

1. سجّل الدخول إلى Namecheap.
2. افتح **Domain List** (قائمة النطاقات).
3. انقر على **Manage** (إدارة) بجانب **spamanagement.co**.
4. افتح علامة التبويب **Advanced DNS** (إعدادات DNS المتقدمة).

تبقى خوادم الأسماء (nameservers) على **Namecheap BasicDNS**. ولا يوجد Cloudflare أمام المنصة.

## السجلات التي تحتاج إليها

| النوع | المضيف (Host) | القيمة | وظيفته |
|---|---|---|---|
| **A** | **@** | عنوان IP الخاص بالخادم | spamanagement.co نفسه (الموقع التسويقي). |
| **A** | **\*** | عنوان IP نفسه | كل عنوان تحت spamanagement.co، أي: www.spamanagement.co و app.spamanagement.co و admin.spamanagement.co، وعنوان كل سبا {slug}.spamanagement.co، و customers.spamanagement.co. |
| Email Forwarding (إعادة توجيه البريد: MX + SPF TXT) | يضبطه Namecheap | يضبطه Namecheap | يوصل بريد ask@spamanagement.co إلى صندوق بريدك الخاص. |

عنوان IP الخاص بالخادم هو العنوان العام لخادم DigitalOcean (droplet). وتجده في DigitalOcean في صفحة الـ droplet. ويُكتب في هذا الدليل بالصيغة `<droplet IP>`.

> **مهم:** لا تحذف سجلَّي **A** ولا تغيّرهما. فإذا كانا غير صحيحين، تتوقف المنصة كلها، وكل مواقع مراكز السبا، والحجز الإلكتروني عن العمل.

> **نصيحة:** يعني السجل **\*** أنك لا تحتاج إلى سجل جديد لكل سبا. فعنوان السبا الجديد، مثل saffron-spa.spamanagement.co، يعمل فوراً. ويحصل الخادم على شهادة الأمان (https) الخاصة به عند أول زيارة.

## السجلات التي تضيفها لاحقاً

- **Resend (بريد الموظفين):** السجلات الموجودة في **Company** (الشركة) → **Email (Resend)** (البريد الإلكتروني) → **Set up sending domain** (إعداد نطاق الإرسال) (الفصل 15). واقرأ أولاً التحذير الموجود هناك بشأن **Custom MX** وEmail Forwarding.
- **Google Search Console:** سجل **TXT** يثبت ملكيتك لنطاق spamanagement.co (الفصل 25).

## النطاقات الخاصة لمراكز السبا

النطاق الخاص بالسبا (مثل book.saffronspa.ae) ليس في حسابك لدى Namecheap. ويضيف السبا سجلاته لدى الشركة التي سجّل نطاقه عندها:

- سجل **TXT** يثبت ملكيته للنطاق،
- سجل **CNAME** يوجّه النطاق إلى **customers.spamanagement.co**.

ويجعل السجل **\*** أعلاه customers.spamanagement.co يشير إلى الخادم. راجع الفصل 13.

## التحقق من أن DNS يعمل

- افتح https://app.spamanagement.co و https://admin.spamanagement.co. ويجب أن يُفتح كلاهما.
- اطلب من Claude فحص السجلات. ويستطيع Claude معرفة الوجهة التي يشير إليها app.spamanagement.co ومقارنتها بعنوان الخادم.

> **نصيحة:** يسري تغيير DNS لدى Namecheap عادة خلال دقائق، لكنه قد يستغرق حتى 48 ساعة ليصل إلى الجميع.
