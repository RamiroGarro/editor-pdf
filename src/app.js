'use strict';

// Funciones globales de ui.js: $, $$, toast, busy, openModal, askConfirm, askDiscard, askForm,
// showMenu, closeMenu, showHelp, toggleTheme, Recents
const PDFJS_BASE = 'app://local/node_modules/pdfjs-dist/';
pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'legacy/build/pdf.worker.js';
const PDF_OPTS = { cMapUrl: PDFJS_BASE + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_BASE + 'standard_fonts/', isEvalSupported: false };

const pagesEl = $('#pages'), thumbsEl = $('#thumbs'), viewer = $('#viewer');
const els = new Map(), thumbEls = new Map(), thumbCache = new Map(), itemsCache = new Map();
let drag = null;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dpr = () => window.devicePixelRatio || 1;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BOX = ['rect', 'ellipse', 'highlight', 'whiteout'];
const SHAPE = ['rect', 'ellipse', 'line', 'draw'];
const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55] };
const baseName = () => S.name.replace(/\.pdf$/i, '');
const errMsg = (e) => (e && e.message) || String(e);

// =====================================================================
// Carga y guardado de PDFs
// =====================================================================
async function loadSource(bytes, name) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const id = S.nextSrc++;
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), ...PDF_OPTS }).promise;
  S.sources.set(id, { bytes, doc, name });
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const [x0, y0, x1, y1] = p.view;
    out.push({ id: uid('p'), src: id, idx: i - 1, w: x1 - x0, h: y1 - y0, x0, y0, base: ((p.rotate % 360) + 360) % 360, rot: 0, objs: [] });
  }
  return out;
}

function dropOldSources(keepIds) {
  for (const [id, s] of [...S.sources]) {
    if (keepIds.includes(id)) continue;
    try { s.doc.destroy(); } catch (e) { /* nada */ }
    S.sources.delete(id);
  }
  S.images.clear(); S.clip = null; S.psel = new Set();
  thumbCache.clear(); itemsCache.clear();
  S.sel = null; S.editing = null;
}

async function openBytes(f) {
  try {
    busy(true, 'Abriendo…');
    const pages = await loadSource(f.data, f.name);        // si falla, el documento actual queda intacto
    dropOldSources([pages[0].src]);
    S.pages = pages; S.name = f.name; S.filePath = f.path || null;
    S.cur = pages[0].id; S.dirty = false;
    S.zoom = clamp((viewer.clientWidth - 80) / viewSize(pages[0])[0], 0.5, 1.5);
    histReset(); rebuild(); viewer.scrollTop = 0;
    Recents.add(f.path, f.name);
    try {
      if (!localStorage.getItem('tipEdit')) {
        localStorage.setItem('tipEdit', '1');
        toast('Consejo: doble clic sobre cualquier texto del PDF para editarlo.', 7000);
      }
    } catch (e) { /* nada */ }
  } catch (err) {
    console.error(err);
    toast('No se pudo abrir el PDF (¿está dañado o protegido con contraseña?): ' + errMsg(err), 6000);
  } finally { busy(false); }
}

async function confirmDiscard() {
  if (!S.dirty) return true;
  const r = await askDiscard();
  if (r === 'save') return doSave(false);
  return r === 'discard';
}

async function newDoc() {
  if (!(await confirmDiscard())) return;
  dropOldSources([]);
  const [w, h] = PAGE_SIZES.a4;
  const pg = { id: uid('p'), src: null, idx: 0, w, h, x0: 0, y0: 0, base: 0, rot: 0, objs: [] };
  S.pages = [pg]; S.cur = pg.id; S.name = 'Sin título.pdf'; S.filePath = null; S.dirty = false;
  histReset(); rebuild();
}

async function doOpen() {
  if (!(await confirmDiscard())) return;
  const f = await api.openPdf();
  if (f) await openBytes(f);
}

async function openRecent(r) {
  if (!(await confirmDiscard())) return;
  let f = null;
  try { f = await api.readPath(r.path); } catch (e) { /* no existe */ }
  if (!f) { Recents.remove(r.path); renderRecents(); toast('No se encontró el archivo: ' + r.name); return; }
  await openBytes(f);
}

function renderRecents() {
  const list = Recents.get(), box = $('#recents'), ul = $('#recent-list');
  box.hidden = !list.length; ul.innerHTML = '';
  list.forEach((r) => {
    const b = document.createElement('button'); b.className = 'recent'; b.innerHTML = '<b></b><small></small>';
    b.children[0].textContent = r.name; b.children[1].textContent = r.path;
    b.onclick = () => openRecent(r);
    ul.append(b);
  });
}

async function doSave(asNew) {
  if (!S.pages.length) return false;
  try {
    busy(true, 'Guardando…');
    const data = await buildPdf();
    const r = await api.savePdf({ path: asNew ? null : S.filePath, name: S.name, data });
    if (!r) return false;
    S.filePath = r.path; S.name = r.name; S.dirty = false;
    Recents.add(r.path, r.name);
    updateUI(); toast('Guardado: ' + r.name);
    return true;
  } catch (err) {
    console.error(err);
    toast('Error al guardar: ' + errMsg(err), 6000);
    return false;
  } finally { busy(false); }
}

async function doPrint() {
  if (!S.pages.length) return;
  try {
    busy(true, 'Preparando para imprimir…');
    const data = await buildPdf();
    const err = await api.printPdf({ name: S.name, data });
    if (err) toast('No se pudo abrir un visor de PDF del sistema: ' + err, 7000);
    else toast('Se abrió en el visor de PDF del sistema; imprimir desde allí.', 5000);
  } catch (e) { console.error(e); toast('Error: ' + errMsg(e), 6000); } finally { busy(false); }
}

// =====================================================================
// Renderizado de páginas
// =====================================================================
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const el = en.target, pg = findPage(el.dataset.pid);
    el._vis = en.isIntersecting;
    if (!pg || !pg.src) continue;
    if (en.isIntersecting) { renderCanvas(pg, el); loadItems(pg).then(() => renderOverlay(findPage(pg.id))).catch(() => {}); }
    else freeCanvas(el);
  }
}, { root: viewer, rootMargin: '900px 0px' });

function freeCanvas(el) {
  el._tok = (el._tok || 0) + 1;
  if (el._task) { try { el._task.cancel(); } catch (e) { /* nada */ } }
  const c = $('canvas', el); c.width = 0; c.height = 0; el._rkey = null;
}

async function renderCanvas(pg, el) {
  if (!pg.src) return;
  const key = `${S.zoom}:${pg.rot}:${dpr()}`;
  if (el._rkey === key) return;
  el._rkey = key;
  const tok = el._tok = (el._tok || 0) + 1;
  if (el._task) { try { el._task.cancel(); } catch (e) { /* nada */ } }
  try {
    const p = await S.sources.get(pg.src).doc.getPage(pg.idx + 1);
    if (tok !== el._tok) return;
    const vp = p.getViewport({ scale: S.zoom * dpr(), rotation: pg.rot });
    const cv = $('canvas', el);
    cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    const task = p.render({ canvasContext: cv.getContext('2d'), viewport: vp });
    el._task = task;
    await task.promise;
  } catch (e) {
    if (tok === el._tok) el._rkey = null;
    if (!e || e.name !== 'RenderingCancelledException') console.error(e);
  }
}

function makePageEl(pg) {
  const el = document.createElement('div');
  el.className = 'page'; el.dataset.pid = pg.id;
  el.innerHTML = '<canvas></canvas><svg class="ov" xmlns="http://www.w3.org/2000/svg"></svg>';
  const svg = $('svg', el);
  svg.addEventListener('pointerdown', (e) => onDown(e, el));
  svg.addEventListener('pointermove', (e) => onMove(e, el));
  svg.addEventListener('pointerup', (e) => onUp(e, el));
  svg.addEventListener('pointercancel', (e) => onUp(e, el));
  svg.addEventListener('dblclick', (e) => onDbl(e, el));
  svg.addEventListener('contextmenu', (e) => onCtx(e, el));
  return el;
}

function rebuild(opts = {}) {
  const ids = new Set(S.pages.map((p) => p.id));
  for (const [pid, el] of els) if (!ids.has(pid)) { io.unobserve(el); if (el._task) { try { el._task.cancel(); } catch (e) { /* */ } } el.remove(); els.delete(pid); }
  for (const [pid, t] of thumbEls) if (!ids.has(pid)) { t.remove(); thumbEls.delete(pid); }
  S.psel = new Set([...S.psel].filter((id) => ids.has(id)));
  S.pages.forEach((pg, i) => {
    let el = els.get(pg.id);
    if (!el) { el = makePageEl(pg); els.set(pg.id, el); pagesEl.append(el); io.observe(el); }
    const [W, Hh] = viewSize(pg);
    el.style.width = W * S.zoom + 'px'; el.style.height = Hh * S.zoom + 'px';
    const cv = $('canvas', el); cv.style.width = el.style.width; cv.style.height = el.style.height;
    if (pagesEl.children[i] !== el) pagesEl.insertBefore(el, pagesEl.children[i] || null);
    if (el._vis && pg.src) { renderCanvas(pg, el); loadItems(pg).then(() => renderOverlay(findPage(pg.id))).catch(() => {}); }
    renderOverlay(pg);
  });
  if (opts.thumbs !== false) rebuildThumbs();
  updateUI();
  if (S.tool === 'edittext') loadAllItems();
}

// =====================================================================
// Overlay SVG (objetos)
// =====================================================================
function objSvg(o) {
  const ds = `class="o" data-oid="${o.id}"`;
  switch (o.type) {
    case 'text': {
      if (S.editing === o.id) return '';
      const [w, h] = textSize(o);
      const tsp = o.text.split('\n').map((l, i) => `<tspan x="0" y="${(ASC + i * LH) * o.size}">${esc(l) || ' '}</tspan>`).join('');
      return `<g ${ds} opacity="${o.op ?? 1}" transform="translate(${o.x} ${o.y}) rotate(${o.angle || 0})"><rect width="${w}" height="${h}" fill="transparent"/>` +
        `<text style="white-space:pre" font-family="${FONT_CSS[o.font]}" font-size="${o.size}" font-weight="${o.bold ? 700 : 400}" font-style="${o.italic ? 'italic' : 'normal'}" fill="${o.color}">${tsp}</text></g>`;
    }
    case 'image': {
      const im = S.images.get(o.imgId);
      return `<g ${ds} transform="translate(${o.x} ${o.y}) rotate(${o.angle || 0})"><image href="${im ? im.url : ''}" width="${o.w}" height="${o.h}" preserveAspectRatio="none"/></g>`;
    }
    case 'rect': case 'highlight': case 'whiteout':
      return `<rect ${ds} x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${o.fill || 'none'}" stroke="${o.stroke || 'none'}" stroke-width="${o.sw}" opacity="${o.op ?? 1}"${o.type === 'highlight' ? ' style="mix-blend-mode:multiply"' : ''}/>`;
    case 'ellipse':
      return `<ellipse ${ds} cx="${o.x + o.w / 2}" cy="${o.y + o.h / 2}" rx="${o.w / 2}" ry="${o.h / 2}" fill="${o.fill || 'none'}" stroke="${o.stroke || 'none'}" stroke-width="${o.sw}" opacity="${o.op ?? 1}"/>`;
    case 'line': {
      let head = '';
      if (o.arrow) { const [a, b] = arrowWings(o); head = `<path d="M${a[0]} ${a[1]} L${o.x2} ${o.y2} L${b[0]} ${b[1]}" fill="none" stroke="${o.stroke}" stroke-width="${o.sw}" stroke-linecap="round" stroke-linejoin="round"/>`; }
      return `<g ${ds}><line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="transparent" stroke-width="${Math.max(o.sw, 10)}"/>` +
        `<line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${o.stroke}" stroke-width="${o.sw}" stroke-linecap="round" pointer-events="none"/>${head}</g>`;
    }
    case 'draw': {
      const pts = o.pts.map((p) => p.join(',')).join(' ');
      return `<g ${ds}><polyline points="${pts}" fill="none" stroke="transparent" stroke-width="${Math.max(o.sw, 10)}" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<polyline points="${pts}" fill="none" stroke="${o.stroke}" stroke-width="${o.sw}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/></g>`;
    }
  }
  return '';
}

function selSvg(o) {
  const hs = 8 / S.zoom, sw = 1 / S.zoom;
  const st = `fill="none" stroke="#2563eb" stroke-width="${sw}" stroke-dasharray="${4 / S.zoom}" pointer-events="none"`;
  const handles = S.tool === 'select';
  const hnd = (x, y, k, cur) => handles ? `<rect data-handle="${k}" x="${x - hs / 2}" y="${y - hs / 2}" width="${hs}" height="${hs}" fill="#fff" stroke="#2563eb" stroke-width="${sw}" style="cursor:${cur}"/>` : '';
  switch (o.type) {
    case 'text': { const [w, h] = textSize(o); return `<g transform="translate(${o.x} ${o.y}) rotate(${o.angle || 0})"><rect width="${w}" height="${h}" ${st}/></g>`; }
    case 'image': return `<g transform="translate(${o.x} ${o.y}) rotate(${o.angle || 0})"><rect width="${o.w}" height="${o.h}" ${st}/>${hnd(o.w, o.h, 'se', 'nwse-resize')}</g>`;
    case 'line': return `<g>${[['p1', o.x1, o.y1], ['p2', o.x2, o.y2]].map(([k, x, y]) => handles ? `<circle data-handle="${k}" cx="${x}" cy="${y}" r="${hs / 1.4}" fill="#fff" stroke="#2563eb" stroke-width="${sw}" style="cursor:move"/>` : '').join('')}</g>`;
    case 'draw': {
      const xs = o.pts.map((p) => p[0]), ys = o.pts.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return `<rect x="${x}" y="${y}" width="${Math.max(...xs) - x}" height="${Math.max(...ys) - y}" ${st}/>`;
    }
    default:
      return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" ${st}/>` +
        hnd(o.x, o.y, 'nw', 'nwse-resize') + hnd(o.x + o.w, o.y, 'ne', 'nesw-resize') + hnd(o.x, o.y + o.h, 'sw', 'nesw-resize') + hnd(o.x + o.w, o.y + o.h, 'se', 'nwse-resize');
  }
}

function renderOverlay(pg) {
  if (!pg) return;
  const el = els.get(pg.id);
  if (!el) return;
  const svg = $('svg', el);
  const [W, Hh] = viewSize(pg);
  svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
  let html = '';
  if (S.tool === 'edittext' && pg.src) {
    const items = itemsCache.get(pg.id + ':' + rotOf(pg)) || [];
    items.forEach((it, i) => { if (!isCovered(pg, it)) html += `<rect class="ti" data-ti="${i}" x="${it.bx}" y="${it.by}" width="${it.bw}" height="${it.bh}"/>`; });
  }
  for (const o of pg.objs) html += objSvg(o);
  if (S.sel && S.sel.pid === pg.id) {
    const o = findObj(pg, S.sel.oid);
    if (o && S.editing !== o.id) html += selSvg(o);
  }
  svg.innerHTML = html;
}

// =====================================================================
// Texto existente del PDF
// =====================================================================
async function loadItems(pg) {
  if (!pg.src) return [];
  const key = pg.id + ':' + rotOf(pg);
  if (itemsCache.has(key)) return itemsCache.get(key);
  const p = await S.sources.get(pg.src).doc.getPage(pg.idx + 1);
  const vp = p.getViewport({ scale: 1, rotation: pg.rot });
  const tc = await p.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const t = pdfjsLib.Util.transform(vp.transform, it.transform);
    const fs = Math.hypot(t[2], t[3]);
    if (fs < 1) continue;
    let ang = Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI / 90) * 90;
    ang = ((ang % 360) + 360) % 360;
    const w = it.width || it.str.length * fs * 0.5;
    const th = (ang * Math.PI) / 180, s = Math.sin(th), c = Math.cos(th);
    const bx = t[4], by = t[5], d = ASC * fs;
    const pts = [[-1, -0.85 * fs], [w + 1, -0.85 * fs], [w + 1, 0.25 * fs], [-1, 0.25 * fs]].map(([u, v]) => [bx + u * c - v * s, by + u * s + v * c]);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    let fname = '';
    try { fname = p.commonObjs.get(it.fontName).name || ''; } catch (e) { /* aún no cargada */ }
    const fam = (tc.styles[it.fontName] && tc.styles[it.fontName].fontFamily) || '';
    const tag = fname + ' ' + fam;
    items.push({
      str: it.str.normalize('NFKC'), x: bx + d * s, y: by - d * c, size: fs, angle: ang,
      bx: Math.min(...xs), by: Math.min(...ys), bw: Math.max(...xs) - Math.min(...xs), bh: Math.max(...ys) - Math.min(...ys),
      font: /mono|courier|consol/i.test(tag) ? 'courier' : (/times|georgia|garamond|palatino|cambria|book|(^|[^s])serif/i.test(tag) && !/sans/i.test(tag) ? 'times' : 'helvetica'),
      bold: /bold|black|heavy|semibold/i.test(fname), italic: /italic|oblique/i.test(fname),
    });
  }
  itemsCache.set(key, items);
  return items;
}

async function loadAllItems() {
  for (const pg of S.pages) {
    if (S.tool !== 'edittext') return;
    if (!pg.src || itemsCache.has(pg.id + ':' + rotOf(pg))) continue;
    try { await loadItems(pg); } catch (e) { console.error(e); }
    renderOverlay(findPage(pg.id));
  }
}

const isCovered = (pg, it) => pg.objs.some((o) => o.type === 'whiteout' && it.bx >= o.x - 1 && it.by >= o.y - 1 && it.bx + it.bw <= o.x + o.w + 1 && it.by + it.bh <= o.y + o.h + 1);
function hitItem(pg, pt) {
  const items = itemsCache.get(pg.id + ':' + rotOf(pg));
  if (!items) return null;
  return items.find((it) => pt[0] >= it.bx && pt[0] <= it.bx + it.bw && pt[1] >= it.by && pt[1] <= it.by + it.bh && !isCovered(pg, it)) || null;
}

// Detecta color de fondo y de texto dentro del recuadro, leyendo el canvas ya renderizado
function sampleColors(pg, el, it) {
  const out = { bg: '#ffffff', fg: '#000000' };
  try {
    const cv = $('canvas', el);
    if (!cv.width) return out;
    const k = cv.width / viewSize(pg)[0];
    const x = Math.max(0, Math.floor(it.bx * k)), y = Math.max(0, Math.floor(it.by * k));
    const w = Math.min(Math.ceil(it.bw * k), cv.width - x), h = Math.min(Math.ceil(it.bh * k), cv.height - y);
    if (w < 1 || h < 1) return out;
    const d = cv.getContext('2d').getImageData(x, y, w, h).data;
    const hist = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      const e = hist.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; hist.set(key, e);
    }
    let best = null;
    for (const e of hist.values()) if (!best || e.n > best.n) best = e;
    const bg = [best.r / best.n, best.g / best.n, best.b / best.n];
    let far = -1, fg = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      const dist = (d[i] - bg[0]) ** 2 + (d[i + 1] - bg[1]) ** 2 + (d[i + 2] - bg[2]) ** 2;
      if (dist > far) { far = dist; fg = [d[i], d[i + 1], d[i + 2]]; }
    }
    const hex = (a) => '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    out.bg = hex(bg);
    out.fg = far > 1500 ? hex(fg) : '#000000';
  } catch (e) { /* valores por defecto */ }
  return out;
}

function editItem(pg, el, it) {
  const col = sampleColors(pg, el, it);
  const wo = { id: uid(), type: 'whiteout', x: it.bx, y: it.by, w: it.bw, h: it.bh, fill: col.bg, stroke: null, sw: 0, op: 1 };
  const tx = { id: uid(), type: 'text', x: it.x, y: it.y, text: it.str, font: it.font, size: it.size, bold: it.bold, italic: it.italic, color: col.fg, angle: it.angle };
  pg.objs.push(wo, tx);
  select(pg.id, tx.id);
  setTimeout(() => openEditor(pg.id, tx.id), 20);
}

// =====================================================================
// Edición de texto en el lugar
// =====================================================================
function openEditor(pid, oid) {
  const pg = findPage(pid), o = findObj(pg, oid), el = els.get(pid);
  if (!o || !el) return;
  S.editing = oid; renderOverlay(pg);
  const z = S.zoom;
  const ta = document.createElement('textarea');
  ta.className = 'te'; ta.value = o.text; ta.spellcheck = false;
  Object.assign(ta.style, {
    left: o.x * z + 'px', top: o.y * z + 'px', fontFamily: FONT_CSS[o.font], fontSize: o.size * z + 'px',
    fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal', color: o.color,
    lineHeight: String(LH), transform: `rotate(${o.angle || 0}deg)`,
  });
  const fit = () => {
    ta.style.width = '1px'; ta.style.height = '1px';
    ta.style.width = Math.max(ta.scrollWidth + 6, o.size * z * 2) + 'px';
    ta.style.height = ta.scrollHeight + 'px';
  };
  el.append(ta); fit(); ta.focus(); ta.select();
  ta.addEventListener('input', fit);
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    const txt = ta.value; ta.remove(); S.editing = null;
    const pg2 = findPage(pid), o2 = findObj(pg2, oid);
    if (pg2 && o2) {
      if (!txt.trim()) pg2.objs = pg2.objs.filter((x) => x.id !== oid);
      else o2.text = txt;
      if (S.sel && !findObj(pg2, S.sel.oid)) S.sel = null;
      histPush(); renderOverlay(pg2);
    }
    updateUI(); updatePanel();
  };
  ta.addEventListener('blur', finish);
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ta.blur(); }
  });
}

function addTextAt(pg, pt) {
  const st = S.style;
  const o = { id: uid(), type: 'text', x: pt[0], y: pt[1] - st.size * 0.6, text: '', font: st.font, size: st.size, bold: st.bold, italic: st.italic, color: st.color, angle: 0 };
  pg.objs.push(o); select(pg.id, o.id);
  setTimeout(() => openEditor(pg.id, o.id), 20);
}

// =====================================================================
// Interacción con el mouse
// =====================================================================
function toPt(e, el) {
  const r = $('svg', el).getBoundingClientRect();
  return [(e.clientX - r.left) / S.zoom, (e.clientY - r.top) / S.zoom];
}

function select(pid, oid) {
  const old = S.sel;
  S.sel = pid ? { pid, oid } : null;
  if (old && (!pid || old.pid !== pid)) renderOverlay(findPage(old.pid));
  if (pid) renderOverlay(findPage(pid));
  updatePanel();
}

function newObj(t, [x, y]) {
  const st = S.style, id = uid();
  switch (t) {
    case 'rect': case 'ellipse': return { id, type: t, x, y, w: 0, h: 0, stroke: st.stroke, sw: st.sw, fill: st.noFill ? null : st.fill, op: 1 };
    case 'highlight': return { id, type: 'highlight', x, y, w: 0, h: 0, stroke: null, sw: 0, fill: '#ffeb3b', op: 0.4 };
    case 'whiteout': return { id, type: 'whiteout', x, y, w: 0, h: 0, stroke: null, sw: 0, fill: '#ffffff', op: 1 };
    case 'line': case 'arrow': return { id, type: 'line', arrow: t === 'arrow', x1: x, y1: y, x2: x, y2: y, stroke: st.stroke, sw: st.sw };
    case 'pen': return { id, type: 'draw', pts: [[x, y]], stroke: st.stroke, sw: st.sw };
  }
}

function applyMove(o, r, dx, dy) {
  if (o.type === 'line') { o.x1 = r.x1 + dx; o.y1 = r.y1 + dy; o.x2 = r.x2 + dx; o.y2 = r.y2 + dy; }
  else if (o.type === 'draw') o.pts = r.pts.map(([x, y]) => [x + dx, y + dy]);
  else { o.x = r.x + dx; o.y = r.y + dy; }
}
const anchorOf = (o) => (o.type === 'line' ? [o.x1, o.y1] : o.type === 'draw' ? o.pts[0] : [o.x, o.y]);

function applyResize(o, r, h, pt) {
  if (o.type === 'line') { if (h === 'p1') { o.x1 = pt[0]; o.y1 = pt[1]; } else { o.x2 = pt[0]; o.y2 = pt[1]; } return; }
  if (o.type === 'image') {
    const th = ((r.angle || 0) * Math.PI) / 180;
    const dx = pt[0] - drag.start[0], dy = pt[1] - drag.start[1];
    const w = Math.max(8, r.w + dx * Math.cos(th) + dy * Math.sin(th));
    o.w = w; o.h = (w * r.h) / r.w; return;
  }
  let x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
  if (h.includes('n')) y1 = pt[1]; else y2 = pt[1];
  if (h.includes('w')) x1 = pt[0]; else x2 = pt[0];
  o.x = Math.min(x1, x2); o.y = Math.min(y1, y2); o.w = Math.abs(x2 - x1); o.h = Math.abs(y2 - y1);
}

function applyCreate(o, start, pt, shift) {
  let [x, y] = pt;
  if (o.type === 'line') {
    if (shift) {
      const a = Math.round(Math.atan2(y - start[1], x - start[0]) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(x - start[0], y - start[1]);
      x = start[0] + d * Math.cos(a); y = start[1] + d * Math.sin(a);
    }
    o.x2 = x; o.y2 = y; return;
  }
  let w = x - start[0], h = y - start[1];
  if (shift && (o.type === 'rect' || o.type === 'ellipse')) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
  o.x = Math.min(start[0], start[0] + w); o.y = Math.min(start[1], start[1] + h); o.w = Math.abs(w); o.h = Math.abs(h);
}

function onDown(e, el) {
  if (e.button !== 0) return;
  const pg = findPage(el.dataset.pid);
  if (!pg) return;
  const svg = $('svg', el), pt = toPt(e, el), t = S.tool;
  S.cur = pg.id; markCur();

  if (t === 'select') {
    const h = e.target.closest('[data-handle]'), g = e.target.closest('[data-oid]');
    if (h && S.sel) {
      const { o } = selected();
      if (o) { drag = { mode: 'resize', pid: pg.id, oid: o.id, start: pt, orig: structuredClone(o), handle: h.dataset.handle }; svg.setPointerCapture(e.pointerId); }
    } else if (g) {
      select(pg.id, g.dataset.oid);
      const o = findObj(pg, g.dataset.oid);
      drag = { mode: 'move', pid: pg.id, oid: o.id, start: pt, orig: structuredClone(o) };
      svg.setPointerCapture(e.pointerId);
    } else select(null);
    return;
  }
  if (t === 'edittext') {
    const ti = e.target.closest('[data-ti]');
    if (ti) {
      const it = (itemsCache.get(pg.id + ':' + rotOf(pg)) || [])[+ti.dataset.ti];
      if (it) editItem(pg, el, it);
    }
    return;
  }
  if (t === 'text') { addTextAt(pg, pt); return; }
  if (t === 'image') { placeImage(pg, pt); return; }

  const o = newObj(t, pt);
  if (!o) return;
  pg.objs.push(o);
  drag = { mode: t === 'pen' ? 'pen' : 'create', pid: pg.id, oid: o.id, start: pt, orig: null };
  S.sel = null;
  svg.setPointerCapture(e.pointerId);
  renderOverlay(pg);
}

function onMove(e, el) {
  if (!drag) {
    if (S.tool === 'select') {   // cursor de texto al pasar sobre texto editable del PDF
      const pg = findPage(el.dataset.pid), svg = $('svg', el);
      const free = !e.target.closest('[data-oid],[data-handle]');
      const want = free && pg && hitItem(pg, toPt(e, el)) ? 'text' : '';
      if (svg._cur !== want) { svg.style.cursor = want; svg._cur = want; }
    }
    return;
  }
  const pg = findPage(drag.pid), o = findObj(pg, drag.oid);
  if (!o) return;
  const pt = toPt(e, el), dx = pt[0] - drag.start[0], dy = pt[1] - drag.start[1];
  switch (drag.mode) {
    case 'move': applyMove(o, drag.orig, dx, dy); break;
    case 'resize': applyResize(o, drag.orig, drag.handle, pt); break;
    case 'create': applyCreate(o, drag.start, pt, e.shiftKey); break;
    case 'pen': { const l = o.pts[o.pts.length - 1]; if (Math.hypot(pt[0] - l[0], pt[1] - l[1]) > 0.6) o.pts.push(pt); break; }
  }
  drag.moved = true;
  renderOverlay(pg);
}

function onUp() {
  if (!drag) return;
  const d = drag; drag = null;
  const pg = findPage(d.pid), o = findObj(pg, d.oid);
  if (!o) return;
  if (d.mode === 'create' || d.mode === 'pen') {
    const tiny = o.type === 'line' ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 3
      : o.type === 'draw' ? o.pts.length < 2 : (o.w < 2 || o.h < 2);
    if (tiny) { pg.objs = pg.objs.filter((x) => x.id !== o.id); renderOverlay(pg); return; }
    histPush(); select(pg.id, o.id); updateUI();
    if (S.tool !== 'pen' && S.tool !== 'highlight') setTool('select');
  } else if (d.moved) { histPush(); updateUI(); }
}

function onDbl(e, el) {
  if (S.tool !== 'select') return;
  const pg = findPage(el.dataset.pid);
  if (!pg) return;
  const g = e.target.closest('[data-oid]');
  if (g) {
    const o = findObj(pg, g.dataset.oid);
    if (o && o.type === 'text') openEditor(pg.id, o.id);
    return;
  }
  const it = hitItem(pg, toPt(e, el));   // doble clic sobre texto del PDF => editarlo
  if (it) editItem(pg, el, it);
}

function onCtx(e, el) {
  e.preventDefault();
  const pg = findPage(el.dataset.pid);
  if (!pg || S.editing) return;
  S.cur = pg.id; markCur();
  const pt = toPt(e, el), g = e.target.closest('[data-oid]'), items = [];
  if (g) {
    select(pg.id, g.dataset.oid);
    const o = findObj(pg, g.dataset.oid);
    if (o.type === 'text') items.push({ label: 'Editar texto', icon: 'edittext', fn: () => openEditor(pg.id, o.id) }, '-');
    items.push(
      { label: 'Copiar', key: 'Ctrl+C', fn: copySel },
      { label: 'Duplicar', icon: 'dup', key: 'Ctrl+D', fn: dupSel }, '-',
      { label: 'Traer al frente', fn: () => reorder(true) },
      { label: 'Enviar al fondo', fn: () => reorder(false) }, '-',
      { label: 'Eliminar', icon: 'trash', key: 'Supr', fn: deleteSel },
    );
  } else {
    const it = hitItem(pg, pt);
    if (it) items.push({ label: 'Editar este texto', icon: 'edittext', fn: () => editItem(pg, el, it) }, '-');
    items.push(
      { label: 'Pegar', key: 'Ctrl+V', disabled: !S.clip, fn: () => pasteClip(pt) },
      { label: 'Agregar texto aquí', icon: 'text', fn: () => addTextAt(pg, pt) },
    );
  }
  showMenu(e.clientX, e.clientY, items);
}

// =====================================================================
// Imágenes
// =====================================================================
async function prepareImage(f) {
  let bytes = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
  let type = /\.png$/i.test(f.name) ? 'png' : /\.jpe?g$/i.test(f.name) ? 'jpg' : null;
  const bmp = await createImageBitmap(new Blob([bytes]));
  if (!type) {
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const b = await new Promise((r) => c.toBlob(r, 'image/png'));
    bytes = new Uint8Array(await b.arrayBuffer()); type = 'png';
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: type === 'png' ? 'image/png' : 'image/jpeg' }));
  const id = uid('i');
  S.images.set(id, { bytes, type, url });
  return { id, w: bmp.width, h: bmp.height };
}

async function placeImage(pg, pt) {
  try {
    const f = await api.openImage();
    if (!f) return;
    const im = await prepareImage(f);
    const w = Math.min(im.w * 0.75, viewSize(pg)[0] * 0.5), h = (w * im.h) / im.w;
    const o = { id: uid(), type: 'image', imgId: im.id, x: pt[0], y: pt[1], w, h, angle: 0 };
    const cur = findPage(pg.id);
    cur.objs.push(o); histPush(); select(cur.id, o.id); updateUI();
    setTool('select');
  } catch (err) { console.error(err); toast('No se pudo insertar la imagen: ' + errMsg(err), 5000); }
}

// Cada imagen pasa a ser una página (largo mayor = 842 pt, como A4)
async function addImagePages(files) {
  try {
    busy(true, 'Procesando imágenes…');
    const news = [];
    for (const f of files) {
      const im = await prepareImage(f);
      const pw = im.w * 0.75, ph = im.h * 0.75, k = 842 / Math.max(pw, ph), w = pw * k, h = ph * k;
      news.push({ id: uid('p'), src: null, idx: 0, w, h, x0: 0, y0: 0, base: 0, rot: 0, objs: [{ id: uid(), type: 'image', imgId: im.id, x: 0, y: 0, w, h, angle: 0 }] });
    }
    if (!news.length) return;
    if (!S.pages.length) {
      S.pages = news; S.cur = news[0].id; S.name = 'Imágenes.pdf'; S.filePath = null;
      histReset(); S.dirty = true; rebuild();
    } else {
      const i = curIndex();
      S.pages.splice(i + 1, 0, ...news); S.cur = news[0].id; S.psel = new Set();
      commitStruct(); goTo(i + 1);
    }
    toast(`${news.length} imagen(es) agregada(s) como página(s)`);
  } catch (err) { console.error(err); toast('No se pudo procesar la imagen: ' + errMsg(err), 5000); } finally { busy(false); }
}
async function imagesToPages() { const files = await api.openImages(); if (files && files.length) await addImagePages(files); }

// =====================================================================
// Panel de propiedades
// =====================================================================
const HINTS = {
  select: 'Clic en un objeto para moverlo o redimensionarlo · doble clic sobre un texto para editarlo · clic derecho para más opciones',
  edittext: 'Clic sobre un texto del PDF para reemplazarlo (se tapa el original y se escribe el nuevo)',
  text: 'Clic donde se quiera agregar texto · Esc para terminar',
  highlight: 'Arrastrar sobre el contenido para resaltarlo',
  whiteout: 'Arrastrar para tapar contenido; el color se cambia en "Relleno"',
  rect: 'Arrastrar para dibujar un rectángulo (Mayús = cuadrado)',
  ellipse: 'Arrastrar para dibujar una elipse (Mayús = círculo)',
  line: 'Arrastrar para dibujar una línea (Mayús = ángulos de 45°)',
  arrow: 'Arrastrar para dibujar una flecha',
  pen: 'Dibujar a mano alzada',
  image: 'Clic donde se quiera insertar la imagen',
};

function updatePanel() {
  const { o } = selected(), t = o && o.type, tool = S.tool;
  const showText = t === 'text' || tool === 'text' || tool === 'edittext';
  const showShape = SHAPE.includes(t) || ['rect', 'ellipse', 'line', 'arrow', 'pen'].includes(tool);
  const showFill = BOX.includes(t) || BOX.includes(tool);
  $('.g-text').hidden = !showText; $('.g-shape').hidden = !showShape; $('.g-fill').hidden = !showFill; $('.g-obj').hidden = !o;
  $('#props-empty').hidden = showText || showShape || showFill || !!o;
  const ts = t === 'text' ? o : S.style;
  $('#p-font').value = ts.font; $('#p-size').value = Math.round(ts.size * 10) / 10;
  $('#p-bold').classList.toggle('on', !!ts.bold); $('#p-italic').classList.toggle('on', !!ts.italic);
  $('#p-color').value = t === 'text' ? o.color : S.style.color;
  const sh = o && SHAPE.includes(t) ? o : S.style;
  $('#p-stroke').value = sh.stroke || '#000000'; $('#p-sw').value = sh.sw;
  const fl = o && BOX.includes(t) ? o : null;
  $('#p-fill').value = (fl ? fl.fill : S.style.fill) || S.style.fill;
  $('#p-nofill').checked = fl ? !fl.fill : S.style.noFill;
  $('#nofill-wrap').hidden = !(fl ? (t === 'rect' || t === 'ellipse') : (tool === 'rect' || tool === 'ellipse'));
  $('#hint').textContent = HINTS[tool] || '';
}

function setProp(k, v, commit) {
  const { pg, o } = selected(), t = o && o.type;
  if (!(k === 'fill' && (t === 'highlight' || t === 'whiteout')) && k in S.style) S.style[k] = v;
  if (o) {
    if (t === 'text' && ['font', 'size', 'bold', 'italic', 'color'].includes(k)) o[k] = v;
    else if (SHAPE.includes(t) && (k === 'stroke' || k === 'sw')) o[k] = v;
    else if (BOX.includes(t) && k === 'fill') { o.fill = v; if (t === 'rect' || t === 'ellipse') S.style.noFill = false; }
    else if ((t === 'rect' || t === 'ellipse') && k === 'noFill') o.fill = v ? null : S.style.fill;
    renderOverlay(pg);
  }
  if (commit) { histPush(); updateUI(); }
  updatePanel();
}

function bindProp(id, key, parse, ev = 'input') {
  const n = $(id);
  n.addEventListener(ev, (e) => setProp(key, parse(e.target), false));
  n.addEventListener('change', (e) => { setProp(key, parse(e.target), true); if (e.target.type !== 'number') e.target.blur(); });
}
bindProp('#p-font', 'font', (n) => n.value);
bindProp('#p-size', 'size', (n) => clamp(+n.value || 14, 4, 300));
bindProp('#p-color', 'color', (n) => n.value);
bindProp('#p-stroke', 'stroke', (n) => n.value);
bindProp('#p-sw', 'sw', (n) => clamp(+n.value || 1, 0.5, 40));
bindProp('#p-fill', 'fill', (n) => n.value);
bindProp('#p-nofill', 'noFill', (n) => n.checked, 'change');
$('#p-bold').onclick = () => { const { o } = selected(); setProp('bold', !(o && o.type === 'text' ? o.bold : S.style.bold), true); };
$('#p-italic').onclick = () => { const { o } = selected(); setProp('italic', !(o && o.type === 'text' ? o.italic : S.style.italic), true); };

function reorder(front) {
  const { pg, o } = selected(); if (!o) return;
  pg.objs = pg.objs.filter((x) => x.id !== o.id);
  if (front) pg.objs.push(o); else pg.objs.unshift(o);
  histPush(); renderOverlay(pg); updateUI();
}
function deleteSel() {
  const { pg, o } = selected(); if (!o) return;
  pg.objs = pg.objs.filter((x) => x.id !== o.id);
  S.sel = null; histPush(); renderOverlay(pg); updatePanel(); updateUI();
}
function dupSel() {
  const { pg, o } = selected(); if (!o) return;
  const c = structuredClone(o); c.id = uid(); applyMove(c, structuredClone(o), 12, 12);
  pg.objs.push(c); histPush(); select(pg.id, c.id); updateUI();
}
function copySel() { const { o } = selected(); if (!o) return; S.clip = structuredClone(o); toast('Objeto copiado'); }
function pasteClip(pt) {
  if (!S.clip) return;
  const pg = findPage(S.cur) || S.pages[0]; if (!pg) return;
  const c = structuredClone(S.clip), orig = structuredClone(c);
  c.id = uid();
  if (pt) { const [ax, ay] = anchorOf(c); applyMove(c, orig, pt[0] - ax, pt[1] - ay); }
  else applyMove(c, orig, 14, 14);
  pg.objs.push(c); histPush(); select(pg.id, c.id); updateUI();
}
$('#a-front').onclick = () => reorder(true);
$('#a-back').onclick = () => reorder(false);
$('#a-del').onclick = deleteSel;
$('#a-dup').onclick = dupSel;
$('#a-copy').onclick = copySel;

function setTool(t) {
  S.tool = t; pagesEl.dataset.tool = t;
  $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  S.pages.forEach(renderOverlay);
  updatePanel();
  if (t === 'edittext') loadAllItems();
}
$$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

// =====================================================================
// Miniaturas y selección de páginas
// =====================================================================
let tq = Promise.resolve();
async function renderThumb(pg) {
  const p = await S.sources.get(pg.src).doc.getPage(pg.idx + 1);
  const base = p.getViewport({ scale: 1, rotation: pg.rot });
  const vp = p.getViewport({ scale: 220 / base.width, rotation: pg.rot });
  const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: ctx, viewport: vp }).promise;
  return c.toDataURL('image/jpeg', 0.7);
}
function queueThumb(pg, t) {
  const img = $('img', t);
  if (!pg.src) { img.hidden = true; return; }
  const key = `${pg.src}:${pg.idx}:${pg.rot}`;
  img.hidden = false;
  if (thumbCache.has(key)) { img.src = thumbCache.get(key); return; }
  if (t._tk === key) return;
  t._tk = key;
  tq = tq.then(async () => {
    if (!thumbEls.has(pg.id)) return;
    if (!thumbCache.has(key)) thumbCache.set(key, await renderThumb(pg));
    if (t._tk === key) img.src = thumbCache.get(key);
  }).catch(console.error);
}

let dragPid = null;
function thumbClick(e, pid) {
  const idx = S.pages.findIndex((p) => p.id === pid);
  if (e.shiftKey && S.anchor && findPage(S.anchor)) {
    const a = S.pages.findIndex((p) => p.id === S.anchor);
    S.psel = new Set(S.pages.slice(Math.min(a, idx), Math.max(a, idx) + 1).map((p) => p.id));
    S.cur = pid; markCur();
  } else if (e.ctrlKey || e.metaKey) {
    if (!S.psel.size && S.cur) S.psel.add(S.cur);
    if (S.psel.has(pid)) S.psel.delete(pid); else S.psel.add(pid);
    S.anchor = pid; S.cur = pid; markCur();
  } else {
    S.psel = new Set([pid]); S.anchor = pid; goTo(idx);
  }
}

function makeThumb(pg) {
  const t = document.createElement('div');
  t.className = 'thumb'; t.draggable = true; t.dataset.pid = pg.id;
  t.innerHTML = '<div class="tw"><img alt=""></div><span></span>';
  t.addEventListener('click', (e) => thumbClick(e, t.dataset.pid));
  t.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const pid = t.dataset.pid;
    if (!(S.psel.size > 1 && S.psel.has(pid))) { S.psel = new Set([pid]); S.anchor = pid; }
    S.cur = pid; markCur();
    showMenu(e.clientX, e.clientY, pageMenuItems());
  });
  t.addEventListener('dragstart', (e) => { dragPid = t.dataset.pid; e.dataTransfer.setData('text/plain', dragPid); });
  t.addEventListener('dragover', (e) => {
    if (!dragPid) return;
    e.preventDefault();
    const r = t.getBoundingClientRect(), below = e.clientY >= r.top + r.height / 2;
    t.classList.toggle('above', !below); t.classList.toggle('below', below);
  });
  t.addEventListener('dragleave', () => t.classList.remove('above', 'below'));
  t.addEventListener('drop', (e) => {
    if (!dragPid) return;
    e.preventDefault();
    const r = t.getBoundingClientRect(), below = e.clientY >= r.top + r.height / 2;
    t.classList.remove('above', 'below');
    const from = dragPid; dragPid = null;
    movePages(from, t.dataset.pid, below);
  });
  t.addEventListener('dragend', () => { dragPid = null; $$('.thumb').forEach((x) => x.classList.remove('above', 'below')); });
  return t;
}

function rebuildThumbs() {
  S.pages.forEach((pg, i) => {
    let t = thumbEls.get(pg.id);
    if (!t) { t = makeThumb(pg); thumbEls.set(pg.id, t); thumbsEl.append(t); }
    $('span', t).textContent = i + 1;
    if (thumbsEl.children[i] !== t) thumbsEl.insertBefore(t, thumbsEl.children[i] || null);
    const [W, Hh] = viewSize(pg);
    $('.tw', t).style.height = (Hh / W) * 130 + 'px';
    queueThumb(pg, t);
  });
}

const curIndex = () => Math.max(0, S.pages.findIndex((p) => p.id === S.cur));
const commitStruct = () => { histPush(); rebuild(); };
const targetPages = () => {
  if (!S.pages.length) return [];
  return S.psel.size > 1 ? S.pages.filter((p) => S.psel.has(p.id)) : [S.pages[curIndex()]];
};

function goTo(i) {
  if (!S.pages.length) return;
  i = clamp(i, 0, S.pages.length - 1);
  const pg = S.pages[i]; S.cur = pg.id;
  els.get(pg.id).scrollIntoView({ block: 'start' });
  markCur();
}

function markCur() {
  const multi = S.psel.size > 1;
  for (const [pid, t] of thumbEls) { t.classList.toggle('cur', pid === S.cur); t.classList.toggle('sel', multi && S.psel.has(pid)); }
  $('#selinfo').textContent = multi ? `${S.psel.size} seleccionadas` : '';
  const inp = $('#pgnum');
  if (document.activeElement !== inp) inp.value = S.pages.length ? curIndex() + 1 : 1;
  $('#pageinfo').textContent = S.pages.length ? `Página ${curIndex() + 1} de ${S.pages.length}` : '';
  const t = thumbEls.get(S.cur);
  if (t) t.scrollIntoView({ block: 'nearest' });
}

function detectCur() {
  const vr = viewer.getBoundingClientRect(), mid = vr.top + vr.height / 3;
  let best = null, bd = 1e12;
  for (const pg of S.pages) {
    const el = els.get(pg.id); if (!el) continue;
    const r = el.getBoundingClientRect();
    const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
    if (d < bd) { bd = d; best = pg.id; }
  }
  if (best && best !== S.cur) { S.cur = best; markCur(); }
}
let scrollTick = false;
viewer.addEventListener('scroll', () => {
  if (scrollTick) return; scrollTick = true;
  requestAnimationFrame(() => { scrollTick = false; detectCur(); });
});

// =====================================================================
// Operaciones sobre páginas
// =====================================================================
function insertBlank(where = 'after', size = null, count = 1) {
  const has = S.pages.length > 0, ref = has ? S.pages[curIndex()] : null;
  const [W, Hh] = size || (ref ? viewSize(ref) : PAGE_SIZES.a4);
  const i = has ? curIndex() + (where === 'after' ? 1 : 0) : 0;
  const news = Array.from({ length: count }, () => ({ id: uid('p'), src: null, idx: 0, w: W, h: Hh, x0: 0, y0: 0, base: 0, rot: 0, objs: [] }));
  S.pages.splice(i, 0, ...news); S.cur = news[0].id; S.psel = new Set();
  commitStruct(); goTo(i);
}

async function blankDialog() {
  const v = await askForm('Página en blanco', [
    { key: 'size', label: 'Tamaño', type: 'select', value: 'same', options: [['same', 'Igual a la página actual'], ['a4', 'A4'], ['letter', 'Carta (Letter)'], ['legal', 'Oficio (Legal)'], ['a3', 'A3']] },
    { key: 'orient', label: 'Orientación', type: 'select', value: 'auto', options: [['auto', 'Automática'], ['p', 'Vertical'], ['l', 'Horizontal']] },
    { key: 'count', label: 'Cantidad', type: 'number', value: 1, min: 1, max: 200 },
  ], 'Agregar');
  if (!v) return;
  const ref = S.pages.length ? S.pages[curIndex()] : null;
  let [w, h] = v.size === 'same' ? (ref ? viewSize(ref) : PAGE_SIZES.a4) : PAGE_SIZES[v.size];
  if (v.orient === 'l' && w < h) [w, h] = [h, w];
  if (v.orient === 'p' && w > h) [w, h] = [h, w];
  insertBlank('after', [w, h], clamp(Math.round(v.count) || 1, 1, 200));
}

async function insertBytes(f) {
  try {
    busy(true, 'Insertando páginas…');
    const pages = await loadSource(f.data, f.name);
    const i = S.pages.length ? curIndex() : -1;
    S.pages.splice(i + 1, 0, ...pages); S.cur = pages[0].id; S.psel = new Set();
    commitStruct(); goTo(i + 1);
    toast(`${pages.length} página(s) insertada(s)`);
  } catch (err) { console.error(err); toast('No se pudo insertar: ' + errMsg(err), 5000); } finally { busy(false); }
}
async function insertPdf() { const f = await api.openPdf(); if (f) await insertBytes(f); }

function dupPages() {
  const t = targetPages(); if (!t.length) return;
  for (let k = t.length - 1; k >= 0; k--) {
    const i = S.pages.findIndex((p) => p.id === t[k].id);
    const c = structuredClone(S.pages[i]);
    c.id = uid('p'); c.objs.forEach((o) => { o.id = uid(); });
    S.pages.splice(i + 1, 0, c);
    if (k === t.length - 1) S.cur = c.id;
  }
  S.psel = new Set(); commitStruct();
}

function delPages() {
  const t = targetPages(); if (!t.length) return;
  if (t.length >= S.pages.length) { toast('El documento debe conservar al menos una página'); return; }
  const idx = S.pages.findIndex((p) => p.id === t[0].id), ids = new Set(t.map((p) => p.id));
  S.pages = S.pages.filter((p) => !ids.has(p.id));
  S.cur = S.pages[Math.min(idx, S.pages.length - 1)].id; S.psel = new Set(); S.sel = null;
  commitStruct();
  toast(t.length > 1 ? `${t.length} páginas eliminadas` : 'Página eliminada', 6000, { label: 'Deshacer', fn: undo });
}

function rotPages(deg) { const t = targetPages(); if (!t.length) return; t.forEach((pg) => rotatePage(pg, deg)); commitStruct(); }

function movePages(fromId, toId, after) {
  const ids = S.psel.size > 1 && S.psel.has(fromId) ? S.psel : new Set([fromId]);
  if (ids.has(toId)) return;
  const moving = S.pages.filter((p) => ids.has(p.id));
  S.pages = S.pages.filter((p) => !ids.has(p.id));
  const ti = S.pages.findIndex((p) => p.id === toId);
  S.pages.splice(ti + (after ? 1 : 0), 0, ...moving);
  commitStruct();
}

function movePageBy(d) {
  const sel = new Set(targetPages().map((p) => p.id)), a = S.pages;
  if (d < 0) { for (let i = 1; i < a.length; i++) if (sel.has(a[i].id) && !sel.has(a[i - 1].id)) [a[i - 1], a[i]] = [a[i], a[i - 1]]; }
  else { for (let i = a.length - 2; i >= 0; i--) if (sel.has(a[i].id) && !sel.has(a[i + 1].id)) [a[i + 1], a[i]] = [a[i], a[i + 1]]; }
  commitStruct(); goTo(curIndex());
}

function selectAllPages() { S.psel = new Set(S.pages.map((p) => p.id)); markCur(); }

async function extractPages() {
  const pages = targetPages(); if (!pages.length) return;
  try {
    busy(true, 'Extrayendo páginas…');
    const data = await buildPdf(pages);
    const r = await api.savePdf({ path: null, name: `${baseName()} (extracto).pdf`, data });
    if (r) toast(`Se guardaron ${pages.length} página(s) en ${r.name}`);
  } catch (e) { console.error(e); toast('Error: ' + errMsg(e), 6000); } finally { busy(false); }
}

async function exportImage() {
  const pg = targetPages()[0]; if (!pg) return;
  try {
    busy(true, 'Generando imagen…');
    const bytes = await buildPdf([pg]);
    const doc = await pdfjsLib.getDocument({ data: bytes, ...PDF_OPTS }).promise;
    const p = await doc.getPage(1), vp = p.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    doc.destroy();
    const n = S.pages.findIndex((x) => x.id === pg.id) + 1;
    const r = await api.saveFile({ name: `${baseName()} - página ${n}.png`, label: 'Imagen PNG', ext: 'png', data: buf });
    if (r) toast('Imagen guardada: ' + r.name);
  } catch (e) { console.error(e); toast('Error: ' + errMsg(e), 6000); } finally { busy(false); }
}

const scopeOpts = [['all', 'Todas las páginas'], ['sel', 'Solo la selección (o página actual)']];
const scopePages = (s) => (s === 'all' ? S.pages : targetPages());

async function numberDialog() {
  if (!S.pages.length) return;
  const v = await askForm('Numerar páginas', [
    { key: 'pos', label: 'Posición', type: 'select', value: 'bc', options: [['bc', 'Abajo, centro'], ['br', 'Abajo, derecha'], ['bl', 'Abajo, izquierda'], ['tc', 'Arriba, centro'], ['tr', 'Arriba, derecha'], ['tl', 'Arriba, izquierda']] },
    { key: 'fmt', label: 'Formato', type: 'select', value: 'Página {n} de {t}', options: [['{n}', '1, 2, 3…'], ['Página {n}', 'Página 1'], ['Página {n} de {t}', 'Página 1 de 10'], ['{n} / {t}', '1 / 10'], ['- {n} -', '- 1 -']] },
    { key: 'start', label: 'Empezar en', type: 'number', value: 1, min: 0 },
    { key: 'size', label: 'Tamaño de letra', type: 'number', value: 11, min: 6, max: 48 },
    { key: 'color', label: 'Color', type: 'color', value: '#333333' },
    { key: 'scope', label: 'Aplicar a', type: 'select', value: 'all', options: scopeOpts },
  ], 'Numerar');
  if (!v) return;
  const list = scopePages(v.scope), start = Math.round(v.start) || 0, total = start + list.length - 1, M = 36;
  list.forEach((pg, i) => {
    const o = { id: uid(), type: 'text', x: 0, y: 0, text: v.fmt.replace('{n}', start + i).replace('{t}', total), font: 'helvetica', size: clamp(v.size || 11, 6, 48), bold: false, italic: false, color: v.color, angle: 0 };
    const [w, h] = textSize(o), [Wv, Hv] = viewSize(pg);
    o.x = v.pos[1] === 'l' ? M : v.pos[1] === 'r' ? Wv - M - w : (Wv - w) / 2;
    o.y = v.pos[0] === 't' ? M : Hv - M - h;
    pg.objs.push(o);
  });
  histPush(); S.pages.forEach(renderOverlay); updateUI();
  toast(`Numeración agregada a ${list.length} página(s)`);
}

async function watermarkDialog() {
  if (!S.pages.length) return;
  const v = await askForm('Marca de agua', [
    { key: 'text', label: 'Texto', type: 'text', value: 'CONFIDENCIAL' },
    { key: 'size', label: 'Tamaño de letra', type: 'number', value: 72, min: 10, max: 400 },
    { key: 'color', label: 'Color', type: 'color', value: '#888888' },
    { key: 'op', label: 'Opacidad (%)', type: 'number', value: 30, min: 5, max: 100 },
    { key: 'angle', label: 'Orientación', type: 'select', value: '-45', options: [['-45', 'Diagonal ascendente'], ['0', 'Horizontal'], ['45', 'Diagonal descendente']] },
    { key: 'scope', label: 'Aplicar a', type: 'select', value: 'all', options: scopeOpts },
  ], 'Agregar');
  if (!v || !v.text.trim()) return;
  const list = scopePages(v.scope), ang = +v.angle, th = (ang * Math.PI) / 180;
  list.forEach((pg) => {
    const o = { id: uid(), type: 'text', x: 0, y: 0, text: v.text, font: 'helvetica', size: clamp(v.size || 72, 10, 400), bold: true, italic: false, color: v.color, angle: ang, op: clamp(v.op, 5, 100) / 100 };
    const [w, h] = textSize(o), [Wv, Hv] = viewSize(pg);
    o.x = Wv / 2 - ((w / 2) * Math.cos(th) - (h / 2) * Math.sin(th));
    o.y = Hv / 2 - ((w / 2) * Math.sin(th) + (h / 2) * Math.cos(th));
    pg.objs.push(o);
  });
  histPush(); S.pages.forEach(renderOverlay); updateUI();
  toast(`Marca de agua agregada a ${list.length} página(s)`);
}

function pageMenuItems() {
  const n = targetPages().length, s = n > 1 ? ` (${n})` : '';
  return [
    { label: 'Insertar página en blanco antes', fn: () => insertBlank('before') },
    { label: 'Insertar página en blanco después', fn: () => insertBlank('after') }, '-',
    { label: 'Rotar a la izquierda' + s, icon: 'rotl', fn: () => rotPages(-90) },
    { label: 'Rotar a la derecha' + s, icon: 'rotr', fn: () => rotPages(90) },
    { label: 'Duplicar' + s, icon: 'dup', fn: dupPages },
    { label: 'Mover hacia arriba' + s, icon: 'up', fn: () => movePageBy(-1) },
    { label: 'Mover hacia abajo' + s, icon: 'down', fn: () => movePageBy(1) }, '-',
    { label: 'Extraer a un PDF nuevo…', fn: extractPages },
    { label: 'Exportar como imagen (PNG)…', fn: exportImage }, '-',
    { label: 'Eliminar' + s, icon: 'trash', fn: delPages },
  ];
}
$('#m-add').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    { label: 'Página en blanco', icon: 'plus', fn: () => insertBlank('after') },
    { label: 'Página en blanco (elegir tamaño)…', fn: blankDialog },
    { label: 'Páginas de otro PDF…', icon: 'open', fn: insertPdf },
    { label: 'Páginas desde imágenes…', icon: 'image', fn: imagesToPages },
  ]);
};
$('#m-more').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    { label: 'Extraer a un PDF nuevo…', fn: extractPages },
    { label: 'Exportar página como imagen (PNG)…', fn: exportImage }, '-',
    { label: 'Numerar páginas…', fn: numberDialog },
    { label: 'Agregar marca de agua…', fn: watermarkDialog }, '-',
    { label: 'Seleccionar todas las páginas', key: 'Ctrl+A', fn: selectAllPages },
  ]);
};

// =====================================================================
// Zoom, deshacer, interfaz general
// =====================================================================
function setZoom(z) {
  z = clamp(z, 0.25, 4);
  if (z === S.zoom) return;
  const ratio = viewer.scrollTop / Math.max(1, viewer.scrollHeight);
  S.zoom = z; rebuild({ thumbs: false });
  viewer.scrollTop = ratio * viewer.scrollHeight;
}
function fitWidth() {
  if (!S.pages.length) return;
  setZoom((viewer.clientWidth - 70) / Math.max(...S.pages.map((p) => viewSize(p)[0])));
}
viewer.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
viewer.addEventListener('scroll', closeMenu);

function restore() {
  S.pages = JSON.parse(HIST.stack[HIST.i]);
  S.sel = null; S.dirty = true;
  if (!findPage(S.cur)) S.cur = S.pages[0] && S.pages[0].id;
  rebuild();
}
function undo() { if (S.editing) return; if (HIST.i > 0) { HIST.i--; restore(); } }
function redo() { if (S.editing) return; if (HIST.i < HIST.stack.length - 1) { HIST.i++; restore(); } }

function updateUI() {
  const has = S.pages.length > 0;
  $('#empty').hidden = has; pagesEl.hidden = !has;
  if (!has) renderRecents();
  $('#b-undo').disabled = HIST.i <= 0; $('#b-redo').disabled = HIST.i >= HIST.stack.length - 1;
  $('#zoomlbl').textContent = Math.round(S.zoom * 100) + '%';
  $('#pgtotal').textContent = '/ ' + S.pages.length;
  $('#dn').textContent = has ? S.name : '';
  $('#dirty').hidden = !(has && S.dirty);
  markCur();
  document.title = (S.dirty ? '● ' : '') + S.name + ' — Editor PDF';
  api.setDirty(S.dirty);
}

const ACTIONS = {
  new: newDoc, open: doOpen, save: () => doSave(false), saveas: () => doSave(true), print: doPrint,
  undo, redo,
  zoomin: () => setZoom(S.zoom * 1.2), zoomout: () => setZoom(S.zoom / 1.2), zoomreset: () => setZoom(1), fit: fitWidth,
  prev: () => goTo(curIndex() - 1), next: () => goTo(curIndex() + 1),
  insertpdf: insertPdf, imgs: imagesToPages,
  dup: dupPages, rotl: () => rotPages(-90), rotr: () => rotPages(90), up: () => movePageBy(-1), down: () => movePageBy(1), delpage: delPages,
  theme: toggleTheme, help: showHelp,
  'save-then-close': async () => { if (await doSave(false)) api.closeNow(); },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && ACTIONS[b.dataset.act]) ACTIONS[b.dataset.act]();
});
api.onMenu((a) => ACTIONS[a] && ACTIONS[a]());
api.onOpenFile((f) => openBytes(f));
$('#pgnum').addEventListener('change', (e) => goTo(+e.target.value - 1));

const TOOLKEYS = { v: 'select', e: 'edittext', t: 'text', h: 'highlight', b: 'whiteout', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', p: 'pen', i: 'image' };
window.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-ov')) return;
  if (e.key === 'F1') { e.preventDefault(); showHelp(); return; }
  if (e.target.matches('input, textarea, select')) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl) {
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'd') { e.preventDefault(); dupSel(); }
    else if (k === 'c') { if (S.sel) { e.preventDefault(); copySel(); } }
    else if (k === 'x') { if (S.sel) { e.preventDefault(); copySel(); deleteSel(); } }
    else if (k === 'v') { if (S.clip) { e.preventDefault(); pasteClip(null); } }
    else if (k === 'a') { e.preventDefault(); selectAllPages(); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (S.sel) { e.preventDefault(); deleteSel(); } return; }
  if (e.key === 'Escape') { select(null); S.psel = new Set(); markCur(); setTool('select'); return; }
  if (e.key.startsWith('Arrow') && S.sel) {
    const { pg, o } = selected(); if (!o) return;
    e.preventDefault();
    const st = e.shiftKey ? 10 : 1;
    applyMove(o, structuredClone(o), e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0);
    histPush(); renderOverlay(pg); updateUI();
    return;
  }
  if (!e.altKey && TOOLKEYS[k] && S.pages.length) setTool(TOOLKEYS[k]);
});

// Arrastrar archivos desde el explorador (PDF o imágenes)
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#dropzone').hidden = false; }
});
window.addEventListener('dragleave', () => { if (dragDepth > 0 && --dragDepth === 0) $('#dropzone').hidden = true; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; $('#dropzone').hidden = true;
  const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
  const pdf = files.find((x) => /\.pdf$/i.test(x.name));
  const imgs = files.filter((x) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(x.name));
  const read = async (f) => ({ name: f.name, path: f.path || null, data: new Uint8Array(await f.arrayBuffer()) });
  if (pdf) {
    const f = await read(pdf);
    if (!S.pages.length) { await openBytes(f); return; }
    const p = document.createElement('p'); p.textContent = `¿Qué hacer con "${pdf.name}"?`;
    const r = await openModal('Archivo PDF', p, [
      { label: 'Cancelar', value: null },
      { label: 'Insertar sus páginas aquí', value: 'insert' },
      { label: 'Abrir en lugar del actual', value: 'open', primary: true },
    ]);
    if (r === 'insert') await insertBytes(f);
    else if (r === 'open' && (await confirmDiscard())) await openBytes(f);
  } else if (imgs.length) {
    await addImagePages(await Promise.all(imgs.map(read)));
  }
});

fillIcons();
setTool('select');
updateUI();
