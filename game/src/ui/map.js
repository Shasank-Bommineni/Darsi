// Player-facing map (separate from the debug overlay).
//
// Canvas-drawn from the same road graph the world is built from, with a clean
// visual hierarchy: highways > main roads > streets > lanes, water, built-up
// shading, the player, discovered landmarks, category filters, zoom levels and
// a routing line to a chosen destination.

import { clamp, clamp01, lerp, fmtDistance } from '../core/util.js';

const CSS = `
#mapui { position: fixed; inset: 0; z-index: 40; display: none; background: rgba(10,9,8,.72);
  backdrop-filter: blur(5px); font-family: ui-sans-serif, system-ui, Roboto, sans-serif; color: #f3ece0; }
#mapui.on { display: block; }
#mapwrap { position: absolute; inset: 3.2vh 3.2vw; background: #e9e2d2; border-radius: 16px; overflow: hidden;
  box-shadow: 0 30px 90px rgba(0,0,0,.6); }
#mapcanvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: grab; }
#maptop { position: absolute; left: 0; right: 0; top: 0; padding: 12px 16px; display: flex; gap: 10px;
  align-items: center; background: linear-gradient(180deg, rgba(20,18,15,.88), rgba(20,18,15,0)); }
#maptop .title { font-weight: 800; letter-spacing: .18em; font-size: 15px; }
#maptop .sub { font-size: 11px; color: #c9bb9f; letter-spacing: .1em; }
#mapclose { margin-left: auto; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.2);
  color: #f3ece0; border-radius: 9px; padding: 7px 14px; cursor: pointer; font-weight: 700; font-size: 12px; }
#mapfilters { position: absolute; left: 14px; bottom: 14px; display: flex; gap: 6px; flex-wrap: wrap; max-width: 70%; }
.mf { background: rgba(26,23,19,.82); border: 1px solid rgba(255,255,255,.14); color: #e7dcc6;
  border-radius: 999px; padding: 6px 13px; font-size: 11.5px; cursor: pointer; letter-spacing: .05em; }
.mf.on { background: #e2b33c; color: #241c08; border-color: #e2b33c; font-weight: 700; }
#mapzoom { position: absolute; right: 14px; bottom: 14px; display: flex; flex-direction: column; gap: 6px; }
#mapzoom button { width: 40px; height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18);
  background: rgba(26,23,19,.82); color: #f3ece0; font-size: 19px; cursor: pointer; }
#mapinfo { position: absolute; right: 14px; top: 62px; width: 230px; background: rgba(26,23,19,.9);
  border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: 12px 14px; display: none; }
#mapinfo .n { font-weight: 700; font-size: 14px; margin-bottom: 3px; }
#mapinfo .c { font-size: 11px; color: #c9bb9f; letter-spacing: .08em; text-transform: uppercase; }
#mapinfo .d { font-size: 12px; color: #e7dcc6; margin-top: 8px; }
#mapinfo button { margin-top: 10px; width: 100%; background: #e2b33c; color: #241c08; border: 0;
  border-radius: 8px; padding: 8px; font-weight: 700; cursor: pointer; }
#maplegend { position: absolute; left: 14px; top: 62px; background: rgba(26,23,19,.82);
  border: 1px solid rgba(255,255,255,.12); border-radius: 10px; padding: 9px 12px; font-size: 11px;
  color: #d8cbb0; line-height: 1.7; }
#maplegend i { display: inline-block; width: 16px; height: 3px; vertical-align: middle; margin-right: 6px; border-radius: 2px; }
@media (max-width: 760px) {
  #mapwrap { inset: 1.5vh 1.5vw; }
  #maplegend { display: none; }
  #mapinfo { width: 180px; right: 8px; }
}
`;

const CATS = [
  { id: 'temple', label: 'Temples', test: (p) => p.cat === 'amenity:place_of_worship', color: '#c2552a', icon: '▲' },
  { id: 'fuel', label: 'Fuel', test: (p) => p.cat === 'amenity:fuel', color: '#2b7a4b', icon: '⛽' },
  { id: 'edu', label: 'Schools', test: (p) => /school|college|university|kindergarten/.test(p.cat), color: '#2f6ba8', icon: '✎' },
  { id: 'health', label: 'Health', test: (p) => /hospital|clinic|doctors|pharmacy|healthcare/.test(p.cat), color: '#b03a3a', icon: '✚' },
  { id: 'transport', label: 'Transport', test: (p) => /bus_station|bus_stop|railway/.test(p.cat), color: '#6a4aa8', icon: '◼' },
  { id: 'shop', label: 'Shops', test: (p) => p.cat.startsWith('shop:') || /marketplace|bank|restaurant|cafe/.test(p.cat), color: '#8a6a1f', icon: '●' },
  { id: 'civic', label: 'Civic', test: (p) => /police|townhall|post_office|courthouse|government|library|cinema|community/.test(p.cat), color: '#3a6a6a', icon: '■' },
];

const ROAD_STYLE = {
  highway: { w: 6.0, c: '#e8a33c', casing: '#b9772a', minZoom: 0 },
  arterial: { w: 5.0, c: '#f0c25a', casing: '#bb8c2e', minZoom: 0 },
  major: { w: 4.0, c: '#ffffff', casing: '#b8ae96', minZoom: 0 },
  secondary: { w: 3.2, c: '#ffffff', casing: '#c0b69e', minZoom: 0.35 },
  townroad: { w: 2.6, c: '#fdfbf4', casing: '#c8bea6', minZoom: 0.55 },
  bazaar: { w: 3.0, c: '#fff4e0', casing: '#c8bea6', minZoom: 0.5 },
  residential: { w: 2.0, c: '#fdfbf4', casing: '#cdc3ab', minZoom: 0.9 },
  lane: { w: 1.4, c: '#f4efe2', casing: '#cdc3ab', minZoom: 1.5 },
  farm: { w: 1.2, c: '#d9cdb0', casing: null, minZoom: 1.8, dash: [4, 4] },
  path: { w: 1.0, c: '#cdbf9e', casing: null, minZoom: 2.6, dash: [2, 4] },
};

export class MapUI {
  constructor(root, world) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.world = world;
    this.open = false;
    this.zoom = 0.09; // pixels per metre
    this.cx = 0;
    this.cz = 0;
    this.follow = true;
    this.filters = new Set(CATS.map((c) => c.id));
    this.selected = null;
    this.destination = null;
    this.route = null;
    this.discovered = new Set();

    const el = document.createElement('div');
    el.id = 'mapui';
    el.innerHTML = `
      <div id="mapwrap">
        <canvas id="mapcanvas"></canvas>
        <div id="maptop">
          <div><div class="title">DARSI</div><div class="sub">PRAKASAM DISTRICT · 523247</div></div>
          <button id="mapclose">CLOSE ✕</button>
        </div>
        <div id="maplegend"></div>
        <div id="mapfilters"></div>
        <div id="mapzoom"><button id="zin">+</button><button id="zout">−</button><button id="zme">◎</button></div>
        <div id="mapinfo"></div>
      </div>`;
    root.appendChild(el);
    this.el = el;
    this.canvas = el.querySelector('#mapcanvas');
    this.ctx = this.canvas.getContext('2d');
    this.info = el.querySelector('#mapinfo');

    el.querySelector('#mapclose').onclick = () => this.hide();
    el.querySelector('#zin').onclick = () => this.setZoom(this.zoom * 1.5);
    el.querySelector('#zout').onclick = () => this.setZoom(this.zoom / 1.5);
    el.querySelector('#zme').onclick = () => {
      this.follow = true;
      this.dirty = true;
    };

    const fl = el.querySelector('#mapfilters');
    for (const c of CATS) {
      const b = document.createElement('button');
      b.className = 'mf on';
      b.textContent = c.label;
      b.onclick = () => {
        if (this.filters.has(c.id)) {
          this.filters.delete(c.id);
          b.classList.remove('on');
        } else {
          this.filters.add(c.id);
          b.classList.add('on');
        }
        this.dirty = true;
      };
      fl.appendChild(b);
    }

    const lg = el.querySelector('#maplegend');
    lg.innerHTML = [
      `<i style="background:#e8a33c"></i>State highway`,
      `<i style="background:#f0c25a"></i>Main road`,
      `<i style="background:#ffffff"></i>Town road`,
      `<i style="background:#d9cdb0"></i>Track`,
      `<i style="background:#7fb0c8"></i>Water / canal`,
    ].join('<br>');

    this._bindPointer();
    this.dirty = true;
  }

  _bindPointer() {
    const c = this.canvas;
    let dragging = false;
    let lx = 0;
    let lz = 0;
    let moved = 0;
    c.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = 0;
      lx = e.clientX;
      lz = e.clientY;
      c.setPointerCapture(e.pointerId);
      c.style.cursor = 'grabbing';
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - lz;
      moved += Math.abs(dx) + Math.abs(dy);
      lx = e.clientX;
      lz = e.clientY;
      this.cx -= dx / this.zoom;
      this.cz -= dy / this.zoom;
      this.follow = false;
      this.dirty = true;
    });
    c.addEventListener('pointerup', (e) => {
      dragging = false;
      c.style.cursor = 'grab';
      if (moved < 6) this._pick(e);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18));
    }, { passive: false });
  }

  setZoom(z) {
    this.zoom = clamp(z, 0.022, 1.3);
    this.dirty = true;
  }

  _pick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = this.cx + (mx - this.canvas.width / (2 * this._dpr())) / this.zoom;
    const wz = this.cz + (my - this.canvas.height / (2 * this._dpr())) / this.zoom;
    let best = null;
    for (const p of this.visiblePois || []) {
      const d = Math.hypot(p.wx - wx, p.wz - wz);
      if (d < 26 / this.zoom && (!best || d < best.d)) best = { p, d };
    }
    if (best) {
      this.selected = best.p;
      this._showInfo(best.p);
    } else {
      this.selected = null;
      this.info.style.display = 'none';
    }
    this.dirty = true;
  }

  _showInfo(p) {
    const dist = this.playerPos ? Math.hypot(p.wx - this.playerPos.x, p.wz - this.playerPos.z) : 0;
    const cat = p.cat.split(':')[1].replace(/_/g, ' ');
    this.info.innerHTML = `
      <div class="n">${p.name || cat.replace(/\b\w/g, (m) => m.toUpperCase())}</div>
      <div class="c">${cat}</div>
      <div class="d">${fmtDistance(dist)} away</div>
      <button id="setdest">SET DESTINATION</button>`;
    this.info.style.display = 'block';
    this.info.querySelector('#setdest').onclick = () => {
      this.destination = p;
      this.route = this._route(this.playerPos, p);
      this.dirty = true;
      if (this.onDestination) this.onDestination(p);
    };
  }

  /** A* over the road graph. */
  _route(from, to) {
    if (!from) return null;
    const w = this.world;
    const startEdge = w.nearestRoad(from.x, from.z, 120);
    const endEdge = w.nearestRoad(to.wx, to.wz, 180);
    if (!startEdge || !endEdge) return null;
    const goalNode = endEdge.edge.a;
    const nodePos = (id) => [w.nodes[id][0], -w.nodes[id][1]];
    const h = (id) => {
      const [x, z] = nodePos(id);
      return Math.hypot(x - to.wx, z - to.wz);
    };
    const start = startEdge.edge.a;
    const openSet = [[h(start), start]];
    const came = new Map();
    const g = new Map([[start, 0]]);
    const seen = new Set();
    let found = false;
    let guard = 0;
    while (openSet.length && guard++ < 60000) {
      openSet.sort((a, b) => a[0] - b[0]);
      const [, cur] = openSet.shift();
      if (cur === goalNode) {
        found = true;
        break;
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const eid of w.nodeEdges.get(cur) || []) {
        const e = w.edges[eid];
        const nxt = e.a === cur ? e.b : e.a;
        const penalty = e.cls === 'path' ? 4 : e.cls === 'farm' ? 2 : 1;
        const ng = (g.get(cur) ?? Infinity) + e.len * penalty;
        if (ng < (g.get(nxt) ?? Infinity)) {
          g.set(nxt, ng);
          came.set(nxt, [cur, eid]);
          openSet.push([ng + h(nxt), nxt]);
        }
      }
    }
    if (!found) return null;
    const pts = [];
    let cur = goalNode;
    const chain = [];
    while (came.has(cur)) {
      const [prev, eid] = came.get(cur);
      chain.push([prev, eid, cur]);
      cur = prev;
    }
    chain.reverse();
    for (const [prev, eid] of chain) {
      const e = w.edges[eid];
      const fwd = e.a === prev;
      const list = fwd ? e.pts3 : [...e.pts3].reverse();
      for (const p of list) pts.push([p[0], p[2]]);
    }
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return { pts, len };
  }

  show(playerPos) {
    this.open = true;
    this.el.classList.add('on');
    this.playerPos = playerPos;
    if (this.follow) {
      this.cx = playerPos.x;
      this.cz = playerPos.z;
    }
    this._resize();
    this.dirty = true;
    this.draw();
  }

  hide() {
    this.open = false;
    this.el.classList.remove('on');
  }

  toggle(playerPos) {
    if (this.open) this.hide();
    else this.show(playerPos);
    return this.open;
  }

  _dpr() {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = this._dpr();
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dirty = true;
    }
  }

  update(playerPos, heading) {
    this.playerPos = playerPos;
    this.heading = heading;
    if (!this.open) return;
    if (this.follow) {
      this.cx = playerPos.x;
      this.cz = playerPos.z;
    }
    this._resize();
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const dpr = this._dpr();
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.save();
    ctx.scale(dpr, dpr);
    const vw = W / dpr;
    const vh = H / dpr;
    const z = this.zoom;
    const toX = (x) => (x - this.cx) * z + vw / 2;
    const toY = (zz) => (zz - this.cz) * z + vh / 2;

    ctx.fillStyle = '#efe8d8';
    ctx.fillRect(0, 0, vw, vh);

    const w = this.world;
    const pad = 60 / z;
    const x0 = this.cx - vw / 2 / z - pad;
    const x1 = this.cx + vw / 2 / z + pad;
    const z0 = this.cz - vh / 2 / z - pad;
    const z1 = this.cz + vh / 2 / z + pad;

    // --- land cover -------------------------------------------------------
    for (const a of w.areas) {
      const [ax0, az0, ax1, az1] = a.bbox;
      if (ax1 < x0 || ax0 > x1 || az1 < z0 || az0 > z1) continue;
      let fill = null;
      if (a.kind === 'water') fill = '#9ec6d6';
      else if (a.ground === 1) fill = '#dfe3c4';
      else if (a.ground === 5) fill = '#d8e2bc';
      else if (a.ground === 2) fill = '#e3ddc4';
      else if (a.ground === 3) fill = '#e7ddca';
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(toX(a.poly3[0][0]), toY(a.poly3[0][1]));
      for (let i = 1; i < a.poly3.length; i++) ctx.lineTo(toX(a.poly3[i][0]), toY(a.poly3[i][1]));
      ctx.closePath();
      ctx.fill();
    }

    // --- built-up shading -------------------------------------------------
    if (z > 0.035) {
      ctx.globalAlpha = 0.5;
      const n = w.urbanN;
      const cell = (2 * w.half) / (n - 1);
      const step = z > 0.25 ? 1 : 2;
      for (let j = 0; j < n; j += step) {
        for (let i = 0; i < n; i += step) {
          const u = w.urban[j * n + i] / 255;
          if (u < 0.3) continue;
          const px = -w.half + i * cell;
          const pz = -w.half + j * cell;
          if (px < x0 || px > x1 || pz < z0 || pz > z1) continue;
          ctx.fillStyle = `rgba(214,197,166,${(u - 0.3) * 0.9})`;
          ctx.fillRect(toX(px), toY(pz), cell * z * step + 1, cell * z * step + 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- waterways --------------------------------------------------------
    ctx.strokeStyle = '#7fb0c8';
    ctx.lineWidth = Math.max(1, 3 * z * 4);
    for (const ww of w.waterways) {
      ctx.beginPath();
      for (let i = 0; i < ww.pts.length; i++) {
        const px = ww.pts[i][0];
        const pz = -ww.pts[i][1];
        if (i === 0) ctx.moveTo(toX(px), toY(pz));
        else ctx.lineTo(toX(px), toY(pz));
      }
      ctx.stroke();
    }

    // --- roads: casing pass then fill pass --------------------------------
    const zoomLevel = z / 0.09;
    const visible = [];
    for (const e of w.edges) {
      const st = ROAD_STYLE[e.cls];
      if (!st || zoomLevel < st.minZoom) continue;
      const [bx0, bz0, bx1, bz1] = e.bbox;
      if (bx1 < x0 || bx0 > x1 || bz1 < z0 || bz0 > z1) continue;
      visible.push([e, st]);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [e, st] of visible) {
      if (!st.casing) continue;
      ctx.strokeStyle = st.casing;
      ctx.lineWidth = Math.max(1.2, st.w * Math.min(2.2, zoomLevel * 0.8) + 1.6);
      strokeEdge(ctx, e, toX, toY);
    }
    for (const [e, st] of visible) {
      ctx.strokeStyle = st.c;
      ctx.lineWidth = Math.max(0.8, st.w * Math.min(2.2, zoomLevel * 0.8));
      if (st.dash) ctx.setLineDash(st.dash);
      strokeEdge(ctx, e, toX, toY);
      if (st.dash) ctx.setLineDash([]);
    }

    // --- route ------------------------------------------------------------
    if (this.route) {
      ctx.strokeStyle = 'rgba(40,110,220,.92)';
      ctx.lineWidth = Math.max(3, 7 * Math.min(2, zoomLevel));
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < this.route.pts.length; i++) {
        const p = this.route.pts[i];
        if (i === 0) ctx.moveTo(toX(p[0]), toY(p[1]));
        else ctx.lineTo(toX(p[0]), toY(p[1]));
      }
      ctx.stroke();
    }

    // --- road labels ------------------------------------------------------
    if (zoomLevel > 1.1) {
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#5d5444';
      ctx.textAlign = 'center';
      const placed = [];
      for (const [e] of visible) {
        if (!e.name || e.len < 60) continue;
        const mid = e.pts3[Math.floor(e.pts3.length / 2)];
        const sx = toX(mid[0]);
        const sy = toY(mid[2]);
        if (sx < 40 || sx > vw - 40 || sy < 60 || sy > vh - 40) continue;
        if (placed.some(([qx, qy, nm]) => nm === e.name && Math.hypot(qx - sx, qy - sy) < 220)) continue;
        if (placed.some(([qx, qy]) => Math.hypot(qx - sx, qy - sy) < 48)) continue;
        placed.push([sx, sy, e.name]);
        ctx.strokeStyle = 'rgba(248,244,234,.9)';
        ctx.lineWidth = 3;
        ctx.strokeText(e.name, sx, sy - 4);
        ctx.fillText(e.name, sx, sy - 4);
        if (placed.length > 26) break;
      }
    }

    // --- POIs -------------------------------------------------------------
    this.visiblePois = [];
    const labelled = [];
    for (const p of w.pois) {
      if (p.wx < x0 || p.wx > x1 || p.wz < z0 || p.wz > z1) continue;
      const cat = CATS.find((c) => c.test(p));
      if (!cat || !this.filters.has(cat.id)) continue;
      const important = !!p.name;
      if (zoomLevel < 0.6 && !important) continue;
      this.visiblePois.push(p);
      const sx = toX(p.wx);
      const sy = toY(p.wz);
      ctx.fillStyle = cat.color;
      ctx.beginPath();
      ctx.arc(sx, sy, this.selected === p ? 8 : 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fffaf0';
      ctx.lineWidth = 2;
      ctx.stroke();
      // labels only when there is room
      if (p.name && zoomLevel > 0.85 && labelled.length < 22) {
        if (labelled.some(([qx, qy]) => Math.hypot(qx - sx, qy - sy) < 70)) continue;
        labelled.push([sx, sy]);
        ctx.font = '600 11.5px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.strokeStyle = 'rgba(250,246,236,.92)';
        ctx.lineWidth = 3.2;
        ctx.strokeText(p.name, sx + 9, sy + 4);
        ctx.fillStyle = '#3c3524';
        ctx.fillText(p.name, sx + 9, sy + 4);
      }
    }

    // --- player -----------------------------------------------------------
    if (this.playerPos) {
      const sx = toX(this.playerPos.x);
      const sy = toY(this.playerPos.z);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(this.heading || 0);
      ctx.fillStyle = 'rgba(40,110,220,.22)';
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1f6ddc';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(9, 10);
      ctx.lineTo(0, 5);
      ctx.lineTo(-9, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // --- destination ------------------------------------------------------
    if (this.destination) {
      const sx = toX(this.destination.wx);
      const sy = toY(this.destination.wz);
      ctx.fillStyle = '#d7352b';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - 7, sy - 16);
      ctx.lineTo(sx + 7, sy - 16);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy - 18, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // --- scale bar --------------------------------------------------------
    const target = 90;
    let metres = target / z;
    const pow = Math.pow(10, Math.floor(Math.log10(metres)));
    metres = Math.round(metres / pow) * pow;
    const barPx = metres * z;
    ctx.fillStyle = 'rgba(30,26,20,.75)';
    ctx.fillRect(vw / 2 - barPx / 2, vh - 34, barPx, 4);
    ctx.font = '600 11px ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, vw / 2, vh - 40);

    ctx.restore();
    this.dirty = false;
  }

  /** Draw the circular minimap into an existing 2D context. */
  drawMini(ctx, size, playerPos, heading) {
    const z = 0.22;
    const r = size / 2;
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(32,29,24,.82)';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(r, r);
    ctx.rotate(-heading);
    const toX = (x) => (x - playerPos.x) * z;
    const toY = (zz) => (zz - playerPos.z) * z;
    const w = this.world;
    const range = r / z + 30;

    for (const a of w.areas) {
      if (a.kind !== 'water') continue;
      if (Math.abs(a.bbox[0] - playerPos.x) > range && Math.abs(a.bbox[2] - playerPos.x) > range) continue;
      ctx.fillStyle = 'rgba(96,150,180,.75)';
      ctx.beginPath();
      ctx.moveTo(toX(a.poly3[0][0]), toY(a.poly3[0][1]));
      for (let i = 1; i < a.poly3.length; i++) ctx.lineTo(toX(a.poly3[i][0]), toY(a.poly3[i][1]));
      ctx.closePath();
      ctx.fill();
    }
    ctx.lineCap = 'round';
    for (const id of w.roadGrid.query(playerPos.x, playerPos.z, range)) {
      const e = w.edges[id];
      const st = ROAD_STYLE[e.cls];
      if (!st) continue;
      ctx.strokeStyle = e.cls === 'highway' || e.cls === 'arterial' ? 'rgba(226,179,60,.95)' : 'rgba(236,230,214,.8)';
      ctx.lineWidth = Math.max(1.4, st.w * 0.85);
      ctx.beginPath();
      for (let i = 0; i < e.pts3.length; i++) {
        const p = e.pts3[i];
        if (i === 0) ctx.moveTo(toX(p[0]), toY(p[2]));
        else ctx.lineTo(toX(p[0]), toY(p[2]));
      }
      ctx.stroke();
    }
    if (this.route) {
      ctx.strokeStyle = 'rgba(70,150,255,.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < this.route.pts.length; i++) {
        const p = this.route.pts[i];
        if (i === 0) ctx.moveTo(toX(p[0]), toY(p[1]));
        else ctx.lineTo(toX(p[0]), toY(p[1]));
      }
      ctx.stroke();
    }
    for (const p of w.pois) {
      const dx = p.wx - playerPos.x;
      const dz = p.wz - playerPos.z;
      if (Math.hypot(dx, dz) > range) continue;
      const cat = CATS.find((c) => c.test(p));
      if (!cat) continue;
      ctx.fillStyle = cat.color;
      ctx.beginPath();
      ctx.arc(toX(p.wx), toY(p.wz), 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // player arrow (always up)
    ctx.save();
    ctx.translate(r, r);
    ctx.fillStyle = '#6fb7ff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6.5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // north marker
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(-heading);
    ctx.fillStyle = 'rgba(226,120,80,.95)';
    ctx.beginPath();
    ctx.moveTo(0, -r + 7);
    ctx.lineTo(5, -r + 17);
    ctx.lineTo(-5, -r + 17);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function strokeEdge(ctx, e, toX, toY) {
  ctx.beginPath();
  const pts = e.pts3;
  ctx.moveTo(toX(pts[0][0]), toY(pts[0][2]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(pts[i][0]), toY(pts[i][2]));
  ctx.stroke();
}
