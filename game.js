'use strict';
// ============================================================
//  GLORIA ETERNA — lógica del juego (sin dependencias)
//  Estrategia por turnos en hexágonos, con unidades que crecen
//  sin límite mediante XP y promociones.
// ============================================================

const UNIT_TYPES = {
  warrior: { name: 'Guerrero', atk: 10, def: 10, hp: 100, mv: 2, range: 0, cost: 18, vision: 2, civil: false },
  archer:  { name: 'Arquero',  atk: 9,  def: 5,  hp: 70,  mv: 2, range: 2, cost: 22, vision: 2, civil: false },
  horse:   { name: 'Jinete',   atk: 11, def: 8,  hp: 90,  mv: 4, range: 0, cost: 30, vision: 3, civil: false },
  settler: { name: 'Colono',   atk: 0,  def: 2,  hp: 40,  mv: 2, range: 0, cost: 35, vision: 2, civil: true },
};

const TERR = {
  w: { name: 'Agua',     cost: 99, pass: false, def: 1 },
  g: { name: 'Llanura',  cost: 1,  pass: true,  def: 1 },
  f: { name: 'Bosque',   cost: 2,  pass: true,  def: 1.2 },
  h: { name: 'Colinas',  cost: 2,  pass: true,  def: 1.4 },
  m: { name: 'Montaña',  cost: 99, pass: false, def: 1 },
};

// Promociones: se pueden apilar sin límite (salvo las marcadas con max)
const PROMOS = {
  atk:    { name: 'Ferocidad',     desc: '+8% de ataque por rango', max: 999 },
  def:    { name: 'Coraza',        desc: '+8% de defensa por rango', max: 999 },
  vit:    { name: 'Vitalidad',     desc: '+15 PV máximos por rango (y cura 15)', max: 999 },
  regen:  { name: 'Regeneración',  desc: '+4 PV curados por turno por rango', max: 999 },
  blood:  { name: 'Sed de sangre', desc: 'Al matar, cura 8% de sus PV máx. por rango', max: 999 },
  stride: { name: 'Zancada',       desc: '+1 movimiento cada 2 rangos (máx. +4)', max: 8 },
  reach:  { name: 'Puntería',      desc: '+1 alcance cada 3 rangos (máx. +2). Solo a distancia', max: 6 },
  aura:   { name: 'Mando',         desc: 'Aliados adyacentes: +4% ataque y defensa por rango', max: 999 },
  double: { name: 'Doble golpe',   desc: 'Ataca dos veces por turno (requiere Ferocidad 3)', max: 1 },
};

const TITLES = [[0, 'Recluta'], [3, 'Veterano'], [8, 'Curtido'], [15, 'Campeón'], [25, 'Héroe'], [40, 'Leyenda'], [60, 'Semidiós'], [90, 'Titán']];
const COLORS = ['#e63946', '#2a9d8f', '#f4a261', '#a06cd5', '#4cc9f0', '#e9c46a'];
const CITY_NAMES = ['Aurora', 'Bastión', 'Cumbre', 'Dorado', 'Éfira', 'Faro', 'Gaia', 'Halcón', 'Ítaca', 'Jade', 'Kora', 'Lumbre', 'Mirador', 'Nácar', 'Oasis', 'Pórtico', 'Quilla', 'Roca', 'Solana', 'Tálamo', 'Umbral', 'Vega', 'Xanadú', 'Yunque', 'Zafiro', 'Brisa', 'Cenit', 'Delta', 'Ébano', 'Fénix'];
const UNIT_NAMES = ['Aldric', 'Brenna', 'Cassian', 'Dara', 'Eryx', 'Fiora', 'Garrick', 'Helia', 'Ivar', 'Jora', 'Kael', 'Lyra', 'Marek', 'Nyra', 'Orin', 'Petra', 'Quill', 'Rhea', 'Soren', 'Talia', 'Ulric', 'Vera', 'Wren', 'Xander', 'Yara', 'Zeno', 'Borin', 'Cora', 'Dax', 'Elara'];

const MAX_PLAYERS = 6;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = (m) => ({ error: m });
const OK = { ok: true };

// ---------- utilidades hexagonales (odd-r, pointy-top) ----------
function neighbors(x, y, W, H) {
  const d = (y & 1)
    ? [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]]
    : [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
  const out = [];
  for (const [dx, dy] of d) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push([nx, ny]);
  }
  return out;
}
function toCube(x, y) { const q = x - ((y - (y & 1)) >> 1); return [q, y, -q - y]; }
function dist(ax, ay, bx, by) {
  const a = toCube(ax, ay), b = toCube(bx, by);
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

// ---------- generación del mapa ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function valueNoise(rng, W, H, scale) {
  const gw = Math.ceil(W / scale) + 3, gh = Math.ceil(H / scale) + 3;
  const g = []; for (let i = 0; i < gw * gh; i++) g.push(rng());
  return (x, y) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}
function generateTerrain(W, H, rng) {
  const n1 = valueNoise(rng, W, H, 8), n2 = valueNoise(rng, W, H, 4), n3 = valueNoise(rng, W, H, 3.5);
  const t = new Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let e = 0.6 * n1(x, y) + 0.3 * n2(x, y) + 0.1 * rng();
    const edge = Math.max(Math.abs(2 * x / (W - 1) - 1), Math.abs(2 * y / (H - 1) - 1));
    e -= 0.32 * Math.pow(edge, 3);
    let c;
    if (e < 0.37) c = 'w';
    else if (e > 0.70) c = 'm';
    else if (e > 0.62) c = 'h';
    else c = n3(x, y) > 0.58 ? 'f' : 'g';
    t[y * W + x] = c;
  }
  return t;
}
function pickStarts(terrain, W, H, n, rng) {
  const pass = (k) => TERR[terrain[k]].pass;
  // componentes de tierra
  const comp = new Int32Array(W * H).fill(-1); const sizes = [];
  for (let s = 0; s < W * H; s++) {
    if (comp[s] !== -1 || !pass(s)) continue;
    const id = sizes.length; let size = 0; const st = [s]; comp[s] = id;
    while (st.length) {
      const k = st.pop(); size++;
      for (const [nx, ny] of neighbors(k % W, (k / W) | 0, W, H)) {
        const nk = ny * W + nx;
        if (comp[nk] === -1 && pass(nk)) { comp[nk] = id; st.push(nk); }
      }
    }
    sizes.push(size);
  }
  if (!sizes.length) return null;
  let big = 0; for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[big]) big = i;
  if (sizes[big] < W * H * 0.3) return null;
  const cands = [];
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const k = y * W + x;
    if (comp[k] !== big || terrain[k] !== 'g') continue;
    if (neighbors(x, y, W, H).every(([nx, ny]) => pass(ny * W + nx))) cands.push([x, y]);
  }
  if (cands.length < n) return null;
  const minD = n <= 3 ? 8 : 6;
  const starts = [cands[Math.floor(rng() * cands.length)]];
  while (starts.length < n) {
    let best = null, bd = -1;
    for (const c of cands) {
      let m = Infinity; for (const s of starts) m = Math.min(m, dist(c[0], c[1], s[0], s[1]));
      if (m > bd) { bd = m; best = c; }
    }
    if (bd < minD) return null;
    starts.push(best);
  }
  return starts;
}

// ============================================================
class Game {
  constructor() {
    this.players = [];
    this.resetToLobby();
  }

  resetToLobby() {
    this.phase = 'lobby';
    this.turn = 0; this.W = 0; this.H = 0; this.terrain = [];
    this.units = new Map(); this.cities = new Map(); this.cityIdx = new Map();
    this.nextId = 1; this.fx = []; this.fxId = 0; this.winner = null;
    for (const p of this.players) { p.alive = true; p.ended = false; p.log = []; p.explored = null; }
  }

  // ---------- jugadores / lobby ----------
  addPlayer(name, isBot) {
    if (this.phase !== 'lobby') return err('La partida ya ha empezado.');
    if (this.players.length >= MAX_PLAYERS) return err('Partida llena (máx. ' + MAX_PLAYERS + ').');
    const id = this.players.length;
    const p = {
      id, name: String(name || (isBot ? 'Bot' : 'Jugador')).slice(0, 16), color: COLORS[id % COLORS.length],
      token: isBot ? null : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      isBot: !!isBot, alive: true, ended: false, connected: false, explored: null, log: [],
    };
    this.players.push(p);
    return { ok: true, player: p };
  }
  removeLastBot() {
    if (this.phase !== 'lobby') return err('La partida ya ha empezado.');
    for (let i = this.players.length - 1; i >= 0; i--) if (this.players[i].isBot) { this.players.splice(i, 1); this.players.forEach((p, j) => { p.id = j; p.color = COLORS[j % COLORS.length]; }); return OK; }
    return err('No hay bots.');
  }

  start() {
    const n = this.players.length;
    if (this.phase !== 'lobby') return err('Ya empezó.');
    if (n < 2) return err('Hacen falta al menos 2 jugadores (añade un bot para probar).');
    this.W = 24 + 2 * n; this.H = 16 + 2 * n;
    let starts = null;
    for (let a = 0; a < 80 && !starts; a++) {
      const rng = mulberry32((Date.now() + a * 7919) >>> 0);
      this.terrain = generateTerrain(this.W, this.H, rng);
      starts = pickStarts(this.terrain, this.W, this.H, n, rng);
    }
    if (!starts) return err('No se pudo generar el mapa. Inténtalo de nuevo.');
    this.units = new Map(); this.cities = new Map(); this.cityIdx = new Map(); this.nextId = 1;
    this.turn = 1; this.winner = null; this.fx = [];
    const names = CITY_NAMES.slice().sort(() => Math.random() - 0.5);
    this._names = names;
    this.players.forEach((p, i) => {
      p.alive = true; p.ended = p.isBot; p.log = []; p.explored = new Uint8Array(this.W * this.H);
      const [sx, sy] = starts[i];
      this.makeCity(p, sx, sy);
      this.makeUnit(p.id, 'warrior', sx, sy);
      this.makeUnit(p.id, 'settler', sx, sy);
      const nb = neighbors(sx, sy, this.W, this.H).find(([x, y]) => TERR[this.terrain[y * this.W + x]].pass);
      this.makeUnit(p.id, 'archer', nb[0], nb[1]);
      this.pushLog([p.id], '¡Comienza la partida! Funda ciudades, entrena a tus unidades y haz crecer a tus héroes.');
    });
    this.phase = 'playing';
    for (const p of this.players) if (p.isBot) this.botTurn(p);
    return OK;
  }

  // ---------- creación ----------
  makeCity(p, x, y) {
    const name = (this._names && this._names.length) ? this._names.pop() : 'Ciudad ' + this.nextId;
    const c = { id: this.nextId++, owner: p.id, x, y, name, pop: 1, growth: 0, hp: 0, building: 'warrior', prod: 0 };
    c.hp = this.cityMaxHp(c);
    this.cities.set(c.id, c); this.cityIdx.set(y * this.W + x, c);
    this.reveal(p, x, y, 3);
    return c;
  }
  makeUnit(owner, type, x, y) {
    const T = UNIT_TYPES[type];
    const u = {
      id: this.nextId++, owner, type, x, y, hp: T.hp, xp: 0, level: 0, pts: 0, promos: {}, kills: 0,
      moves: T.mv, attacks: 1, hasAttacked: false, moved: false, fort: false, goto: null,
      name: UNIT_NAMES[Math.floor(Math.random() * UNIT_NAMES.length)],
    };
    this.units.set(u.id, u);
    const p = this.players[owner]; if (p && p.explored) this.reveal(p, x, y, T.vision);
    return u;
  }

  // ---------- estadísticas ----------
  rank(u, k) { return u.promos[k] || 0; }
  maxHp(u) { return UNIT_TYPES[u.type].hp + 15 * this.rank(u, 'vit'); }
  moveMax(u) { return UNIT_TYPES[u.type].mv + Math.min(4, Math.floor(this.rank(u, 'stride') / 2)); }
  rangeOf(u) { const r = UNIT_TYPES[u.type].range; return r > 0 ? r + Math.min(2, Math.floor(this.rank(u, 'reach') / 3)) : 0; }
  attacksMax(u) { return 1 + (this.rank(u, 'double') > 0 ? 1 : 0); }
  hpFactor(u) { return 0.5 + 0.5 * u.hp / this.maxHp(u); }
  auraBonus(u) {
    let best = 0;
    for (const v of this.units.values()) {
      if (v.owner !== u.owner || v === u) continue;
      if (dist(u.x, u.y, v.x, v.y) === 1) best = Math.max(best, 0.04 * this.rank(v, 'aura'));
    }
    return best;
  }
  atkStr(u) { return UNIT_TYPES[u.type].atk * (1 + 0.08 * this.rank(u, 'atk') + this.auraBonus(u)) * this.hpFactor(u); }
  defStr(u, x, y) {
    const k = y * this.W + x; const city = this.cityIdx.get(k);
    return UNIT_TYPES[u.type].def * (1 + 0.08 * this.rank(u, 'def') + this.auraBonus(u))
      * TERR[this.terrain[k]].def * (city && city.owner === u.owner ? 1.25 : 1) * (u.fort ? 1.15 : 1) * this.hpFactor(u);
  }
  cityMaxHp(c) { return 100 + 20 * c.pop; }
  cityDef(c) { return 12 + 2 * c.pop; }
  cityProd(c) { return 3 + c.pop; }
  xpNeed(u) { return 8 + 4 * u.level; }
  titleOf(u) {
    let n = 0; for (const k in u.promos) n += u.promos[k];
    let t = TITLES[0][1]; for (const [th, name] of TITLES) if (n >= th) t = name;
    return t;
  }
  dmg(a, d) { return Math.round(clamp(28 * Math.exp(0.06 * (a - d)), 3, 160)); }

  // ---------- registro / efectos ----------
  pushLog(pids, m) {
    for (const id of pids) { const p = this.players[id]; if (!p) continue; p.log.push({ t: this.turn, m }); if (p.log.length > 60) p.log.shift(); }
  }
  addFx(x, y, text, color) { this.fx.push({ id: ++this.fxId, x, y, text, color }); if (this.fx.length > 40) this.fx.shift(); }

  addXp(u, amt) {
    u.xp += amt; let ups = 0;
    while (u.xp >= this.xpNeed(u)) { u.xp -= this.xpNeed(u); u.level++; u.pts++; ups++; }
    if (ups) {
      this.addFx(u.x, u.y, '¡Nivel ' + u.level + '!', '#ffd166');
      this.pushLog([u.owner], u.name + ' (' + UNIT_TYPES[u.type].name + ') sube a nivel ' + u.level + '. ¡Elige una promoción!');
    }
  }

  // ---------- visibilidad ----------
  reveal(p, x, y, r) {
    if (!p.explored) return;
    for (let yy = Math.max(0, y - r); yy <= Math.min(this.H - 1, y + r); yy++)
      for (let xx = Math.max(0, x - r - 1); xx <= Math.min(this.W - 1, x + r + 1); xx++)
        if (dist(x, y, xx, yy) <= r) p.explored[yy * this.W + xx] = 1;
  }
  visibleSet(p) {
    const vis = new Uint8Array(this.W * this.H);
    const mark = (x, y, r) => {
      for (let yy = Math.max(0, y - r); yy <= Math.min(this.H - 1, y + r); yy++)
        for (let xx = Math.max(0, x - r - 1); xx <= Math.min(this.W - 1, x + r + 1); xx++)
          if (dist(x, y, xx, yy) <= r) { vis[yy * this.W + xx] = 2; p.explored[yy * this.W + xx] = 1; }
    };
    for (const u of this.units.values()) if (u.owner === p.id) mark(u.x, u.y, UNIT_TYPES[u.type].vision);
    for (const c of this.cities.values()) if (c.owner === p.id) mark(c.x, c.y, 3);
    return vis;
  }

  // ---------- ocupación y caminos ----------
  occ() {
    const m = new Map();
    for (const u of this.units.values()) {
      const k = u.y * this.W + u.x; let o = m.get(k);
      if (!o) { o = { mil: null, civ: null }; m.set(k, o); }
      if (UNIT_TYPES[u.type].civil) o.civ = u; else o.mil = u;
    }
    return m;
  }
  stoppable(u, k, occ) {
    const o = occ.get(k); if (!o) return true;
    return UNIT_TYPES[u.type].civil ? !(o.civ && o.civ !== u) : !(o.mil && o.mil !== u);
  }
  computeCosts(u, occ) {
    const W = this.W, H = this.H, N = W * H;
    const cost = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), inq = new Uint8Array(N);
    const s = u.y * W + u.x; cost[s] = 0; const q = [s]; let qi = 0;
    while (qi < q.length) {
      const c = q[qi++]; inq[c] = 0;
      for (const [nx, ny] of neighbors(c % W, (c / W) | 0, W, H)) {
        const k = ny * W + nx; const T = TERR[this.terrain[k]];
        if (!T.pass) continue;
        const o = occ.get(k);
        if (o && ((o.mil && o.mil.owner !== u.owner) || (o.civ && o.civ.owner !== u.owner))) continue;
        const city = this.cityIdx.get(k); if (city && city.owner !== u.owner) continue;
        const nc = cost[c] + T.cost;
        if (nc < cost[k]) { cost[k] = nc; prev[k] = c; if (!inq[k]) { inq[k] = 1; q.push(k); } }
      }
    }
    return { cost, prev };
  }
  reachTiles(u, occ) {
    occ = occ || this.occ();
    if (u.moves <= 0) return [];
    const { cost } = this.computeCosts(u, occ); const out = [];
    const s = u.y * this.W + u.x;
    for (let k = 0; k < cost.length; k++) {
      if (k === s || !isFinite(cost[k])) continue;
      const step = TERR[this.terrain[k]].cost;
      if (cost[k] - step < u.moves && this.stoppable(u, k, occ)) out.push(k);
    }
    return out;
  }
  targetsFor(p, u, vis) {
    const T = UNIT_TYPES[u.type]; if (T.civil || u.attacks <= 0 || (u.moves <= 0 && !u.hasAttacked)) return [];
    const range = this.rangeOf(u) || 1; const out = []; const occ = this.occ();
    for (let y = Math.max(0, u.y - range); y <= Math.min(this.H - 1, u.y + range); y++)
      for (let x = Math.max(0, u.x - range - 1); x <= Math.min(this.W - 1, u.x + range + 1); x++) {
        const d = dist(u.x, u.y, x, y); if (d < 1 || d > range) continue;
        const k = y * this.W + x; if (vis[k] !== 2) continue;
        const o = occ.get(k); const c = this.cityIdx.get(k);
        if ((o && ((o.mil && o.mil.owner !== p.id) || (o.civ && o.civ.owner !== p.id))) || (c && c.owner !== p.id)) out.push(k);
      }
    return out;
  }

  // ---------- acciones ----------
  act(pid, m) {
    const p = this.players[pid]; if (!p) return err('Jugador desconocido');
    if (this.phase === 'lobby') {
      if (pid !== 0) return err('Solo el anfitrión puede hacer eso.');
      if (m.type === 'addbot') return this.addPlayer('Bot ' + (this.players.filter(x => x.isBot).length + 1), true);
      if (m.type === 'removebot') return this.removeLastBot();
      if (m.type === 'start') return this.start();
      return err('Acción no válida en el lobby.');
    }
    if (m.type === 'reset') { if (pid !== 0) return err('Solo el anfitrión.'); this.resetToLobby(); return OK; }
    if (this.phase !== 'playing') return err('La partida ha terminado.');
    if (!p.alive) return err('Has sido eliminado.');
    if (m.type === 'endturn') { p.ended = true; this.checkAllEnded(); return OK; }
    if (p.ended) return err('Ya has terminado tu turno.');
    if (m.type === 'build') {
      const c = this.cities.get(m.cityId); if (!c || c.owner !== pid) return err('Ciudad no válida.');
      if (!UNIT_TYPES[m.unit]) return err('Unidad no válida.');
      c.building = m.unit; return OK;
    }
    const u = this.units.get(m.unitId);
    if (!u || u.owner !== pid) return err('Unidad no válida.');
    switch (m.type) {
      case 'move': return this.move(p, u, m.x | 0, m.y | 0);
      case 'attack': return this.attack(p, u, m.x | 0, m.y | 0);
      case 'found': return this.found(p, u);
      case 'promote': return this.promote(p, u, m.key);
      case 'fortify': u.fort = true; u.goto = null; u.moves = 0; return OK;
      default: return err('Acción desconocida.');
    }
  }

  move(p, u, tx, ty) {
    if (u.moves <= 0) return err('Sin movimiento este turno.');
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return err('Fuera del mapa.');
    if (tx === u.x && ty === u.y) return err('Ya estás ahí.');
    const W = this.W; const occ = this.occ(); const { cost, prev } = this.computeCosts(u, occ);
    const Tk = ty * W + tx;
    if (!isFinite(cost[Tk])) return err('No hay camino hasta ahí.');
    const path = []; for (let k = Tk; k !== -1; k = prev[k]) path.push(k); path.reverse();
    let acc = 0, best = 0, bestAcc = 0;
    for (let i = 1; i < path.length; i++) {
      if (acc >= u.moves) break;
      acc += TERR[this.terrain[path[i]]].cost;
      if (this.stoppable(u, path[i], occ)) { best = i; bestAcc = acc; }
    }
    if (best === 0) return err('No puedes avanzar por ahí este turno.');
    const vis = UNIT_TYPES[u.type].vision;
    for (let i = 1; i <= best; i++) { u.x = path[i] % W; u.y = (path[i] / W) | 0; this.reveal(p, u.x, u.y, vis); }
    u.moves = Math.max(0, u.moves - bestAcc); u.moved = true; u.fort = false;
    u.goto = best < path.length - 1 ? { x: tx, y: ty } : null;
    return OK;
  }

  attack(p, u, tx, ty) {
    const T = UNIT_TYPES[u.type], W = this.W;
    if (T.civil || T.atk <= 0) return err('Esta unidad no puede atacar.');
    if (u.attacks <= 0 || (u.moves <= 0 && !u.hasAttacked)) return err('Esta unidad ya no puede atacar este turno.');
    const range = this.rangeOf(u), ranged = range > 0; const d = dist(u.x, u.y, tx, ty);
    if (d < 1 || d > (ranged ? range : 1)) return err('Objetivo fuera de alcance.');
    const k = ty * W + tx;
    if (this.visibleSet(p)[k] !== 2) return err('No ves esa casilla.');
    const o = this.occ().get(k); const city = this.cityIdx.get(k);
    let target = null;
    if (o) { if (o.mil && o.mil.owner !== p.id) target = o.mil; else if (o.civ && o.civ.owner !== p.id) target = o.civ; }
    const eCity = city && city.owner !== p.id ? city : null;
    if (!target && !eCity) return err('No hay enemigos ahí.');
    const A = this.atkStr(u);
    u.fort = false;

    if (target) {
      const D = this.defStr(target, tx, ty);
      const dd = this.dmg(A, D); target.hp -= dd; this.addFx(tx, ty, '-' + dd, '#ff6b6b');
      let rd = 0; const killed = target.hp <= 0;
      if (!killed && !ranged && !UNIT_TYPES[target.type].civil) {
        rd = this.dmg(D, A); u.hp -= rd; this.addFx(u.x, u.y, '-' + rd, '#ff6b6b');
      }
      const tn = UNIT_TYPES[target.type].name, un = UNIT_TYPES[u.type].name;
      if (killed) {
        this.units.delete(target.id); u.kills++;
        const heal = Math.round(0.08 * this.rank(u, 'blood') * this.maxHp(u));
        if (heal) u.hp = Math.min(this.maxHp(u), u.hp + heal);
        this.pushLog([p.id], u.name + ' (' + un + ') destruye a un ' + tn + ' enemigo.');
        this.pushLog([target.owner], 'Tu ' + tn + ' ' + target.name + ' ha sido destruido por ' + this.players[p.id].name + '.');
      } else {
        this.pushLog([p.id], u.name + ' ataca a un ' + tn + ' (-' + dd + ', recibe -' + rd + ').');
        this.pushLog([target.owner], 'Tu ' + tn + ' ' + target.name + ' es atacado (-' + dd + ').');
      }
      if (u.hp <= 0) {
        this.units.delete(u.id);
        this.pushLog([p.id], 'Tu ' + un + ' ' + u.name + ' cae en combate.');
        if (!killed) { this.addXp(target, 3 + Math.floor(rd / 10) + 10); }
      } else {
        this.addXp(u, 4 + Math.floor(dd / 12) + (killed ? 12 : 0));
        if (!killed && !UNIT_TYPES[target.type].civil) this.addXp(target, 3 + Math.floor(rd / 10));
      }
    } else {
      const D = this.cityDef(eCity); let dd = this.dmg(A, D);
      if (ranged) dd = Math.min(dd, Math.max(0, eCity.hp - 1));
      eCity.hp -= dd; this.addFx(tx, ty, '-' + dd, '#ff9f1c');
      this.pushLog([eCity.owner], eCity.name + ' es atacada (-' + dd + ' PV).');
      if (!ranged && eCity.hp <= 0) {
        this.capture(eCity, p, u);
      } else {
        let rd = 0;
        if (!ranged) { rd = Math.round(clamp(this.dmg(D, A) * 0.6, 2, 100)); u.hp -= rd; this.addFx(u.x, u.y, '-' + rd, '#ff6b6b'); }
        if (u.hp <= 0) { this.units.delete(u.id); this.pushLog([p.id], 'Tu ' + T.name + ' ' + u.name + ' cae ante las murallas de ' + eCity.name + '.'); }
        else this.addXp(u, 4 + Math.floor(dd / 12));
      }
    }
    if (this.units.has(u.id)) { u.moves = 0; u.hasAttacked = true; u.attacks--; u.moved = true; }
    this.checkElim();
    return OK;
  }

  capture(c, p, u) {
    const prevOwner = c.owner; const k = c.y * this.W + c.x;
    const o = this.occ().get(k);
    if (o && o.civ && o.civ.owner !== p.id) this.units.delete(o.civ.id);
    c.owner = p.id; c.hp = Math.floor(this.cityMaxHp(c) * 0.4); c.building = 'warrior'; c.prod = 0; c.pop = Math.max(1, c.pop - 1);
    u.x = c.x; u.y = c.y; u.moved = true; u.moves = 0;
    this.reveal(p, c.x, c.y, 3);
    this.addXp(u, 20);
    this.addFx(c.x, c.y, '¡Capturada!', '#ffd166');
    this.pushLog([p.id], '¡' + u.name + ' conquista ' + c.name + '!');
    this.pushLog([prevOwner], '¡' + c.name + ' ha caído en manos de ' + p.name + '!');
  }

  found(p, u) {
    if (u.type !== 'settler') return err('Solo los colonos fundan ciudades.');
    if (u.moves <= 0) return err('Sin movimiento este turno.');
    const f = this.canFound(u.x, u.y); if (f !== true) return err(f);
    this.units.delete(u.id);
    const c = this.makeCity(p, u.x, u.y);
    this.pushLog([p.id], 'Has fundado ' + c.name + '.');
    return OK;
  }
  canFound(x, y) {
    if (!TERR[this.terrain[y * this.W + x]].pass) return 'Terreno no válido.';
    for (const c of this.cities.values()) if (dist(x, y, c.x, c.y) <= 2) return 'Demasiado cerca de otra ciudad (mínimo 3 casillas).';
    return true;
  }

  promote(p, u, key) {
    const P = PROMOS[key]; if (!P) return err('Promoción desconocida.');
    if (UNIT_TYPES[u.type].civil) return err('Los colonos no se promocionan.');
    if (u.pts <= 0) return err('No tienes puntos de promoción.');
    if (this.rank(u, key) >= P.max) return err('Rango máximo alcanzado.');
    if (key === 'reach' && UNIT_TYPES[u.type].range <= 0) return err('Solo para unidades a distancia.');
    if (key === 'double' && this.rank(u, 'atk') < 3) return err('Requiere Ferocidad 3.');
    u.pts--; u.promos[key] = this.rank(u, key) + 1;
    if (key === 'vit') u.hp = Math.min(this.maxHp(u), u.hp + 15);
    if (key === 'double') u.attacks++;
    return OK;
  }

  // ---------- turnos ----------
  checkAllEnded() {
    if (this.phase !== 'playing') return;
    const hs = this.players.filter(p => !p.isBot && p.alive && p.connected);
    if (!hs.length) return;
    if (hs.every(p => p.ended)) this.processTurn();
  }

  processTurn() {
    const W = this.W;
    for (const u of this.units.values()) {
      const T = UNIT_TYPES[u.type]; const mx = this.maxHp(u);
      if (u.hp < mx) {
        let heal = 4 * this.rank(u, 'regen');
        if (!u.moved) heal += 10;
        const c = this.cityIdx.get(u.y * W + u.x); if (c && c.owner === u.owner) heal += 12;
        u.hp = Math.min(mx, u.hp + heal);
      }
      if (!T.civil) this.addXp(u, 1);
      u.moves = this.moveMax(u); u.attacks = this.attacksMax(u); u.hasAttacked = false; u.moved = false;
    }
    for (const c of this.cities.values()) {
      c.growth++; if (c.growth >= 5 && c.pop < 10) { c.pop++; c.growth = 0; this.pushLog([c.owner], c.name + ' crece (población ' + c.pop + ').'); }
      c.hp = Math.min(this.cityMaxHp(c), c.hp + 15);
      if (c.building) {
        c.prod += this.cityProd(c);
        const T = UNIT_TYPES[c.building];
        if (c.prod >= T.cost && !(c.building === 'settler' && c.pop < 2)) this.spawnFrom(c);
      }
    }
    this.turn++;
    for (const p of this.players) { p.ended = p.isBot; }
    // órdenes de movimiento pendientes
    for (const u of [...this.units.values()]) {
      if (!u.goto || !this.units.has(u.id)) continue;
      const p = this.players[u.owner];
      if (u.x === u.goto.x && u.y === u.goto.y) { u.goto = null; continue; }
      const r = this.move(p, u, u.goto.x, u.goto.y); if (r.error) u.goto = null;
    }
    for (const p of this.players) if (p.isBot && p.alive) this.botTurn(p);
    this.checkElim();
  }

  spawnFrom(c) {
    const type = c.building, T = UNIT_TYPES[type], W = this.W; const occ = this.occ();
    const free = (k) => { const o = occ.get(k); return !o || (T.civil ? !o.civ : !o.mil); };
    let spot = null;
    const ck = c.y * W + c.x;
    if (free(ck)) spot = [c.x, c.y];
    else for (const [nx, ny] of neighbors(c.x, c.y, W, this.H)) {
      const k = ny * W + nx; if (!TERR[this.terrain[k]].pass || this.cityIdx.get(k)) continue;
      const o = occ.get(k); if (o && ((o.mil && o.mil.owner !== c.owner) || (o.civ && o.civ.owner !== c.owner))) continue;
      if (free(k)) { spot = [nx, ny]; break; }
    }
    if (!spot) return;
    c.prod -= T.cost;
    if (type === 'settler') c.pop = Math.max(1, c.pop - 1);
    const u = this.makeUnit(c.owner, type, spot[0], spot[1]);
    this.pushLog([c.owner], c.name + ' entrena un ' + T.name + ' (' + u.name + ').');
  }

  checkElim() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const hasCity = [...this.cities.values()].some(c => c.owner === p.id);
      const hasSettler = [...this.units.values()].some(u => u.owner === p.id && u.type === 'settler');
      if (!hasCity && !hasSettler) {
        p.alive = false;
        for (const u of [...this.units.values()]) if (u.owner === p.id) this.units.delete(u.id);
        for (const q of this.players) this.pushLog([q.id], p.name + ' ha sido eliminado.');
      }
    }
    if (this.phase === 'playing') {
      const alive = this.players.filter(p => p.alive);
      if (alive.length <= 1) { this.phase = 'over'; this.winner = alive[0] ? alive[0].id : null; }
    }
  }

  // ---------- vista para un jugador ----------
  unitView(u, own) {
    const v = {
      id: u.id, owner: u.owner, type: u.type, x: u.x, y: u.y, hp: Math.ceil(u.hp), hpMax: this.maxHp(u),
      level: u.level, title: this.titleOf(u), name: u.name,
      atk: +this.atkStr(u).toFixed(1), def: +this.defStr(u, u.x, u.y).toFixed(1), range: this.rangeOf(u), mv: this.moveMax(u),
    };
    if (own) Object.assign(v, {
      xp: u.xp, need: this.xpNeed(u), pts: u.pts, promos: u.promos, moves: u.moves, attacks: u.attacks, attacksMax: this.attacksMax(u),
      fort: u.fort, kills: u.kills, goto: u.goto, foundErr: u.type === 'settler' ? this.canFound(u.x, u.y) : null,
    });
    return v;
  }
  viewFor(pid) {
    const base = {
      phase: this.phase, you: pid, turn: this.turn, winner: this.winner,
      players: this.players.map(p => ({ id: p.id, name: p.name, color: p.color, isBot: p.isBot, alive: p.alive, ended: p.ended, connected: p.isBot || p.connected })),
    };
    if (this.phase === 'lobby') return base;
    const p = this.players[pid]; const vis = this.visibleSet(p); const N = this.W * this.H;
    let t = '', v = '';
    for (let i = 0; i < N; i++) { t += p.explored[i] ? this.terrain[i] : '?'; v += vis[i] ? '2' : (p.explored[i] ? '1' : '0'); }
    const units = [];
    for (const u of this.units.values()) if (u.owner === pid || vis[u.y * this.W + u.x] === 2) units.push(this.unitView(u, u.owner === pid));
    const cities = [];
    for (const c of this.cities.values()) {
      if (c.owner !== pid && vis[c.y * this.W + c.x] !== 2) continue;
      const cv = { id: c.id, owner: c.owner, x: c.x, y: c.y, name: c.name, pop: c.pop, hp: c.hp, hpMax: this.cityMaxHp(c) };
      if (c.owner === pid) Object.assign(cv, { building: c.building, prod: c.prod, cost: c.building ? UNIT_TYPES[c.building].cost : 0, perTurn: this.cityProd(c), growth: c.growth });
      cities.push(cv);
    }
    return Object.assign(base, {
      W: this.W, H: this.H, t, v, units, cities, log: p.log.slice(-25),
      fx: this.fx.filter(f => vis[f.y * this.W + f.x] === 2).slice(-12),
    });
  }
  query(pid, unitId) {
    const p = this.players[pid]; const u = this.units.get(unitId);
    if (this.phase !== 'playing' || !p || !u || u.owner !== pid) return { reach: [], targets: [] };
    const vis = this.visibleSet(p);
    return { reach: this.reachTiles(u), targets: this.targetsFor(p, u, vis) };
  }
  config() { return { UNIT_TYPES, TERR, PROMOS, TITLES }; }

  // ============================================================
  //  IA sencilla (bots) — sirve para probar en solitario
  // ============================================================
  botTurn(p) {
    const myCities = [...this.cities.values()].filter(c => c.owner === p.id);
    const myUnits = [...this.units.values()].filter(u => u.owner === p.id);
    const nSettlers = myUnits.filter(u => u.type === 'settler').length;
    for (const c of myCities) {
      if (c.building === 'settler' && (c.pop < 2 || nSettlers > 0)) c.building = null;
      if (!c.building || Math.random() < 0.15) {
        if (c.pop >= 2 && myCities.length < 4 && nSettlers === 0 && this.turn > 4 && Math.random() < 0.5) c.building = 'settler';
        else { const r = Math.random(); c.building = r < 0.4 ? 'warrior' : r < 0.75 ? 'archer' : 'horse'; }
      }
    }
    const pool = ['atk', 'atk', 'def', 'vit', 'regen', 'blood', 'aura', 'stride'];
    for (const u of myUnits) {
      if (UNIT_TYPES[u.type].civil) continue;
      while (u.pts > 0) {
        let key = pool[Math.floor(Math.random() * pool.length)];
        if (u.type === 'archer' && Math.random() < 0.3) key = 'reach';
        if (this.rank(u, 'atk') >= 3 && !this.rank(u, 'double') && Math.random() < 0.5) key = 'double';
        const r = this.promote(p, u, key); if (r.error) { u.pts--; }
      }
    }
    const milCount = myUnits.filter(u => !UNIT_TYPES[u.type].civil).length;
    for (const u of myUnits) {
      if (!this.units.has(u.id)) continue;
      if (u.type === 'settler') this.botSettler(p, u);
      else this.botMil(p, u, milCount);
    }
  }
  botSettler(p, u) {
    let best = null, bs = -1e9;
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      const d = dist(u.x, u.y, x, y); if (d > 10) continue;
      if (this.canFound(x, y) !== true) continue;
      if (!this.stoppable(u, y * this.W + x, this.occ()) && !(x === u.x && y === u.y)) continue;
      const sc = -d + (this.terrain[y * this.W + x] === 'g' ? 2 : 0);
      if (sc > bs) { bs = sc; best = [x, y]; }
    }
    if (!best) return;
    if (best[0] === u.x && best[1] === u.y) this.found(p, u); else this.move(p, u, best[0], best[1]);
    if (this.units.has(u.id) && this.canFound(u.x, u.y) === true) this.found(p, u);
  }
  botMil(p, u, milCount) {
    const tryAttack = () => {
      for (let i = 0; i < 3; i++) {
        if (!this.units.has(u.id) || u.attacks <= 0) return;
        const range = this.rangeOf(u) || 1; let best = null, bv = Infinity;
        for (const e of this.units.values()) {
          if (e.owner === p.id || !this.players[e.owner].alive) continue;
          const d = dist(u.x, u.y, e.x, e.y); if (d < 1 || d > range) continue;
          const val = e.hp + (UNIT_TYPES[e.type].civil ? -50 : 0); if (val < bv) { bv = val; best = [e.x, e.y]; }
        }
        if (!best) for (const c of this.cities.values()) {
          if (c.owner === p.id) continue; const d = dist(u.x, u.y, c.x, c.y);
          if (d >= 1 && d <= range) { best = [c.x, c.y]; break; }
        }
        if (!best) return;
        // los bots ven todo lo que atacan (para simplificar)
        const r = this._botAttack(p, u, best[0], best[1]); if (r.error) return;
      }
    };
    tryAttack();
    if (!this.units.has(u.id) || u.moves <= 0) return;
    // goal
    let goal = null, gd = Infinity;
    for (const e of this.units.values()) { if (e.owner === p.id || !this.players[e.owner].alive) continue; const d = dist(u.x, u.y, e.x, e.y); if (d < gd && d <= 5) { gd = d; goal = [e.x, e.y]; } }
    const nearEnemy = !!goal;
    if (!goal) for (const c of this.cities.values()) { if (c.owner === p.id || !this.players[c.owner].alive) continue; const d = dist(u.x, u.y, c.x, c.y); if (d < gd) { gd = d; goal = [c.x, c.y]; } }
    if (!goal) return;
    const city = this.cityIdx.get(u.y * this.W + u.x);
    const homeGuard = city && city.owner === p.id && !nearEnemy && (this.turn < 12 || milCount < 5)
      && [...this.units.values()].filter(v => v.owner === p.id && v.x === u.x && v.y === u.y && !UNIT_TYPES[v.type].civil).length === 1;
    if (homeGuard) return;
    const want = this.rangeOf(u) || 1;
    const tiles = this.reachTiles(u); let bestK = -1, bd = Infinity;
    for (const k of tiles) {
      const x = k % this.W, y = (k / this.W) | 0; if (this.cityIdx.get(k) && this.cityIdx.get(k).owner !== p.id) continue;
      let d = dist(x, y, goal[0], goal[1]); if (this.rangeOf(u) > 0) d = Math.abs(d - want) + 0.01 * d;
      if (d < bd) { bd = d; bestK = k; }
    }
    if (bestK >= 0) { this.move(p, u, bestK % this.W, (bestK / this.W) | 0); tryAttack(); }
  }
  _botAttack(p, u, x, y) {
    // igual que attack() pero sin exigir visibilidad
    const real = this.visibleSet; this.visibleSet = () => new Uint8Array(this.W * this.H).fill(2);
    try { return this.attack(p, u, x, y); } finally { this.visibleSet = real; }
  }
}

module.exports = { Game, UNIT_TYPES, TERR, PROMOS, TITLES, dist, neighbors, generateTerrain, mulberry32 };
