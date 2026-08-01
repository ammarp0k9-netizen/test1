# التقرير النهائي — Product Entry Experience

التاريخ: 2026-08-01  
الحالة: مكتمل محليًا وجاهز لمرحلة Firebase/Vercel staging، وليس منشورًا.

## الخلاصة التنفيذية

أصبح لـLootLingua مسار دخول واحد مترابط:

`Landing /` → دخول Google أو متابعة كضيف → `/app` → حسم Auth والبيانات والترحيل → Entry Experience v1 → اهتمامات أو تخطٍ → اختيار/حفظ المظهر → CTA مشتق من التقدم الحقيقي.

المستخدم القديم لا يُصنف جديدًا بسبب غياب حقل onboarding. تظهر له نسخة «أهلًا بعودتك» مرة واحدة للإصدار الأول، وتحترم الكلمات وJourney وSRS والجلسات والمظهر. الضيف القديم يحتفظ بمساحته المحلية، ولا يُطلب منه حساب إلا عند فعل يحتاج Journey محفوظة. لا تمنح Entry أي XP أو صلاحية، ولا تعدل destination أو progress أو completion ledgers.

## 1. المعمارية النهائية للمسارات

| الرابط | المستند | السلوك |
|---|---|---|
| `/` | `landing.html` | Landing عامة RTL، خفيفة ومستقلة عن shell التطبيق |
| `/app` | `index.html` | التطبيق الفعلي |
| `/app/*` | `index.html` | deep links وrefresh داخل التطبيق |
| `/privacy` | `privacy.html` | صفحة الخصوصية الموجودة |
| GitHub Pages | `404.html` | استرجاع deep link إلى app document مع base path المستودع |

[vercel.json](../vercel.json) يعرّف rewrites دون نقل `index.html`. Router في التطبيق يبني المسارات انطلاقًا من `/app` على Vercel ومن base path المشروع على GitHub Pages. الخادم المحلي يحاكي هذا العقد، واختبار routing تحقق من `/` و`/app` وdeep links والـassets وعدم الحلقة.

## 2. Auth من Landing وداخل App

- Landing والتطبيق يستخدمان مشروع Firebase نفسه وGoogle provider نفسه.
- Firebase Auth session، لا localStorage، هي مصدر حقيقة تسجيل الدخول.
- popup هو المسار المعتاد، وredirect هو مسار iOS، مع `getRedirectResult` واستعادة حالة الانتظار.
- المستخدم المسجل مسبقًا ينتقل من Landing إلى `/app` بلا مطالبة ثانية.
- التطبيق ينتظر `onAuthStateChanged` وSmart Loading قبل التصنيف، ويلغي listeners الحساب السابق عند account switch.
- إلغاء popup أو فشله يعيد الزر إلى حالة قابلة للمحاولة ولا يمس Entry draft أو pending intent.
- كل عملية async الحساسة تقارن UID/auth generation حتى لا تُطبق نتيجة حساب قديم بعد تبديل الحساب.

## 3. state machine لحالات المستخدم

المحور التخزيني مستقل عن التصنيف:

- الإصدار: `experienceVersion = 1` و`contractVersion = 1`.
- الحالة: `in-progress | completed | skipped`.
- الخطوة: `interests | theme | action`.
- جمهور أول عرض: `new | returning | returning-guest`.
- التصنيف: `brand-new | returning-with-progress | returning-light | returning-guest-with-local-data | existing-account-without-meaningful-progress`.

الحالات التشغيلية المطلوبة تُركّب من Auth + owner namespace + Entry state + learning signals:

| الحالة التشغيلية | التمثيل |
|---|---|
| زائر Landing مجهول/مسجل | `onAuthStateChanged` في Landing يغير CTA فقط |
| ضيف جديد/عائد | owner=`guest` + تصنيف الإشارات المحلية |
| حساب جديد/قديم | owner=`user:<uid>` + Auth metadata + البيانات المحملة |
| draft ضيف/حساب | `status=in-progress` و`currentStep` محفوظان |
| ترحيل جارٍ | Entry ينتظر `prepareGuestMigrationForUser` |
| Journey موجودة/غير موجودة | `LootLinguaJourneyCloud` وdestination resolver |
| interests skipped | `interestsStatus=skipped` ثم `theme` |
| completed/skipped | terminal؛ v1 لا تظهر ثانية |
| account switch/second-tab auth | auth generation جديدة ومساحة UID مستقلة |
| reset progress | لا يحذف Entry terminal أو interests أو theme intro history |

## 4. اكتشاف المستخدم الحالي ومنع false-new

التصنيف المركزي لا ينظر إلى `onboarding.completed`. يجمع الإشارات التالية:

- كلمات الحساب أو الضيف، بما فيها hidden/mastered والمنقولة إلى private world.
- حقول SRS في الكلمات ومستند mastery وعدد مدخلاته.
- XP، activity، streaks، quiz history، added game words، loot، titles، وعدادات النشاط.
- active/resumable quiz session.
- active Journey، أي Journey progress، ووجهة resolver الحالية.
- World/Gate/Rank أو completion signals عندما توفرها العقود الحالية.
- profile موجود، تخصيص theme/interest، custom worlds، وdraft محلي.
- مؤشرات first-run القديمة للضيف فقط.
- Firebase Auth `creationTime` و`lastSignInTime`.

الحساب لا يصبح `brand-new` إلا عندما تكون creation/first-sign-in pair موثوقة، وعمر الحساب لا يتجاوز 30 دقيقة، ولا توجد أي إشارة استخدام. الحساب الأقدم، أو profile الموجود، أو فشل قراءة بيانات التعلم يصنف بصورة محافظة كحساب موجود. تاريخ الإصدار موجود كمعلومة عقدية فقط ولا يُستخدم كـcutoff وحيد، لذلك لا يتوقف القرار على معرفة يوم النشر مسبقًا.

## 5. Entry schema

المستند الكامل يحوي فقط:

`contractVersion`, `experienceVersion`, `status`, `audience`, `classification`, `currentStep`, `interestsStatus`, `interestIds`, `themeStatus`, `themeId`, `oasisMode`, `themeExplicit`, `source`, `startedAt`, `updatedAt`, `completedAt`, `skippedAt`.

- `completedAt` يوجد فقط مع `completed`، و`skippedAt` فقط مع `skipped`.
- `themeExplicit=false` يحمي المظهر القديم من التطبيق العرضي.
- `source` محصور في `app-entry | guest-migration | settings`.
- تحديث settings لا يعيد terminal state إلى `in-progress` ولا يغير timestamp الحسم الأصلي.

## 6. عقد source of truth المحلي/السحابي

| الهوية | المصدر الدائم | cache/استرداد |
|---|---|---|
| ضيف | `localStorage` بالمفتاح `lootlingua:entry-experience:v1:guest` | نفس مساحة الضيف |
| حساب | `users/{uid}/entryExperiences/v1` | cache محلي `...:user:<uid>` |
| Theme/Oasis | profile للحساب أو owner-scoped local للضيف | مفاتيح legacy العامة للتهيئة المتوافقة فقط |

عند boot للحساب تُقرأ v1 مرة واحدة. لا يُكتب مستند لمجرد أن التصنيف اكتشف مستخدمًا قديمًا، ولا يوجد backfill. الكتابة السحابية تتم فقط عند checkpoint صريح: متابعة خطوة، skip مؤكد، completion، أو save من الإعدادات. اختيار بطاقة يحدث محليًا ولا ينشئ cloud write لكل نقرة.

## 7. عقد guest → account merge

ترتيب الدمج:

1. التقاط snapshot الضيف قبل تغير مساحة Auth.
2. حسم قرار guest migration قبل عرض Entry.
3. رفع الكلمات وSRS/mastery وcustom worlds وpending drafts والـquiz القابل للحفظ قبل purge.
4. حفظ profile recovery backup مقيدًا بالحساب قبل purge.
5. دمج Entry: terminal account يحكم؛ وإلا يحفظ أبعد خطوة، يجمع الاهتمامات، ويحترم المظهر الصريح.
6. حذف Entry guest فقط بعد نجاح حفظ النسخة الحسابية.
7. حذف profile backup فقط بعد نجاح save السحابي؛ الفشل يبقيه للـrefresh التالي.

الحساب الذي يملك quiz معلقة يحتفظ بها كأولوية، وتُحفظ جلسة الضيف في archive حسابي للاسترداد بدل overwrite. markers القديمة لا تبرر حذف snapshot meaningful، وبيانات ضيف جديدة بعد ترحيل سابق تعيد فتح قرار الترحيل.

## 8. pendingIntent

العقد versioned ومقيد بالمالك، وحقوله allowlisted:

- action من مجموعة Journey/Placement المعروفة فقط.
- `worldId` و`operationId` محدودان ومنظفان.
- `cefrLevel` إلزامي فقط لمسار Level Placement.
- `returnTo` يجب أن يكون مسارًا داخليًا؛ أي قيمة غير آمنة تصبح `/app`.
- العمر الأقصى 24 ساعة.
- الحالات: `pending | consuming | consumed | cancelled`.

بعد Auth ينتظر التنفيذ الترحيل وEntry resolution، يعيد قراءة العالم المنشور، ويتحقق من Journey القائمة ثم ينفذ عبر `LootLinguaJourneyEntryActions` بدل مسار تقدم جديد.

## 9. idempotency ومنع Journey مزدوجة

- `operationId` ثابت للعملية نفسها.
- Web Locks تمنع التنفيذ المتوازي عندما تكون متاحة، مع lease محلي كـfallback.
- marker consumed مقيد بالحساب يمنع replay بعد refresh.
- terminal intent للعملية نفسها يحكم على النسختين guest/account.
- terminal intent قديم لعملية مختلفة لا يستطيع إسقاط intent ضيف أحدث.
- revalidation لعالم منشور وJourney حالية تتم قبل الاستهلاك.
- عقود Journey المركزية/transactions هي وحدها التي تبدأ أو تستأنف التقدم.

## 10. عقد الاهتمامات والتصنيف

المعرفات المركزية الثابتة في Entry وContent Schema هي:

`games`, `movies`, `study`, `general`, `technology`, `travel`.

الاختيار متعدد. Continue يبقى disabled بلا اختيار، وإزالة آخر اختيار تعيده disabled. Skip interests يحفظ `skipped` وينقل إلى theme ولا ينهي التجربة. يمكن تعديل الاهتمامات لاحقًا من الإعدادات.

## 11. Admin world classification

- محرر العالم يعرض `primaryInterest` واختيارات `interestTags` من العقد المركزي نفسه.
- create/edit/publish تمرر الحقول عبر schema cleaner واحد.
- القيم غير المعروفة تُرفض، والتكرار والعدد يضبطان مركزيًا.
- الكتابة تبقى خلف claim Admin والعقود السحابية الحالية؛ المستخدم العادي لا يستطيع تغيير التصنيف.
- عالم production قديم بلا الحقول يقرأ `unknown` ولا يُكتب له backfill.

## 12. سلوك التوصية، بما فيه عالم واحد

التوصية exact فقط إذا طابق `primaryInterest` أو عنصرًا من `interestTags` أحد اهتمامات المستخدم. البطاقة تعرض «مقترح حسب اهتماماتك». إذا لم توجد مطابقة، أو كان العالم legacy/غير مصنف، يبقى ظاهرًا ويعرض «متاح حاليًا» من دون ادعاء. لا يحدث sort أو filter أو تغيير progress، ولذلك تعمل الحالة نفسها مع عالم واحد.

## 13. معمارية الثيم

- سلطة التطبيق بقيت `setTheme/loadTheme` بدل إنشاء theme engine موازٍ.
- Entry v1 يتيح `lootlingua` و`ocean` فقط.
- ثيمات `golden`, `scroll`, `glass` قابلة للحفظ للمستخدم القديم لكنها ليست اختيارات جديدة في Entry.
- preview داخل Entry draft ولا يغير المظهر الفعلي. التطبيق يتم بعد اختيار صريح وإكمال مؤكد.
- full skip للعائد يحافظ على baseline ولا يغير theme أو Oasis mode.
- المفاتيح owner-scoped تمنع تسرب ثيم حساب إلى حساب آخر بعد حسم Auth.

## 14. Oasis dark mode

أضيفت tokens وحالات dark لواحة الهدوء، مع `data-oasis-mode=light|dark`. زر الوضع يظهر في إعدادات الملف فقط عندما يكون theme الحالي `ocean`. تغيير light↔dark لا يعد Theme جديدًا ولا يعيد intro.

## 15. تحسين Oasis light

ضُبطت الخلفيات والأسطح والحدود وحالات البطاقات والأزرار وEntry shell لتظل القراءة والتسلسل البصري واضحين في الوضع الفاتح، مع الحفاظ على هوية واحة الهدوء وعدم إعادة تصميم بقية التطبيق.

## 16. theme intro مرة واحدة

- القرار pure عبر `resolveThemeIntro`.
- السجل محلي ومقيد بالمالك والثيم، ويُدمج مع `profile.themeIntroSeen` للحساب.
- أول تفعيل صريح يعرض الرسالة مرة، وrefresh لا يعيدها.
- A → B → A لا يعيد رسالة A.
- Oasis light ↔ dark لا يعيد رسالة Ocean.
- إذا فشل profile save، يبقى السجل المحلي مانعًا للتكرار على الجهاز ويُعاد sync لاحقًا. قد تتكرر الرسالة على جهاز آخر قبل نجاح المزامنة؛ هذا fallback موثق وليس ادعاء once-only سحابي أثناء انقطاع دائم.

## 17. الأنظمة القديمة التي أزيلت

أزيلت `welcomeModal`، الجولة المبنية على `ONBOARDING_STEPS`، empty onboarding، replay UI، DOM/CSS/listeners/timers والhooks التي كانت تشغلها من القاموس وXP. بقيت المفاتيح الثلاثة التاريخية للقراءة فقط حتى تمنع false-new للضيف القديم.

## 18. orchestration لرسائل أول دخول

- Entry ينتظر guest migration ولا يتراكب معها.
- Entry أعلى من app dialogs المعتادة وأدنى من Smart Loading النظامي.
- الخلفية inert وscroll locked، والاختصارات تتوقف.
- toast غير الحرج يؤجل أثناء Entry؛ بعد الإغلاق يظهر preview واحد وتبقى التفاصيل في Notification Center.
- daily chest لا يفتح تلقائيًا؛ يحتاج فعل المستخدم.
- رسالة performance تمر عبر سياسة التأجيل نفسها.
- بعد الإكمال يوجد CTA أساسي واحد، مع secondary فقط عندما يقرره العقد المركزي.

## 19. قرارات mobile responsive

- Landing وEntry mobile-first وRTL.
- shell يستخدم `100dvh` وsafe-area insets.
- الشبكة عمود واحد في العرض الشديد الضيق وعمودان فقط عندما تسمح القراءة.
- محتوى panel يملك scroll داخليًا في الارتفاع القصير، ولا تغطي أزرار footer البطاقات.
- CTA في header يصغر نصه عند العرض الضيق من دون إخفاء خيار الدخول أو البدء.

## 20. Accessibility

- `role=dialog`, `aria-modal`, عنوان مرتبط، وlive status.
- focus trap، واستعادة focus، ونقل التركيز إلى H1 عند تبديل الخطوة.
- الخلفية `inert` و`aria-hidden` أثناء Entry/auth prompt.
- بطاقات الثيم تتصرف كـradio مع roving tabindex وأسهم لوحة المفاتيح.
- focus visible، touch targets، RTL، ودعم `prefers-reduced-motion`.
- Escape في auth prompt يلغي الطلب ويحفظ الحالة؛ Entry نفسها لا تفقد draft عبر Escape.

## 21. Firestore reads/writes المضافة

### Reads

- `getDoc(users/{uid}/entryExperiences/v1)` مرة واحدة في boot الحساب.
- Entry يستهلك snapshots الكلمات/profile/mastery الأولية، ويستدعي عقود Journey والـquiz الحالية لاشتقاق CTA؛ لا توجد قراءة في كل render.
- Worlds يعيد استخدام cache القراءة الموجود عند تغير اهتمامات Entry.

### Writes

- `setDoc` كامل إلى Entry v1 عند تفاعل checkpoint صريح فقط.
- profile save الحالي يضم `oasisMode` و`themeIntroSeen`.
- Admin world writes الحالية تضم `primaryInterest` و`interestTags`.
- guest migration يكتب بياناته فقط بعد قبول صريح، وبترتيب upload-before-purge.

لا polling، ولا auth listener مكرر، ولا draft cloud write لكل بطاقة، ولا backfill جماعي.

## 22. تغييرات Security Rules

- owner-only read/create/update لـ`users/{uid}/entryExperiences/v1`، ومنع delete.
- whitelist كامل للحقول والقيم والأحجام.
- terminal monotonic: `completed` يبقى completed و`skipped` يبقى skipped، مع ثبات audience/classification/startedAt وتواريخ الحسم.
- profile whitelist توسع فقط بـ`oasisMode` و`themeIntroSeen` مع validation.
- world classification تقبل المعرفات الستة فقط وتبقى كتابة Admin-only.
- الاختبارات على Firestore emulator: 77/77.

## 23. schema/index/migration

- Schema جديد: Entry v1، وحقلا تصنيف العالم، وحقلا profile للمظهر/intro.
- لا تعديل في `firestore.indexes.json`؛ لا index جديد مطلوب.
- لا backfill ولا batch migration لبيانات الإنتاج.
- migration lazy وتفاعلي للضيف فقط؛ اكتشاف مستخدم قديم لا يكتب أي شيء.
- `RELEASE_AT` ليس قرار migration ولا cutoff وحيدًا.

## 24. الملفات

### جديدة

- `landing.html`, `landing.css`, `js/landing.js`
- `entry-experience.css`
- `js/entry-experience-contract.js`
- `js/entry-experience-cloud.js`
- `js/entry-experience-controller.js`
- `tests/entry-experience-contract.test.mjs`
- `tests/entry-experience-integration-static.test.mjs`
- `tests/entry-readiness-orchestration-static.test.mjs`
- `tests/guest-entry-migration-static.test.mjs`
- `tests/landing-routing.test.mjs`
- `tests/legacy-entry-removal-static.test.mjs`
- `tests/world-interest-recommendations.test.mjs`
- `tests/fixtures/entry-experience-legacy-fixtures.mjs`
- `reports/product-entry-audit.md`
- `reports/product-entry-final.md`

### معدلة

- Shell/routing/styles: `404.html`, `index.html`, `style.css`, `vercel.json`.
- Runtime/Auth/data: `js/cloud.js`, `js/core-runtime.js`, `js/core.js`, `js/dictionary-render.js`, `js/dictionary.js`, `js/journey-cloud.js`, `js/profile-cloud.js`, `js/quiz.js`, `js/script.js`, `js/srs.js`, `js/storage.js`, `js/worlds.js`, `js/xp.js`.
- Content/Admin: `js/content-schema.js`, `js/admin.js`, `js/admin-cloud.js`, `js/published-content.js`.
- Security/build: `firestore.rules`, `package.json`.
- Existing tests: `tests/admin-claim-state.test.mjs`, `tests/admin-cloud-api-static.test.mjs`, `tests/admin-cloud-rank-behavior.test.mjs`, `tests/admin-ui-static.test.mjs`, `tests/content-schema.test.mjs`, `tests/firestore-rules.test.mjs`, `tests/protected-contracts.test.mjs`, `tests/published-content-static.test.mjs`.
- Browser/local tools: `tools/admin-gate-browser-smoke.mjs`, `tools/admin-rank-browser-smoke.mjs`, `tools/browser-smoke.mjs`, `tools/gate-mastery-browser-smoke.mjs`, `tools/static-server.mjs`.

### محذوفة

لا توجد ملفات محذوفة. أزيلت الأنظمة القديمة من الملفات القائمة.

## 25. نتائج الاختبارات

كل النتائج التالية ناجحة على الشجرة النهائية أو بعد آخر تعديل في الملف المعني. الحزم تتداخل، لذلك لا يُجمع عددها كعدد اختبارات فريد:

| الأمر/الحزمة | النتيجة |
|---|---:|
| `test:entry:contract` | 26/26 |
| `test:entry:integration` | 23/23 |
| `test:landing` | 5/5 |
| `test:contracts` | 14/14 |
| `test:admin` | 84/84 |
| `test:published` | 24/24 |
| `test:journey` | 61/61 |
| `test:quiz` | 6/6 |
| `test:srs` | 2/2 |
| `test:performance` | 7/7 |
| `test:dictionary` | 4/4 |
| `test:placement` | 11/11 |
| `test:level-placement` | 35/35 |
| `test:level-placement-journey` | 75/75 |
| `test:journey-integration` | 16/16 |
| `test:new-ranks` | 16/16 |
| `test:word-lifecycle` | 14/14 |
| `test:collection-membership` | 7/7 |
| `test:evidence` | 7/7 |
| `test:gate-readiness` | 12/12 |
| `test:gate-clear` | 6/6 |
| `test:rank-completion` | 8/8 |
| `test:world-completion` | 24/24 |
| Firestore Rules emulator | 77/77 |
| `functions` check | ناجح |
| `functions` tests | 60/60 |
| syntax لكل JS/MJS المتغير | 42 ملفًا ناجحًا |
| `git diff --check` | ناجح؛ تحذيرات line-ending فقط |

التحذيران اللذان ظهرا في Level Placement هما حالات retry متوقعة داخل الاختبارات، لا إخفاقات.

## 26. Browser smoke evidence

نُفذ Chromium headless فعليًا عبر CDP على الخادم المحلي، وليس unit logic فقط. تم التحقق من:

- Landing على `/` والتطبيق وdeep link `/app/dictionary`.
- عدم وجود legacy onboarding/welcome UI.
- Entry interests غير محددة ثم محددة، Continue state، والانتقال إلى theme.
- تنقل focus بين العناوين والبطاقات وroving radio.
- theme preview يبقى draft حتى التأكيد.
- auth prompt: focus trap وخلفية inert، والإلغاء يحفظ pending state.
- 320×568 بلا overflow أفقي.
- 568×320 landscape مع scroll داخلي صالح.
- تكبير النص 200% بلا overflow أفقي.
- reduced motion يلغي animations/transitions الخاصة بالتجربة.
- لا `Runtime.exceptionThrown` أثناء السيناريوهات المحلية.

قياس HTTP محلي تشخيصي، 25 طلبًا متتابعًا لكل مسار، بلا CDN أو Firebase:

| المورد | الحجم | median | p95 |
|---|---:|---:|---:|
| `/` | 14,324 B | 3.03 ms | 8.19 ms |
| `/app` | 74,005 B | 3.22 ms | 6.44 ms |
| `/app/dictionary` | 74,005 B | 2.22 ms | 4.37 ms |
| `landing.css` | 19,016 B | 1.71 ms | 3.18 ms |
| `entry-experience.css` | 16,623 B | 1.82 ms | 4.38 ms |

هذه أرقام local server الخام وليست Web Vitals أو زمن Auth في الإنتاج.

## 27. ما لم يُختبر فعليًا

تعذر إجراء E2E حي يعتمد على Firebase لأن تحميل CDN/Firebase الخارجي لم يكن متاحًا في بيئة الفحص المحلية. لذلك لم يُثبت في staging بعد:

- Google popup/redirect الحقيقي، بما فيه iOS.
- حسابان حقيقيان على الجهاز نفسه، وauth change من تبويب ثانٍ.
- refresh/logout/login مع Entry doc حقيقي في Firestore.
- guest → account migration حي للكلمات وSRS والـquiz وcustom worlds مع فشل شبكة حقيقي.
- pending Journey بعد Auth حي، double-click عبر تبويبين، أو world يُلغى نشره أثناء Auth.
- Admin write/publish حي وتصنيف عالم حقيقي.
- مزامنة theme intro بين جهازين أثناء failure دائم.
- مقاسات 360×640 و390×844 و412×915 وtablet كجلسات مصورة مستقلة؛ الكود responsive لكن smoke الفعلي ركز على 320×568 وlandscape و200%.
- Web Vitals وزمن auth resolution/account switch على Vercel Preview.

ظهر طلب asset شبيه favicon بحالة 404 في الفحص المحلي، دون runtime exception أو أثر على المسار. يستحسن حسم favicon في Preview إن ظهر في Network panel.

## 28. المخاطر المتبقية وبوابات الإطلاق

1. يلزم Firebase staging بمستخدم جديد، حساب قديم، ضيف قديم، وحسابين منفصلين قبل production.
2. التزامن عبر تبويبين يعتمد على Web Locks حيث تتوفر وعلى lease/idempotent Journey contracts كـfallback؛ يجب اختباره في المتصفحات المستهدفة.
3. المظهر العام يملك مفتاح legacy مبكرًا لتفادي flash قبل Auth؛ Smart Loading يخفي shell حتى تحميل profile، لكن يجب فحص no-wrong-theme-flash على شبكة بطيئة في Preview.
4. Level Placement أهلية مرتبطة بعالم ورُتبه وبواباته؛ لم تُخترع `placementEligible` عامة. يظهر الاقتراح من داخل العالم المؤهل فقط.
5. theme intro قد يتكرر على جهاز ثانٍ إذا فشل sync السحابي طويلًا، مع منع التكرار محليًا.
6. لا توجد قياسات production performance بعد؛ يجب تسجيل Landing LCP وapp auth resolution وEntry open وaccount switch في Preview.

## 29. أوامر النشر المطلوبة — لم تُنفذ

التسلسل المقترح بعد نجاح staging:

```powershell
# تحقق محلي أخير
npm.cmd run test:entry:contract
npm.cmd run test:entry:integration
npm.cmd run test:landing
npm.cmd run test:rules

# نشر Rules فقط إلى مشروع staging أولًا
firebase deploy --only firestore:rules --project <STAGING_PROJECT_ID>

# Vercel Preview واختبارات E2E عليه
vercel

# بعد الموافقة ونشر Rules إلى المشروع الفعلي
firebase deploy --only firestore:rules --project <PRODUCTION_PROJECT_ID>
vercel --prod
```

لا يوجد أمر لنشر indexes أو Functions لأنهما لم يتغيرا. ينبغي استبدال project IDs صراحة وعدم استخدام default project على نحو أعمى.

## 30. إثبات عدم إضافة Functions أو Blaze

- `git diff -- functions` فارغ.
- `git diff -- firestore.indexes.json` فارغ.
- لا callable أو trigger أو dependency تشغيلية جديدة.
- فحوص Functions الحالية نجحت و60/60 اختبارًا مرت.
- التنفيذ Client + Firebase Auth + Firestore + Security Rules فقط؛ لا يتطلب Blaze أو بطاقة دفع.

## تغطية بيانات الإنتاج القديمة المطلوبة

| # | fixture/السيناريو الفعلي | ما ثَبُت |
|---:|---|---|
| 1 | حساب كلمات + XP بلا Journey | `returning-with-progress`، CTA «راجع كلماتك» |
| 2 | حساب active Journey | Journey محفوظة، CTA «تابع رحلتك» |
| 3 | hidden/mastered + SRS | يعد تقدمًا، ولا يظهر «أضف أول كلمة» |
| 4 | quiz معلقة | CTA «أكمل جلستك» قبل Journey العامة |
| 5 | ثيم واحة الهدوء | `returning-light`، Ocean محفوظ ولا يطبق تغيير قبل اختيار صريح |
| 6 | حساب بلا حقول onboarding/Entry | حساب عائد، لا false-new؛ البداية الفارغة فقط إن لم توجد بيانات meaningful فعلًا |
| 7 | ضيف قديم بكلمات محلية | `returning-guest-with-local-data`، CTA مراجعة الكلمات |
| 8 | ضيف draft + session محلية | استعادة خطوة theme وCTA استئناف الجلسة |
| 9 | عائد يكمل ثم refresh | `completed` terminal وv1 لا تظهر ثانية |
| 10 | عائد يتخطى ثم logout/login | `skipped` terminal يبقى للحساب ولا يغير الاهتمامات/الثيم |
| 11 | حسابان على جهاز | مفاتيح `user:<uid>` مستقلة وterminal لكل حساب منفصل |
| 12 | guest قديم ثم login/migration | draft وpreferences وlearning snapshot تنتقل قبل purge |
| 13 | CTA لا يناقض البيانات | فحص آلي لجميع fixtures + `ctaContradictsSignals` |
| 14 | لا فقد أو overwrite | immutability في العقد + upload-before-purge + profile recovery/quiz archive |
| 15 | Entry v1 لا تظهر مرتين | terminal normalization + Rules monotonic + owner-scoped persistence |

السيناريوهات 1–15 مغطاة بعقود/fixtures واختبارات integration ساكنة. السيناريوهات 9–12 و14 تحتاج كذلك إعادة تنفيذ E2E على Firebase staging لإثبات دورة الشبكة الحقيقية، كما هو موضح في قسم «ما لم يُختبر فعليًا».

