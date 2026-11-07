/* LootLingua Runner: visual projection only. No DOM reads, rewards or physics. */
(function(root) {
  'use strict';
  const FAR = 80;
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
    let destroyed = false, visualLane = 1, lastElapsed = null, activeTime = 0;
    const ordered = [], vehicles = [];
    const metrics = { drawn: 0, culled: 0, dpr: 1 };
    const byDepth = (a, b) => b.z - a.z;

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
    function project(lane, z) {
      const depth = Number(z) || 0, scale = 17 / Math.max(2, 17 + depth);
      return { x: width / 2 + ((Number(lane) || 0) - 1) * laneWidth * scale,
        y: horizon + (ground - horizon) * scale, scale, laneWidth: laneWidth * scale,
        visible: depth >= NEAR && depth <= FAR,
        gateTop: horizon + (ground - horizon) * scale - actorHeight * 1.48 * scale,
        labelY: horizon + (ground - horizon) * scale - actorHeight * 1.16 * scale };
    }
    function cacheBackground() {
      back.setTransform(dpr, 0, 0, dpr, 0, 0);
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
      metrics.dpr = dpr; cacheBackground();
    }
    function road(distance) {
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
    function shadow(x, y, w, h, alpha = .3) {
      context.fillStyle = `rgba(0,7,12,${alpha})`; context.beginPath(); context.ellipse(x, y, w, h, 0, 0, Math.PI * 2); context.fill();
    }
    function coin(entity, p, time) {
      const phase = time * .005 + (Number(entity.id) || 0), radius = laneWidth * .095 * p.scale;
      const x = p.x, y = p.y - actorHeight * (entity.height ?? .44) * p.scale + Math.sin(phase * 1.7) * radius * .12;
      shadow(x, p.y + 1, radius * 1.25, radius * .28, .23);
      context.save(); context.translate(x, y); context.scale(Math.max(.23, Math.abs(Math.cos(phase))), 1);
      const metal = context.createLinearGradient(-radius, -radius, radius, radius);
      metal.addColorStop(0, '#fff0a5'); metal.addColorStop(.45, '#f7c558'); metal.addColorStop(1, '#a96520');
      context.fillStyle = metal; context.strokeStyle = '#ffdc80'; context.lineWidth = Math.max(.5, radius * .12);
      context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.fill(); context.stroke();
      context.strokeStyle = '#9c6d2a'; context.lineWidth = Math.max(.6, radius * .07);
      context.beginPath(); context.arc(0, 0, radius * .65, 0, Math.PI * 2); context.stroke();
      context.fillStyle = '#fff0a6'; context.beginPath(); context.moveTo(0, -radius * .45); context.lineTo(radius * .3, 0); context.lineTo(0, radius * .45); context.lineTo(-radius * .3, 0); context.fill(); context.restore();
    }
    function obstacle(entity, p, foreground = false) {
      const type = entity.obstacleType || entity.type;
      const w = laneWidth * .72 * p.scale, h = actorHeight * p.scale;
      if (!foreground) shadow(p.x, p.y, w * .58, h * .1, .36);
      if (type === 'train') {
        const point = position => {
          const p = project(entity.lane, entity.z + position);
          const level = root.LootLinguaRunnerEngine.vehicleSurface(entity, -position);
          return { ...p, w: laneWidth * .76 * p.scale, top: p.y - actorHeight * level * p.scale };
        };
        const rear = point(0), ramp = point(VEHICLE_RAMP), end = point(entity.length), exit = point(entity.length + VEHICLE_EXIT), cab = point(entity.length - 3);
        // The front descent begins AFTER the complete golden cab. Every top
        // vertex uses the same support function as the runner's feet.
        quad(context, end.x - end.w / 2, end.top, end.x + end.w / 2, end.top, exit.x + exit.w / 2, exit.y, exit.x - exit.w / 2, exit.y, '#526768');
        line(context, end.x, end.top, exit.x, exit.y, '#829594', Math.max(1, end.scale * 2));
        for (const offset of [7.5, entity.length - 3]) {
          const axle = project(entity.lane, entity.z + offset), aw = laneWidth * .76 * axle.scale;
          for (const side of [-1, 1]) {
            const x = axle.x + side * aw * .48, y = axle.y - actorHeight * .08 * axle.scale;
            context.fillStyle = '#070d12'; context.beginPath(); context.ellipse(x, y, aw * .095, actorHeight * .17 * axle.scale, 0, 0, Math.PI * 2); context.fill();
            context.fillStyle = '#7b8d91'; context.beginPath(); context.ellipse(x, y, aw * .04, actorHeight * .075 * axle.scale, 0, 0, Math.PI * 2); context.fill();
          }
        }
        for (const side of [-1, 1]) {
          quad(context, ramp.x + side * ramp.w / 2, ramp.top, end.x + side * end.w / 2, end.top,
            end.x + side * end.w / 2, end.y - actorHeight * .09 * end.scale,
            ramp.x + side * ramp.w / 2, ramp.y - actorHeight * .09 * ramp.scale, side < 0 ? '#325b64' : '#23444e');
        }
        quad(context, end.x - end.w / 2, end.top, end.x + end.w / 2, end.top, end.x + end.w / 2, end.y - actorHeight * .1 * end.scale, end.x - end.w / 2, end.y - actorHeight * .1 * end.scale, '#907443');
        quad(context, ramp.x - ramp.w / 2, ramp.top, end.x - end.w / 2, end.top, end.x + end.w / 2, end.top, ramp.x + ramp.w / 2, ramp.top, '#719096');
        for (const offset of [10, 15]) {
          const vent = point(offset), vw = vent.w * .4;
          context.fillStyle = '#aec0ba'; context.fillRect(vent.x - vw / 2, vent.top - actorHeight * .04 * vent.scale, vw, actorHeight * .06 * vent.scale);
          line(context, vent.x - vw * .4, vent.top, vent.x + vw * .4, vent.top, '#405e68', Math.max(1, vent.scale));
        }
        for (let offset = 8; offset < entity.length - 3; offset += 2.5) {
          const rib = point(offset);
          line(context, rib.x - rib.w * .46, rib.top, rib.x + rib.w * .46, rib.top, '#4b6e76', Math.max(1, rib.scale));
          for (const side of [-1, 1]) line(context, rib.x + side * rib.w * .5, rib.top, rib.x + side * rib.w * .5, rib.y - actorHeight * .2 * rib.scale, '#719095', Math.max(1, rib.scale));
        }
        quad(context, cab.x - cab.w / 2, cab.top, end.x - end.w / 2, end.top, end.x + end.w / 2, end.top, cab.x + cab.w / 2, cab.top, '#c09d61');
        line(context, cab.x - cab.w * .38, cab.top + actorHeight * .12 * cab.scale, cab.x + cab.w * .38, cab.top + actorHeight * .12 * cab.scale, '#203d48', Math.max(2, actorHeight * .12 * cab.scale));
        quad(context, rear.x - rear.w / 2, rear.y, rear.x + rear.w / 2, rear.y, ramp.x + ramp.w / 2, ramp.top, ramp.x - ramp.w / 2, ramp.top, '#a88e59');
        for (let offset = 1; offset < VEHICLE_RAMP; offset++) {
          const tread = point(offset);
          line(context, tread.x - tread.w * .47, tread.top, tread.x + tread.w * .47, tread.top, '#4b5a55', Math.max(1, tread.scale * 1.5));
        }
        for (const side of [-1, 1]) {
          // Vehicle edges have their own metal trim, distinct from road lines.
          line(context, rear.x + side * rear.w / 2, rear.y, ramp.x + side * ramp.w / 2, ramp.top, '#d1b579', Math.max(1, ramp.scale * 2));
          line(context, ramp.x + side * ramp.w / 2, ramp.top, end.x + side * end.w / 2, end.top, '#294b55', Math.max(2, ramp.scale * 3));
          for (const offset of [8, 13, 18]) {
            const cap = point(offset);
            line(context, cap.x + side * cap.w * .46, cap.top, cap.x + side * cap.w * .5, cap.top, '#c8ae75', Math.max(1, cap.scale * 2));
          }
        }
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
    function gate(entity, state) {
      if (!entity.resolved) {
        const a = project(-.56, entity.z), b = project(2.56, entity.z);
        const farLeft = project(-.56, FAR), farRight = project(2.56, FAR);
        // Opaque veil hides the continuing road until the physical crossing.
        quad(context, a.x, a.y, b.x, b.y, farRight.x, farRight.y, farLeft.x, farLeft.y, '#040c18');
      }
      for (let lane = 0; lane < 3; lane++) {
        const p = project(lane, entity.z), w = laneWidth * .9 * p.scale, h = actorHeight * 1.48 * p.scale;
        const x = p.x - w / 2, y = p.y - h, rim = Math.max(2, w * .085), color = laneColors[lane];
        shadow(p.x, p.y, w * .58, h * .04, .2);
        context.fillStyle = entity.resolved ? (state.feedback?.correct ? '#135846' : '#642a39') : '#040c18'; rounded(context, x + rim, y + rim, w - rim * 2, h - rim, w * .44); context.fill();
        context.strokeStyle = '#172d38'; context.lineWidth = rim * 2.8; context.lineCap = 'butt';
        context.beginPath(); context.moveTo(x + rim, p.y); context.lineTo(x + rim, y + w * .48);
        context.quadraticCurveTo(x + rim, y + rim, p.x, y + rim); context.quadraticCurveTo(x + w - rim, y + rim, x + w - rim, y + w * .48); context.lineTo(x + w - rim, p.y); context.stroke();
        context.strokeStyle = color; context.lineWidth = Math.max(1, rim * .35); context.stroke();
        context.fillStyle = '#dfbc7b'; context.fillRect(x, p.y - rim * .9, rim * 2, rim); context.fillRect(x + w - rim * 2, p.y - rim * .9, rim * 2, rim);
        context.fillStyle = color; context.beginPath(); context.moveTo(p.x, y - rim); context.lineTo(p.x + rim * .62, y + rim * .8); context.lineTo(p.x, y + rim * 2); context.lineTo(p.x - rim * .62, y + rim * .8); context.fill();
        if (entity.resolved && state.feedback?.chosenLane === lane) {
          context.strokeStyle = state.feedback.correct ? '#81f6a5' : '#fa8278'; context.lineWidth = rim * .7;
          context.beginPath(); context.moveTo(x, p.y); context.lineTo(x + w, p.y); context.stroke();
        }
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
      if (Number(state.invulnerableUntil) > Number(state.elapsed) && Math.floor(activeTime / 80) % 2) context.globalAlpha = .58;
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
        const stride = jumping ? .38 : Math.sin(phase);
        // Viewed from behind: feet cycle in depth/height, never sweep sideways.
        for (const side of [-1, 1]) {
          const swing = stride * side, x = side * h * .09;
          const kneeY = -h * (.17 + Math.max(0, swing) * .08);
          const footY = jumping ? -h * (.12 + side * .035) : -h * Math.max(0, swing) * .2;
          limb(x, -h * .34, x + side * h * .018, kneeY, x, footY, side < 0 ? '#173747' : '#285366', h * .125);
          line(context, x - h * .045, footY, x + h * .045, footY, '#dbbe85', h * .065);
        }
        limb(-h * .19, -h * .68, -h * .27, -h * (.47 + stride * .08), -h * .2, -h * (.35 + stride * .1), '#d9ab7c', h * .09);
        limb(h * .19, -h * .68, h * .27, -h * (.47 - stride * .08), h * .2, -h * (.35 - stride * .1), '#d9ab7c', h * .09);
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
      context.restore();
    }
    function opacity(entity, elapsed) {
      const span = (entity.length || 0) + (entity.obstacleType === 'train' ? VEHICLE_EXIT : 0);
      const birth = Number.isFinite(entity.bornAt) ? clamp((elapsed - entity.bornAt) / 260, 0, 1) : 1;
      return birth * clamp((FAR - entity.z) / 10, 0, 1) * clamp((entity.z + span - NEAR) / 3, 0, 1);
    }
    function inViewport(entity) {
      const vehicle = entity.obstacleType === 'train';
      const span = (entity.length || 0) + (vehicle ? VEHICLE_EXIT : 0);
      const a = project(entity.lane ?? 1, entity.z), b = project(entity.lane ?? 1, entity.z + span);
      const half = laneWidth * (entity.kind === 'gate' ? 1.65 : .65);
      const body = actorHeight * (entity.kind === 'gate' ? 1.65 : entity.kind === 'coin' ? (entity.height ?? .44) + .2 : 1.6);
      return Math.max(a.x + half * a.scale, b.x + half * b.scale) >= 0 &&
        Math.min(a.x - half * a.scale, b.x - half * b.scale) <= width &&
        Math.min(a.y - body * a.scale, b.y - body * b.scale) <= height && Math.max(a.y, b.y) >= 0;
    }
    function draw(input = {}) {
      if (destroyed) return metrics;
      const state = input.engine || input;
      const elapsed = Number(state.elapsed) || 0;
      const delta = lastElapsed === null ? 16 : clamp(elapsed - lastElapsed, 0, 80);
      if (lastElapsed === null || elapsed < lastElapsed) visualLane = clamp(Number(state.lane) || 0, 0, 2);
      lastElapsed = elapsed; activeTime += delta;
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.globalAlpha = 1;
      context.drawImage(background, 0, 0, background.width, background.height, 0, 0, width, height);
      const distance = Math.max(0, Number(state.distance) || 0);
      road(distance); environment(distance);
      ordered.length = vehicles.length = 0; metrics.drawn = 0; metrics.culled = 0; metrics.foreground = 0;
      for (const entity of state.entities || []) {
        if (!entity || entity.active === false || entity.z + (entity.length || 0) + (entity.obstacleType === 'train' ? VEHICLE_EXIT : 0) < NEAR || entity.z > FAR || entity.collected || entity.hit || !inViewport(entity)) { metrics.culled++; continue; }
        ordered.push(entity);
        if (entity.obstacleType === 'train') vehicles.push(entity);
      }
      ordered.sort(byDepth);
      const readingGate = ordered.find(item => item.kind === 'gate' && !item.resolved);
      const pose = root.LootLinguaRunnerEngine.getPose(state);
      const inFront = entity => entity.kind === 'obstacle' && entity.obstacleType !== 'train' && entity.z < 0 && (entity.obstacleType !== 'overhead' || pose.floor < .88);
      for (const entity of ordered) {
        if (readingGate && entity !== readingGate && entity.z > readingGate.z) { metrics.culled++; continue; }
        if (entity.kind === 'coin' || inFront(entity)) continue;
        context.globalAlpha = opacity(entity, elapsed);
        const p = project(entity.lane ?? 1, entity.z);
        if (entity.kind === 'gate' || entity.type === 'gate') gate(entity, state);
        else obstacle(entity, p);
        metrics.drawn++;
      }
      // Coins on a roof are drawn above its surface. Ground coins behind a
      // vehicle are occluded instead of making the cargo body look transparent.
      for (const entity of ordered) {
        if (entity.kind !== 'coin' || readingGate && entity.z > readingGate.z) continue;
        if (vehicles.some(truck => truck.lane === entity.lane && entity.z >= truck.z && truck.z + truck.length + VEHICLE_EXIT > 0 && (entity.height ?? .44) < VEHICLE_HEIGHT)) continue;
        context.globalAlpha = opacity(entity, elapsed);
        coin(entity, project(entity.lane, entity.z), elapsed); metrics.drawn++;
      }
      context.globalAlpha = 1;
      actor(state, delta);
      // The vehicle supports the feet, so it stays behind the actor. A beam
      // already passed by the feet is in front of the crouched body instead.
      for (const entity of ordered) {
        if (!inFront(entity)) continue;
        context.globalAlpha = opacity(entity, elapsed);
        obstacle(entity, project(entity.lane, entity.z), true); metrics.drawn++; metrics.foreground++;
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
