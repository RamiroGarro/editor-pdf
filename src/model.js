'use strict';

// ---------- Constantes ----------
const ASC = 0.95;   // distancia (en múltiplos del tamaño) del borde superior del texto a su línea base
const LH = 1.2;     // interlineado
const FONT_CSS = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
};

// ---------- Estado global ----------
const S = {
  sources: new Map(),   // id -> { bytes, doc (pdf.js), name }
  nextSrc: 1,
  pages: [],            // { id, src, idx, w, h, x0, y0, base, rot, objs: [] }
  images: new Map(),    // imgId -> { bytes, type, url }
  zoom: 1.25,
  tool: 'select',
  sel: null,            // { pid, oid }
  cur: null,            // id de la página actual
  editing: null,        // id del objeto de texto en edición
  psel: new Set(),      // páginas seleccionadas (miniaturas)
  anchor: null,         // ancla para selección con Shift
  clip: null,           // portapapeles de objetos
  filePath: null,
  name: 'Sin título.pdf',
  dirty: false,
  style: { color: '#000000', stroke: '#d32f2f', fill: '#ffff00', noFill: true, sw: 2, font: 'helvetica', size: 14, bold: false, italic: false },
};

let _uid = 0;
const uid = (p = 'o') => p + (++_uid).toString(36) + Math.random().toString(36).slice(2, 6);
const rotOf = (pg) => (pg.base + pg.rot) % 360;
function viewSize(pg) { return rotOf(pg) % 180 !== 0 ? [pg.h, pg.w] : [pg.w, pg.h]; }
const findPage = (pid) => S.pages.find((p) => p.id === pid);
const findObj = (pg, oid) => (pg ? pg.objs.find((o) => o.id === oid) : undefined);
function selected() {
  if (!S.sel) return {};
  const pg = findPage(S.sel.pid);
  return { pg, o: findObj(pg, S.sel.oid) };
}

// ---------- Geometría ----------
// Coordenadas de objetos: puntos (pt) en "espacio de vista" (origen arriba-izquierda, y hacia abajo, ya rotada la página).
// Convierte a espacio de usuario PDF (origen abajo-izquierda, sin rotar).
function toUser(pg, x, y) {
  const R = rotOf(pg), w = pg.w, h = pg.h;
  let X, Y;
  if (R === 0) { X = x; Y = h - y; }
  else if (R === 90) { X = y; Y = x; }
  else if (R === 180) { X = w - x; Y = y; }
  else { X = w - y; Y = h - x; }
  return [X + pg.x0, Y + pg.y0];
}

function arrowWings(o) {
  const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), L = Math.max(8, o.sw * 4);
  return [Math.PI * 0.85, -Math.PI * 0.85].map((da) => [o.x2 + L * Math.cos(ang + da), o.y2 + L * Math.sin(ang + da)]);
}

const _mc = document.createElement('canvas').getContext('2d');
function textSize(o) {
  _mc.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size}px ${FONT_CSS[o.font]}`;
  const lines = o.text.split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, _mc.measureText(l).width);
  return [Math.max(w, o.size * 0.5), lines.length * LH * o.size];
}

// ---------- Rotación de páginas (arrastra los objetos) ----------
function rotateObjsCW(pg, Hv) {
  const P = (x, y) => [Hv - y, x];
  for (const o of pg.objs) {
    switch (o.type) {
      case 'text': case 'image': { [o.x, o.y] = P(o.x, o.y); o.angle = ((o.angle || 0) + 90) % 360; break; }
      case 'line': { [o.x1, o.y1] = P(o.x1, o.y1); [o.x2, o.y2] = P(o.x2, o.y2); break; }
      case 'draw': o.pts = o.pts.map(([x, y]) => P(x, y)); break;
      default: { const nx = Hv - (o.y + o.h), ny = o.x, w = o.h, h = o.w; o.x = nx; o.y = ny; o.w = w; o.h = h; }
    }
  }
}
function rotatePage(pg, deg) {
  const steps = deg > 0 ? 1 : 3;
  for (let k = 0; k < steps; k++) {
    const Hv = viewSize(pg)[1];
    rotateObjsCW(pg, Hv);
    pg.rot = (pg.rot + 90) % 360;
  }
}

// ---------- Historial (deshacer / rehacer) ----------
const HIST = { stack: [], i: -1 };
const snap = () => JSON.stringify(S.pages);
function histReset() { HIST.stack = [snap()]; HIST.i = 0; }
function histPush() {
  const s = snap();
  if (s === HIST.stack[HIST.i]) return false;
  HIST.stack.length = HIST.i + 1;
  HIST.stack.push(s);
  if (HIST.stack.length > 100) HIST.stack.shift();
  HIST.i = HIST.stack.length - 1;
  S.dirty = true;
  return true;
}
