# تدقيق Product Entry Experience

التاريخ: 2026-08-01  
النطاق: تنفيذ محلي فقط، بلا نشر أو commit أو كتابة إلى بيانات الإنتاج.

> توثّق هذه الصفحة نتيجة التدقيق الذي سبق التنفيذ. الروابط والمسارات تشير إلى البنية النهائية بعد إزالة المنتجين القدامى ومعالجة نقاط التعارض.

## 1. منتجو first-run الذين وُجدوا

كان التطبيق يملك أكثر من منتج مستقل لأول دخول، موزعًا بين shell وbootstrap والقاموس وXP:

| النظام القديم | الأثر الذي كان ينتجه | موضع التعارض | القرار |
|---|---|---|---|
| `welcomeModal` | رسالة ترحيب منفصلة عند أول دخول | يمكن أن تتزامن مع onboarding وtoast | أزيل DOM والمنتج والمؤقتات |
| onboarding القائم على `ONBOARDING_STEPS` | جولة تعليمية مرتبطة بعناصر التطبيق | يعتمد على توفر DOM وقد يتعارض مع التنقل والحسابات القديمة | أزيل بالكامل |
| empty onboarding | دفع المستخدم نحو أول كلمة | يصنّف حسابًا قديمًا بلا الحقل الجديد كمستخدم فارغ | أزيل بالكامل |
| replay onboarding | إعادة تشغيل الجولة من الملف الشخصي | يعيد نظامًا قديمًا لا يشارك عقد Entry الجديد | أزيل؛ استُبدل بتحرير الاهتمامات والمظهر مباشرة من الإعدادات |
| إشعارات فتح/استخدام الثيم | toast مستقل عند أول استعمال | قد يظهر فوق Entry أو يتكرر | بقي ضمن سلطة الثيم الحالية، وأصبح owner-scoped وonce-only ويخضع لسياسة التأجيل |

يثبت اختبار [legacy-entry-removal-static.test.mjs](../tests/legacy-entry-removal-static.test.mjs) غياب DOM والدوال والمستمعات والـCSS الخاصة بالأنظمة الأربعة الأولى، مع إبقاء مؤشرات الإنتاج القديمة للقراءة فقط.

## 2. مفاتيح التخزين وحقول Firestore ذات الصلة

### مؤشرات قديمة للقراءة فقط

- `lootlinguaOnboarding`
- `hasCompletedOnboarding`
- `lootlingua_welcome_v1_seen`

لا يوجد أي `setItem` أو `removeItem` لها في الشجرة النهائية. تُقرأ فقط كإشارة مساعدة لضيف قديم، ولا يسمح لها بتلويث تصنيف حساب Firebase جديد على الجهاز نفسه.

### مفاتيح المظهر القديمة المتوافقة

- `theme`
- `lootlinguaOasisMode`
- `lootlingua:used:theme:<owner>:<theme>`
- `lootlingua:unlocked:theme:<owner>:<theme>`
- `lootlingua:themeNotifyBootstrapped:<owner>`

بقي المفتاحان العامان الأولان كطبقة توافق وتهيئة مبكرة للمظهر. بعد حسم Auth تُستخدم المفاتيح المقيدة بالمالك:

- `lootlingua:theme:guest` أو `lootlingua:theme:user:<uid>`
- `lootlingua:oasis-mode:guest` أو `lootlingua:oasis-mode:user:<uid>`

### مفاتيح Entry والترحيل الجديدة

- `lootlingua:entry-experience:v1:<owner>`
- `lootlingua:pending-intent:v1:<owner>`
- `lootlingua:guest-profile-migration:v1:user:<uid>`

مساحة `owner` هي `guest` أو `user:<uid>`، لذلك لا تشترك حسابات الجهاز في draft أو intent أو theme. مفاتيح الترحيل التاريخية الموجودة أصلًا (`lootlinguaGuestMigrationHandled` و`lootlingua_migration_complete` و`lootlinguaGuestDataDirty`) بقيت للتوافق، لكن لم تعد تكفي وحدها لمسح بيانات ضيف meaningful.

### Firestore

- حالة الإصدار: `users/{uid}/entryExperiences/v1`.
- إعدادات المظهر الحالية في الملف: `users/{uid}/meta/profile.theme`، و`oasisMode`، و`themeIntroSeen`.
- تصنيف العالم: `primaryInterest` و`interestTags` على مستند العالم وفق عقد Admin الحالي.

## 3. تدفق Auth الذي بُني عليه التنفيذ

- التطبيق يهيئ Firebase مرة واحدة في [cloud.js](../js/cloud.js)، ويجعل Firebase Auth session مصدر الحقيقة.
- `onAuthStateChanged` يحسم المستخدم، يلغي مستمعي الحساب السابق، يزيد generation للحماية من نتائج async المتأخرة، ويبدأ تحميل الكلمات والملف وSRS.
- Smart Loading يبقى ظاهرًا حتى حسم Auth والبيانات الأولية؛ لا يُستدل على login من `localStorage`.
- Landing تستخدم مشروع Firebase نفسه ومزود Google نفسه: popup في المتصفحات المعتادة وredirect على iOS، ثم انتقال same-origin إلى `/app`.
- الإلغاء أو الفشل يبقي المستخدم في سياقه ويتيح المحاولة مجددًا.

## 4. تدفق guest migration الذي رُوجع

المسار السابق كان يستطيع الاعتماد على marker قديم أو cache حساب، ما يهدد بإسقاط snapshot ضيف أحدث. العقد النهائي أصبح:

1. التقاط snapshot الضيف قبل أن يبدّل Auth مساحة البيانات.
2. اعتبار الكلمات، كلمات العوالم الخاصة، SRS/mastery، quiz session، custom worlds، pending world drafts، وprofile progress بيانات meaningful.
3. طلب قرار صريح عند وجود تلك البيانات، حتى إن غاب dirty marker الحديث أو وُجد marker ترحيل قديم.
4. عند القبول: كتابة بيانات التعلم أولًا، وحفظ profile backup مرتبطًا بـUID، ثم التنظيف فقط بعد نجاح مسارات الحفظ/الاسترداد المطلوبة.
5. إذا كان للحساب quiz معلّق، يبقى هو المصدر الأساسي وتُؤرشف جلسة الضيف بدل إتلافها.
6. فشل حفظ profile لا يمسح backup؛ تعاد المحاولة بعد refresh ويُزال فقط بعد نجاح الحفظ.
7. إنشاء بيانات ضيف جديدة بعد ترحيل سابق يعيد فتح قرار الترحيل بدل إعادة استخدام promise/marker قديم.

## 5. تمييز الجديد من العائد

رفض التدقيق الشرط السطحي `!onboarding.completed`. التصنيف المركزي في [entry-experience-contract.js](../js/entry-experience-contract.js) يجمع:

- الكلمات الشخصية والمحلية، بما فيها hidden/mastered.
- سجل SRS/mastery.
- XP وactivity وstreaks وquiz history وloot/titles.
- quiz session القابلة للاستئناف.
- active Journey ووجهتها وتقدم World/Gate/Rank وcompletion ledgers.
- profile موجود أو فشل قراءته بصورة محافظة.
- custom worlds وdrafts المحلية.
- المظهر أو الاهتمامات الموجودة.
- مؤشرات first-run القديمة للضيف فقط.
- `creationTime` و`lastSignInTime` من Firebase Auth.

الحساب لا يُعد جديدًا إلا إذا كانت creation/first-sign-in pair موثوقة وعمره في نافذة 30 دقيقة ولا توجد أي إشارة استعمال. تاريخ build المصدّر معلوماتي، وليس cutoff يقرر وحده أن الحساب جديد. فشل قراءة profile أو mastery يعامل الحالة بصورة محافظة كحساب موجود، لا كحساب فارغ.

## 6. نظام المسارات

- Vercel: `/` → `landing.html`، و`/app` و`/app/*` → `index.html`، و`/privacy` → `privacy.html`.
- Router داخل التطبيق يحافظ على `/app` كقاعدة على Vercel، ويستمر في دعم قاعدة مستودع GitHub Pages.
- [404.html](../404.html) يستعيد deep links على GitHub Pages مباشرة إلى التطبيق ولا يمررها عبر Landing.
- الخادم المحلي في [static-server.mjs](../tools/static-server.mjs) يحاكي هذه الدلالة للاختبارات.

## 7. التعارضات التي حُسمت

| التعارض | الحسم |
|---|---|
| Auth غير محسوم مقابل guest Entry | Entry ينتظر Auth والبيانات الأولية وJourney والمهاجرة |
| بيانات قديمة بلا Entry doc | تصنيف متعدد الإشارات في الذاكرة؛ لا backfill ولا write أثناء render |
| guest draft مقابل account draft | terminal account يحكم؛ وإلا يُحفظ أبعد step وتُدمج الاهتمامات ويحكم الاختيار الصريح للمظهر |
| intent حساب قديم مقابل intent ضيف أحدث | العملية نفسها تحترم terminal idempotency؛ العمليات المختلفة تختار أحدث intent صالح |
| Journey session مقابل quiz عام | وجهة Journey النشطة أولًا، ثم quiz القابل للاستئناف، ثم Journey |
| Entry مقابل guest migration | الترحيل يُحسم أولًا، ولا يتراكبان بصريًا |
| Entry مقابل toast/رسائل أول دخول | تؤجل الرسائل غير الحرجة ويُفرج عن preview واحد بعد الإغلاق |
| Entry مقابل اختصارات الخلفية | الاختصارات تتوقف أثناء Entry أو auth prompt؛ الخلفية inert |
| ثيم قديم مقابل اختيار Entry | يحفظ baseline ولا يطبق تغييرًا إلا بعد اختيار صريح مؤكد |
| عالم legacy بلا تصنيف | يبقى مقروءًا كـ`unknown` دون backfill أو ادعاء توصية |
| Level Placement قبل اختيار عالم | لا تُخترع أهلية عالمية؛ يظهر داخل عقد العالم المؤهل فقط |

## 8. قيود التنفيذ المؤكدة

- لا deploy ولا commit ولا كتابة إنتاج.
- لا Cloud Functions أو triggers أو callable جديدة.
- لا تغيير في `firestore.indexes.json`.
- لا XP أو streak أو SRS أو Journey mutation من Entry.
- Entry classification مخصص للـUI والcopy والـCTA فقط، وليس للصلاحيات أو التقدم.

