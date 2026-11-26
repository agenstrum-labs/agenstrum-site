// Hero animation: the AGENSTRUM emblem splits into its four agents (one per
// quarter sector), which take their places across the supply-chain echelons
// and run it as a multi-agent system. Material flows downstream between
// facilities; information pulses travel between agents and to their sites.
// After a while the agents regroup into the emblem and the cycle repeats.
(function () {
  const canvas = document.querySelector('.hero-art .agents');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;

  // ---- Emblem geometry (in emblem image pixels, 512 x 512) ----
  const IMG = 512, IC = 256, IR = 254;   // image size, centre, emblem radius
  const AD = 136;                         // distance from centre to an agent's centre
  const DR = 90;                          // agent disc radius (image px)

  // Four agents, by the direction they face in the emblem (canvas angles).
  // col: echelon column each agent takes (0 = upstream ... 3 = downstream).
  const AGENTS = [
    { a: Math.PI,      col: 0 },   // left
    { a: -Math.PI / 2, col: 1 },   // top
    { a: Math.PI / 2,  col: 2 },   // bottom
    { a: 0,            col: 3 }    // right
  ];

  // ---- Timeline (seconds) ----
  const T_IN = 1.1, T_HOLD = 2.3, T_SPLIT = 3.2, T_ARRIVE = 5.0, T_LIVE = 6.2,
        T_FADE = 16.2, T_BACK = 17.0, T_HOME = 18.8, CYCLE = 19.8;

  // ---- Network layout (fractions of S, relative to centre) ----
  const COLS = [-0.34, -0.113, 0.113, 0.34];
  const AGENT_Y = [0.0, -0.035, 0.035, 0.0];
  const AGENT_R = 0.066;                 // agent disc radius on the network
  const SITES = [                        // facility sites per echelon (y offsets)
    [-0.36, -0.22, 0.22, 0.36],
    [-0.27, 0.26],
    [-0.29, 0.25],
    [-0.38, -0.25, 0.24, 0.37]
  ];
  const SHAPES = ['hex', 'square', 'diamond', 'circle'];

  const img = new Image();
  img.src = canvas.dataset.emblem || 'assets/emblem.png';

  let W = 0, H = 0, S = 0, cx = 0, cy = 0, dpr = 1;
  let colors = {};
  let sites = [], routes = [], spokes = [], mesh = [];
  let parcels = [], signals = [];
  let glow = [0, 0, 0, 0];
  let start = 0, last = 0, raf = 0, running = false, visible = true;
  let nextParcel = 0, nextSignal = 0;

  // Morph outlines (agent-local, image px): wedge sector -> disc
  const N = 96;
  const wedgePts = [], discPts = [];

  const clamp = (x, a = 0, b = 1) => Math.min(Math.max(x, a), b);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => (t = clamp(t), t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const rand = (a, b) => a + Math.random() * (b - a);

  // Ray from the agent centre (origin) to the boundary of the top wedge.
  // In agent-local space "up" is outward; the emblem centre sits at (0, AD).
  function buildOutlines() {
    const poly = [[0, AD]];
    for (let i = 0; i <= 40; i++) {
      const ang = -3 * Math.PI / 4 + (i / 40) * (Math.PI / 2);
      poly.push([Math.cos(ang) * IR, AD + Math.sin(ang) * IR]);
    }
    for (let k = 0; k < N; k++) {
      const th = (k / N) * TAU - Math.PI / 2;
      const dx = Math.cos(th), dy = Math.sin(th);
      let best = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
        const ex = x2 - x1, ey = y2 - y1;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (x1 * ey - y1 * ex) / den;
        const u = (x1 * dy - y1 * dx) / den;
        if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.min(best, t);
      }
      wedgePts.push([dx * best, dy * best]);
      discPts.push([dx * DR, dy * DR]);
    }
  }

  function readColors() {
    const cs = getComputedStyle(canvas);
    const v = (n, f) => cs.getPropertyValue(n).trim() || f;
    colors = {
      node: v('--net-node', '#8B949D'),
      edge: v('--net-edge', '#7397CC'),
      pulse: v('--net-pulse', '#1D63D8'),
      core: v('--net-core', '#01265A'),
      surface: v('--surface', '#FFFFFF'),
      material: v('--net-core', '#01265A')
    };
  }

  function buildNetwork() {
    sites = [];
    SITES.forEach((ys, c) => ys.forEach((y, i) => sites.push({
      c, i, x: COLS[c] + (c % 2 ? 0.012 : -0.012) * (i % 2 ? 1 : -1), y, shape: SHAPES[c], hot: 0
    })));
    const byCol = c => sites.filter(s => s.c === c);
    // Material routes between neighbouring echelons: mostly same side, a few crossings
    routes = [];
    for (let c = 0; c < 3; c++) {
      const A = byCol(c), B = byCol(c + 1);
      A.forEach(a => B.forEach(b => {
        const same = Math.sign(a.y) === Math.sign(b.y);
        const near = Math.abs(a.y - b.y) < 0.16;
        if ((same && (near || A.length < B.length || A.length > B.length)) ||
            (!same && a.i === 0 && b.i === B.length - 1 && c === 1)) routes.push({ a, b });
      }));
    }
    // Info: each agent to its own sites, and agents to each other
    spokes = sites.map(s => ({ agent: s.c, site: s }));
    mesh = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) mesh.push({ i, j, arc: j - i === 1 ? 0 : (j - i === 2 ? (i === 0 ? -1 : 1) : -1.6) });
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = Math.min(W, H);
    cx = W / 2; cy = H / 2;
    if (reduceMotion) draw(T_LIVE + 3, 0);
  }

  // ---- helpers ----
  const P = (x, y) => [cx + x * S, cy + y * S];
  function agentHome(k) { return P(COLS[AGENTS[k].col], AGENT_Y[AGENTS[k].col]); }

  function bez(r) {
    const [x1, y1] = P(r.a.x, r.a.y), [x2, y2] = P(r.b.x, r.b.y);
    const mx = (x2 - x1) * 0.5;
    return [x1, y1, x1 + mx, y1, x2 - mx, y2, x2, y2];
  }
  function bezAt(b, t) {
    const u = 1 - t;
    const x = u * u * u * b[0] + 3 * u * u * t * b[2] + 3 * u * t * t * b[4] + t * t * t * b[6];
    const y = u * u * u * b[1] + 3 * u * u * t * b[3] + 3 * u * t * t * b[5] + t * t * t * b[7];
    return [x, y];
  }
  function meshPath(m) {
    const [x1, y1] = agentHome(AGENTS.findIndex(a => a.col === m.i));
    const [x2, y2] = agentHome(AGENTS.findIndex(a => a.col === m.j));
    const lift = m.arc * S * 0.13;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + lift * 1.35;
    return [x1, y1, mx, my, x2, y2];
  }
  function quadAt(q, t) {
    const u = 1 - t;
    return [u * u * q[0] + 2 * u * t * q[2] + t * t * q[4], u * u * q[1] + 2 * u * t * q[3] + t * t * q[5]];
  }

  function shapePath(shape, x, y, r) {
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(x, y, r, 0, TAU);
    else if (shape === 'square') ctx.roundRect ? ctx.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.3) : ctx.rect(x - r, y - r, 2 * r, 2 * r);
    else if (shape === 'diamond') { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y); ctx.closePath(); }
    else { for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r * 1.12, y + Math.sin(a) * r * 1.12); } ctx.closePath(); }
  }

  // ---- spawners ----
  function spawnParcel() {
    const r = routes[(Math.random() * routes.length) | 0];
    parcels.push({ r, b: bez(r), t: 0, v: rand(0.22, 0.34), rot: rand(0, TAU) });
  }
  function spawnSignal() {
    const roll = Math.random();
    if (roll < 0.5) {
      const m = mesh[(Math.random() * mesh.length) | 0];
      const rev = Math.random() < 0.6; // demand information mostly travels upstream
      signals.push({ kind: 'mesh', m, q: meshPath(m), t: 0, v: rand(0.45, 0.7), rev });
    } else {
      const s = spokes[(Math.random() * spokes.length) | 0];
      signals.push({ kind: 'spoke', s, t: 0, v: rand(0.8, 1.2), rev: Math.random() < 0.5 });
    }
  }

  // ---- drawing ----
  function drawAgent(k, pos, rot, scale, morph, alpha) {
    const ag = AGENTS[k];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(pos[0], pos[1]);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    // clip: wedge -> disc
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = lerp(wedgePts[i][0], discPts[i][0], morph);
      const y = lerp(wedgePts[i][1], discPts[i][1], morph);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.save();
    ctx.clip();
    ctx.translate(0, AD);
    ctx.rotate(-Math.PI / 2 - ag.a);
    ctx.drawImage(img, -IC, -IC, IMG, IMG);
    ctx.restore();
    // crisp edge on the piece
    ctx.lineWidth = 1.2 / scale;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.18 + 0.25 * morph) + ')';
    ctx.stroke();
    ctx.restore();
  }

  function drawHalo(x, y, r, t, k, a) {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    // soft glow
    const g = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 1.9);
    g.addColorStop(0, hexA(colors.pulse, 0.22 + glow[k] * 0.35));
    g.addColorStop(1, hexA(colors.pulse, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, TAU); ctx.fill();
    // HUD rings
    ctx.lineWidth = 1;
    ctx.strokeStyle = hexA(colors.edge, 0.55);
    ctx.setLineDash([2, 5]);
    ctx.beginPath(); ctx.arc(x, y, r * 1.28, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = colors.pulse;
    const s0 = t * (k % 2 ? -0.9 : 0.7) + k;
    ctx.beginPath(); ctx.arc(x, y, r * 1.14, s0, s0 + 1.1); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 1.14, s0 + Math.PI, s0 + Math.PI + 0.5); ctx.stroke();
    ctx.restore();
  }

  function hexA(c, a) {
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = h.split('').map(x => x + x).join('');
      const n = parseInt(h, 16);
      return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
    }
    return c;
  }

  function draw(t, dt) {
    ctx.clearRect(0, 0, W, H);
    if (!img.complete || !img.naturalWidth) return;

    const k0 = (S * 0.36) / IR;                 // emblem scale when whole
    const k1 = (S * AGENT_R) / DR;              // agent scale on the network
    const net = reduceMotion ? 1 : ease(span(t, T_ARRIVE - 0.6, T_LIVE)) * (1 - ease(span(t, T_FADE, T_BACK + 0.2)));
    const flows = reduceMotion ? 1 : clamp(span(t, T_LIVE - 0.4, T_LIVE + 0.6)) * (1 - span(t, T_FADE - 0.6, T_FADE + 0.2));

    // ---- echelon lanes ----
    if (net > 0) {
      ctx.save();
      COLS.forEach((x, c) => {
        const [px] = P(x, 0);
        const g = ctx.createLinearGradient(0, cy - S * 0.47, 0, cy + S * 0.47);
        g.addColorStop(0, hexA(colors.edge, 0));
        g.addColorStop(0.5, hexA(colors.edge, 0.22 * net));
        g.addColorStop(1, hexA(colors.edge, 0));
        ctx.strokeStyle = g;
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 6]);
        ctx.beginPath(); ctx.moveTo(px, cy - S * 0.47 * net); ctx.lineTo(px, cy + S * 0.47 * net); ctx.stroke();
      });
      ctx.restore();

      // material routes (solid, drawn in)
      ctx.save();
      ctx.lineWidth = 1.1;
      routes.forEach((r, i) => {
        const b = bez(r);
        const reveal = reduceMotion ? 1 : clamp(net * 1.4 - (r.a.c * 0.15));
        if (reveal <= 0) return;
        ctx.strokeStyle = hexA(colors.node, 0.42 * net);
        ctx.beginPath();
        ctx.moveTo(b[0], b[1]);
        const steps = 24;
        for (let s = 1; s <= steps * reveal; s++) { const p = bezAt(b, s / steps); ctx.lineTo(p[0], p[1]); }
        ctx.stroke();
      });
      ctx.restore();

      // information links (dashed, flowing)
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = -t * 14;
      spokes.forEach(sp => {
        const [ax, ay] = agentHome(AGENTS.findIndex(a => a.col === sp.agent));
        const [sx, sy] = P(sp.site.x, sp.site.y);
        ctx.strokeStyle = hexA(colors.pulse, 0.32 * net);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(lerp(ax, sx, net), lerp(ay, sy, net)); ctx.stroke();
      });
      ctx.lineDashOffset = t * 18;
      mesh.forEach(m => {
        const q = meshPath(m);
        ctx.strokeStyle = hexA(colors.pulse, (m.arc ? 0.26 : 0.4) * net);
        ctx.beginPath(); ctx.moveTo(q[0], q[1]);
        const steps = 30;
        for (let s = 1; s <= steps * net; s++) { const p = quadAt(q, s / steps); ctx.lineTo(p[0], p[1]); }
        ctx.stroke();
      });
      ctx.restore();

      // facility sites
      sites.forEach(s => {
        const [x, y] = P(s.x, s.y);
        const r = S * 0.016 * easeOut(net);
        if (r <= 0.2) return;
        s.hot = Math.max(0, s.hot - dt * 2);
        ctx.save();
        if (s.hot > 0) {
          ctx.fillStyle = hexA(colors.pulse, 0.18 * s.hot);
          ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, TAU); ctx.fill();
        }
        shapePath(s.shape, x, y, r);
        ctx.fillStyle = colors.surface;
        ctx.globalAlpha = net;
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = s.hot > 0.2 ? colors.pulse : colors.node;
        ctx.stroke();
        shapePath(s.shape, x, y, r * 0.38);
        ctx.fillStyle = colors.core;
        ctx.fill();
        ctx.restore();
      });
    }

    // ---- flows ----
    if (!reduceMotion && flows > 0 && dt > 0) {
      nextParcel -= dt; nextSignal -= dt;
      if (nextParcel <= 0 && t < T_FADE - 0.8) { spawnParcel(); nextParcel = rand(0.09, 0.2); }
      if (nextSignal <= 0 && t < T_FADE - 0.8) { spawnSignal(); nextSignal = rand(0.12, 0.26); }
    }
    if (reduceMotion && parcels.length === 0 && routes.length) {
      routes.forEach((r, i) => { if (i % 2 === 0) parcels.push({ r, b: bez(r), t: 0.25 + (i % 3) * 0.22, v: 0, rot: i }); });
    }
    if (flows > 0 || parcels.length || signals.length) {
      // material parcels
      parcels = parcels.filter(p => {
        p.t += p.v * dt;
        if (p.t >= 1) { p.r.b.hot = 0.6; return false; }
        const [x, y] = bezAt(p.b, p.t);
        const [tx, ty] = bezAt(p.b, Math.max(0, p.t - 0.06));
        const a = Math.sin(Math.PI * p.t) * 0.85 + 0.15;
        ctx.save();
        ctx.globalAlpha = a * Math.max(flows, 0.0001 + (reduceMotion ? 1 : 0));
        const g = ctx.createLinearGradient(tx, ty, x, y);
        g.addColorStop(0, hexA(colors.material, 0));
        g.addColorStop(1, hexA(colors.material, 0.45));
        ctx.strokeStyle = g; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        ctx.translate(x, y); ctx.rotate(Math.atan2(y - ty, x - tx));
        const sz = Math.max(2.6, S * 0.0085);
        ctx.fillStyle = colors.material;
        ctx.fillRect(-sz, -sz * 0.8, sz * 2, sz * 1.6);
        ctx.restore();
        return true;
      });

      // information signals
      signals = signals.filter(s => {
        s.t += s.v * dt;
        if (s.t >= 1) {
          if (s.kind === 'mesh') glow[AGENTS.findIndex(a => a.col === (s.rev ? s.m.i : s.m.j))] = 1;
          else if (s.rev) glow[AGENTS.findIndex(a => a.col === s.s.agent)] = 1;
          else s.s.site.hot = 1;
          return false;
        }
        const tt = s.rev ? 1 - s.t : s.t;
        const tail = s.rev ? Math.min(1, tt + 0.08) : Math.max(0, tt - 0.08);
        let x, y, x0, y0;
        if (s.kind === 'mesh') { [x, y] = quadAt(s.q, tt); [x0, y0] = quadAt(s.q, tail); }
        else {
          const [ax, ay] = agentHome(AGENTS.findIndex(a => a.col === s.s.agent));
          const [sx, sy] = P(s.s.site.x, s.s.site.y);
          x = lerp(ax, sx, tt); y = lerp(ay, sy, tt); x0 = lerp(ax, sx, tail); y0 = lerp(ay, sy, tail);
        }
        ctx.save();
        ctx.globalAlpha = Math.max(flows, 0);
        const g = ctx.createLinearGradient(x0, y0, x, y);
        g.addColorStop(0, hexA(colors.pulse, 0));
        g.addColorStop(1, hexA(colors.pulse, 0.9));
        ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = colors.pulse;
        ctx.shadowColor = colors.pulse; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.8, S * 0.0055), 0, TAU); ctx.fill();
        ctx.restore();
        return true;
      });
    }
    for (let k = 0; k < 4; k++) glow[k] = Math.max(0, glow[k] - dt * 1.6);

    // ---- emblem / agents ----
    // Whole emblem: intro, hold, and the instant it re-forms
    const intro = reduceMotion ? 1 : easeOut(span(t, 0, T_IN));
    if (!reduceMotion && (t < T_HOLD || t >= CYCLE - 0.02)) {
      const sc = k0 * lerp(0.86, 1, intro);
      ctx.save();
      ctx.globalAlpha = intro;
      // breathing halo around the emblem
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
      const R = IR * sc;
      const g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.5);
      g.addColorStop(0, hexA(colors.pulse, 0.16 + pulse * 0.08));
      g.addColorStop(1, hexA(colors.pulse, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.5, 0, TAU); ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = hexA(colors.edge, 0.5);
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, t * 0.3, t * 0.3 + TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.drawImage(img, cx - IC * sc, cy - IC * sc, IMG * sc, IMG * sc);
      ctx.restore();
      // split cue: a ring sweeping out just before the break
      const cue = span(t, T_HOLD - 0.6, T_HOLD);
      if (cue > 0 && cue < 1) {
        ctx.save();
        ctx.strokeStyle = hexA(colors.pulse, 0.6 * (1 - cue));
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, R * (1 + cue * 0.35), 0, TAU); ctx.stroke();
        ctx.restore();
      }
      return;
    }

    // Pieces. Forward: split (T_HOLD..T_SPLIT) then travel (T_SPLIT..T_ARRIVE).
    // Return: travel back (T_BACK..T_HOME) then close up (T_HOME..CYCLE).
    let gap, travel;
    if (reduceMotion) { gap = 0; travel = 1; }
    else if (t < T_BACK) { gap = ease(span(t, T_HOLD, T_SPLIT)); travel = ease(span(t, T_SPLIT, T_ARRIVE)); }
    else { travel = 1 - ease(span(t, T_BACK, T_HOME)); gap = 1 - ease(span(t, T_HOME, CYCLE)); }

    // Seam flash while the emblem breaks apart / re-forms
    const seam = reduceMotion ? 0 : Math.max(Math.sin(Math.PI * span(t, T_HOLD, T_SPLIT)) * (t < T_BACK ? 1 : 0),
                                              Math.sin(Math.PI * span(t, T_HOME, CYCLE)) * (t >= T_HOME ? 1 : 0));
    if (seam > 0.01) {
      ctx.save();
      ctx.globalAlpha = seam * 0.55;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.25);
      g.addColorStop(0, colors.pulse);
      g.addColorStop(1, hexA(colors.pulse, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, S * 0.25, 0, TAU); ctx.fill();
      ctx.restore();
    }

    const order = [1, 0, 3, 2]; // draw top/left first so travelling pieces overlap cleanly
    order.forEach(k => {
      const ag = AGENTS[k];
      const dir = [Math.cos(ag.a), Math.sin(ag.a)];
      const off = gap * S * 0.045;
      const start = [cx + dir[0] * (AD * k0 + off), cy + dir[1] * (AD * k0 + off)];
      const home = agentHome(k);
      // curved travel path: bow outward a little
      const ctrl = [lerp(start[0], home[0], 0.5) + dir[0] * S * 0.08, lerp(start[1], home[1], 0.5) + dir[1] * S * 0.08];
      const u = 1 - travel;
      const pos = [u * u * start[0] + 2 * u * travel * ctrl[0] + travel * travel * home[0],
                   u * u * start[1] + 2 * u * travel * ctrl[1] + travel * travel * home[1]];
      let r0 = ag.a + Math.PI / 2;           // orientation inside the emblem
      if (r0 > Math.PI) r0 -= TAU;           // shortest turn to upright
      const rot = lerp(r0, 0, travel);
      const scale = lerp(k0, k1, travel);
      const morph = ease(span(travel, 0.15, 1));
      if (net > 0.02) drawHalo(home[0], home[1], S * AGENT_R, t, k, net * (reduceMotion ? 1 : clamp(travel * 2 - 1)));
      drawAgent(k, pos, rot, scale, morph, 1);
    });
  }

  function tick(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    let t = (now - start) / 1000;
    if (t >= CYCLE) t = T_IN + ((t - T_IN) % (CYCLE - T_IN)); // skip the fade-in after the first cycle
    if (t < T_ARRIVE && parcels.length + signals.length) { parcels = []; signals = []; }
    draw(t, dt);
    raf = requestAnimationFrame(tick);
  }

  let paused = 0;
  function play() {
    if (running || reduceMotion || !visible || document.hidden) return;
    running = true;
    const now = performance.now();
    if (!start) start = now; else start += now - paused;
    last = now;
    raf = requestAnimationFrame(tick);
  }
  function pause() {
    if (!running) return;
    running = false;
    paused = performance.now();
    cancelAnimationFrame(raf);
  }

  buildOutlines();
  buildNetwork();
  readColors();
  const ready = () => { resize(); play(); };
  if (img.complete && img.naturalWidth) ready(); else img.addEventListener('load', ready);

  window.addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  const recolor = () => { readColors(); if (reduceMotion) draw(T_LIVE + 3, 0); };
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    visible ? play() : pause();
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => document.hidden ? pause() : play());
})();
