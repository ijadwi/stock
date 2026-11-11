# التشغيل من GitHub (5 خطوات، بدون أي حساب إضافي)

1. ادخل github.com ← **New repository** ← سمّه `stock` ← اجعله **Public** ← **Create**.
2. اضغط **uploading an existing file** ثم **اسحب كل محتويات هذا المجلد** (بما فيها مجلد `.github` و`scripts` و`data`) إلى الصفحة ← **Commit changes**.
   - إن لم يظهر مجلد `.github` في ويندوز: من تبويب «عرض» فعّل «العناصر المخفية».
3. **Settings ← Pages ← Source: Deploy from a branch ← main / (root) ← Save**.
4. **Actions ← update-data ← Run workflow** (مرة واحدة للتجربة). انتظر دقيقة حتى تصبح العلامة خضراء ✅، وسيمتلئ مجلد `data` بالملفات.
   - إن ظهر زر «I understand my workflows, enable them» اضغطه.
5. افتح `https://USERNAME.github.io/stock/` (غيّر USERNAME لاسم حسابك).

## ملاحظات
- يتحدث تلقائياً كل 15 دقيقة أثناء السوق الأمريكي، والأسعار متأخرة بهذا القدر وليست لحظية.
- لإضافة سهم: افتح `symbols.txt` على GitHub ← أيقونة القلم ← أضف الرمز في سطر جديد ← Commit، ثم شغّل Run workflow.
- إن فشل الجلب (علامة ❌ حمراء) فغالباً Yahoo يرفض طلبات GitHub، وعندها أخبرني بنص الخطأ.
- قد يوقف GitHub الجدولة إذا بقي المستودع دون نشاط شهرين، وتُعاد من زر Run workflow.
