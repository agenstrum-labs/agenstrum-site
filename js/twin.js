// Home hero: a live digital twin of a multi-echelon supply chain run by
// AGENSTRUM agents.
//
// 1. The emblem appears and splits into its four agents (one per quarter sector).
// 2. Each agent takes charge of an echelon (suppliers, hubs, DCs, points of sale)
//    and spawns sub-agents that hover over the network nodes.
// 3. The network runs: material flows downstream, information flows upstream,
//    and agents react to events (demand spikes, supplier risk, capacity, ...).
// The control panel under the stage shows agent activity and network KPIs.
// All data is simulated.
(function () {
  const hero = document.querySelector('.twin-hero');
  if (!hero) return;
  const canvas = hero.querySelector('canvas.twin');
  const stage = hero.querySelector('.twin-stage');
  if (!canvas || !stage || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;

  // Agenstrum palette (dark twin)
  const C = {
    edge: '#2E5592', edgeDim: '#1B3560', node: '#C5CCD3', nodeFill: '#0A1A33', ion: '#5EA6FF', ionDeep: '#1D63D8',
    mat: '#E4E8EC', ok: '#3CC48A', warn: '#F2A541', bad: '#F06A6E', white: '#FFFFFF'
  };

  // ---------- helpers ----------
  const clamp = (x, a = 0, b = 1) => Math.min(Math.max(x, a), b);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => (t = clamp(t), t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(20261128);
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  // ---------- timeline (s) ----------
  const T_IN = 1.0, T_HOLD = 2.0, T_SPLIT = 2.8, T_ARRIVE = 4.7,
        NET_A = 3.0, NET_B = 6.2, SPAWN = 5.0, LIVE = 7.2;

  // ---------- network model ----------
  const PREFIX = ['SUP-', 'HUB-', 'DC-', 'PoS-'];
  const ECH_U = [0.035, 0.31, 0.595, 0.9];       // where each echelon sits along the flow
  const nodes = [], byType = [[], [], [], []], edges = [];

  function addNode(type, u, v) {
    const n = {
      id: nodes.length, type, u, v, idx: byType[type].length, x: 0, y: 0,
      level: 0.5 + rng() * 0.35, status: 0, statusUntil: 0, hot: 0, in: [], out: [], appear: 0, sub: null
    };
    n.name = PREFIX[type] + String(n.idx + 1).padStart(2, '0');
    nodes.push(n); byType[type].push(n);
    return n;
  }
  for (let i = 0; i < 24; i++) addNode(0, 0.0 + (i % 2) * 0.05, (i + 0.5) / 24);
  for (let i = 0; i < 5; i++) addNode(1, 0.3 + (rng() - 0.5) * 0.035, (i + 0.5) / 5 + (rng() - 0.5) * 0.04);
  for (let i = 0; i < 12; i++) addNode(2, 0.575 + (i % 2) * 0.04, (i + 0.5) / 12);
  const POS_PER = [5, 4, 5, 5, 4, 5, 5, 4, 5, 5, 4, 5];   // 56 points of sale
  {
    let k = 0;
    byType[2].forEach((dc, j) => {
      for (let q = 0; q < POS_PER[j]; q++, k++) {
        const p = addNode(3, 0.835 + (k % 3) * 0.07, (k + 0.5) / 56 + (rng() - 0.5) * 0.006);
        p.dc = dc;
      }
    });
  }

  function addEdge(a, b, backup) {
    const e = { a, b, backup: !!backup, active: !backup, hi: 0, hiC: C.ion, kind: a.type, p: null, len: 1 };
    edges.push(e); a.out.push(e); b.in.push(e);
    return e;
  }
  const nearest = (n, list) => list.slice().sort((p, q) => Math.abs(p.v - n.v) - Math.abs(q.v - n.v));
  byType[0].forEach(s => { const h = nearest(s, byType[1]); addEdge(s, h[0]); if (rng() < 0.45) addEdge(s, h[1]); });
  byType[2].forEach(d => { const h = nearest(d, byType[1]); addEdge(h[0], d); addEdge(h[1], d, true); });
  byType[3].forEach(p => addEdge(p.dc, p));
  const edgesByKind = [0, 1, 2].map(k => edges.filter(e => e.kind === k));
  let lateral = [];   // temporary DC-to-DC transfers

  // ---------- agents ----------
  // Emblem geometry (image px, 512 x 512)
  const IMG = 512, IC = 256, IR = 254, AD = 136, DR = 90;
  const MAINS = [
    { a: Math.PI, ech: 0 },       // left agent   -> suppliers
    { a: -Math.PI / 2, ech: 1 },  // top agent    -> hubs
    { a: Math.PI / 2, ech: 2 },   // bottom agent -> DCs
    { a: 0, ech: 3 }              // right agent  -> points of sale
  ];
  MAINS.forEach(m => { m.x = 0; m.y = 0; m.glow = 0; });
  const SUBS_PER = [6, 3, 5, 6];
  const subs = [];
  MAINS.forEach((m, k) => {
    const list = byType[m.ech];
    for (let i = 0; i < SUBS_PER[m.ech]; i++) {
      const node = list[Math.floor((i + 0.5) * list.length / SUBS_PER[m.ech])];
      const s = { owner: k, node, fx: 0, fy: 0, t0: SPAWN + i * 0.22 + k * 0.12, dur: 1.3, born: false, x: 0, y: 0, ph: rng() * TAU, next: 0, act: 0 };
      node.sub = s;
      subs.push(s);
    }
  });

  // Wedge -> disc morph outlines (agent-local, image px)
  const NM = 96, wedgePts = [], discPts = [];
  (function buildOutlines() {
    const poly = [[0, AD]];
    for (let i = 0; i <= 40; i++) {
      const ang = -3 * Math.PI / 4 + (i / 40) * (Math.PI / 2);
      poly.push([Math.cos(ang) * IR, AD + Math.sin(ang) * IR]);
    }
    for (let k = 0; k < NM; k++) {
      const th = (k / NM) * TAU - Math.PI / 2, dx = Math.cos(th), dy = Math.sin(th);
      let best = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
        const ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (x1 * ey - y1 * ex) / den, u = (x1 * dy - y1 * dx) / den;
        if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.min(best, t);
      }
      wedgePts.push([dx * best, dy * best]);
      discPts.push([dx * DR, dy * DR]);
    }
  })();

  const img = new Image();
  img.src = canvas.dataset.emblem || 'assets/emblem.png';

  // Glow sprite for information pulses
  const sprite = document.createElement('canvas');
  (function () {
    sprite.width = sprite.height = 48;
    const g = sprite.getContext('2d');
    const grd = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(150,200,255,0.95)');
    grd.addColorStop(0.45, 'rgba(94,166,255,0.35)');
    grd.addColorStop(1, 'rgba(94,166,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 48, 48);
  })();

  // ---------- layout ----------
  let W = 0, H = 0, dpr = 1, R = { x: 0, y: 0, w: 1, h: 1 }, portrait = false, unit = 1, gu = 1, band = 60;

  function map(u, v) {
    if (!portrait) {
      const pl = 26 * unit, pr = 26 * unit, pb = 12 * unit;
      return [R.x + pl + u * (R.w - pl - pr), R.y + band + v * (R.h - band - pb)];
    }
    const pt = 16 * unit, pb = 16 * unit, pr = 12 * unit;
    return [R.x + band + v * (R.w - band - pr), R.y + pt + u * (R.h - pt - pb)];
  }

  function layout() {
    const cr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cr.width; H = cr.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = { x: sr.left - cr.left, y: sr.top - cr.top, w: sr.width, h: sr.height };
    portrait = R.w < R.h * 1.05;
    unit = clamp(Math.min(R.w, R.h * 1.6) / 760, 0.62, 1.25);
    gu = clamp(Math.max(unit, Math.min(R.w, R.h * 2) / 900), 0.8, 1.3);  // glyph scale
    band = (portrait ? 50 : 62) * unit;
    nodes.forEach(n => { [n.x, n.y] = map(n.u, n.v); });
    edges.forEach(buildPath);
    lateral.forEach(buildPath);
    MAINS.forEach(m => {
      const [ex, ey] = map(ECH_U[m.ech], 0);
      if (!portrait) { m.x = ex; m.y = R.y + band * 0.46; } else { m.x = R.x + band * 0.5; m.y = ey; }
    });
    if (reduce) draw(LIVE + 30, 0);
  }

  function buildPath(e) {
    const ax = e.a.x, ay = e.a.y, bx = e.b.x, by = e.b.y;
    let c1x, c1y, c2x, c2y;
    if (e.lateral) {
      const bow = 22 * unit * (e.side || 1);
      if (!portrait) { c1x = ax + bow; c1y = ay; c2x = bx + bow; c2y = by; } else { c1x = ax; c1y = ay + bow; c2x = bx; c2y = by + bow; }
    } else if (!portrait) {
      const d = (bx - ax) * 0.5; c1x = ax + d; c1y = ay; c2x = bx - d; c2y = by;
    } else {
      const d = (by - ay) * 0.5; c1x = ax; c1y = ay + d; c2x = bx; c2y = by - d;
    }
    e.p = [ax, ay, c1x, c1y, c2x, c2y, bx, by];
    e.len = Math.hypot(bx - ax, by - ay) * 1.1 + 1;
  }
  function at(e, t) {
    const p = e.p, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
  }
  function strokeEdge(e, from = 0, to = 1) {
    const p = e.p;
    ctx.beginPath();
    if (from <= 0 && to >= 1) { ctx.moveTo(p[0], p[1]); ctx.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]); }
    else {
      const steps = 18, s0 = at(e, from); ctx.moveTo(s0[0], s0[1]);
      for (let i = 1; i <= steps; i++) { const q = at(e, lerp(from, to, i / steps)); ctx.lineTo(q[0], q[1]); }
    }
    ctx.stroke();
  }

  // ---------- particles ----------
  let parcels = [], pulses = [];
  function spawnParcel(e, speed) {
    if (!e || !e.active) return;
    parcels.push({ e, t: 0, v: (speed || rand(70, 105) * unit) / e.len, s: rand(0.85, 1.15) });
  }
  function spawnPulse(e, reverse, speed, color) {
    if (!e) return;
    pulses.push({ e, t: 0, v: (speed || rand(150, 220) * unit) / e.len, rev: reverse !== false, c: color });
  }
  // free-path pulses (agent tethers, agent mesh)
  let beams = [];
  function spawnBeam(x1, y1, x2, y2, bend, color, speed) {
    const len = Math.hypot(x2 - x1, y2 - y1) + 1;
    beams.push({ x1, y1, x2, y2, bend, c: color || C.ion, t: 0, v: (speed || 260 * unit) / len });
  }

  // ---------- glyphs ----------
  function glyph(type, x, y, s) {
    ctx.beginPath();
    if (type === 0) {        // supplier: factory with saw-tooth roof
      ctx.moveTo(x - s, y + s * 0.8); ctx.lineTo(x - s, y - s * 0.15);
      ctx.lineTo(x - s * 0.34, y - s * 0.6); ctx.lineTo(x - s * 0.34, y - s * 0.15);
      ctx.lineTo(x + s * 0.32, y - s * 0.6); ctx.lineTo(x + s * 0.32, y - s * 0.15);
      ctx.lineTo(x + s, y - s * 0.6); ctx.lineTo(x + s, y + s * 0.8); ctx.closePath();
    } else if (type === 1) { // hub: hexagon
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6 - Math.PI / 2; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * s, y + Math.sin(a) * s); }
      ctx.closePath();
    } else if (type === 2) { // DC: warehouse
      ctx.moveTo(x - s, y + s * 0.78); ctx.lineTo(x - s, y - s * 0.15); ctx.lineTo(x, y - s * 0.8);
      ctx.lineTo(x + s, y - s * 0.15); ctx.lineTo(x + s, y + s * 0.78); ctx.closePath();
    } else {                 // point of sale: storefront
      ctx.rect(x - s, y - s * 0.55, s * 2, s * 1.5);
    }
  }
  function glyphDetail(type, x, y, s) {
    ctx.beginPath();
    if (type === 1) {
      for (let i = 0; i < 3; i++) { const a = i * TAU / 3 - Math.PI / 2; ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * s * 0.62, y + Math.sin(a) * s * 0.62); }
    } else if (type === 2) {
      ctx.rect(x - s * 0.32, y + s * 0.18, s * 0.64, s * 0.6);
    } else if (type === 3) {
      ctx.moveTo(x - s * 1.15, y - s * 0.7); ctx.lineTo(x + s * 1.15, y - s * 0.7);
    } else {
      ctx.moveTo(x + s * 0.62, y - s * 0.4); ctx.lineTo(x + s * 0.62, y - s * 1.05);
    }
    ctx.stroke();
  }
  const SIZE = [6.4, 8.6, 7.6, 4.4];

  // ---------- emblem pieces ----------
  function drawPiece(k, x, y, rot, scale, morph) {
    const m = MAINS[k];
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale);
    ctx.beginPath();
    for (let i = 0; i < NM; i++) {
      const px = lerp(wedgePts[i][0], discPts[i][0], morph), py = lerp(wedgePts[i][1], discPts[i][1], morph);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.translate(0, AD); ctx.rotate(-Math.PI / 2 - m.a);
    ctx.drawImage(img, -IC, -IC, IMG, IMG);
    ctx.restore();
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeStyle = rgba(C.ion, 0.35 + 0.45 * morph);
    ctx.stroke();
    ctx.restore();
  }

  function subGlyph(x, y, r, a, act) {
    ctx.save();
    ctx.globalAlpha = a;
    if (act > 0) {
      ctx.strokeStyle = rgba(C.ion, 0.6 * act); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, r * (1.4 + (1 - act) * 1.4), 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = '#0B1E3F';
    ctx.strokeStyle = C.ion; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
    // agent figure: head + body with arms, as in the emblem
    ctx.fillStyle = C.white; ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, r * 0.2); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y - r * 0.38, r * 0.24, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - r * 0.45, y + r * 0.06); ctx.lineTo(x + r * 0.45, y + r * 0.06);
    ctx.moveTo(x, y + r * 0.06); ctx.lineTo(x, y + r * 0.55); ctx.stroke();
    ctx.restore();
  }

  // ---------- events, KPIs, panel ----------
  const panel = {
    feed: hero.querySelector('.feed'),
    kpis: {}
  };
  hero.querySelectorAll('.kpi').forEach(el => {
    panel.kpis[el.dataset.kpi] = { el, val: el.querySelector('.k-val'), delta: el.querySelector('.k-delta'), path: el.querySelector('.k-spark path') };
  });

  const LANG = () => (window.AgenstrumI18n && AgenstrumI18n.current) || document.documentElement.lang || 'en';
  const ROLES = {
    en: { pur: 'Purchasing', net: 'Network', plan: 'Planning', alloc: 'Allocation', risk: 'Risk', perf: 'Performance' },
    es: { pur: 'Compras', net: 'Red', plan: 'Planificación', alloc: 'Asignación', risk: 'Riesgo', perf: 'Desempeño' },
    pt: { pur: 'Compras', net: 'Rede', plan: 'Planejamento', alloc: 'Alocação', risk: 'Risco', perf: 'Desempenho' },
    it: { pur: 'Acquisti', net: 'Rete', plan: 'Pianificazione', alloc: 'Allocazione', risk: 'Rischio', perf: 'Performance' }
  };
  const ROLE_C = { pur: '#5EA6FF', net: '#A9C1E4', plan: '#7FB8FF', alloc: '#3CC48A', risk: '#F2A541', perf: '#C5CCD3' };
  const MSG = {
    en: {
      replen: 'Replenishment released {b} → {a}: {n} units',
      risk: 'Lead-time risk at {a}; {p}% re-sourced to {b}',
      split: 'PO split across {a} and {b} ({p}/{q})',
      spike: 'Demand spike at {a} (+{p}%); {n} units moved {b} → {c}',
      hub: '{a} at {p}% capacity; {n} lanes re-routed via {b}',
      fcst: 'Forecast refreshed for {n} PoS; error {p}%',
      anom: 'OTIF anomaly {a} → {b}; root cause: carrier delay',
      ss: 'Safety stock re-positioned upstream; inventory −{p}%',
      boot: 'Twin synced: {n} nodes, 4 agents, 20 sub-agents online'
    },
    es: {
      replen: 'Reposición liberada {b} → {a}: {n} unidades',
      risk: 'Riesgo de plazo en {a}; {p}% reasignado a {b}',
      split: 'OC dividida entre {a} y {b} ({p}/{q})',
      spike: 'Pico de demanda en {a} (+{p}%); {n} unidades movidas {b} → {c}',
      hub: '{a} al {p}% de capacidad; {n} rutas desviadas vía {b}',
      fcst: 'Pronóstico actualizado para {n} PdV; error {p}%',
      anom: 'Anomalía de OTIF {a} → {b}; causa raíz: retraso del transportista',
      ss: 'Stock de seguridad reposicionado aguas arriba; inventario −{p}%',
      boot: 'Gemelo sincronizado: {n} nodos, 4 agentes y 20 subagentes en línea'
    },
    pt: {
      replen: 'Reposição liberada {b} → {a}: {n} unidades',
      risk: 'Risco de lead time em {a}; {p}% realocado para {b}',
      split: 'Pedido dividido entre {a} e {b} ({p}/{q})',
      spike: 'Pico de demanda em {a} (+{p}%); {n} unidades movidas {b} → {c}',
      hub: '{a} com {p}% da capacidade; {n} rotas desviadas via {b}',
      fcst: 'Previsão atualizada para {n} PDVs; erro {p}%',
      anom: 'Anomalia de OTIF {a} → {b}; causa raiz: atraso da transportadora',
      ss: 'Estoque de segurança reposicionado a montante; estoque −{p}%',
      boot: 'Gêmeo sincronizado: {n} nós, 4 agentes e 20 subagentes online'
    },
    it: {
      replen: 'Rifornimento rilasciato {b} → {a}: {n} unità',
      risk: 'Rischio lead time su {a}; {p}% riassegnato a {b}',
      split: 'Ordine diviso tra {a} e {b} ({p}/{q})',
      spike: 'Picco di domanda su {a} (+{p}%); {n} unità spostate {b} → {c}',
      hub: '{a} al {p}% di capacità; {n} tratte deviate via {b}',
      fcst: 'Previsione aggiornata per {n} PdV; errore {p}%',
      anom: 'Anomalia OTIF {a} → {b}; causa: ritardo del vettore',
      ss: 'Scorte di sicurezza riposizionate a monte; inventario −{p}%',
      boot: 'Gemello sincronizzato: {n} nodi, 4 agenti e 20 sotto-agenti online'
    }
  };
  const fmtInt = n => new Intl.NumberFormat(LANG()).format(n);

  function log(role, key, vars) {
    if (!panel.feed) return;
    const lang = LANG();
    let msg = (MSG[lang] || MSG.en)[key];
    Object.keys(vars || {}).forEach(k => { msg = msg.replace('{' + k + '}', vars[k]); });
    const li = document.createElement('li');
    const now = new Date();
    const time = document.createElement('time');
    time.textContent = now.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const tag = document.createElement('span');
    tag.className = 'tag'; tag.style.setProperty('--c', ROLE_C[role]);
    tag.textContent = (ROLES[lang] || ROLES.en)[role];
    const m = document.createElement('span');
    m.className = 'msg'; m.textContent = msg; m.title = msg;
    li.append(time, tag, m);
    panel.feed.prepend(li);
    while (panel.feed.children.length > 6) panel.feed.lastChild.remove();
    K.dec.v += 1 + ((Math.random() * 3) | 0);
  }

  // KPI model (simulated): agents steadily improve inventory, cost and CO2,
  // events dent service briefly and the agents recover it.
  const K = {
    fill: { v: 97.6, target: 98.7, dip: 0, fmt: v => v.toFixed(1) + '%', good: 1, hist: [] },
    otif: { v: 94.8, target: 96.6, dip: 0, fmt: v => v.toFixed(1) + '%', good: 1, hist: [] },
    inv:  { v: 34.2, target: 27.5, dip: 0, fmt: v => v.toFixed(1), good: -1, hist: [] },
    cts:  { v: 2.58, target: 2.31, dip: 0, fmt: v => '$' + v.toFixed(2), good: -1, hist: [] },
    co2:  { v: 0.91, target: 0.79, dip: 0, fmt: v => v.toFixed(2), good: -1, hist: [] },
    dec:  { v: 1180 + ((Math.random() * 400) | 0), fmt: v => fmtInt(Math.round(v)), good: 1, hist: [] }
  };
  function tickKpis() {
    ['fill', 'otif', 'inv', 'cts', 'co2'].forEach(k => {
      const q = K[k];
      q.v += (q.target - q.v) * 0.035 + (Math.random() - 0.5) * (k === 'inv' ? 0.08 : k === 'cts' || k === 'co2' ? 0.004 : 0.06);
      q.dip *= 0.82;
    });
    K.dec.v += Math.random() < 0.6 ? 1 : 0;
    Object.keys(K).forEach(k => {
      const q = K[k], shown = q.v - (q.dip || 0);
      q.hist.push(shown); if (q.hist.length > 48) q.hist.shift();
    });
    renderKpis();
  }
  function renderKpis() {
    Object.keys(K).forEach(k => {
      const q = K[k], ui = panel.kpis[k];
      if (!ui) return;
      const shown = q.v - (q.dip || 0);
      ui.val.textContent = q.fmt(shown);
      const h = q.hist;
      if (h.length > 1) {
        const ref = h[Math.max(0, h.length - 30)], d = shown - ref;
        const better = d * q.good > 0;
        const tiny = Math.abs(d) < (k === 'dec' ? 0.5 : k === 'cts' || k === 'co2' ? 0.005 : 0.05);
        ui.delta.className = 'k-delta' + (tiny ? '' : better ? ' up' : ' down');
        const sign = d > 0 ? '▲' : '▼';
        ui.delta.textContent = tiny ? '' : sign + ' ' + (k === 'dec' ? fmtInt(Math.round(Math.abs(d))) : Math.abs(d).toFixed(k === 'cts' || k === 'co2' ? 2 : 1));
        const lo = Math.min(...h), hi = Math.max(...h), r = hi - lo || 1;
        ui.path.setAttribute('d', h.map((v, i) => (i ? 'L' : 'M') + (i / (48 - 1) * 100).toFixed(1) + ' ' + (20 - (v - lo) / r * 18).toFixed(1)).join(' '));
      }
      ui.el.classList.toggle('flash', (q.dip || 0) > 0.25);
    });
  }

  function setStatus(n, s, secs, now) { n.status = s; n.statusUntil = now + secs; }
  function summon(node, now) {
    // send the nearest free sub-agent of that echelon to the node
    const owner = MAINS.findIndex(m => m.ech === node.type);
    const mine = subs.filter(s => s.owner === owner && s.born);
    if (!mine.length) return null;
    let s = node.sub && node.sub.owner === owner ? node.sub : null;
    if (!s) {
      s = mine.sort((p, q) => Math.abs(p.node.v - node.v) - Math.abs(q.node.v - node.v))[0];
      if (s.node.sub === s) s.node.sub = null;
      s.fx = s.x; s.fy = s.y; s.node = node; node.sub = s; s.t0 = now; s.dur = 0.9;
    }
    s.act = 1; s.next = now + rand(8, 14);
    MAINS[owner].glow = 1;
    const m = MAINS[owner];
    spawnBeam(m.x, m.y, node.x, node.y - 14 * unit, 0.2, C.ion, 420 * unit);
    return s;
  }
  const primaryIn = d => d.in.find(e => !e.backup) || d.in[0];

  const EVENTS = [
    { w: 3, run(now) {   // replenishment hub -> DC
      const dc = pick(byType[2]), e = primaryIn(dc).active ? primaryIn(dc) : dc.in.find(x => x.active);
      summon(dc, now); spawnPulse(e, true, 320 * unit);
      e.hi = 1; e.hiC = C.ion;
      for (let i = 0; i < 6; i++) setTimeout(() => spawnParcel(e, 120 * unit), 500 + i * 160);
      dc.level = clamp(dc.level + 0.22, 0, 0.95);
      log('plan', 'replen', { a: dc.name, b: e.a.name, n: fmtInt(Math.round(rand(6, 24)) * 60) });
    } },
    { w: 2.4, run(now) { // demand spike at a PoS, lateral rebalance between DCs
      const p = pick(byType[3]); const dA = p.dc;
      const j = byType[2].indexOf(dA), dB = byType[2][j + (j === 0 ? 1 : j === byType[2].length - 1 ? -1 : (Math.random() < 0.5 ? -1 : 1))];
      setStatus(p, 1, 4, now); summon(p, now);
      spawnPulse(dA.out.find(e => e.b === p), true, 280 * unit);
      const lat = { a: dB, b: dA, lateral: true, side: 1, active: true, hi: 1, hiC: C.ok, kind: 2, until: now + 5 };
      buildPath(lat); lateral.push(lat);
      setTimeout(() => { for (let i = 0; i < 5; i++) setTimeout(() => spawnParcel(lat, 110 * unit), i * 170); }, 500);
      summon(dA, now);
      K.fill.dip += 0.5;
      log('alloc', 'spike', { a: p.name, p: Math.round(rand(24, 46)), n: fmtInt(Math.round(rand(4, 16)) * 10), b: dB.name, c: dA.name });
    } },
    { w: 1.2, run(now) { // supplier lead-time risk -> re-source
      const s = pick(byType[0]); const hubE = s.out[0];
      const alt = byType[0].filter(o => o !== s && o.out.some(e => e.b === hubE.b))[0] || pick(byType[0]);
      setStatus(s, 2, 8, now); summon(s, now);
      s.out.forEach(e => { e.hi = 1; e.hiC = C.bad; });
      K.otif.dip += 0.9;
      log('risk', 'risk', { a: s.name, p: Math.round(rand(4, 8)) * 10, b: alt.name });
      setTimeout(() => {
        const ae = alt.out.find(e => e.b === hubE.b) || alt.out[0];
        ae.hi = 1; ae.hiC = C.ok;
        for (let i = 0; i < 5; i++) setTimeout(() => spawnParcel(ae, 120 * unit), i * 150);
        summon(alt, performance.now() / 1000);
      }, 1800);
    } },
    { w: 1.6, run(now) { // PO split across two suppliers
      const h = pick(byType[1]); const sup = h.in.map(e => e.a);
      if (sup.length < 2) return;
      const a = pick(sup); let b = pick(sup); if (b === a) b = sup.find(x => x !== a);
      [a, b].forEach(s => { const e = s.out.find(x => x.b === h); e.hi = 1; e.hiC = C.ion; spawnPulse(e, true, 300 * unit); setTimeout(() => { for (let i = 0; i < 3; i++) setTimeout(() => spawnParcel(e, 110 * unit), i * 170); }, 700); });
      summon(a, now);
      const p = Math.round(rand(5, 7)) * 10;
      log('pur', 'split', { a: a.name, b: b.name, p, q: 100 - p });
    } },
    { w: 1, run(now) { // hub capacity -> re-route DCs to their backup hub
      const h = pick(byType[1]);
      const ds = h.out.filter(e => !e.backup && e.active).slice(0, 2);
      if (!ds.length) return;
      setStatus(h, 1, 7, now); summon(h, now);
      let via = null;
      ds.forEach(e => {
        const b = e.b.in.find(x => x.backup);
        if (!b) return;
        via = b.a; e.active = false; b.active = true; b.hi = 1; b.hiC = C.ion;
        for (let i = 0; i < 3; i++) setTimeout(() => spawnParcel(b, 115 * unit), 300 + i * 180);
        setTimeout(() => { e.active = true; b.active = false; }, 11000);
      });
      log('net', 'hub', { a: h.name, p: Math.round(rand(89, 97)), n: ds.length, b: via ? via.name : h.name });
    } },
    { w: 0.8, run() {    // forecast refresh: wave of demand signals upstream
      byType[3].forEach(p => setTimeout(() => spawnPulse(p.in[0], true, rand(180, 260) * unit), rand(0, 900)));
      setTimeout(() => byType[2].forEach(d => spawnPulse(d.in.find(e => e.active), true, 240 * unit)), 1100);
      MAINS[3].glow = 1;
      log('plan', 'fcst', { n: 56, p: rand(6.5, 9.5).toFixed(1) });
    } },
    { w: 1, run(now) {   // OTIF anomaly on a hub -> DC lane
      const e = pick(edgesByKind[1].filter(x => x.active));
      e.hi = 1; e.hiC = C.warn; summon(e.b, now);
      K.otif.dip += 0.4;
      log('perf', 'anom', { a: e.a.name, b: e.b.name });
    } },
    { w: 0.6, run() {    // safety stock re-positioning
      byType[1].forEach(h => { h.level = clamp(h.level + 0.12, 0, 0.92); h.out.forEach(e => { if (e.active) { e.hi = 0.8; e.hiC = C.ion; } }); });
      K.inv.v -= 0.4;
      MAINS[1].glow = 1;
      log('plan', 'ss', { p: rand(3, 7).toFixed(1) });
    } }
  ];
  const W_SUM = EVENTS.reduce((a, e) => a + e.w, 0);
  function runEvent(now) {
    let r = Math.random() * W_SUM;
    for (const ev of EVENTS) { r -= ev.w; if (r <= 0) { ev.run(now); return; } }
  }

  // ---------- pointer focus (highlight a node's supply path) ----------
  let focus = null, focusSet = null;
  hero.addEventListener('pointermove', e => {
    if (e.target.closest('.twin-copy > *, .twin-panel, a, button')) { focus = null; return; }
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 18 * unit;
    for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } }
    if (best !== focus) {
      focus = best; focusSet = null;
      if (best) {
        focusSet = new Set([best]);
        const up = [best], down = [best];
        while (up.length) { const n = up.pop(); n.in.forEach(ed => { if (ed.active && !focusSet.has(ed)) { focusSet.add(ed); focusSet.add(ed.a); up.push(ed.a); } }); }
        while (down.length) { const n = down.pop(); n.out.forEach(ed => { if (ed.active && !focusSet.has(ed)) { focusSet.add(ed); focusSet.add(ed.b); down.push(ed.b); } }); }
      }
    }
  });
  hero.addEventListener('pointerleave', () => { focus = null; focusSet = null; });
  const dimOf = o => (focusSet && !focusSet.has(o)) ? 0.22 : 1;

  // ---------- frame ----------
  let nextEvent = LIVE + 1.2, nextKpi = 0, matAcc = 0, infoAcc = 0, booted = false;

  function draw(t, dt) {
    ctx.clearRect(0, 0, W, H);
    if (!img.complete || !img.naturalWidth) return;
    const now = t;
    const live = t >= LIVE;
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    const k0 = (Math.min(R.w, R.h) * 0.3) / IR;
    const rd = band * 0.37, k1 = rd / DR;

    // node reveal times (left to right along the flow)
    nodes.forEach(n => { n.appear = NET_A + n.u * (NET_B - NET_A - 0.8) + (n.idx % 5) * 0.04; });
    const nodeA = n => reduce ? 1 : easeOut(span(t, n.appear, n.appear + 0.6));

    // --- echelon lanes ---
    const laneA = reduce ? 1 : easeOut(span(t, NET_A - 0.4, NET_A + 1.2));
    if (laneA > 0) {
      ctx.save();
      ctx.setLineDash([2, 6]); ctx.lineWidth = 1;
      MAINS.forEach(m => {
        const [ex, ey] = map(ECH_U[m.ech], 0), [fx, fy] = map(ECH_U[m.ech], 1);
        const g = portrait ? ctx.createLinearGradient(R.x, 0, R.x + R.w, 0) : ctx.createLinearGradient(0, R.y, 0, R.y + R.h);
        g.addColorStop(0, rgba(C.ion, 0.25 * laneA)); g.addColorStop(1, rgba(C.ion, 0));
        ctx.strokeStyle = g;
        ctx.beginPath();
        if (!portrait) { ctx.moveTo(ex, R.y + band * 0.8); ctx.lineTo(ex, fy + 6); } else { ctx.moveTo(R.x + band * 0.8, ey); ctx.lineTo(fx + 6, ey); }
        ctx.stroke();
      });
      ctx.restore();
    }

    // --- edges ---
    ctx.save();
    ctx.lineCap = 'round';
    for (const e of edges) {
      const ra = nodeA(e.a), rb = nodeA(e.b);
      if (ra <= 0) continue;
      const prog = reduce ? 1 : clamp(span(t, e.a.appear + 0.2, e.b.appear + 0.3));
      if (prog <= 0) continue;
      const dim = dimOf(e);
      if (e.backup && !e.active) {
        ctx.setLineDash([2, 5]); ctx.lineWidth = 0.9; ctx.strokeStyle = rgba(C.edge, 0.28 * dim);
      } else {
        ctx.setLineDash([]); ctx.lineWidth = (e.kind === 2 ? 0.9 : 1.2) * Math.max(unit, 0.8);
        ctx.strokeStyle = rgba(C.edge, (e.kind === 2 ? 0.55 : 0.7) * dim);
      }
      strokeEdge(e, 0, prog);
      if (e.hi > 0.01 && (e.active || e.hiC !== C.ion)) {
        ctx.setLineDash([]); ctx.lineWidth = 2.2 * unit; ctx.strokeStyle = rgba(e.hiC, 0.75 * e.hi);
        ctx.shadowColor = e.hiC; ctx.shadowBlur = 8 * e.hi;
        strokeEdge(e); ctx.shadowBlur = 0;
      }
      if (focusSet && focusSet.has(e)) {
        ctx.setLineDash([]); ctx.lineWidth = 1.8 * unit; ctx.strokeStyle = rgba(C.ion, 0.85); strokeEdge(e);
      }
      e.hi = Math.max(0, e.hi - dt * 0.35);
    }
    lateral = lateral.filter(l => {
      if (now > l.until && !parcels.some(p => p.e === l)) return false;
      const a = clamp((l.until - now) / 1.5 + 0.2);
      ctx.setLineDash([4, 4]); ctx.lineDashOffset = -now * 30; ctx.lineWidth = 1.6 * unit;
      ctx.strokeStyle = rgba(C.ok, 0.8 * a); strokeEdge(l); ctx.lineDashOffset = 0;
      return true;
    });
    ctx.restore();

    // --- ambient flow spawning ---
    if (live && dt > 0) {
      matAcc += dt * 15; infoAcc += dt * 7;
      while (matAcc >= 1) {
        matAcc -= 1;
        const r = Math.random(), kind = r < 0.3 ? 0 : r < 0.58 ? 1 : 2;
        spawnParcel(pick(edgesByKind[kind]));
      }
      while (infoAcc >= 1) {
        infoAcc -= 1;
        const r = Math.random(), kind = r < 0.25 ? 0 : r < 0.5 ? 1 : 2;
        const e = pick(edgesByKind[kind]);
        if (e.active) spawnPulse(e, true);
      }
      if (Math.random() < dt * 1.6) {        // agent <-> sub-agent coordination
        const s = pick(subs); const m = MAINS[s.owner];
        if (s.born) Math.random() < 0.5 ? spawnBeam(m.x, m.y, s.x, s.y, 0.25) : spawnBeam(s.x, s.y, m.x, m.y, -0.25);
      }
      if (Math.random() < dt * 0.9) {        // agent-to-agent negotiation
        const i = (Math.random() * 3) | 0, a = MAINS.find(m => m.ech === i), b = MAINS.find(m => m.ech === i + 1);
        Math.random() < 0.5 ? spawnBeam(a.x, a.y, b.x, b.y, -0.18) : spawnBeam(b.x, b.y, a.x, a.y, 0.18);
      }
    }

    // --- material parcels ---
    ctx.save();
    parcels = parcels.filter(p => {
      p.t += p.v * dt;
      if (p.t >= 1) {
        const n = p.e.b; n.hot = 1;
        if (n.type < 3) n.level = clamp(n.level + 0.01, 0.12, 0.96);
        if (p.e.a.type > 0) p.e.a.level = clamp(p.e.a.level - 0.006, 0.12, 0.96);
        return false;
      }
      const [x, y] = at(p.e, p.t), [tx, ty] = at(p.e, Math.max(0, p.t - 0.035));
      const a = Math.min(1, Math.sin(Math.PI * p.t) * 3) * dimOf(p.e);
      const sz = 2.3 * unit * p.s;
      ctx.globalAlpha = a;
      ctx.strokeStyle = rgba(C.mat, 0.28); ctx.lineWidth = sz * 1.2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      ctx.translate(x, y); ctx.rotate(Math.atan2(y - ty, x - tx));
      ctx.fillStyle = C.mat; ctx.fillRect(-sz, -sz * 0.75, sz * 2, sz * 1.5);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    });
    ctx.restore();

    // --- information pulses (upstream) ---
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    pulses = pulses.filter(p => {
      p.t += p.v * dt;
      if (p.t >= 1) { const n = p.rev ? p.e.a : p.e.b; n.hot = Math.max(n.hot, 0.6); return false; }
      const tt = p.rev ? 1 - p.t : p.t, tail = p.rev ? Math.min(1, tt + 0.07) : Math.max(0, tt - 0.07);
      const [x, y] = at(p.e, tt), [x0, y0] = at(p.e, tail);
      const a = Math.min(1, Math.sin(Math.PI * p.t) * 2.5) * dimOf(p.e);
      const g = ctx.createLinearGradient(x0, y0, x, y);
      g.addColorStop(0, rgba(C.ion, 0)); g.addColorStop(1, rgba(C.ion, 0.85 * a));
      ctx.strokeStyle = g; ctx.lineWidth = 1.6 * unit; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      const s = 13 * unit; ctx.globalAlpha = a;
      ctx.drawImage(sprite, x - s / 2, y - s / 2, s, s);
      ctx.globalAlpha = 1;
      return true;
    });
    ctx.restore();

    // --- nodes ---
    for (const n of nodes) {
      const a = nodeA(n);
      if (a <= 0) continue;
      const s = SIZE[n.type] * gu * lerp(0.6, 1, a), dim = dimOf(n);
      if (n.status && now > n.statusUntil) n.status = 0;
      n.hot = Math.max(0, n.hot - dt * 2.2);
      ctx.save();
      ctx.globalAlpha = a * dim;
      // status halo
      if (n.status) {
        const col = n.status === 2 ? C.bad : C.warn, ph = (now * 1.6) % 1;
        ctx.strokeStyle = rgba(col, 0.9 * (1 - ph)); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(n.x, n.y, s * (1.6 + ph * 2.2), 0, TAU); ctx.stroke();
        ctx.fillStyle = rgba(col, 0.16); ctx.beginPath(); ctx.arc(n.x, n.y, s * 2.1, 0, TAU); ctx.fill();
      } else if (n.hot > 0.05) {
        ctx.fillStyle = rgba(C.ion, 0.2 * n.hot); ctx.beginPath(); ctx.arc(n.x, n.y, s * 2.2, 0, TAU); ctx.fill();
      }
      // inventory ring for hubs and DCs
      if (n.type === 1 || n.type === 2) {
        const rr = s * 1.6, lv = n.level;
        const col = lv < 0.25 ? C.warn : lv > 0.9 ? C.warn : C.ok;
        ctx.lineWidth = 1.6 * unit;
        ctx.strokeStyle = rgba(C.node, 0.12); ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, TAU); ctx.stroke();
        ctx.strokeStyle = rgba(col, 0.85); ctx.beginPath(); ctx.arc(n.x, n.y, rr, -Math.PI / 2, -Math.PI / 2 + lv * TAU); ctx.stroke();
        n.level = clamp(n.level + (Math.random() - 0.52) * dt * 0.02, 0.15, 0.95);
      }
      glyph(n.type, n.x, n.y, s);
      ctx.fillStyle = C.nodeFill; ctx.fill();
      ctx.lineWidth = (n.type === 3 ? 1.1 : 1.3) * Math.max(unit, 0.8);
      ctx.strokeStyle = n.status === 2 ? C.bad : n.status === 1 ? C.warn : (focus === n ? C.ion : C.node);
      ctx.stroke();
      ctx.lineWidth = Math.max(unit, 0.8);
      glyphDetail(n.type, n.x, n.y, s);
      if (n.type === 1) { ctx.fillStyle = C.ion; ctx.beginPath(); ctx.arc(n.x, n.y, s * 0.22, 0, TAU); ctx.fill(); }
      ctx.restore();
    }

    // --- emblem / main agents ---
    if (!reduce && t < T_HOLD) {
      const intro = easeOut(span(t, 0, T_IN)), sc = k0 * lerp(0.85, 1, intro), Rr = IR * sc;
      ctx.save();
      ctx.globalAlpha = intro;
      const g = ctx.createRadialGradient(cx, cy, Rr * 0.85, cx, cy, Rr * 1.6);
      g.addColorStop(0, rgba(C.ion, 0.28)); g.addColorStop(1, rgba(C.ion, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, Rr * 1.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(C.ion, 0.45); ctx.setLineDash([2, 7]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, Rr * 1.14, t * 0.4, t * 0.4 + TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.drawImage(img, cx - IC * sc, cy - IC * sc, IMG * sc, IMG * sc);
      const cue = span(t, T_HOLD - 0.6, T_HOLD);
      if (cue > 0) { ctx.strokeStyle = rgba(C.ion, 0.7 * (1 - cue)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, Rr * (1 + cue * 0.4), 0, TAU); ctx.stroke(); }
      ctx.restore();
    } else {
      const gap = reduce ? 1 : ease(span(t, T_HOLD, T_SPLIT));
      const travel = reduce ? 1 : ease(span(t, T_SPLIT, T_ARRIVE));
      const seam = reduce ? 0 : Math.sin(Math.PI * span(t, T_HOLD, T_SPLIT));
      if (seam > 0.01) {
        ctx.save(); ctx.globalAlpha = seam * 0.6;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, IR * k0 * 0.8);
        g.addColorStop(0, C.ion); g.addColorStop(1, rgba(C.ion, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, IR * k0 * 0.8, 0, TAU); ctx.fill(); ctx.restore();
      }
      // agent-to-agent link
      if (travel >= 1) {
        ctx.save();
        ctx.strokeStyle = rgba(C.ion, 0.3); ctx.setLineDash([3, 5]); ctx.lineDashOffset = -now * 12; ctx.lineWidth = 1;
        const ord = MAINS.slice().sort((p, q) => p.ech - q.ech);
        ctx.beginPath(); ord.forEach((m, i) => i ? ctx.lineTo(m.x, m.y) : ctx.moveTo(m.x, m.y)); ctx.stroke();
        ctx.restore();
      }
      [1, 0, 3, 2].forEach(k => {
        const m = MAINS[k], dir = [Math.cos(m.a), Math.sin(m.a)], off = gap * Math.min(R.w, R.h) * 0.05;
        const sx = cx + dir[0] * (AD * k0 + off), sy = cy + dir[1] * (AD * k0 + off);
        const ctlx = lerp(sx, m.x, 0.5) + dir[0] * R.h * 0.12, ctly = lerp(sy, m.y, 0.5) + dir[1] * R.h * 0.12;
        const u = 1 - travel;
        const x = u * u * sx + 2 * u * travel * ctlx + travel * travel * m.x;
        const y = u * u * sy + 2 * u * travel * ctly + travel * travel * m.y;
        let r0 = m.a + Math.PI / 2; if (r0 > Math.PI) r0 -= TAU;
        // halo once docked
        const dock = reduce ? 1 : span(t, T_ARRIVE - 0.3, T_ARRIVE + 0.5);
        if (dock > 0) {
          m.glow = Math.max(0, m.glow - dt * 1.2);
          ctx.save(); ctx.globalAlpha = dock;
          const g = ctx.createRadialGradient(m.x, m.y, rd * 0.8, m.x, m.y, rd * 2.3);
          g.addColorStop(0, rgba(C.ion, 0.3 + m.glow * 0.4)); g.addColorStop(1, rgba(C.ion, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(m.x, m.y, rd * 2.3, 0, TAU); ctx.fill();
          ctx.strokeStyle = rgba(C.ion, 0.5); ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.arc(m.x, m.y, rd * 1.35, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
          ctx.strokeStyle = C.ion; ctx.lineWidth = 2; ctx.lineCap = 'round';
          const s0 = now * (k % 2 ? -0.9 : 0.7) + k;
          ctx.beginPath(); ctx.arc(m.x, m.y, rd * 1.18, s0, s0 + 1.1); ctx.stroke();
          ctx.beginPath(); ctx.arc(m.x, m.y, rd * 1.18, s0 + Math.PI, s0 + Math.PI + 0.5); ctx.stroke();
          ctx.restore();
        }
        drawPiece(k, x, y, lerp(r0, 0, travel), lerp(k0, k1, travel), ease(span(travel, 0.15, 1)));
      });
    }

    // --- coordination beams ---
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    beams = beams.filter(b => {
      b.t += b.v * dt;
      if (b.t >= 1) return false;
      const mx = (b.x1 + b.x2) / 2 - (b.y2 - b.y1) * b.bend, my = (b.y1 + b.y2) / 2 + (b.x2 - b.x1) * b.bend;
      const q = tt => { const u = 1 - tt; return [u * u * b.x1 + 2 * u * tt * mx + tt * tt * b.x2, u * u * b.y1 + 2 * u * tt * my + tt * tt * b.y2]; };
      const [x, y] = q(b.t), [x0, y0] = q(Math.max(0, b.t - 0.12));
      const a = Math.sin(Math.PI * b.t);
      const g = ctx.createLinearGradient(x0, y0, x, y);
      g.addColorStop(0, rgba(b.c, 0)); g.addColorStop(1, rgba(b.c, 0.7 * a));
      ctx.strokeStyle = g; ctx.lineWidth = 1.3 * unit;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x) / 2, (y0 + y) / 2, x, y); ctx.stroke();
      const s = 10 * unit; ctx.globalAlpha = a; ctx.drawImage(sprite, x - s / 2, y - s / 2, s, s); ctx.globalAlpha = 1;
      return true;
    });
    ctx.restore();

    // --- sub-agents ---
    const lift = 16 * gu, sr = 7.4 * gu;
    for (const s of subs) {
      const m = MAINS[s.owner];
      if (!reduce && t < s.t0) continue;
      if (!s.born) { s.born = true; s.fx = m.x; s.fy = m.y; }
      const tx = s.node.x, ty = s.node.y - lift - SIZE[s.node.type] * gu * 0.4;
      const k = reduce ? 1 : ease(span(t, s.t0, s.t0 + s.dur));
      const arc = Math.sin(Math.PI * k) * 18 * unit;
      s.x = lerp(s.fx, tx, k) + (portrait ? arc : 0);
      s.y = lerp(s.fy, ty, k) - (portrait ? 0 : arc);
      const bob = Math.sin(now * 2 + s.ph) * 1.6 * unit * k;
      const y = s.y + bob;
      const a = (reduce ? 1 : easeOut(span(t, s.t0, s.t0 + 0.3))) * dimOf(s.node);
      // tether to the main agent
      ctx.save();
      ctx.globalAlpha = a * 0.5;
      ctx.strokeStyle = rgba(C.ion, 0.32); ctx.lineWidth = 0.8; ctx.setLineDash([1.5, 4]);
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(s.x, y); ctx.stroke(); ctx.setLineDash([]);
      // scan beam onto the node
      if (k > 0.95) {
        ctx.globalAlpha = a;
        const g = ctx.createLinearGradient(s.x, y, s.node.x, s.node.y);
        g.addColorStop(0, rgba(C.ion, 0.35)); g.addColorStop(1, rgba(C.ion, 0));
        ctx.fillStyle = g;
        const bw = SIZE[s.node.type] * gu * 1.4;
        ctx.beginPath(); ctx.moveTo(s.x - sr * 0.35, y); ctx.lineTo(s.x + sr * 0.35, y);
        ctx.lineTo(s.node.x + bw, s.node.y + bw * 0.3); ctx.lineTo(s.node.x - bw, s.node.y + bw * 0.3); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      s.act = Math.max(0, s.act - dt * 0.9);
      subGlyph(s.x, y, sr, a, s.act);
      // patrol: move to another node of the echelon from time to time
      if (live && !reduce && now > s.next && k >= 1) {
        if (s.next) {
          const free = byType[MAINS[s.owner].ech].filter(n => !n.sub);
          if (free.length) {
            const n = pick(free);
            s.node.sub = null; s.fx = s.x; s.fy = s.y; s.node = n; n.sub = s; s.t0 = now; s.dur = 1.2;
          }
        }
        s.next = now + rand(7, 15);
      }
    }

    // --- events and KPIs ---
    if (live && !reduce) {
      if (now >= nextEvent) { runEvent(now); nextEvent = now + rand(2.4, 4.2); }
      if (now >= nextKpi) { tickKpis(); nextKpi = now + 1; }
      if (!booted) { booted = true; log('net', 'boot', { n: nodes.length }); }
    }
  }

  // ---------- loop ----------
  let start = 0, last = 0, raf = 0, running = false, visible = true, pausedAt = 0, offset = 0;
  function tick(nowMs) {
    if (!running) return;
    const dt = Math.min((nowMs - last) / 1000, 0.05);
    last = nowMs;
    draw((nowMs - start - offset) / 1000, dt);
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (running || reduce || !visible || document.hidden) return;
    running = true;
    const n = performance.now();
    if (!start) start = n; else offset += n - pausedAt;
    last = n;
    raf = requestAnimationFrame(tick);
  }
  function pause() {
    if (!running) return;
    running = false; pausedAt = performance.now();
    cancelAnimationFrame(raf);
  }

  function staticFrame() {
    // Reduced motion: show the running network with a populated panel
    subs.forEach(s => { s.born = true; });
    ['replen', 'spike', 'split'].forEach((k, i) => {
      const ev = EVENTS[[0, 1, 3][i]]; try { ev.run(LIVE); } catch (e) {}
    });
    parcels = []; pulses = []; beams = []; lateral = [];
    edgesByKind.forEach(list => list.forEach((e, i) => { if (e.active && i % 3 === 0) parcels.push({ e, t: 0.3 + (i % 5) * 0.12, v: 0, s: 1 }); }));
    draw(LIVE + 30, 0);
  }

  for (let i = 0; i < 30; i++) tickKpis();   // KPI history before the twin goes live
  const ready = () => { layout(); reduce ? staticFrame() : play(); };
  if (img.complete && img.naturalWidth) ready(); else img.addEventListener('load', ready);

  window.addEventListener('resize', layout);
  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(stage);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; visible ? play() : pause(); }).observe(hero);
  document.addEventListener('visibilitychange', () => document.hidden ? pause() : play());
  document.addEventListener('langchange', () => renderKpis());
})();
