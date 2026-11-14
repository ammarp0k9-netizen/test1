/* The character picker and the runner share these Canvas costumes. */
(function (root) {
  'use strict';
  const characters = [
    { id: 'explorer', name: 'المستكشف', description: 'السترة الفيروزية وحقيبة الكنوز الأصلية.', accent: '#dcb978' },
    { id: 'mechanic', name: 'مهندسة الميناء', description: 'لباس عمل برتقالي، ضفيرة، وحزام عدّة.', accent: '#f8ab63', main: '#c96437', shade: '#8f3f34', trim: '#ffe0a0', legs: '#323b4e', skin: '#b87352', hair: '#392336', shoulders: .20, hips: .096 },
    { id: 'ranger', name: 'كشّافة السرو', description: 'عباءة قصيرة بمشبك ورقة، جزمة جلد وشعر مجعّد.', accent: '#acd07b', main: '#507a49', shade: '#29483d', trim: '#c6b47c', legs: '#38463e', skin: '#85503d', hair: '#282129', shoulders: .17, hips: .085 },
    { id: 'alpinist', name: 'متسلّق الصقيع', description: 'معطف مبطّن، قبعة فرو وحقيبة بحبال تسلّق.', accent: '#a5ecff', main: '#6095be', shade: '#396588', trim: '#d9f0ee', legs: '#3b5477', skin: '#e6b795', hair: '#58434c', shoulders: .24, hips: .11 },
    { id: 'courier', name: 'ساعي النيون', description: 'سترة قصيرة بحواف مضيئة، حقيبة كتف وشعر حادّ الأطراف.', accent: '#f19adc', main: '#744b91', shade: '#422e69', trim: '#79e0dd', legs: '#282640', skin: '#c08468', hair: '#e583c7', shoulders: .18, hips: .086 },
    { id: 'nomad', name: 'رحّالة الرمال', description: 'معطف رملي بفتحتين، عمامة ووشاح قرميدي.', accent: '#ffc882', main: '#cb9c68', shade: '#86584e', trim: '#f0cb93', legs: '#573d49', skin: '#a76343', hair: '#472d34', shoulders: .205, hips: .09 },
    { id: 'diver', name: 'غوّاص الأعماق', description: 'خوذة نحاسية بخراطيم خلفية وأسطوانة هواء.', accent: '#72ded6', main: '#427571', shade: '#244b55', trim: '#d8ab76', legs: '#253f50', skin: '#367d82', hair: '#987051', shoulders: .225, hips: .105 },
  ].map(Object.freeze);
  const byId = new Map(characters.map(character => [character.id, character]));
  const get = id => byId.get(id) || characters[0];

  function polygon(ctx, color, points) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath();
    ctx.fill();
  }
  function ellipse(ctx, color, x, y, rx, ry) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function stroke(ctx, color, width, ...points) {
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.stroke();
  }
  function rect(ctx, color, x, y, width, height) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  }

  function outerLayer(ctx, c, phase, sliding) {
    const flap = Math.sin(phase * .55) * .025;
    if (c.id === 'ranger') {
      // A single mantle ends above the belt, with a seam and one leaf clasp.
      polygon(ctx, '#294b3b', [-.12,-.75,.10,-.75,.19,-.66,.15+flap,-.49,-.06,-.46,-.17,-.51,-.19,-.65]);
      polygon(ctx, '#618456', [-.12,-.75,0,-.76,.025,-.69,-.015,-.50,-.07,-.46,-.17,-.51,-.19,-.65]);
      stroke(ctx, '#8faa68', .013, -.16,-.65,-.065,-.68,.047,-.68,.155,-.65);
      polygon(ctx, '#bcd182', [-.02,-.661,.051,-.635,.063,-.587,.010,-.606]);
      stroke(ctx, '#4c734a', .010, .054,-.600,-.005,-.646);
      rect(ctx, '#82674d', -.09,-.411,.17,.032);
    } else if (c.id === 'nomad') {
      const hem = sliding ? -.29 : -.21;
      polygon(ctx, c.shade, [-.14,-.42,.13,-.42,.17+flap,hem,.06,hem-.018,0,-.34,-.052,hem+.008,-.185+flap,hem-.018]);
      polygon(ctx, '#ddb17c', [-.17,-.69,-.11,-.75,.018,-.72,-.068,-.35,-.052,hem+.008,-.185+flap,hem-.018,-.142,-.39]);
      polygon(ctx, '#ba845a', [.018,-.72,.13,-.74,.18,-.67,.126,-.38,.17+flap,hem,.06,hem-.018,0,-.34]);
      stroke(ctx, '#edcb96', .016, -.139,-.61,-.11,-.51,-.13,-.36,-.14+flap,hem-.034);
      stroke(ctx, '#62414a', .038, -.137,-.411,.135,-.409);
      rect(ctx, c.trim, -.027,-.434,.064,.049);
      polygon(ctx, '#87444c', [-.106,-.747,.111,-.739,.136,-.688,.088,-.656,-.083,-.663,-.132,-.708]);
      polygon(ctx, '#ae6556', [.058,-.687,.122,-.702,.146+flap,-.509,.073+flap,-.542]);
      stroke(ctx, '#e39a75', .014, -.099,-.729,.0,-.705,.087,-.706);
    } else if (c.id === 'alpinist') {
      ellipse(ctx, c.trim, 0, -.717, .191, .072);
      for (const y of [-.61, -.51, -.41]) stroke(ctx, c.shade, .016, -.198,y,-.15,y+.025,.15,y+.025,.198,y);
      ellipse(ctx, '#2b526d', 0, -.561, .129, .146);
      stroke(ctx, '#f8bd80', .024, -.092,-.48,-.107,-.61,-.052,-.657,.06,-.645,.10,-.57,.055,-.489,-.043,-.492,-.057,-.578,.047,-.592);
      rect(ctx, c.trim, -.077,-.443,.154,.027);
    } else if (c.id === 'mechanic') {
      polygon(ctx, '#293f52', [-.16,-.7,-.105,-.73,-.056,-.60,.064,-.60,.115,-.73,.17,-.69,.14,-.4,-.14,-.4]);
      rect(ctx, '#50677b', -.097,-.577,.194,.12);
      stroke(ctx, c.trim, .02, -.087,-.55,.087,-.55);
      rect(ctx, '#534050', -.198,-.419,.396,.044);
      rect(ctx, '#a96d48', -.185,-.407,.102,.10);
      stroke(ctx, '#ced8ce', .021, .127,-.335,.11,-.466,.08,-.498);
      stroke(ctx, '#ced8ce', .019, .113,-.467,.147,-.506);
    } else if (c.id === 'courier') {
      polygon(ctx, '#a15ea1', [-.16,-.687,-.12,-.732,.055,-.723,.156,-.685,.11,-.64,-.105,-.64]);
      stroke(ctx, c.trim, .021, -.16,-.64,-.123,-.613,-.174,-.479);
      stroke(ctx, c.accent, .019, .151,-.65,.128,-.61,.17,-.487);
      stroke(ctx, '#2c264c', .036, -.14,-.687,.012,-.54,.12,-.438);
      polygon(ctx, '#293950', [-.028,-.529,.161,-.568,.192,-.425,.01,-.39]);
      stroke(ctx, c.trim, .016, .012,-.49,.146,-.516,.155,-.481,.023,-.456);
    } else if (c.id === 'diver') {
      stroke(ctx, '#1a3942', .037, -.12,-.72,-.144,-.47,-.12,-.399);
      stroke(ctx, '#1a3942', .037, .12,-.72,.144,-.47,.12,-.399);
      ellipse(ctx, '#735043', .017, -.549, .111, .157);
      ellipse(ctx, '#ab7953', -.019, -.55, .085, .151);
      stroke(ctx, '#e4bb85', .024, -.049,-.648,-.059,-.581,-.055,-.502);
      for (const y of [-.609, -.474]) {
        rect(ctx, '#2d4e51', -.109,y,.235,.028);
        rect(ctx, '#d4a66d', .047,y-.003,.032,.033);
      }
      stroke(ctx, '#16353c', .037, .042,-.683,.116,-.702,.142,-.762,.13,-.828);
      stroke(ctx, '#6b9590', .012, .049,-.693,.114,-.717,.133,-.759,.12,-.818);
    }
  }

  function helmet(ctx, c, phase, sliding) {
    if (c.id !== 'diver') {
      ellipse(ctx, c.skin, 0, -.851, .104, .117);
      ellipse(ctx, '#fff0c52a', -.05, -.858, .039, .072);
    }
    if (c.id === 'mechanic') {
      ellipse(ctx, c.hair, 0, -.878, .109, .103);
      const tip = sliding ? -.743 : -.672;
      const sway = Math.sin(phase) * .024;
      stroke(ctx, c.hair, .063, -.046,-.857,-.104,-.767,-.075+sway,tip);
      stroke(ctx, c.trim, .019, -.099+sway,tip-.015,-.054+sway,tip-.014);
      polygon(ctx, c.main, [-.117,-.907,-.085,-.97,.065,-.973,.117,-.925,.135,-.89,-.13,-.89]);
      stroke(ctx, c.trim, .018, -.114,-.901,.122,-.902);
    } else if (c.id === 'ranger') {
      ellipse(ctx, c.hair, 0, -.883, .106, .101);
      ellipse(ctx, c.hair, -.067,-.935,.059,.049);
      ellipse(ctx, c.hair, .045,-.943,.067,.047);
      ellipse(ctx, c.hair, .087,-.905,.045,.053);
      stroke(ctx, '#785647', .017, -.097,-.924,-.065,-.946,-.025,-.937);
      stroke(ctx, '#533d38', .019, -.073,-.883,-.033,-.904,.012,-.897);
    } else if (c.id === 'alpinist') {
      ellipse(ctx, '#567293', 0, -.889, .132, .114);
      rect(ctx, c.trim, -.118,-.9,.236,.048);
      ellipse(ctx, c.trim, -.105,-.852,.035,.062);
      ellipse(ctx, c.trim, .105,-.852,.035,.062);
      ellipse(ctx, c.trim, .003,-.991,.046,.036);
    } else if (c.id === 'courier') {
      polygon(ctx, '#4e345d', [-.09,-.85,-.093,-.93,.015,-.966,.109,-.915,.081,-.829,-.019,-.795]);
      polygon(ctx, c.hair, [-.11,-.87,-.128,-.941,-.071,-.927,-.075,-.994,-.007,-.955,.02,-1.014,.044,-.961,.124,-.963,.077,-.911,.11,-.904,.045,-.856]);
      stroke(ctx, '#f6abd4', .016, -.077,-.927,.001,-.952,.058,-.937);
      rect(ctx, c.trim, .067,-.887,.059,.035);
    } else if (c.id === 'nomad') {
      ellipse(ctx, '#a66d58', .007, -.885, .131, .105);
      ellipse(ctx, '#e3b681', -.015,-.913,.115,.080);
      stroke(ctx, '#f2d3a0', .025, -.121,-.896,-.067,-.882,.026,-.894,.102,-.930);
      stroke(ctx, '#c58e69', .023, -.104,-.860,-.036,-.847,.057,-.867,.123,-.911);
      ellipse(ctx, '#a87259', .061,-.857,.04,.033);
    } else if (c.id === 'diver') {
      ellipse(ctx, '#533b3b', 0, -.777, .139,.046);
      ellipse(ctx, '#81553e', .008, -.879, .133,.126);
      ellipse(ctx, '#c9925c', -.017,-.894,.114,.109);
      ellipse(ctx, '#edbb80', -.050,-.934,.057,.044);
      stroke(ctx, '#704d3c', .026, -.116,-.853,-.044,-.825,.045,-.826,.118,-.853);
      stroke(ctx, '#e5b27b', .014, -.093,-.841,-.037,-.822,.042,-.823,.093,-.843);
      for (const x of [-.125, .125]) {
        ellipse(ctx, '#775342', x,-.867,.021,.045);
        ellipse(ctx, c.trim, x,-.875,.012,.027);
      }
      ellipse(ctx, '#27454a', .098,-.814,.028,.018);
    }
  }

  function draw(ctx, c, height, phase, pose) {
    const sliding = pose.action === 'slide', jumping = pose.action === 'jump';
    const stride = Math.sin(phase), tuck = jumping ? Math.sin(Math.PI * pose.fraction) : 0;
    const settle = sliding ? 1 - (1 - Math.min(1, pose.fraction * 5)) ** 2 : 0;
    const hipY = sliding ? -.155 : -.345;
    ctx.save();
    ctx.scale(height, height);
    for (const side of [-1, 1]) {
      const x = side * c.hips;
      const lift = jumping ? tuck * (.13 + side * .048) : Math.max(0, side * stride) * .20;
      // The far knee stays folded. The near leg extends toward the viewer
      // as the runner's weight settles onto the slide.
      const foot = sliding ? (side < 0 ? -.064 - settle * .032 : -.012) : -lift;
      const footX = x + side * (sliding ? .020 + settle * .018 : -.018 * tuck);
      const kneeX = x + side * (sliding && side < 0 ? .063 : .022);
      const knee = sliding ? (side < 0 ? -.205 : -.089 + settle * .014) : -.17 - lift * .47;
      stroke(ctx, side < 0 ? '#0c1721' : c.legs, c.hips + .027, x,hipY,kneeX,knee,footX,foot);
      stroke(ctx, c.legs, c.hips * .74, x-.011,hipY,kneeX-.011,knee,footX-.011,foot);
      stroke(ctx, '#e0cda328', .021, kneeX-.014,knee,footX-.014,foot);
      const boot = sliding && side > 0 ? .060 : .042;
      stroke(ctx, '#182631', .065, footX-boot,foot,footX+boot,foot);
      stroke(ctx, c.trim, .032, footX-boot,foot-.012,footX+boot*.78,foot-.012);
    }
    const shoulder = c.shoulders, hip = c.hips + .045;
    if (sliding) {
      ctx.save();
      // Foreshorten only the torso and its gear. The limbs and helmet
      // have their own positions and keep their volume.
      ctx.transform(1.02, .10, -.23 - settle * .06, .296, -.086, -.055);
    } else {
      for (const side of [-1, 1]) {
        const swing = -side * stride;
        const raised = tuck * (side < 0 ? 1 : .43);
        const elbowX = side * (shoulder + .055 + raised * .014);
        const elbowY = -.464 + swing * .056 * (1 - tuck) - raised * .115;
        const handX = side * (shoulder + .019 - raised * .021);
        const handY = -.348 + swing * .088 * (1 - tuck) - raised * .316;
        arm(ctx, c, side * shoulder, -.66, elbowX, elbowY, handX, handY);
      }
    }
    polygon(ctx, c.shade, [-shoulder,-.69,-shoulder*.7,-.751,shoulder*.7,-.751,shoulder,-.676,hip,-.34,-hip,-.34]);
    polygon(ctx, c.main, [-shoulder,-.673,-shoulder*.68,-.746,shoulder*.54,-.746,shoulder*.78,-.69,hip*.67,-.356,-hip,-.34]);
    stroke(ctx, '#fff4d42b', .019, -shoulder*.91,-.671,-shoulder*.64,-.723,shoulder*.29,-.731);
    stroke(ctx, c.trim, .025, -hip,-.354,hip,-.354);
    outerLayer(ctx, c, phase, sliding);
    if (sliding) {
      ctx.restore();
      arm(ctx, c, -.117,-.259,-.202,-.166,-.211,-.105-settle*.012);
      arm(ctx, c, .171,-.226,.213,-.154,.135,-.086);
      ctx.translate(.036 + settle * .027, .218);
      ctx.rotate(.13);
      ctx.scale(.67, .58);
    }
    helmet(ctx, c, phase, sliding);
    ctx.restore();
  }
  function arm(ctx, c, shoulderX, shoulderY, elbowX, elbowY, handX, handY) {
    stroke(ctx, c.shade, .089, shoulderX,shoulderY,elbowX,elbowY,handX,handY);
    stroke(ctx, c.main, .062, shoulderX-.009,shoulderY-.011,elbowX-.009,elbowY-.011,handX-.009,handY-.011);
    ellipse(ctx, c.id === 'diver' ? c.trim : c.skin, handX,handY,.035,.038);
    ellipse(ctx, '#ffe3b744', handX-.010,handY-.012,.017,.013);
  }
  root.LootLinguaRunnerCharacters = Object.freeze({ list: Object.freeze(characters), get, draw });
})(window);
