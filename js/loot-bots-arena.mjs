export const WIDTH = 640;
export const HEIGHT = 540;
export const STATION = Object.freeze({ x: 320, y: 262, reach: 86 });
export const DOCKS = [{ x: 34, y: 108 }, { x: 606, y: 108 }, { x: 34, y: 434 }, { x: 606, y: 434 }];
export const isFighting = ({ phase }) => phase === 'combat' || phase === 'approach' || phase === 'boss-warning' || phase === 'boss';
export const canDecode = state => state.phase === 'approach' && state.phaseTime >= 2.4 &&
  Math.hypot(state.player.x - STATION.x, state.player.y - STATION.y) <= STATION.reach;
