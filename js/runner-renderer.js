/* LootLingua Runner: visual projection only. No DOM reads, rewards or physics. */
(function(root) {
  'use strict';
  const FAR = 112;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const laneColors = ['#53e5d2', '#f6c56a', '#82a8ff'];
  const palette = Object.freeze({ sky: '#071722', dark: '#061019', stone: '#24414b', edge: '#4d7272', gold: '#efc578', teal: '#5be6d1' });

  function createRenderer(canvas, options = {}) {
    const { NEAR, VEHICLE_HEIGHT, VEHICLE_RAMP, VEHICLE_EXIT } = root.LootLinguaRunnerEngine.constants;
    const context = canvas?.getContext?.('2d', { alpha: false });
    if (!context) throw new Error('Runner needs a 2D canvas.');
    const document = canvas.ownerDocument || root.document;
    const background = document.createElement('canvas');
    const back = background.getContext('2d', { alpha: false });
    let width = 1, height = 1, dpr = 1, laneWidth = 1, horizon = 1, ground = 1, actorHeight = 1;
    let destroyed = false, visualLane = 1, lastElapsed = null, activeTime = 0, horizonFog;
    const getMap = id => root.LootLinguaRunnerMaps?.get(id);
    let map = getMap('classic'), distance = 0, changeDistance = -100, curve = 0, climb = 0;
    const ordered = [], vehicles = [];
    const metrics = { drawn: 0, culled: 0, dpr: 1 };
    function paintDepth(entity) {
      if (entity.kind === 'coin' && (entity.height ?? .44) >= VEHICLE_HEIGHT) {
        for (const truck of vehicles) if (truck.lane === entity.lane && entity.z >= truck.z + VEHICLE_RAMP && entity.z <= truck.z + truck.length) return truck.z - .001;
      }
      return entity.z;
    }
    const byDepth = (a, b) => paintDepth(b) - paintDepth(a) || b.z - a.z || (a.id || 0) - (b.id || 0);

    function rounded(ctx, x, y, w, h, radius) {
      const r = Math.min(radius, w / 2, h / 2);
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }
    function quad(ctx, ax, ay, bx, by, cx, cy, dx, dy, color) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy); ctx.lineTo(dx, dy); ctx.closePath(); ctx.fill();
    }
    function line(ctx, ax, ay, bx, by, color, size = 1) {
      ctx.strokeStyle = color; ctx.lineWidth = size; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    function clipWorld(vertices, closed) {
      const result = [];
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i], b = vertices[(i + 1) % vertices.length];
        if (a[1] >= NEAR) result.push(a);
        if ((!closed && i === vertices.length - 1) || (a[1] >= NEAR) === (b[1] >= NEAR)) continue;
        const t = (NEAR - a[1]) / (b[1] - a[1]);
        result.push([a[0] + (b[0] - a[0]) * t, NEAR, a[2] + (b[2] - a[2]) * t]);
      }
      return result;
    }
    function mesh(vertices, color, stroke = 0) {
      const clipped = clipWorld(vertices, !stroke);
      if (clipped.length < (stroke ? 2 : 3)) return;
      context.beginPath();
      clipped.forEach((v, i) => {
        const p = project(v[0], v[1]), y = p.y - actorHeight * v[2] * p.scale;
        if (i) context.lineTo(p.x, y); else context.moveTo(p.x, y);
      });
      if (stroke) { context.strokeStyle = color; context.lineWidth = stroke; context.stroke(); }
      else { context.closePath(); context.fillStyle = color; context.fill(); }
    }
    function project(lane, z) {
      const depth = Number(z) || 0, scale = 17 / Math.max(2, 17 + depth);
      const sweep = curve || climb ? Math.max(-.12, Math.min(1, depth / 100)) : 0;
      const bend = curve * sweep * sweep * width;
      const grade = climb * sweep * height;
      const y = horizon + (ground - horizon) * scale - grade;
      return { x: width / 2 + ((Number(lane) || 0) - 1) * laneWidth * scale + bend,
        y, scale, laneWidth: laneWidth * scale,
        visible: depth >= NEAR && depth <= FAR,
        gateTop: y - actorHeight * 1.48 * scale,
        labelY: y - actorHeight * 1.16 * scale };
    }
    function polygon(ctx, points, fill) {
      ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
      ctx.closePath(); ctx.fill();
    }
    function landscape() {
      const sky = back.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, map.sky); sky.addColorStop(.42, map.horizon); sky.addColorStop(1, map.ground);
      back.fillStyle = sky; back.fillRect(0, 0, width, height);
      const y = horizon, unit = height * .14, scene = map.scene;
      const lightX = width * (scene === 'volcano' ? .36 : .74);
      back.fillStyle = map.light; back.beginPath(); back.arc(lightX, y * .42, Math.max(3, unit * .28), 0, Math.PI * 2); back.fill();
      for (let i = 0; i < 15; i++) {
        const x = i * width / 13 - width * .07, w = width * (.075 + i % 4 * .009), h = unit * (.45 + (i * 7 % 11) * .11);
        if (scene === 'forest') {
          for (let branch = 0; branch < 3; branch++) {
            const top = y - h + branch * h * .22;
            polygon(back, [x, top, x - w * .4 - branch * w * .08, top + h * .59, x + w * .4 + branch * w * .08, top + h * .59], i % 2 ? '#32574b' : '#416454');
          }
        } else if (scene === 'summit' || scene === 'volcano' || scene === 'desert') {
          const peak = y - h * (i === 6 && scene === 'volcano' ? 1.75 : 1);
          polygon(back, [x - w, y + unit * .4, x - w * .16, peak, x + w * .16, peak + unit * .055, x + w, y + unit * .4], i % 2 ? map.shade : map.face);
          if (scene === 'summit') polygon(back, [x - w * .4, peak + h * .4, x - w * .16, peak, x + w * .16, peak + unit * .055, x + w * .42, peak + h * .39, x, peak + h * .27], '#c9e3e9');
          if (i === 6 && scene === 'volcano') polygon(back, [x - w * .14, peak, x + w * .12, peak, x + w * .55, y + unit * .18, x + w * .19, y - unit * .1], '#e06d42');
        } else if (scene === 'harbor') {
          back.fillStyle = map.shade; back.fillRect(x - w / 2, y - h * .18, w, h * .42);
          if (i % 3 === 0) { line(back, x, y, x, y - h, map.face, 3); line(back, x - w * .25, y - h, x + w, y - h, map.face, 3); line(back, x + w * .68, y - h, x + w * .68, y - h * .48, map.light); }
        } else {
          back.fillStyle = i % 2 ? map.shade : map.dark; back.fillRect(x - w / 2, y - h, w * .76, h + unit * .3);
          for (let row = 0; row < 4; row++) { back.fillStyle = row % 2 ? map.edge : map.light; back.fillRect(x - w * .26, y - h * (.82 - row * .17), w * .11, Math.max(1, h * .035)); }
        }
      }
      back.fillStyle = map.ground; back.fillRect(0, y + unit * .2, width, height);
    }
    function cacheBackground() {
      back.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (map && map.scene !== 'classic') { landscape(); return; }
      const sky = back.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#06121f'); sky.addColorStop(.38, '#12373e'); sky.addColorStop(1, '#0a1c25');
      back.fillStyle = sky; back.fillRect(0, 0, width, height);
      const glow = back.createRadialGradient(width * .5, horizon * .86, 1, width * .5, horizon, width * .62);
      glow.addColorStop(0, 'rgba(94,230,199,.19)'); glow.addColorStop(.55, 'rgba(43,103,112,.07)'); glow.addColorStop(1, 'rgba(8,23,35,0)');
      back.fillStyle = glow; back.fillRect(0, 0, width, height);
      for (let index = 0; index < 24; index++) {
        const x = (index * 137.51 % 100) / 100 * width, y = (index * 31.73 % 100) / 100 * horizon * .74;
        back.fillStyle = index % 4 ? 'rgba(187,222,218,.28)' : 'rgba(246,197,106,.55)';
        back.fillRect(x, y, index % 4 ? 1 : 2, index % 4 ? 1 : 2);
      }
      // A distant original ruin-city silhouette stays cached; nearby columns
      // below move in world space and establish the player's forward motion.
      for (let index = 0; index < 22; index++) {
        const x = index * width / 21 - width * .025;
        const w = width * (.035 + index % 4 * .008), h = height * (.045 + index * 13 % 8 * .012);
        back.fillStyle = index % 2 ? '#102c36' : '#15343d'; back.fillRect(x, horizon - h, w, h + height * .1);
        quad(back, x - 2, horizon - h, x + w / 2, horizon - h - w * .4, x + w + 2, horizon - h, x + w / 2, horizon - h + 2, '#1a3e46');
        if (index % 3 === 0) {
          back.fillStyle = '#b59558'; back.fillRect(x + w * .4, horizon - h * .65, Math.max(1, w * .12), h * .16);
        }
      }
      const floor = back.createLinearGradient(0, horizon, 0, height);
      floor.addColorStop(0, '#17333b'); floor.addColorStop(1, '#07151f');
      back.fillStyle = floor; back.fillRect(0, horizon, width, height - horizon);
      // Cached outer masonry fills wide desktop margins without adding more
      // moving entities, textures, or per-frame gradients.
      for (const side of [-1, 1]) {
        const inner = width / 2 + side * laneWidth * 2.2, outer = side < 0 ? 0 : width;
        quad(back, inner, horizon, outer, horizon * .65, outer, height, inner, height, '#112a33');
        for (let band = 0; band < 8; band++) {
          const y = horizon + band * (height - horizon) / 7;
          line(back, outer, y, inner, y, '#1e3941', 1);
        }
      }
      // The sky arch is architecture, not an option gate: no text or symbols.
      const radius = width * .23;
      back.strokeStyle = '#294950'; back.lineWidth = Math.max(8, width * .025);
      back.beginPath(); back.arc(width / 2, horizon * 1.03, radius, Math.PI, 0); back.stroke();
      back.strokeStyle = 'rgba(240,197,120,.4)'; back.lineWidth = 1;
      back.beginPath(); back.arc(width / 2, horizon * 1.03, Math.max(0, radius - Math.max(5, width * .013)), Math.PI, 0); back.stroke();
    }
    function resize(nextWidth, nextHeight) {
      if (destroyed) return;
      width = clamp(Math.round(Number(nextWidth) || 1), 1, 4096);
      height = clamp(Math.round(Number(nextHeight) || 1), 1, 4096);
      dpr = clamp(Number(root.devicePixelRatio) || 1, 1, Math.min(2, Number(options.dprCap) || 1.5));
      canvas.width = background.width = Math.round(width * dpr);
      canvas.height = background.height = Math.round(height * dpr);
      laneWidth = Math.min(width * .94, height * 1.24) / 3;
      horizon = height * .285; ground = height * .84;
      actorHeight = clamp(Math.min(height * .2, laneWidth * .85), 57, 128);
      metrics.dpr = dpr; cacheScene();
    }
    function cacheScene() {
      cacheBackground();
      const fog = map?.fog || '#355b60';
      const top = horizon - height * (map?.road ? .23 : .05);
      horizonFog = context.createLinearGradient(0, top, 0, horizon + height * (map?.road ? .19 : .16));
      const stops = map?.road ? [[0, '00'], [.21, '16'], [.46, '63'], [.69, 'ab'], [.80, '7a'], [.93, '19'], [1, '00']] :
        [[0, '00'], [.18, '59'], [.34, 'db'], [.53, 'e0'], [.70, 'ad'], [.86, '38'], [1, '00']];
      for (const [stop, alpha] of stops) horizonFog.addColorStop(stop, fog + alpha);
    }
    function strip(left, right, front, end, color, step = 12) {
      const count = Math.max(1, Math.ceil((end - front) / step));
      context.beginPath();
      for (let i = 0; i <= count; i++) {
        const p = project(left, front + (end - front) * i / count);
        if (i) context.lineTo(p.x, p.y); else context.moveTo(p.x, p.y);
      }
      for (let i = count; i >= 0; i--) {
        const p = project(right, front + (end - front) * i / count);
        context.lineTo(p.x, p.y);
      }
      context.closePath(); context.fillStyle = color; context.fill();
    }
    function biomeRoad() {
      strip(-.64, 2.64, -8, FAR, map.shade);
      strip(-.53, 2.53, -8, FAR, map.road);
      const forest = map.scene === 'forest', city = map.scene === 'neon', dock = map.scene === 'harbor';
      const pitch = forest ? 4 : city || dock ? 12 : 8;
      const offset = distance % pitch;
      for (let z = 92 - offset; z > -8; z -= pitch) {
        const a = project(-.5, z), b = project(2.5, z);
        if (!city && !dock) line(context, a.x, a.y, b.x, b.y, map.shade, Math.max(.6, a.scale * (forest ? 2.8 : 1.5)));
        if (city || dock) for (const lane of [.5, 1.5]) strip(lane - .014, lane + .014, z, z + 4, map.mark);
        else if (map.scene === 'volcano') {
          const shard = Math.floor((distance + z) / pitch) % 3;
          const x = .7 + shard * .31;
          mesh([[x,z,0],[x+.22,z+1.2,0],[x+.12,z+2.1,0]],map.edge);
        } else if (map.scene === 'desert') {
          const side = Math.floor((distance + z) / pitch) % 2 === 0 ? 0 : 2;
          strip(side - .22, side + .22, z, z + .7, map.face);
        } else if (map.scene === 'summit') {
          mesh([[-.48,z,0],[-.28,z+2,0],[-.46,z+3.1,0]],map.mark);
          mesh([[2.48,z+2,0],[2.17,z+3.8,0],[2.48,z+5,0]],map.edge);
        }
      }
      for (const lane of [-.49, 2.49]) strip(lane - .024, lane + .024, -8, FAR, map.edge);
      if (!city && !dock) for (const lane of [.5, 1.5]) strip(lane - .012, lane + .012, -8, FAR, map.mark);
    }
    function road(distance) {
      if (map?.road) { biomeRoad(); return; }
      const nearLeft = project(-.54, -6), nearRight = project(2.54, -6);
      const farLeft = project(-.54, FAR), farRight = project(2.54, FAR);
      quad(context, farLeft.x, farLeft.y, farRight.x, farRight.y, nearRight.x, nearRight.y, nearLeft.x, nearLeft.y, '#183039');
      // Continuous lane dividers and small moving inlays, no alternating tiles
      // or phase reset that flashes the entire road at high speed.
      for (const boundary of [.5, 1.5]) {
        const front = project(boundary, -6), rear = project(boundary, FAR);
        line(context, rear.x, rear.y, front.x, front.y, 'rgba(95,207,193,.4)', Math.max(.8, front.scale * 1.5));
      }
      const offset = distance % 12;
      for (let index = 7; index >= -1; index--) {
        const z = index * 12 - offset;
        const front = project(1, z), rear = project(1, z + 2);
        line(context, rear.x, rear.y, front.x, front.y, 'rgba(239,197,120,.2)', Math.max(1, front.scale * 2));
      }
      for (const edge of [-.53, 2.53]) {
        const a = project(edge, -6), b = project(edge, FAR);
        line(context, a.x, a.y, b.x, b.y, '#c3a76a', Math.max(1, width * .004));
        const c = project(edge < 1 ? edge - .06 : edge + .06, -6), d = project(edge < 1 ? edge - .06 : edge + .06, FAR);
        line(context, c.x, c.y, d.x, d.y, '#47b7a9', Math.max(1, width * .006));
      }
    }
    function column(lane, z, index) {
      const p = project(lane, z), w = laneWidth * .18 * p.scale, h = height * (.34 + index % 3 * .025) * p.scale;
      if (p.x + w < 0 || p.x - w > width) return;
      const x = p.x - w / 2, y = p.y - h, side = w * .3;
      quad(context, x + w, y, x + w + side, y - side, x + w + side, p.y - side, x + w, p.y, '#122d37');
      const stone = context.createLinearGradient(x, 0, x + w, 0);
      stone.addColorStop(0, '#304d54'); stone.addColorStop(.4, '#43666a'); stone.addColorStop(1, '#24434b');
      context.fillStyle = stone; context.fillRect(x, y, w, h);
      context.fillStyle = '#b79c64'; context.fillRect(x - w * .15, y, w * 1.3, Math.max(2, h * .035));
      context.fillStyle = '#416266'; context.fillRect(x - w * .12, p.y - h * .08, w * 1.24, h * .08);
      for (let row = 1; row < 4; row++) line(context, x, y + h * row / 4, x + w, y + h * row / 4, '#1a3740', Math.max(.5, p.scale));
      context.fillStyle = '#dfba72'; context.beginPath(); context.moveTo(p.x, y + h * .18);
      context.lineTo(p.x + w * .17, y + h * .26); context.lineTo(p.x, y + h * .34); context.lineTo(p.x - w * .17, y + h * .26); context.fill();
      line(context, p.x, y + h * .43, p.x, y + h * .7, '#65c5b4', Math.max(.7, w * .045));
    }
    function environment(distance) {
      if (map?.road) { biomeScenery(); return; }
      const offset = distance % 12;
      const segment = Math.floor(distance / 12);
      // Continuous shoulders meet the road; the buildings behind them remain
      // depth-based geometry rather than a sparse row floating over a void.
      for (const side of [-1, 1]) {
        const lane = side < 0 ? -.56 : 2.56, outer = lane + side * 3.5;
        const a = project(lane, NEAR), b = project(outer, NEAR), c = project(outer, FAR), d = project(lane, FAR);
        quad(context, a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y, '#203a40');
      }
      for (let index = 8; index >= -1; index--) {
        const z = index * 12 - offset;
        if (z + 12 < NEAR || z > FAR) continue;
        const worldIndex = segment + index;
        context.globalAlpha = clamp((FAR - z) / 10, 0, 1) * clamp((z + 12 - NEAR) / 4, 0, 1);
        for (const lane of [-.97, 2.97]) {
          const side = lane < 1 ? -1 : 1, wallLane = lane + side * .14;
          const p = project(wallLane, z), far = project(wallLane, z + 12);
          const h = height * (.29 + ((worldIndex % 3 + 3) % 3) * .025), nearTop = p.y - h * p.scale, farTop = far.y - h * far.scale;
          quad(context, p.x, p.y, far.x, far.y, far.x, farTop, p.x, nearTop, worldIndex % 2 ? '#193640' : '#1c3c44');
          line(context, p.x, nearTop, far.x, farTop, '#466567', Math.max(1, p.scale * 1.4));
          const a = project(wallLane, z + 3.5), b = project(wallLane, z + 8.5);
          const ay = a.y - h * .72 * a.scale, by = b.y - h * .72 * b.scale;
          const ab = a.y - h * .34 * a.scale, bb = b.y - h * .34 * b.scale;
          // Recessed bays follow the wall's perspective instead of floating
          // flat rectangles. Fine bevels are omitted at the horizon.
          quad(context, a.x, ay, b.x, by, b.x, bb, a.x, ab, '#102630');
          if (p.scale > .28) {
            const lip = Math.max(1, 3 * a.scale);
            quad(context, a.x, ay, b.x, by, b.x, by + lip, a.x + side * lip, ay + lip, '#587477');
            line(context, a.x, ay + lip, a.x, ab, '#091c27', Math.max(1, a.scale * 3));
            line(context, a.x, ab, b.x, bb, '#3c5c63', Math.max(1, a.scale * 2));
            line(context, p.x, p.y - h * .18 * p.scale, far.x, far.y - h * .18 * far.scale, '#102c36', Math.max(1, p.scale));
          }
          const niche = project(wallLane, z + 6), nw = laneWidth * .035 * niche.scale;
          context.fillStyle = '#a88e5a'; context.fillRect(niche.x - nw / 2, niche.y - h * .58 * niche.scale, nw, h * .11 * niche.scale);
          if (z >= NEAR) column(lane, z, (worldIndex % 3 + 3) % 3);
        }
      }
      context.globalAlpha = 1;
    }
    function biomeScenery() {
      const { scene, face, shade, light, edge, dark } = map;
      const gap = scene === 'forest' ? 13 : 17;
      for (const side of [-1, 1]) {
        const lane = side < 0 ? -.65 : 2.65;
        strip(Math.min(lane, lane + side * 4), Math.max(lane, lane + side * 4), -8, FAR, shade);
      }
      const far = 100 - distance % gap;
      for (let z = far; z >= -9; z -= gap) {
        context.globalAlpha = clamp((96 - z) / 21, 0, 1);
        for (const lane of [-.93, 2.93]) {
          const p = project(lane, z), x = p.x, y = p.y, w = laneWidth * p.scale * .65, h = actorHeight * p.scale;
          if (x < -w * 2 || x > width + w * 2) continue;
          if (scene === 'forest') {
            context.fillStyle = face; context.fillRect(x - w * .12, y - h * 2.1, w * .24, h * 2.1);
            for (let k = 0; k < 3; k++) polygon(context, [x, y - h * (3 - k * .44), x - w * (.55 + k * .16), y - h * (1.98 - k * .49), x + w * (.55 + k * .16), y - h * (1.98 - k * .49)], k % 2 ? shade : '#39654a');
            if (p.scale > .3) polygon(context, [x,y-h*3,x+w*.26,y-h*1.08,x+w*.87,y-h,x,y-h*1.39], '#60845b');
          } else if (scene === 'volcano' || scene === 'summit') {
            polygon(context, [x-w*.62,y,x-w*.52,y-h*.7,x-w*.22,y-h*1.58,x+w*.24,y-h*1.44,x+w*.65,y-h*.58,x+w*.7,y], face);
            polygon(context, [x-w*.22,y-h*1.58,x+w*.24,y-h*1.44,x+w*.65,y-h*.58,x,y-h*.79], scene === 'summit' ? light : shade);
            if (scene === 'volcano') line(context,x-w*.32,y-h*.82,x+w*.11,y-h*.16,edge,Math.max(1,p.scale*2));
          } else if (scene === 'desert') {
            polygon(context, [x-w*.38,y,x-w*.27,y-h*1.66,x,y-h*2.03,x+w*.24,y-h*1.66,x+w*.36,y], face);
            polygon(context, [x,y-h*2.03,x+w*.24,y-h*1.66,x+w*.36,y,x,y], shade);
            for (let k=1;k<4;k++) line(context,x-w*.16,y-h*k*.32,x+w*.14,y-h*k*.32,light,Math.max(1,p.scale));
          } else {
            const top = y - h * (scene === 'harbor' ? 1.04 : 2.45);
            quad(context,x-w*.62,top,x+w*.56,top,x+w*.69,y,x-w*.62,y,face);
            quad(context,x+w*.56,top,x+w*.84,top-h*.18,x+w*.96,y-h*.18,x+w*.69,y,shade);
            for (let k=1;k<5;k++) {
              if (scene === 'harbor') line(context,x-w*.61+k*w*.22,top,x-w*.59+k*w*.22,y,dark,Math.max(1,p.scale*2));
              else line(context,x-w*.51,top+k*h*.37,x+w*.38,top+k*h*.37,k%2?edge:light,Math.max(1,p.scale*3));
            }
          }
        }
      }
      context.globalAlpha = 1;
    }
    function shadow(x, y, w, h, alpha = .3) {
      context.fillStyle = `rgba(0,7,12,${alpha})`; context.beginPath(); context.ellipse(x, y, w, h, 0, 0, Math.PI * 2); context.fill();
    }
    function coin(entity, p, time) {
      const phase = time * .005 + (Number(entity.id) || 0), radius = laneWidth * .095 * p.scale;
      const x = p.x, y = p.y - actorHeight * (entity.height ?? .44) * p.scale + Math.sin(phase * 1.7) * radius * .12;
      shadow(x, p.y + 1, radius * 1.25, radius * .28, .23);
      const face = Math.max(.14, Math.abs(Math.cos(phase))), thickness = radius * .25 * Math.abs(Math.sin(phase));
      context.save(); context.translate(x, y);
      context.fillStyle = '#a66d26'; context.beginPath(); context.ellipse(thickness, 0, radius * face, radius, 0, 0, Math.PI * 2); context.fill();
      context.fillRect(0, -radius, thickness, radius * 2);
      context.scale(face, 1);
      const metal = context.createLinearGradient(-radius, -radius, radius, radius);
      metal.addColorStop(0, '#fff0a5'); metal.addColorStop(.45, '#f7c558'); metal.addColorStop(1, '#a96520');
      context.fillStyle = metal; context.strokeStyle = '#ffdc80'; context.lineWidth = Math.max(.5, radius * .12);
      context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.fill(); context.stroke();
      context.strokeStyle = '#9c6d2a'; context.lineWidth = Math.max(.6, radius * .07);
      context.beginPath(); context.arc(0, 0, radius * .65, 0, Math.PI * 2); context.stroke();
      context.fillStyle = '#fff0a6'; context.beginPath(); context.moveTo(0, -radius * .45); context.lineTo(radius * .3, 0); context.lineTo(0, radius * .45); context.lineTo(-radius * .3, 0); context.fill(); context.restore();
    }
    function biomeObstacle(type, p, w, h) {
      const { scene, face, shade, light, edge, dark } = map;
      const x = p.x, y = p.y, a = x - w / 2, b = x + w / 2;
      if (type === 'overhead' || type === 'duckwall') {
        const bottom = y - h * .58, top = y - h * (type === 'duckwall' ? 1.65 : .76);
        for (const side of [-1, 1]) {
          const post = x + side * w * .44;
          polygon(context, [post-w*.07,y,post-w*.06,top,post+w*.045,top-h*.09,post+w*.075,y], shade);
        }
        const faceted = scene === 'forest' || scene === 'summit' || scene === 'volcano';
        polygon(context, [a,bottom,a,top,x-w*.24,top-h*(faceted ? .12 : .045),b,top,b+w*.05,bottom-h*.03], face);
        line(context,a,bottom,b,bottom,light,Math.max(1,p.scale*2));
        if (type === 'duckwall') for (let i = -1; i <= 1; i++) {
          const center = x + i * w * .24, mid = (top + bottom) / 2;
          line(context,center-w*.07,mid-h*.08,center,mid,edge,Math.max(1,p.scale*3));
          line(context,center,mid,center+w*.07,mid-h*.08,edge,Math.max(1,p.scale*3));
        }
        return;
      }
      const low = type === 'low' || type === 'lowbar', top = y - h * (low ? .37 : 1.4);
      if (scene === 'forest' || scene === 'volcano' || scene === 'summit') {
        polygon(context, [a,y,x-w*.47,y-(y-top)*.57,x-w*.26,top,x+w*.19,top-h*.04,b,top+(y-top)*.38,b,y-h*.05], face);
        polygon(context, [x-w*.26,top,x+w*.19,top-h*.04,b,top+(y-top)*.38,x+w*.03,top+(y-top)*.30], scene === 'summit' ? light : scene === 'forest' ? '#809956' : shade);
        polygon(context, [x+w*.03,top+(y-top)*.30,b,top+(y-top)*.38,b,y-h*.05,x+w*.18,y], shade);
        if (scene === 'volcano') line(context,x-w*.25,top+(y-top)*.45,x+w*.10,y-h*.07,edge,Math.max(1,p.scale*2));
        return;
      }
      const crown = scene === 'desert' ? w * .14 : scene === 'neon' ? w * .12 : 0;
      polygon(context, [a,y,a+crown,top,b-crown,top,b,y], face);
      polygon(context, [a+crown,top,a+crown+w*.09,top-h*.09,b-crown+w*.09,top-h*.09,b-crown,top], edge);
      polygon(context, [b-crown,top,b-crown+w*.09,top-h*.09,b+w*.09,y-h*.09,b,y], shade);
      if (scene === 'desert') {
        for (let i = 1; i <= (low ? 1 : 4); i++) line(context,a+w*.16,top+(y-top)*i/5,b-w*.16,top+(y-top)*i/5,dark,Math.max(1,p.scale));
      } else if (scene === 'harbor') {
        for (let i = 1; i < 6; i++) line(context,a+w*i/6,top+h*.07,a+w*i/6,y-h*.05,dark,Math.max(1,p.scale*2));
      } else {
        quad(context,a+w*.22,top+(y-top)*.25,b-w*.22,top+(y-top)*.25,b-w*.13,y-(y-top)*.35,a+w*.13,y-(y-top)*.35,dark);
        line(context,a+w*.19,y-(y-top)*.32,b-w*.19,y-(y-top)*.32,light,Math.max(1,p.scale*3));
      }
    }
    function obstacle(entity, p, foreground = false) {
      const type = entity.obstacleType || entity.type;
      const w = laneWidth * .72 * p.scale, h = actorHeight * p.scale;
      if (!foreground && (type !== 'train' || entity.z >= NEAR)) shadow(p.x, p.y, w * .58, h * .1, .36);
      if (type === 'train') {
        // Fixed world vertices; clip faces at the camera instead of sliding
        // individual roof/ramp vertices along the truck as it passes.
        const vertex = (offset, side, level = root.LootLinguaRunnerEngine.vehicleSurface(entity, -offset)) => [entity.lane + side * .38, entity.z + offset, level];
        const face = (from, to, color) => mesh([vertex(from, -1), vertex(to, -1), vertex(to, 1), vertex(from, 1)], color);
        const edge = (from, to, side, color, size = 1) => mesh([vertex(from, side), vertex(to, side)], color, size);
        const end = entity.length, cab = end - 3;
        if (map?.vehicle) {
          const tracked = map.vehicle === 'crawler' || map.vehicle === 'snow';
          const slats = map.vehicle === 'timber' || map.vehicle === 'freight';
          const nose = map.vehicle === 'metro' ? 4.6 : map.vehicle === 'expedition' ? 3.8 : 2.8;
          face(end, end + VEHICLE_EXIT, map.road);
          for (const side of [-1, 1]) {
            mesh([vertex(0,side,0),vertex(VEHICLE_RAMP,side),vertex(end,side),vertex(end,side,.09),vertex(VEHICLE_RAMP,side,.09)], map.shade);
            if (tracked) {
              mesh([vertex(5,side,.09),vertex(end-.4,side,.09),vertex(end-.4,side,.31),vertex(5,side,.31)], map.dark);
              for (const z of [7, 11, 15, 18]) mesh([vertex(z,side,.12),vertex(z+1.5,side,.12),vertex(z+1.5,side,.27),vertex(z,side,.27)], map.mark);
            } else for (const z of [7, end-2]) {
              mesh([vertex(z-1.1,side,.07),vertex(z+1.1,side,.07),vertex(z+.7,side,.35),vertex(z-.7,side,.35)], map.dark);
            }
            mesh([vertex(end-nose,side,.89),vertex(end-.35,side,.89),vertex(end-.35,side,.53),vertex(end-nose,side,.53)], map.dark);
            for (const z of slats ? [8,10,12,14,16] : [9,15]) mesh([vertex(z,side,.36),vertex(z,side,.85)], map.edge, 1.5);
            if (map.vehicle === 'metro') mesh([vertex(7,side,.45),vertex(end-.5,side,.45)],map.light,3);
            if (map.vehicle === 'expedition') mesh([vertex(7,side,.58),vertex(10,side,.58),vertex(12,side,.35),vertex(9,side,.35)],map.light);
            if (map.vehicle === 'timber') for (const z of [7.6,10.4,13.2]) {
              mesh([vertex(z,side,.51),vertex(z+2.4,side,.51),vertex(z+2.4,side,.72),vertex(z,side,.72)], '#9d774c');
            }
          }
          mesh([vertex(end,-1),vertex(end,1),vertex(end,1,.07),vertex(end,-1,.07)], map.face);
          mesh([vertex(end,-.82,.88),vertex(end,.82,.88),vertex(end,.82,.57),vertex(end,-.82,.57)],map.dark);
          for (const side of [-1,1]) mesh([vertex(end,side*.65,.42),vertex(end,side*.91,.42),vertex(end,side*.91,.28),vertex(end,side*.65,.28)],map.light);
          face(VEHICLE_RAMP,end,map.face); face(end-nose,end,map.edge); face(0,VEHICLE_RAMP,map.shade);
          for (const z of [1,2.2,3.4,4.6,5.6]) mesh([vertex(z,-.91),vertex(z,.91)],map.mark,1);
          mesh([vertex(1.4,-.16),vertex(3.5,-.16),vertex(3.5,-.47),vertex(5.3,0),vertex(3.5,.47),vertex(3.5,.16),vertex(1.4,.16)],map.light);
          for (const side of [-1, 1]) {
            edge(0,VEHICLE_RAMP,side,map.edge,2); edge(VEHICLE_RAMP,end,side,map.mark,2);
            if (slats) for (const z of [8,11,14]) mesh([vertex(z,side*.86),vertex(z,side*.34)],map.mark,1.5);
            else edge(8,end-nose,side*.68,map.light,2);
          }
          return;
        }
        face(end, end + VEHICLE_EXIT, '#526768');
        for (const offset of [7.5, entity.length - 3]) {
          if (entity.z + offset < NEAR) continue;
          const axle = project(entity.lane, entity.z + offset), aw = laneWidth * .76 * axle.scale;
          for (const side of [-1, 1]) {
            const x = axle.x + side * aw * .48, y = axle.y - actorHeight * .08 * axle.scale;
            context.fillStyle = '#070d12'; context.beginPath(); context.ellipse(x, y, aw * .095, actorHeight * .17 * axle.scale, 0, 0, Math.PI * 2); context.fill();
            context.fillStyle = '#7b8d91'; context.beginPath(); context.ellipse(x, y, aw * .04, actorHeight * .075 * axle.scale, 0, 0, Math.PI * 2); context.fill();
          }
        }
        for (const side of [-1, 1]) {
          mesh([vertex(VEHICLE_RAMP, side), vertex(end, side), vertex(end, side, .09), vertex(VEHICLE_RAMP, side, .09)], side < 0 ? '#325b64' : '#23444e');
          // A solid loading platform, with its sides tied to the same slope
          // that supports the runner; no independent moving stair pieces.
          mesh([vertex(0, side), vertex(VEHICLE_RAMP, side), vertex(VEHICLE_RAMP, side, .09)], side < 0 ? '#77603c' : '#57462e');
        }
        mesh([vertex(end, -1), vertex(end, 1), vertex(end, 1, .1), vertex(end, -1, .1)], '#907443');
        // Paint the far cab face before its roof, preserving solid occlusion.
        mesh([vertex(end, -.82, .92), vertex(end, .82, .92), vertex(end, .82, .59), vertex(end, -.82, .59)], '#173c49');
        mesh([vertex(end, 0, .92), vertex(end, 0, .59)], '#d5b77a', 2);
        mesh([vertex(end, -.55, .4), vertex(end, .55, .4), vertex(end, .55, .27), vertex(end, -.55, .27)], '#253c42');
        for (const side of [-1, 1]) mesh([vertex(end, side * .63, .43), vertex(end, side * .88, .43), vertex(end, side * .88, .3), vertex(end, side * .63, .3)], '#ffe4a4');
        mesh([vertex(end, -.95, .16), vertex(end, .95, .16)], '#526d75', 3);
        face(VEHICLE_RAMP, end, '#719096');
        for (const offset of [10, 15]) {
          mesh([vertex(offset, -.4), vertex(offset + .65, -.4), vertex(offset + .65, .4), vertex(offset, .4)], '#aec0ba');
        }
        for (let offset = 8; offset < entity.length - 3; offset += 2.5) {
          mesh([vertex(offset, -.92), vertex(offset, .92)], '#4b6e76', Math.max(1, project(1, entity.z + offset).scale));
          for (const side of [-1, 1]) mesh([vertex(offset, side), vertex(offset, side, .2)], '#719095', 1);
        }
        face(cab, end, '#c09d61');
        mesh([vertex(cab + .6, -.45), vertex(cab + 1.3, -.45), vertex(cab + 1.3, .45), vertex(cab + .6, .45)], '#d3b47b');
        for (const side of [-1, 1]) {
          mesh([vertex(cab + .3, side, .91), vertex(end - .25, side, .91), vertex(end - .25, side, .52), vertex(cab + .3, side, .52)], '#173c49');
          mesh([vertex(cab + .45, side, .85), vertex(end - .55, side, .85), vertex(cab + .45, side, .66)], '#427582');
          mesh([vertex(cab + .2, side, .4), vertex(end - .2, side, .4)], '#e3c589', 1);
        }
        face(0, VEHICLE_RAMP, '#9c8558');
        // Grip strips and a painted uphill arrow make the loading ramp clear.
        for (const side of [-1, 1]) mesh([vertex(.3, side * .7), vertex(5.7, side * .7)], '#dfc98c', 2);
        for (let offset = 1; offset < VEHICLE_RAMP; offset++) {
          mesh([vertex(offset, -.94), vertex(offset, .94)], '#4b5a55', Math.max(1, project(1, entity.z + offset).scale * 1.5));
        }
        mesh([vertex(1.3, -.12), vertex(3.7, -.12), vertex(3.7, -.4), vertex(5.1, 0), vertex(3.7, .4), vertex(3.7, .12), vertex(1.3, .12)], '#f3d68e');
        for (const side of [-1, 1]) {
          edge(0, VEHICLE_RAMP, side, '#d1b579', 2);
          edge(VEHICLE_RAMP, end, side, '#294b55', 2);
          for (const offset of [8, 13, 18]) {
            mesh([vertex(offset, side * .92), vertex(offset, side)], '#c8ae75', 2);
          }
        }
        return;
      }
      if (map?.road) { biomeObstacle(type, p, w, h); return; }
      if (type === 'duckwall') {
        const left = p.x - w / 2, top = p.y - h * 1.65, bottom = p.y - h * .58, panelHeight = bottom - top, depth = h * .1;
        for (const post of [left, left + w * .9]) {
          context.fillStyle = '#35515b'; context.fillRect(post, top, w * .1, h * 1.65);
          quad(context, post + w * .1, top, post + w * .1 + depth, top - depth, post + w * .1 + depth, p.y - depth, post + w * .1, p.y, '#1b303a');
        }
        quad(context, left, top, left + depth, top - depth, left + w + depth, top - depth, left + w, top, '#e1bd79');
        quad(context, left + w, top, left + w + depth, top - depth, left + w + depth, bottom - depth, left + w, bottom, '#755d39');
        context.fillStyle = '#d3a65d'; context.fillRect(left, top, w, panelHeight);
        context.fillStyle = '#28434c'; context.fillRect(left + w * .06, top + panelHeight * .06, w * .88, panelHeight * .88);
        for (const level of [.2, .53]) {
          const y = top + panelHeight * level;
          quad(context, p.x, y + panelHeight * .23, left + w * .92, y, left + w * .92, y + panelHeight * .13, p.x, y + panelHeight * .36, '#e4bc70');
          quad(context, left + w * .08, y, p.x, y + panelHeight * .23, p.x, y + panelHeight * .36, left + w * .08, y + panelHeight * .13, '#e4bc70');
        }
        for (const side of [left + w * .07, left + w * .93]) for (const y of [top + panelHeight * .07, bottom - panelHeight * .07]) {
          context.fillStyle = '#182f3b'; context.beginPath(); context.arc(side, y, w * .045, 0, Math.PI * 2); context.fill();
        }
        line(context, left, bottom, left + w, bottom, '#f4d18a', Math.max(1, h * .035));
        return;
      }
      if (type === 'overhead') {
        const left = p.x - w / 2, right = p.x + w / 2, beamY = p.y - h * .72, thickness = h * .14;
        context.fillStyle = '#344c57'; context.fillRect(left, beamY, w * .08, h * .72); context.fillRect(right - w * .08, beamY, w * .08, h * .72);
        for (const post of [left, right - w * .08]) {
          quad(context, post + w * .08, beamY, post + w * .08 + h * .04, beamY - h * .06, post + w * .08 + h * .04, p.y - h * .06, post + w * .08, p.y, '#1b313d');
          line(context, post, beamY, post, p.y, '#718780', Math.max(.7, p.scale));
        }
        quad(context, left, beamY, right, beamY, right + h * .05, beamY - h * .07, left + h * .05, beamY - h * .07, '#c58a48');
        context.fillStyle = '#dbac5e'; context.fillRect(left, beamY, w, thickness);
        for (let part = 0; part < 5; part++) quad(context, left + part * w / 5, beamY, left + (part + .5) * w / 5, beamY, left + (part + 1) * w / 5, beamY + thickness, left + (part + .5) * w / 5, beamY + thickness, '#453c38');
        line(context, left, beamY + thickness, right, beamY + thickness, '#f7d38b', Math.max(.7, p.scale * 2));
        line(context, left + h * .025, beamY + thickness + h * .025, right, beamY + thickness + h * .025, '#233943', Math.max(1, p.scale * 2));
        return;
      }
      const low = type === 'low' || type === 'lowbar';
      const blockHeight = h * (low ? .37 : 1.4), x = p.x - w / 2, y = p.y - blockHeight, depth = h * .12;
      quad(context, x, y, x + depth, y - depth, x + w + depth, y - depth, x + w, y, low ? '#e0b86d' : '#94724b');
      quad(context, x + w, y, x + w + depth, y - depth, x + w + depth, p.y - depth, x + w, p.y, low ? '#7c663b' : '#5b4a37');
      context.fillStyle = low ? '#b88d48' : '#6e593e'; context.fillRect(x, y, w, blockHeight);
      line(context, x, y, x + w, y, low ? '#f4d28b' : '#c4a06a', Math.max(1, h * .025));
      line(context, x + w, y, x + w, p.y, '#3d3629', Math.max(1, h * .03));
      context.strokeStyle = low ? '#ffcf70' : '#b28d57'; context.lineWidth = Math.max(1, h * .035); context.strokeRect(x + w * .07, y + blockHeight * .08, w * .86, blockHeight * .82);
      if (low) {
        for (let part = 0; part < 4; part++) quad(context, x + part * w / 4, y, x + (part + .5) * w / 4, y, x + (part + 1) * w / 4, p.y, x + (part + .5) * w / 4, p.y, '#30444a');
      } else {
        if (p.scale > .28) {
          context.fillStyle = '#3e362b'; context.fillRect(x + w * .1, y + blockHeight * .13, w * .8, blockHeight * .74);
          context.fillStyle = '#715c40'; context.fillRect(x + w * .12, y + blockHeight * .16, w * .76, blockHeight * .68);
        }
        line(context, x + w * .08, y + blockHeight * .1, x + w * .92, y + blockHeight * .9, '#b38c57', Math.max(1, h * .05));
        line(context, x + w * .92, y + blockHeight * .1, x + w * .08, y + blockHeight * .9, '#b38c57', Math.max(1, h * .05));
      }
    }
    function archPath(x, y, w, foot, scene, open = false) {
      context.moveTo(x, foot);
      if (scene === 'harbor' || scene === 'neon') {
        const bevel = w * (scene === 'neon' ? .19 : .065);
        context.lineTo(x, y + bevel); context.lineTo(x + bevel, y); context.lineTo(x + w - bevel, y);
        context.lineTo(x + w, y + bevel);
      } else if (scene === 'volcano' || scene === 'summit') {
        context.lineTo(x, y + w * .52); context.lineTo(x + w * .22, y + w * .11);
        context.lineTo(x + w * .59, y); context.lineTo(x + w * .88, y + w * .19); context.lineTo(x + w, y + w * .48);
      } else {
        context.lineTo(x, y + w * (scene === 'desert' ? .26 : .48));
        context.quadraticCurveTo(x, y, x + w / 2, y); context.quadraticCurveTo(x + w, y, x + w, y + w * .48);
      }
      context.lineTo(x + w, foot); if (!open) context.closePath();
    }
    function portalPath(z, transit = false, scene = map?.scene) {
      const headroom = Math.max(2.4, (ground - horizon) / actorHeight + .7);
      const first = transit ? 1 : 0, last = transit ? 1 : 2;
      for (let lane = first; lane <= last; lane++) {
        const p = project(lane, z), w = laneWidth * (transit ? 3.24 : .9) * p.scale, h = actorHeight * headroom * p.scale;
        archPath(p.x - w / 2, p.y - h, w, p.y, scene);
      }
    }
    function tunnelFloor(entity) {
      const front = Math.max(NEAR, entity.z), end = Math.min(FAR + 12, entity.z + (entity.length || 42));
      if (end <= front) return;
      const style = getMap(entity.mapId) || map;
      strip(-.62, 2.62, front, end, style?.dark || '#10232d');
      for (const lane of [.5, 1.5]) {
        strip(lane - .009, lane + .009, front, end, style?.mark || '#406a70');
      }
    }
    function tunnelRing(z, style = map) {
      const headroom = Math.max(2.4, (ground - horizon) / actorHeight + .7);
      const squared = style?.scene === 'harbor' || style?.scene === 'neon';
      const rises = squared ? [0, .23, .23, .23, 0] : [0, .55, .75, .55, 0];
      return [0, .25, .5, .75, 1].map((t, index) => {
        const p = project(-.62 + 3.24 * t, z), h = headroom + rises[index];
        return { x: p.x, y: p.y - actorHeight * h * p.scale, ground: p.y, scale: p.scale };
      });
    }
    function clipToTunnel(entity, passage) {
      if (!passage || entity.z < passage.z) return;
      context.beginPath();
      const style = getMap(passage.mapId) || map;
      if (passage.z >= 0) portalPath(passage.z, passage.kind === 'passage', style?.scene);
      else {
        // Bound each depth slice to the same ceiling and walls as the shell.
        // Beyond the exit, the visible world is framed by the exit aperture.
        const arch = tunnelRing(Math.max(NEAR, Math.min(entity.z, passage.z + passage.length)), style);
        context.moveTo(arch[0].x, arch[0].ground);
        for (const point of arch) context.lineTo(point.x, point.y);
        context.lineTo(arch[4].x, arch[4].ground); context.closePath();
      }
      context.clip();
    }
    function tunnelInterior(entity) {
      const length = entity.length || 42, front = Math.max(NEAR, entity.z), end = entity.z + length;
      const style = getMap(entity.mapId) || map, transit = entity.kind === 'passage';
      if (end < NEAR) return;
      context.save();
      if (entity.z > NEAR) { context.beginPath(); portalPath(entity.z, transit, style?.scene); context.clip(); }
      const ring = z => tunnelRing(z, style);
      const near = ring(front), far = ring(end);
      if (transit && entity.z <= NEAR && end > 0) {
        context.beginPath(); context.rect(0, 0, width, height);
        context.moveTo(far[0].x, far[0].ground); for (const point of far) context.lineTo(point.x, point.y);
        context.lineTo(far[4].x, far[4].ground); context.closePath();
        context.fillStyle = style?.dark || '#10232d'; context.fill('evenodd');
        tunnelFloor(entity);
        if (!entity.changed) {
          context.beginPath(); context.moveTo(far[0].x, far[0].ground);
          for (const point of far) context.lineTo(point.x, point.y);
          context.lineTo(far[4].x, far[4].ground); context.closePath();
          context.fillStyle = style?.dark || '#10232d'; context.fill();
        }
      }
      quad(context, near[0].x, near[0].ground, far[0].x, far[0].ground, far[0].x, far[0].y, near[0].x, near[0].y, style?.face || '#203d46');
      quad(context, near[4].x, near[4].ground, far[4].x, far[4].ground, far[4].x, far[4].y, near[4].x, near[4].y, style?.shade || '#132c38');
      for (let i = 0; i < 4; i++) quad(context, near[i].x, near[i].y, near[i + 1].x, near[i + 1].y, far[i + 1].x, far[i + 1].y, far[i].x, far[i].y, i < 2 ? style?.shade || '#1b3541' : style?.dark || '#122a36');
      for (let offset = length; offset >= 0; offset -= 6) {
        const z = entity.z + offset;
        if (z < NEAR || z > FAR) continue;
        const arch = ring(z);
        context.strokeStyle = offset === length ? style?.edge || '#7ca7a0' : style?.face || '#36575f'; context.lineWidth = Math.max(1, arch[0].scale * 4);
        context.beginPath(); context.moveTo(arch[0].x, arch[0].ground);
        for (const p of arch) context.lineTo(p.x, p.y);
        context.lineTo(arch[4].x, arch[4].ground); context.stroke();
      }
      for (let offset = 8; offset < length; offset += 18) {
        const z = entity.z + offset;
        if (z < NEAR || z > FAR) continue;
        for (const lane of [-.6, 2.6]) {
          const p = project(lane, z), y = p.y - actorHeight * .95 * p.scale;
          context.fillStyle = style?.light || '#dfbc70'; context.fillRect(p.x - p.scale * 2, y, p.scale * 4, actorHeight * .14 * p.scale);
        }
      }
      context.restore();
    }
    function gate(entity, state) {
      if (entity.z <= NEAR) return;
      const headroom = Math.max(2.4, (ground - horizon) / actorHeight + .7);
      const style = getMap(entity.mapId) || map, scene = style?.scene, transit = entity.kind === 'passage';
      if (!entity.resolved) {
        if (!transit) { context.beginPath(); portalPath(entity.z, false, scene); context.fillStyle = '#030a12'; context.fill(); }
      }
      const left = project(-2.4, entity.z), right = project(4.4, entity.z), center = project(1, entity.z);
      const peak = center.y - actorHeight * (headroom + 1.8) * center.scale;
      const mountainPath = () => {
        if (scene === 'harbor' || scene === 'neon' || scene === 'desert') {
          context.moveTo(left.x, left.y); context.lineTo(left.x, peak + actorHeight * .69 * center.scale);
          context.lineTo(right.x, peak + actorHeight * .69 * center.scale); context.lineTo(right.x, right.y); context.closePath(); return;
        }
        context.moveTo(left.x, left.y); context.lineTo(left.x, peak + actorHeight * center.scale);
        context.lineTo(center.x - laneWidth * center.scale, peak + actorHeight * .2 * center.scale);
        context.lineTo(center.x + laneWidth * .3 * center.scale, peak);
        context.lineTo(right.x, peak + actorHeight * .95 * center.scale); context.lineTo(right.x, right.y); context.closePath();
      };
      context.save(); context.beginPath(); mountainPath(); portalPath(entity.z, transit, scene); context.clip('evenodd');
      context.fillStyle = style?.shade || '#28414b'; context.fillRect(0, 0, width, height);
      quad(context, left.x, left.y, left.x, peak, center.x, peak, center.x - laneWidth * center.scale, center.y, style?.face || '#3c565d');
      quad(context, center.x, peak, right.x, peak, right.x, right.y, center.x + laneWidth * .8 * center.scale, center.y, style?.dark || '#1d3440');
      line(context, left.x, peak + actorHeight * center.scale, right.x, peak + actorHeight * .95 * center.scale, style?.edge || '#526c6d', Math.max(1, center.scale * 3));
      if (style?.road) for (let i = -2; i <= 2; i++) {
        const p = project(1 + i * 1.1, entity.z), top = peak + actorHeight * 1.05 * center.scale;
        line(context, p.x, top, p.x + (scene === 'forest' ? i * laneWidth * .2 * center.scale : 0), p.y, style.face, Math.max(1, center.scale * 4));
      }
      context.restore();
      for (let lane = transit ? 1 : 0; lane <= (transit ? 1 : 2); lane++) {
        const p = project(lane, entity.z), w = laneWidth * (transit ? 3.24 : .9) * p.scale, h = actorHeight * headroom * p.scale;
        const x = p.x - w / 2, y = p.y - h, rim = Math.max(2, w * .085);
        context.strokeStyle = style?.face || '#405861'; context.lineWidth = rim * (transit ? .75 : 1.5);
        context.beginPath(); archPath(x, y, w, p.y, scene, true); context.stroke();
        context.strokeStyle = transit ? style?.edge || '#7ca7a0' : entity.resolved && state.feedback?.chosenLane === lane ? state.feedback.correct ? '#81f6a5' : '#fa8278' : laneColors[lane];
        context.lineWidth = Math.max(1, rim * .25); context.stroke();
      }
    }
    function limb(ax, ay, bx, by, cx, cy, color, thickness) {
      context.strokeStyle = color; context.lineWidth = thickness; context.lineCap = 'round'; context.lineJoin = 'round';
      context.beginPath(); context.moveTo(ax, ay); context.lineTo(bx, by); context.lineTo(cx, cy); context.stroke();
      // A narrow lit face gives limbs volume without meshes or blur passes.
      const alpha = context.globalAlpha, offset = thickness * .17;
      context.globalAlpha = alpha * .16; context.strokeStyle = '#d3e8d6'; context.lineWidth = thickness * .24;
      context.beginPath(); context.moveTo(ax - offset, ay); context.lineTo(bx - offset, by); context.lineTo(cx - offset, cy); context.stroke();
      context.globalAlpha = alpha;
    }
    function head(x, y, radius) {
      context.fillStyle = '#d8a579'; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#b88059'; context.beginPath(); context.arc(x, y, radius, -Math.PI / 2, Math.PI / 2);
      context.quadraticCurveTo(x + radius * .24, y, x, y - radius); context.fill();
      context.fillStyle = '#edbf8b'; context.beginPath(); context.ellipse(x - radius * .44, y - radius * .08, radius * .2, radius * .58, -.12, 0, Math.PI * 2); context.fill();
    }
    function actor(state, delta) {
      visualLane += (clamp(Number(state.lane) || 0, 0, 2) - visualLane) * (1 - Math.exp(-delta / 72));
      const p = project(visualLane, 0), h = actorHeight, phase = (Number(state.distance) || 0) * 1.55;
      const pose = root.LootLinguaRunnerEngine.getPose(state);
      const jumping = pose.action === 'jump', sliding = pose.action === 'slide';
      const elevation = pose.feet * h;
      const sway = jumping || sliding ? 0 : -Math.abs(Math.sin(phase)) * h * .025;
      shadow(p.x, p.y - pose.floor * h + h * .025, h * (sliding ? .34 : .25) * (1 - pose.lift * .18), h * .065, .4 - pose.lift * .18);
      context.save(); context.translate(p.x, p.y - elevation + sway);
      const impact = state.impact, age = impact ? state.elapsed - impact.startedAt : Infinity;
      if (impact && age < 320) {
        const kick = Math.sin(Math.PI * clamp(age / 320, 0, 1));
        context.translate((impact.kind === 'side' ? -impact.direction : 0) * h * .14 * kick, h * .045 * kick);
        context.rotate((impact.kind === 'side' ? -impact.direction * .2 : -.13) * kick);
        if (impact.kind === 'hit' && age < 140) context.scale(1.07, .9);
      }
      if ((!impact || state.elapsed > impact.freezeUntil) && Number(state.invulnerableUntil) > Number(state.elapsed) && Math.floor(activeTime / 80) % 2) context.globalAlpha = .58;
      drawExplorer(state, h, phase, pose);
      context.restore();
    }
    function drawExplorer(state, h, phase, pose) {
      const jumping = pose.action === 'jump', sliding = pose.action === 'slide';
      if (sliding) {
        // One leg extends toward the camera while the other stays folded.
        // All visual points remain within the shared .43-body crouch height.
        const settle = Math.min(1, Math.max(0, (state.elapsed - state.actionStartedAt) / 100));
        const tuck = h * (.025 + settle * .025);
        limb(-h * .06, -h * .15, -h * .11, -h * .075, -h * .12, 0, '#173d51', h * .12);
        limb(h * .065, -h * .15, h * .12, -h * .11, h * .13, -tuck, '#244d5e', h * .12);
        line(context, -h * .17, 0, -h * .07, 0, '#dbbe85', h * .055);
        line(context, h * .08, -tuck, h * .18, -tuck, '#dbbe85', h * .055);
        quad(context, -h * .17, -h * .27, h * .13, -h * .29, h * .18, -h * .13, -h * .15, -h * .12, '#317e80');
        quad(context, -h * .17, -h * .27, -h * .11, -h * .29, -h * .08, -h * .13, -h * .15, -h * .12, '#4a9390');
        quad(context, h * .13, -h * .29, h * .18, -h * .13, h * .12, -h * .12, h * .08, -h * .28, '#20565f');
        quad(context, -h * .09, -h * .29, h * .065, -h * .31, h * .11, -h * .17, -h * .07, -h * .15, '#0e2c3a');
        context.fillStyle = '#234b58'; rounded(context, -h * .085, -h * .28, h * .16, h * .12, h * .025); context.fill();
        line(context, -h * .07, -h * .27, h * .055, -h * .27, '#c5a46d', h * .016);
        quad(context, -h * .005, -h * .255, h * .025, -h * .22, -h * .005, -h * .19, -h * .035, -h * .22, '#f1c879');
        for (const side of [-1, 1]) limb(side * h * .16, -h * .24, side * h * .22, -h * .135, side * h * .2, -h * .065, '#d2a077', h * .07);
        head(h * .015, -h * .325, h * .095);
        context.fillStyle = '#284551'; context.beginPath(); context.arc(h * .015, -h * .335, h * .09, Math.PI, Math.PI * 2); context.fill();
        context.fillStyle = '#3f5c65'; context.beginPath(); context.ellipse(0, -h * .38, h * .055, h * .025, -.1, 0, Math.PI * 2); context.fill();
        line(context, -h * .07, -h * .325, h * .1, -h * .325, '#f4ca7a', h * .03);
      } else {
        const stride = Math.sin(phase);
        const tuck = jumping ? Math.sin(Math.PI * pose.fraction) : 0;
        const armRaise = jumping ? Math.sin(Math.PI * pose.fraction ** .7) : 0;
        // Viewed from behind: feet cycle in depth/height, never sweep sideways.
        for (const side of [-1, 1]) {
          const swing = stride * side, x = side * h * .09;
          const kneeY = -h * (.17 + (jumping ? tuck * (.11 + side * .035) : Math.max(0, swing) * .08));
          const footY = -h * (jumping ? tuck * (.16 + side * .055) : Math.max(0, swing) * .2);
          limb(x, -h * .34, x + side * h * (.018 + tuck * .045), kneeY, x - side * h * tuck * .035, footY, side < 0 ? '#173747' : '#285366', h * .125);
          const shoeX = x - side * h * tuck * .035;
          line(context, shoeX - h * .045, footY, shoeX + h * .045, footY, '#dbbe85', h * .065);
        }
        for (const side of [-1, 1]) {
          const swing = jumping ? 0 : -side * stride;
          limb(side * h * .19, -h * .68, side * h * (.27 + armRaise * .06), -h * (.47 + swing * .08 + armRaise * .18),
            side * h * (.2 + armRaise * .08), -h * (.35 + swing * .1 + armRaise * .44), '#d9ab7c', h * .09);
        }
        // Teal explorer jacket, brass belt and a small geometric loot backpack.
        context.fillStyle = '#2b7478'; rounded(context, -h * .2, -h * .76, h * .4, h * .45, h * .08); context.fill();
        quad(context, -h * .19, -h * .69, -h * .11, -h * .75, -h * .1, -h * .34, -h * .19, -h * .38, '#448f8d');
        quad(context, h * .12, -h * .75, h * .2, -h * .68, h * .19, -h * .36, h * .12, -h * .33, '#20555e');
        quad(context, -h * .12, -h * .68, -h * .085, -h * .715, h * .155, -h * .715, h * .12, -h * .68, '#3c6570');
        quad(context, h * .12, -h * .68, h * .155, -h * .715, h * .155, -h * .445, h * .12, -h * .41, '#0d2b39');
        context.fillStyle = '#143d4c'; rounded(context, -h * .12, -h * .68, h * .24, h * .27, h * .04); context.fill();
        context.strokeStyle = '#c5a46d'; context.lineWidth = h * .025; context.stroke();
        context.fillStyle = '#f1c879'; context.beginPath(); context.moveTo(0, -h * .62); context.lineTo(h * .055, -h * .55); context.lineTo(0, -h * .48); context.lineTo(-h * .055, -h * .55); context.fill();
        line(context, -h * .18, -h * .34, h * .18, -h * .34, '#cfa76a', h * .045);
        head(0, -h * .875, h * .12);
        context.fillStyle = '#284551'; context.beginPath(); context.arc(0, -h * .9, h * .122, Math.PI * .86, Math.PI * 2.14); context.fill();
        context.fillStyle = '#3f5c65'; context.beginPath(); context.ellipse(-h * .025, -h * .95, h * .075, h * .035, -.12, 0, Math.PI * 2); context.fill();
        line(context, -h * .11, -h * .87, h * .11, -h * .87, '#e6bd6c', h * .035);
        // A short scarf trails toward the camera; its flap never obscures lanes.
        quad(context, -h * .11, -h * .76, -h * .03, -h * .74, -h * (.12 + .035 * Math.sin(phase * .7)), -h * .58, -h * .18, -h * .62, '#edbd65');
      }
    }
    function opacity(entity, elapsed) {
      const span = (entity.length || 0) + (entity.obstacleType === 'train' ? VEHICLE_EXIT : 0);
      const vehicle = entity.obstacleType === 'train';
      const birth = !vehicle && Number.isFinite(entity.bornAt) ? clamp((elapsed - entity.bornAt) / 260, 0, 1) : 1;
      const spawn = root.LootLinguaRunnerEngine.constants.SPAWN_Z;
      // Vehicle faces become fully opaque within the distant fog strip,
      // before approaching the visible road; no see-through roof or sides.
      const progress = clamp((spawn - entity.z) / (vehicle ? 6 : map?.road ? 38 : 34), 0, 1);
      // Zero visibility at allocation, with a zero-slope reveal driven by
      // distance, not an observable timed fade at the spawn plane.
      const reveal = entity.kind === 'gate' ? clamp((FAR - entity.z) / 10, 0, 1) : progress * progress * (3 - 2 * progress);
      return birth * reveal * clamp((entity.z + span - NEAR) / 3, 0, 1);
    }
    function inViewport(entity) {
      const vehicle = entity.obstacleType === 'train';
      const span = (entity.length || 0) + (vehicle ? VEHICLE_EXIT : 0);
      const a = project(entity.lane ?? 1, entity.z), b = project(entity.lane ?? 1, entity.z + span);
      const half = laneWidth * (entity.kind === 'gate' ? 3.5 : .65);
      const body = entity.kind === 'gate' ? ground - horizon + actorHeight * 2.6 : actorHeight * (entity.kind === 'coin' ? (entity.height ?? .44) + .2 : 1.9);
      return Math.max(a.x + half * a.scale, b.x + half * b.scale) >= 0 &&
        Math.min(a.x - half * a.scale, b.x - half * b.scale) <= width &&
        Math.min(a.y - body * a.scale, b.y - body * b.scale) <= height && Math.max(a.y, b.y) >= 0;
    }
    function draw(input = {}) {
      if (destroyed) return metrics;
      const state = input.engine || input;
      distance = Math.max(0, Number(state.distance) || 0);
      const nextMap = getMap(state.mapId);
      if (nextMap !== map) {
        map = nextMap;
        changeDistance = state.mapTunnel ? distance : distance - 100;
        cacheScene();
      }
      const corridor = state.mapTunnel;
      const shapeMix = corridor ? (corridor.changed ? clamp((distance - changeDistance) / 42, 0, 1) : clamp((corridor.z + 27) / 42, 0, 1)) : 1;
      curve = (map?.curve || 0) * Math.sin(distance / 160) * shapeMix;
      climb = (map?.climb || 0) * (.67 + .33 * Math.sin(distance / 95)) * shapeMix;
      const elapsed = Number(state.elapsed) || 0;
      const delta = lastElapsed === null ? 16 : clamp(elapsed - lastElapsed, 0, 80);
      if (lastElapsed === null || elapsed < lastElapsed) visualLane = clamp(Number(state.lane) || 0, 0, 2);
      lastElapsed = elapsed; activeTime += delta;
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.globalAlpha = 1;
      context.drawImage(background, 0, 0, background.width, background.height, 0, 0, width, height);
      road(distance); environment(distance);
      ordered.length = vehicles.length = 0; metrics.drawn = 0; metrics.culled = 0; metrics.foreground = 0;
      for (const entity of state.entities || []) {
        if (!entity || entity.active === false || entity.z + (entity.length || 0) + (entity.obstacleType === 'train' ? VEHICLE_EXIT : 0) < NEAR || entity.z > FAR || entity.collected || entity.hit || !inViewport(entity)) { metrics.culled++; continue; }
        ordered.push(entity);
        if (entity.obstacleType === 'train') vehicles.push(entity);
      }
      ordered.sort(byDepth);
      const readingGate = ordered.find(item => item.kind === 'gate' && !item.resolved);
      const passage = ordered.find(item => item.kind === 'gate') || (corridor?.z <= FAR ? corridor : null);
      const tunnelAlpha = passage?.kind === 'passage' ? clamp((96 - passage.z) / 17, 0, 1) : passage ? opacity(passage, elapsed) : 0;
      if (passage) { context.globalAlpha = tunnelAlpha; tunnelFloor(passage); tunnelInterior(passage); context.globalAlpha = 1; }
      const pose = root.LootLinguaRunnerEngine.getPose(state);
      const inFront = entity => entity.kind === 'obstacle' && entity.obstacleType !== 'train' && entity.z < 0 && (entity.obstacleType !== 'overhead' || pose.floor < .88);
      for (const entity of ordered) {
        if (readingGate && entity !== readingGate && entity.z > readingGate.z) { metrics.culled++; continue; }
        if (entity.kind === 'gate' || inFront(entity)) continue;
        context.save(); clipToTunnel(entity, passage);
        context.globalAlpha = opacity(entity, elapsed);
        const p = project(entity.lane ?? 1, entity.z);
        if (entity.kind === 'coin') coin(entity, p, elapsed);
        else obstacle(entity, p);
        context.restore();
        metrics.drawn++;
      }
      context.globalAlpha = 1;
      // One cached gradient softens distant births without hiding the road's
      // nearby hazards. The tunnel facade stays opaque in front of this haze.
      if (!corridor || corridor.z > NEAR) {
        context.fillStyle = horizonFog; context.fillRect(0, horizon - height * (map?.road ? .23 : .05), width, height * (map?.road ? .42 : .21));
      }
      if (passage) { context.globalAlpha = tunnelAlpha; gate(passage, state); metrics.drawn++; }
      context.globalAlpha = 1;
      actor(state, delta);
      // The vehicle supports the feet, so it stays behind the actor. A beam
      // already passed by the feet is in front of the crouched body instead.
      for (const entity of ordered) {
        if (!inFront(entity)) continue;
        context.save(); clipToTunnel(entity, passage);
        context.globalAlpha = opacity(entity, elapsed);
        obstacle(entity, project(entity.lane, entity.z), true); metrics.drawn++; metrics.foreground++;
        context.restore();
      }
      context.globalAlpha = 1;
      // Soft foreground vignette keeps HUD text in the DOM readable.
      context.fillStyle = 'rgba(3,12,20,.12)'; context.fillRect(0, 0, width, height * .12);
      return metrics;
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true; ordered.length = 0;
      background.width = background.height = 1;
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    resize(options.width || 1, options.height || 1);
    return Object.freeze({ resize, draw, project, destroy });
  }
  root.LootLinguaRunnerRenderer = Object.freeze({ createRenderer, FAR, laneColors, palette });
})(window);
