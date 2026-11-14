/* The character picker and the runner share these Canvas costumes. */
(function (root) {
  'use strict';
  const characters = [
    { id: 'explorer', name: 'المستكشف', description: 'السترة الفيروزية وحقيبة الكنوز الأصلية.', accent: '#dcb978' },
    { id: 'mechanic', name: 'مهندسة الميناء', description: 'لباس عمل برتقالي، ضفيرة، وحزام عدّة.', accent: '#f8ab63', main: '#c96437', shade: '#8f3f34', trim: '#ffe0a0', legs: '#323b4e', skin: '#b87352', hair: '#392336', shoulders: .20, hips: .096 },
    { id: 'ranger', name: 'كشّافة السرو', description: 'عباءة من الأوراق، حزام مائل وشعر مجعّد.', accent: '#acd07b', main: '#507a49', shade: '#2c5549', trim: '#bdce80', legs: '#3a4c3c', skin: '#85503d', hair: '#282129', shoulders: .17, hips: .085 },
    { id: 'alpinist', name: 'متسلّق الصقيع', description: 'معطف مبطّن، قبعة فرو وحقيبة بحبال تسلّق.', accent: '#a5ecff', main: '#6095be', shade: '#396588', trim: '#d9f0ee', legs: '#3b5477', skin: '#e6b795', hair: '#58434c', shoulders: .24, hips: .11 },
    { id: 'courier', name: 'ساعي النيون', description: 'سترة قصيرة بحواف مضيئة، حقيبة كتف وشعر حادّ الأطراف.', accent: '#f19adc', main: '#744b91', shade: '#422e69', trim: '#79e0dd', legs: '#282640', skin: '#c08468', hair: '#e583c7', shoulders: .18, hips: .086 },
    { id: 'nomad', name: 'رحّالة الرمال', description: 'رداء ملفوف وعمامة ووشاح يتحرّك مع الجري.', accent: '#ffc882', main: '#e9b97f', shade: '#9f655b', trim: '#efdeaa', legs: '#6f4654', skin: '#a76343', hair: '#472d34', shoulders: .205, hips: .09 },
    { id: 'diver', name: 'غوّاص الأعماق', description: 'خوذة نحاسية مستديرة وأسطوانة هواء وبدلة غوص.', accent: '#72ded6', main: '#427571', shade: '#244b55', trim: '#d8ab76', legs: '#253f50', skin: '#367d82', hair: '#987051', shoulders: .225, hips: .105 },
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

  function outerLayer(ctx, c, phase) {
    const flap = Math.sin(phase * .55) * .038;
    if (c.id === 'ranger') {
      polygon(ctx, '#355b45', [-.16,-.71,.08,-.77,.24,-.61,.21+flap,-.34,.10,-.41,.02,-.32,-.08,-.41,-.21,-.35,-.24,-.51]);
      polygon(ctx, '#69894e', [-.16,-.70,.06,-.75,.20,-.64,.07,-.58,-.02,-.51,-.15,-.54,-.23,-.57]);
      stroke(ctx, '#aac379', .018, -.14,-.65,-.018,-.62,.12,-.65);
    } else if (c.id === 'nomad') {
      polygon(ctx, c.shade, [-.17,-.49,.16,-.5,.23+flap,-.23,.07,-.29,-.03,-.24,-.19,-.29]);
      polygon(ctx, c.main, [-.15,-.69,.14,-.72,.20,-.37,.07,-.32,-.19,-.35]);
      polygon(ctx, '#f8d5a1', [-.16,-.7,.08,-.75,.16,-.67,-.04,-.53,-.18,-.51]);
      polygon(ctx, '#a65e59', [.04,-.72,.14,-.72,.20+flap,-.43,.1+flap,-.46,.07,-.59]);
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
      for (const x of [-.12, .12]) stroke(ctx, '#153a46', .029, x,-.71,x*1.25,-.47,x,-.40);
      ellipse(ctx, '#996744', 0, -.548, .118, .166);
      ellipse(ctx, c.trim, -.028, -.55, .084, .153);
      rect(ctx, '#2d4e51', -.114,-.566,.228,.043);
      stroke(ctx, '#294a57', .023, .079,-.644,.142,-.694,.137,-.81);
      ellipse(ctx, c.accent, -.028, -.612, .027, .024);
    }
  }

  function helmet(ctx, c, phase, sliding) {
    ellipse(ctx, c.skin, 0, -.851, .104, .117);
    if (c.id === 'mechanic') {
      ellipse(ctx, c.hair, 0, -.878, .109, .103);
      const tip = sliding ? -.743 : -.672;
      const sway = Math.sin(phase) * .024;
      stroke(ctx, c.hair, .063, -.046,-.857,-.104,-.767,-.075+sway,tip);
      stroke(ctx, c.trim, .019, -.099+sway,tip-.015,-.054+sway,tip-.014);
      polygon(ctx, c.main, [-.117,-.907,-.085,-.97,.065,-.973,.117,-.925,.135,-.89,-.13,-.89]);
      stroke(ctx, c.trim, .018, -.114,-.901,.122,-.902);
    } else if (c.id === 'ranger') {
      for (const [x, y, r] of [[-.076,-.906,.054],[0,-.929,.058],[.076,-.907,.055],[-.066,-.855,.059],[.056,-.853,.061],[0,-.873,.08]]) ellipse(ctx, c.hair, x, y, r, r);
      stroke(ctx, '#98715b', .014, -.082,-.931,-.058,-.942,-.041,-.932);
      polygon(ctx, c.trim, [.07,-.84,.119,-.89,.118,-.847,.091,-.818]);
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
      ellipse(ctx, '#c28568', 0, -.884, .14, .117);
      ellipse(ctx, c.trim, -.013,-.906,.135,.092);
      stroke(ctx, '#c28568', .025, -.13,-.892,-.034,-.878,.075,-.924,.11,-.948);
      stroke(ctx, '#f5c18f', .024, -.123,-.85,-.044,-.841,.119,-.882);
    } else if (c.id === 'diver') {
      ellipse(ctx, '#8c634c', 0, -.867, .145,.145);
      ellipse(ctx, '#eac186', -.029,-.883,.113,.118);
      ellipse(ctx, '#694d48', .015,-.866,.084,.079);
      ellipse(ctx, c.skin, .015,-.866,.064,.059);
      stroke(ctx, '#96e8d9', .017, -.016,-.893,.034,-.891);
      for (const x of [-.146, .146]) ellipse(ctx, c.trim, x,-.864,.027,.039);
    }
  }

  function draw(ctx, c, height, phase, pose) {
    const slide = pose.action === 'slide', jump = pose.action === 'jump';
    const stride = Math.sin(phase), tuck = jump ? Math.sin(Math.PI * pose.fraction) : 0;
    ctx.save();
    ctx.scale(height, height);
    // Both outfits and gear follow the same rig and collision-height poses.
    for (const side of [-1, 1]) {
      const x = side * c.hips, lift = jump ? tuck * (.17 + side * .05) : Math.max(0, side * stride) * .20;
      const foot = slide ? (side > 0 ? -.045 : 0) : -lift;
      const footX = x + side * (slide ? .056 : -.025 * tuck);
      const knee = slide ? -.092 : -.17 - lift * .47;
      stroke(ctx, c.legs, c.hips + .024, x,slide ? -.15 : -.345, x + side*.026,knee, footX,foot);
      stroke(ctx, c.shade, .027, x + side*.008,knee, footX,foot);
      stroke(ctx, c.trim, .058, footX-.044,foot,footX+.044,foot);
    }
    if (slide) ctx.scale(1.08, .406);
    const shoulder = c.shoulders, hip = c.hips + .045;
    for (const side of [-1, 1]) {
      const swing = slide || jump ? 0 : -side * stride;
      const elbow = side * (shoulder + .055 + tuck * .045);
      const wrist = side * (shoulder + .027 + tuck * .08);
      const y = -.386 + swing * .10 - tuck * .26;
      stroke(ctx, c.shade, .093, side*shoulder,-.672,elbow,-.49+swing*.06-tuck*.12,wrist,y);
      stroke(ctx, c.main, .064, side*shoulder,-.671,elbow,-.49+swing*.06-tuck*.12);
      ellipse(ctx, c.id === 'diver' ? c.trim : c.skin, wrist,y,.037,.043);
    }
    polygon(ctx, c.main, [-shoulder,-.68,-shoulder*.7,-.754,shoulder*.7,-.754,shoulder,-.68,hip,-.34,-hip,-.34]);
    polygon(ctx, c.shade, [shoulder*.58,-.755,shoulder,-.68,hip,-.34,hip*.62,-.34]);
    stroke(ctx, c.trim, .025, -hip,-.354,hip,-.354);
    outerLayer(ctx, c, slide ? 0 : phase);
    helmet(ctx, c, slide ? 0 : phase, slide);
    ctx.restore();
  }
  root.LootLinguaRunnerCharacters = Object.freeze({ list: Object.freeze(characters), get, draw });
})(window);
