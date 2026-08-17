(function installPopoverOverrides(root) {
  'use strict';

  function textNode(tag, text, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  root.showBackupHelp = function showBackupHelp(type, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const message = type === 'export'
      ? 'التصدير يحفظ نسخة من كلماتك كملف JSON تستطيع الاحتفاظ به أو نقله إلى جهاز آخر.'
      : 'الاستيراد يدمج ملف JSON صادر من LootLingua مع قاموسك من دون تكرار الكلمات الموجودة.';
    const content = textNode('p', message);
    root.LootLinguaPopover?.open({ id: 'backupHelpPopover', className: 'backup-help-popover', anchor: event?.currentTarget, content });
  };

  root.showMasteryHelp = function showMasteryHelp(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const content = document.createDocumentFragment();
    content.append(
      textNode('strong', 'كيف يعني إتقان كلمة؟'),
      textNode('p', 'لكل كلمة ثلاث نقاط. الإجابات الصحيحة في اختبارات موثوقة وأيام أو جلسات مختلفة ترفع الإتقان.'),
      textNode('p', 'بعد مرور 72 ساعة من أول إجابة صحيحة، إجابة صحيحة جديدة تكمل الإتقان.')
    );
    root.LootLinguaPopover?.open({ id: 'masteryHelpPopover', className: 'mastery-help-popover', anchor: event?.currentTarget, content });
  };

  root.showWordMasteryPopover = function showWordMasteryPopover(event, wordId) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const id = String(wordId || event?.currentTarget?.dataset?.wordId || '');
    const word = (root.words || []).find((item) => String(item.id) === id) || (root.currentQuizWords || []).find((item) => String(item.id) === id) || {};
    const state = root.getWordMasteryState?.(word) || {};
    const level = root.getMasteryLevel?.(word) || 0;
    const label = root.getMasteryLabel?.(word) || 'جديدة';
    const next = state.mastery_status === 'Mastered'
      ? 'هذه الكلمة متقنة، وستعود لاحقًا كمراجعة متباعدة.'
      : level < 2
        ? 'أجب عنها صحيحًا في اختبار موثوق في يوم أو جلسة مختلفة لتتقدم.'
        : 'بعد مرور 72 ساعة من أول إجابة صحيحة، إجابة صحيحة جديدة تجعلها متقنة.';
    const content = document.createDocumentFragment();
    content.append(textNode('strong', label), textNode('p', next));
    root.LootLinguaPopover?.open({ id: 'wordMasteryPopover', className: 'word-mastery-popover', anchor: event?.currentTarget, content });
  };
})(window);
