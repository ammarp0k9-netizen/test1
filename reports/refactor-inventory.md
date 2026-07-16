# خريطة LootLingua قبل الفصل

هذا التقرير هو Inventory المرحلة A. المرجع الآلي التفصيلي للعقود موجود في `refactor-baseline.json`.

## ملفات التشغيل الفعلية

- `index.html`: HTML، bootstrap مبكر للمسار، Google Analytics، وحدتا Firebase inline، وروابط Tesseract و`script.js`.
- `script.js`: التطبيق الكلاسيكي الكامل (الحالة، الواجهة، التخزين، XP، SRS، القواميس، العوالم، الاختبارات، الصندوق، التهيئة).
- `style.css`: التصميم الكامل؛ خارج نطاق الفصل.
- `تجارب/index.js`: ملف تجربة غير محمّل من `index.html`، لذلك ليس جزءًا من runtime.
- `النسخة القديمة 1.0.0/*`: أرشيف قديم غير محمّل، ولا يُعدّل.

## ترتيب التنفيذ الحالي الحساس

ترتيب الوسوم في المستند:

1. bootstrap routing كلاسيكي inline في `<head>`.
2. Google Analytics async وbootstrap الخاص به.
3. Firebase/Auth/Firestore module inline.
4. Firebase profile sync module inline.
5. Tesseract classic external.
6. `script.js` classic.

ملاحظة توقيت: وحدات `type="module"` مؤجلة حتى انتهاء parsing، بينما `script.js` الكلاسيكي في نهاية الصفحة ينفذ عند الوصول إليه. لذلك تتوفر واجهات `script.js` قبل callbacks الخاصة بـFirebase. يجب إبقاء هذه الخاصية بعد النقل. كما أن profile module يعتمد على `getApps()[0]` من الوحدة الأولى، لذلك يجب إبقاء ترتيب وحدتي السحابة.

## الأنظمة والحالة والاعتمادات

### Core / UI shell

- Smart loading overlay، performance mode، notifications، profile modal، daily quests، routing، modal/toast helpers، onboarding، initialization، keyboard shortcuts.
- الحالة المشتركة الأهم: `currentView`, `isInitialLoad`, `userXP`, `dailyStreak`, `customWorlds`, `activeCustomWorldId`, quiz runtime state.
- يعتمد على DOM كامل وعلى storage helpers. يستدعي أنظمة dictionary/worlds/quiz عبر دوال العرض العامة.
- واجهات HTML البارزة: `toggleProfileModal`, `toggleNotificationsPanel`, `toggleDailyQuestsSheet`, `goBackFromSubView`, `showModal`, `hideModal`.

### Local storage / guest migration

- المفاتيح والـprefixes، قراءة/كتابة كلمات الضيف والمستخدم، custom worlds cache، pending custom-world sync، active dictionary scope، profile serialization، guest migration المحلية.
- الدوال الأساسية: `getWordsStorageKey`, `readWordsFromStorage`, `writeWordsToStorage`, `readCustomWorldsFromStorage`, `writeCustomWorldsToStorage`, `readCustomWorldWordsFromStorage`, `writeCustomWorldWordsToStorage`, `loadInt`, `saveInt`, `loadJSON`, `saveJSON`.
- يعتمد على `window.auth?.currentUser` لتحديد scope، وعلى cloud bridge لإعادة المحاولة، وعلى dictionary/world state عند تطبيق snapshots.
- لا يجوز إنشاء نسخة جديدة من `window.words` أو `customWorlds`.

### Firebase / cloud

- Firebase config وتهيئة وحيدة لـapp/auth/db.
- Auth redirect/popup، `onAuthStateChanged` الرئيسي، personal words listener، custom worlds listener، custom-world words listener، mastery snapshot، quiz resume document، global AI cache، suggestions، profile sync.
- Firestore contracts المثبتة آليًا: `users/{uid}/words`, `users/{uid}/customWorlds`, nested world words، `meta/profile`, `meta/active_quiz_session`, `meta/word_mastery`, XP event documents، AI cache، `suggestions`.
- يعتمد من module إلى classic عبر `window.*`: تحميل guest state، تطبيق snapshots، migration، initial-loading gates، pending retries، profile merge/reset.
- يعتمد classic إلى module عبر `window.*`: save/update/delete words/worlds، XP claim، quiz session cloud، profile save، AI cache.

### XP / profile economy

- `XP_ECONOMY_VERSION = 2` وقيم الانتقال المثبتة `2/4/8/3`.
- الدوال الأساسية: `awardXP`, `claimXPEventInCloud` bridge، pending XP retry، dedup log، `applyXPDelta`, rank/theme unlock rendering، streak/daily goal/profile payload.
- يعتمد على storage وcloud/profile UI. لا يمنح XP من الإضافة أو flashcards؛ منح الانتقالات يتم من commit الاختبار الموثق.

### SRS / mastery queue

- الحالات: `New`, `Learning`, `Reviewing`, `Mastered`.
- الدوال الأساسية: mastery state normalization/storage، exposure history، due scoring، backlog، quotas، balanced deck، `computeSrsUpdate`, transition XP handoff.
- يعتمد على storage وdictionary source access وXP API. لا يحتاج إلى استيراد quiz عكسي؛ quiz هو المستهلك.

### Personal dictionary

- إضافة/تعديل/حذف/نجمة/صوت، search/filter/sort، reorder، bulk selection، render virtualization، AI suggestions، OCR word hunter، import/export.
- الحالة: `window.words`, edit/reorder/selection state، sort prefs، virtual-render state.
- يعتمد على storage، cloud bridges، profile/quest notifications، shared mastery helpers.
- واجهات HTML موجودة في baseline وتشمل `addWord`, `render`, `fetchSuggestions`, `setDictionarySortMode`, `enterSelectionMode`, `confirmBulkDeleteSelection`, `exportData`, `importData`.

### Worlds and game dictionaries

- built-in Minecraft/PUBG views، worlds list، custom-world CRUD، word move/copy، world selection management، starred view، treasure/world route shell.
- الحالة: `customWorlds`, `activeCustomWorldId`, `currentGameWords`, pending world action/modal state.
- يعتمد على dictionary storage/cloud APIs، feature locks، routing، mastery state.
- واجهات HTML: `loadWorldsView`, `loadGameDictionary`, `loadCustomWorld`, `saveCustomWorldFromModal`, `openWorldManageModal`, `setWorldManageAction`, `confirmDeleteCustomWorld`.

### Quiz

- setup/source/count، flashcards، Time Attack، Scramble، resume/exit/forfeit، verified result commit.
- الحالة الوحيدة الحالية: `activeQuizSession`, `currentQuizWords`, `quizSessionResults`, `currentQuizPool`, directions/timer/HP.
- يعتمد باتجاه واحد على source access في dictionary/worlds، وعلى SRS لحساب الانتقالات، وعلى XP لمنحها، وعلى cloud لحفظ resume.
- واجهات HTML: `loadQuizView`, `openQuizModeSettings`, `startConfiguredQuiz`, `startActualQuiz`, `markRemember`, `markForgot`, `submitScrambleAnswer`, resume/exit APIs.

## الاعتماد الدائري المحتمل وحله المحافظ

- Cloud ↔ classic runtime هو cycle حالي عبر `window`, وليس ES import cycle. سيبقى bridge نفسه؛ لن تُنشأ imports متبادلة.
- Quiz → SRS → storage/cloud/XP اتجاه وحيد منطقيًا. SRS لا يستدعي quiz UI؛ callbacks/نتيجة return تبقيه مستقلًا.
- Worlds ↔ dictionary يشتركان في `window.words` وactive scope. سيتم إبقاء مصدر الحالة الواحد في bootstrap، ولن ينشأ AppState مكرر.
- Profile cloud ↔ XP/profile payload cycle وقتي: profile module ينتظر `getLootlinguaProfilePayload`، بينما classic يطلب `saveProfileToCloud`. سيبقى الـwindow bridge والانتظار الحاليان كما هما.

## عقد HTML globals

- عدد inline handlers: 149.
- عدد الأسماء العامة المطلوبة منها: 83.
- baseline لم يجد أي اسم handler مفقود statically أو في browser smoke test.
- القائمة الكاملة محفوظة في `refactor-baseline.json > inlineHandlers.requiredGlobals`، وستُقارن آليًا بعد كل مرحلة.

## التهيئة المطلوبة

1. تعريف core/loading/storage bridges قبل bootstrap التطبيق.
2. إنشاء الحالة المشتركة مرة واحدة.
3. تحميل أنظمة XP/SRS/sources/quiz بترتيب يحافظ على ترتيب المصدر الحالي أو يجعل الاستدعاء بعد اكتمال كل السكربتات فقط.
4. يبقى `window.onload` نقطة تهيئة UI الحالية دون listener إضافي.
5. Firebase modules تسجل listeners مرة واحدة بعد اكتمال classic scripts.

## ملاحظات baseline لا تُصلح في refactor

- يوجد تعريفان حاليان باسم `renderProfileTitlePicker`.
- توجد إسنادات عامة متكررة مقصودة/متتابعة، ومنها wrapper لاحق لـ`toggleSidebar` وتعريفان لـ`window.deleteWord`.
- لم تُدمج أو تُحذف هذه التعريفات لأن ذلك تغيير سلوك محتمل وخارج النقل المحافظ.
