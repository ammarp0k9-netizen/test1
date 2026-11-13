import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../js/popover.js', import.meta.url), 'utf8');
test('persistent guidance survives background input, highlights only its target, and clears hidden anchors', () => {
  const handlers = new Map();
  const classes = new Set();
  const anchor = { isConnected: true, visible: true,
    classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key) },
    getBoundingClientRect: () => ({left:30,top:50,bottom:80,width:100}),
    getClientRects() { return this.visible ? [{}] : []; },
    setAttribute() {}, contains: () => false,
  };
  const root = { innerWidth:320, innerHeight:640, addEventListener: (type,fn) => handlers.set(type,fn), removeEventListener: type => handlers.delete(type), dispatchEvent() {} };
  const document = { body: { append() {} }, createElement: () => ({ style:{}, setAttribute() {}, getBoundingClientRect: () => ({width:200,height:80}), append() {}, remove() {}, contains: () => false }), addEventListener: (type,fn) => handlers.set(type,fn), removeEventListener: type => handlers.delete(type) };
  new Function('window','document','Node','CustomEvent','requestAnimationFrame',source)(root,document,class {},class {},fn=>fn());
  const api = root.LootLinguaPopover;
  api.open({id:'coach',anchor,content:'guide',persistent:true});
  assert.ok(classes.has('coach-highlight-target'));
  handlers.get('pointerdown')({target:{}});
  assert.equal(api.getActiveId(),'coach');
  anchor.visible = false;
  handlers.get('scroll')();
  assert.equal(api.getActiveId(),'');
  assert.equal(classes.size,0);
  anchor.visible = true;
  api.open({id:'help',anchor,content:'ordinary help'});
  handlers.get('pointerdown')({target:{}});
  assert.equal(api.getActiveId(),'', 'ordinary help retains outside-click dismissal');
});

test('reading time gates only this step and survives an anchor rerender without starting over', () => {
  const handlers = new Map();
  const classList = { contains: () => false, add() {}, remove() {} };
  function element() {
    return { classList, style: {}, getBoundingClientRect: () => ({ left: 20, top: 180, bottom: 210, width: 180, height: 65 }),
      getClientRects: () => [{}], setAttribute() {}, append() {}, remove() {}, contains: () => false };
  }
  const root = { innerWidth: 320, innerHeight: 640, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const document = { body: { append() {} }, createElement: element,
    addEventListener: (type, handler) => handlers.set(type, handler), removeEventListener: type => handlers.delete(type) };
  let now = 100;
  new Function('window', 'document', 'Node', 'CustomEvent', 'Date', 'setTimeout', 'clearTimeout', source)(
    root, document, class {}, class {}, { now: () => now }, () => 0, () => {}
  );
  const api = root.LootLinguaPopover;
  const anchor = element();
  api.open({ id: 'guide', anchor, content: 'guide', persistent: true, reading: { step: 'one', actions: [anchor] } });
  const unrelated = element();
  assert.equal(api.isReadingAction(anchor), true);
  assert.equal(api.isReadingAction(unrelated), false);
  assert.ok(handlers.has('click'));
  now += 2000;
  const replacement = element();
  api.open({ id: 'guide', anchor: replacement, content: 'guide', persistent: true, reading: { step: 'one', actions: [replacement] } });
  assert.equal(api.isReadingAction(replacement), true);
  now += 1001;
  assert.equal(api.canAct('guide'), true);
  assert.equal(api.isReadingAction(replacement), false);
  api.close({ silent: true });
  assert.equal(handlers.has('click'), false);
});
