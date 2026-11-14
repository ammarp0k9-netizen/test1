/* Shared map catalog. Visual styles use the same obstacle types in every biome. */
(function (root) {
  'use strict';
  const maps = [
    { id: 'volcano', name: 'فوهة الرماد', scene: 'volcano', description: 'بازلت ولهب ومركبات تعدين عند سفح البركان.',
      sky: '#230f1d', horizon: '#a54737', fog: '#854a45', ground: '#281b29', road: '#322b37', edge: '#f68a49', mark: '#d48a70', light: '#ffc068', shade: '#402d3c', face: '#6d4547', dark: '#190f20', curve: .07, climb: .17, vehicle: 'crawler' },
    { id: 'forest', name: 'غابة السرو', scene: 'forest', description: 'جسور خشبية بين الأشجار وصخور مغطّاة بالطحلب.',
      sky: '#10272a', horizon: '#809467', fog: '#5e7b61', ground: '#172d28', road: '#514131', edge: '#c4945f', mark: '#baaa7b', light: '#cce384', shade: '#263e32', face: '#62503c', dark: '#132727', curve: .15, climb: .045, vehicle: 'timber' },
    { id: 'summit', name: 'قمم الصقيع', scene: 'summit', description: 'مسار جبلي صاعد، جليد منحوت ومركبة إنقاذ ثلجية.',
      sky: '#193756', horizon: '#9ec8dd', fog: '#7199b3', ground: '#304a64', road: '#4b6f8b', edge: '#a8d9ee', mark: '#bcdeec', light: '#e1faff', shade: '#2f556f', face: '#75aac2', dark: '#142942', curve: .11, climb: .18, vehicle: 'snow' },
    { id: 'desert', name: 'أطلال الرمال', scene: 'desert', description: 'بلاط حجري بين المسلّات وطريق يمر تحت معبد مدفون.',
      sky: '#623444', horizon: '#d99769', fog: '#ac785d', ground: '#513637', road: '#78604e', edge: '#ffcc88', mark: '#c4a377', light: '#ffe0a5', shade: '#694741', face: '#a17351', dark: '#321d28', curve: .09, climb: .05, vehicle: 'expedition' },
    { id: 'harbor', name: 'ميناء المدّ', scene: 'harbor', description: 'رصيف بين رافعات وحاويات، مع شاحنات شحن وممر مستودع.',
      sky: '#102942', horizon: '#476e88', fog: '#466e84', ground: '#183647', road: '#334b57', edge: '#eec075', mark: '#9bbbc0', light: '#ffe1a0', shade: '#203849', face: '#4f7381', dark: '#101e32', curve: .055, climb: .015, vehicle: 'freight' },
    { id: 'neon', name: 'مدينة النيون', scene: 'neon', description: 'طرق مضيئة فوق المدينة، مركبات خدمة وممر مترو.',
      sky: '#141329', horizon: '#63457b', fog: '#51416c', ground: '#23203a', road: '#322d49', edge: '#64e6e4', mark: '#8abae7', light: '#ff9ad5', shade: '#312750', face: '#654c8c', dark: '#17162d', curve: .13, climb: .065, vehicle: 'metro' },
  ].map(Object.freeze);
  const classic = Object.freeze({ id: 'classic', scene: 'classic', name: 'الأطلال القديمة', fog: '#355b60' });
  const get = id => maps.find(map => map.id === id) || classic;
  root.LootLinguaRunnerMaps = Object.freeze({ maps: Object.freeze(maps), get });
})(window);
