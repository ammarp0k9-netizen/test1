export const WIDTH = 640;
export const HEIGHT = 540;
export const STATION = Object.freeze({ x: 320, y: 262, reach: 86 });
export const DOCKS = [{ x: 34, y: 108 }, { x: 606, y: 108 }, { x: 34, y: 434 }, { x: 606, y: 434 }];
export const DEFAULT_ARENA = { width: WIDTH, height: HEIGHT, station: STATION, docks: DOCKS };
export const CUES = Object.freeze({ fire: 1, hit: 2, destroy: 4, coin: 8, station: 16, correct: 32, wrong: 64,
  boss: 128, victory: 256, damage: 512, dash: 1024, shield: 2048, reload: 4096 });

export function arenaForAspect(aspect) {
  const ratio = Math.max(.64, Math.min(1.95, aspect || WIDTH / HEIGHT));
  const width = Math.round(Math.sqrt(WIDTH * HEIGHT * ratio));
  const height = Math.round(width / ratio);
  return { width, height, station: { x: width / 2, y: height * .485, reach: STATION.reach },
    docks: DOCKS.map(dock => ({ x: dock.x < WIDTH / 2 ? 34 : width - 34, y: height * dock.y / HEIGHT })) };
}

export function makeCover({ width, height, station }) {
  return [
    { ...station, radius: 39, kind: 'station' },
    { x: width * .24, y: height * .37, radius: 23, kind: 'pillar' },
    { x: width * .76, y: height * .67, radius: 23, kind: 'pillar' },
    { x: width * .72, y: height * .28, radius: 22, kind: 'crate', hp: 2 },
    { x: width * .27, y: height * .73, radius: 25, kind: 'cell', hp: 3 },
    { x: width * .78, y: height * .47, radius: 20, kind: 'crate', hp: 2 },
  ];
}

export function moveSolid(actor, dx, dy, radius, arena, cover, steer = false) {
  const edge = radius + 7;
  const length = Math.hypot(dx, dy);
  if (steer && length > 0) {
    const ux = dx / length, uy = dy / length;
    for (const object of cover) {
      const ox = object.x - actor.x, oy = object.y - actor.y, front = ox * ux + oy * uy;
      const side = ux * oy - uy * ox, reach = object.radius + radius;
      if (front <= 0 || front > reach + 22 || Math.abs(side) > reach + 6) continue;
      const turn = side >= 0 ? -1 : 1;
      dx = (ux * .48 - uy * turn * .88) * length;
      dy = (uy * .48 + ux * turn * .88) * length;
      break;
    }
  }
  let x = Math.max(edge, Math.min(arena.width - edge, actor.x + dx));
  let y = Math.max(edge, Math.min(arena.height - edge, actor.y + dy));
  for (const object of cover) {
    const ox = x - object.x, oy = y - object.y, gap = Math.hypot(ox, oy), reach = object.radius + radius;
    if (gap >= reach) continue;
    if (gap > .001) { x = object.x + ox / gap * reach; y = object.y + oy / gap * reach; }
    else { x = object.x; y = object.y + reach; }
  }
  actor.x = Math.max(edge, Math.min(arena.width - edge, x));
  actor.y = Math.max(edge, Math.min(arena.height - edge, y));
}

export function shotCover(cover, x, y, nextX, nextY) {
  const dx = nextX - x, dy = nextY - y, span = dx * dx + dy * dy;
  let target = -1, nearest = Infinity;
  for (let i = 0; i < cover.length; i++) {
    const object = cover[i], px = object.x - x, py = object.y - y;
    const t = span ? Math.max(0, Math.min(1, (px * dx + py * dy) / span)) : 0;
    if (t >= nearest || (px - t * dx) ** 2 + (py - t * dy) ** 2 > object.radius ** 2) continue;
    target = i; nearest = t;
  }
  return target;
}
export const isFighting = ({ phase }) => phase === 'combat' || phase === 'approach' || phase === 'boss-warning' || phase === 'boss';
export const canDecode = state => {
  if (state.phase !== 'approach' || state.phaseTime < 2.4) return false;
  const station = state.arena?.station || STATION;
  const gap = Math.hypot(state.player.x - station.x, state.player.y - station.y);
  return gap >= 49 && gap <= station.reach;
};
