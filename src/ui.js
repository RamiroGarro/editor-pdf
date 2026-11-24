'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- Íconos (SVG de trazo, 24x24) ----------
const ICONS = {
  select: '<path d="M6 3l12 9-5.5 1.2L15 19l-2.6 1-2.6-5.7L6 17z"/>',
  edittext: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 3-3 6 6"/>',
  highlight: '<path d="M14 4l6 6-8 8-4 1 1-4z"/><path d="M4 21h8"/>',
  whiteout: '<rect x="4" y="7" width="16" height="10" rx="1" fill="currentColor" fill-opacity=".25"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  pen: '<path d="M3 17c3-9 6-9 8-3s5 3 7-4"/>',
  newdoc: '<path d="M6 3h8l4 4v14H6z"/><path d="M12 11v6M9 14h6"/>',
  open: '<path d="M3 7h6l2 2h10v10H3z"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  saveas: '<path d="M5 4h8M5 4v16h14v-6"/><path d="M17 3v6M14 6h6"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  zoomin: '<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5M10 7v6M7 10h6"/>',
  zoomout: '<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5M7 10h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  theme: '<path d="M20 14A8 8 0 1110 4a7 7 0 0010 10z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  caret: '<path d="M7 10l5 5 5-5"/>',
  rotl: '<path d="M4 12a8 8 0 108-8"/><path d="M4 4v5h5"/>',
  rotr: '<path d="M20 12a8 8 0 11-8-8"/><path d="M20 4v5h-5"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M5 16V5h11"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
};
function ico(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}
function fillIcons(root = document) { $$('i[data-ico]', root).forEach((i) => { i.innerHTML = ico(i.dataset.ico); }); }
fillIcons();

// ---------- Avisos ----------
function toast(msg, ms = 2800, action) {
  const t = $('#toast');
  t.innerHTML = '';
  const s = document.createElement('span'); s.textContent = msg; t.append(s);
  if (action) {
    const b = document.createElement('button'); b.textContent = action.label;
    b.onclick = () => { t.classList.remove('show'); action.fn(); };
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), action ? Math.max(ms, 6000) : ms);
}
function busy(on, msg = 'Procesando…') { $('#busy').hidden = !on; $('#busy span').textContent = msg; }

// ---------- Diálogos ----------
function openModal(title, bodyEl, buttons) {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'modal-ov';
    const box = document.createElement('div'); box.className = 'modal';
    const h = document.createElement('h3'); h.textContent = title;
    box.append(h, bodyEl);
    const bar = document.createElement('div'); bar.className = 'modal-bar';
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !['TEXTAREA', 'BUTTON'].includes(e.target.tagName)) {
        const p = buttons.find((b) => b.primary);
        if (p) { e.preventDefault(); close(p.value); }
      }
    };
    function close(v) { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); }
    buttons.forEach((b) => {
      const bt = document.createElement('button'); bt.textContent = b.label;
      if (b.primary) bt.classList.add('primary');
      if (b.danger) bt.classList.add('danger');
      bt.onclick = () => close(b.value);
      bar.append(bt);
    });
    box.append(bar); ov.append(box); document.body.append(ov);
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(null); });
    const first = box.querySelector('input:not([type=checkbox]),select') || box.querySelector('button.primary');
    if (first) first.focus();
  });
}

async function askConfirm(title, msg, okLabel = 'Aceptar', danger = false) {
  const p = document.createElement('p'); p.textContent = msg;
  return (await openModal(title, p, [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, primary: true, danger }])) === true;
}

// Devuelve 'save' | 'discard' | null (cancelar)
function askDiscard() {
  const p = document.createElement('p'); p.textContent = 'El documento tiene cambios sin guardar. ¿Qué desea hacer?';
  return openModal('Cambios sin guardar', p, [
    { label: 'Cancelar', value: null },
    { label: 'Descartar cambios', value: 'discard', danger: true },
    { label: 'Guardar', value: 'save', primary: true },
  ]);
}

async function askForm(title, fields, okLabel = 'Aplicar') {
  const f = document.createElement('div'); f.className = 'form';
  const inputs = {};
  for (const fd of fields) {
    const row = document.createElement('label'); row.className = 'row';
    const sp = document.createElement('span'); sp.textContent = fd.label; row.append(sp);
    let el;
    if (fd.type === 'select') {
      el = document.createElement('select');
      fd.options.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; el.append(o); });
      el.value = fd.value;
    } else {
      el = document.createElement('input'); el.type = fd.type || 'text';
      if (fd.type === 'checkbox') el.checked = !!fd.value; else el.value = fd.value == null ? '' : fd.value;
      if (fd.min != null) el.min = fd.min;
      if (fd.max != null) el.max = fd.max;
    }
    inputs[fd.key] = el; row.append(el); f.append(row);
  }
  const ok = await openModal(title, f, [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, primary: true }]);
  if (!ok) return null;
  const out = {};
  for (const fd of fields) {
    const el = inputs[fd.key];
    out[fd.key] = fd.type === 'checkbox' ? el.checked : fd.type === 'number' ? +el.value : el.value;
  }
  return out;
}

function showHelp() {
  const rows = (list) => list.map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`).join('');
  const d = document.createElement('div');
  d.innerHTML = '<table class="keys"><tbody>' +
    '<tr><td colspan="2"><h4>Herramientas</h4></td></tr>' +
    rows([['V', 'Seleccionar y mover'], ['E', 'Editar texto existente'], ['T', 'Texto nuevo'], ['I', 'Imagen'], ['H', 'Resaltar'], ['B', 'Tapar'],
      ['R / O', 'Rectángulo / Elipse'], ['L / A', 'Línea / Flecha'], ['P', 'Lápiz']]) +
    '<tr><td colspan="2"><h4>Atajos</h4></td></tr>' +
    rows([['Doble clic en un texto', 'Editarlo directamente'], ['Ctrl+Z / Ctrl+Y', 'Deshacer / Rehacer'], ['Ctrl+C / Ctrl+V / Ctrl+D', 'Copiar / Pegar / Duplicar objeto'],
      ['Supr', 'Eliminar objeto'], ['Flechas', 'Mover objeto (Mayús = más rápido)'], ['Ctrl+rueda', 'Zoom'], ['Ctrl+A', 'Seleccionar todas las páginas'],
      ['Ctrl+O / Ctrl+S', 'Abrir / Guardar'], ['Ctrl+P', 'Imprimir'], ['Esc', 'Cancelar / volver a Seleccionar']]) +
    '<tr><td colspan="2"><h4>Páginas</h4></td></tr>' +
    rows([['Clic derecho en una miniatura', 'Menú con todas las acciones'], ['Ctrl+clic / Mayús+clic', 'Elegir varias páginas'], ['Arrastrar miniaturas', 'Reordenar']]) +
    '</tbody></table>';
  return openModal('Atajos y ayuda', d, [{ label: 'Cerrar', value: true, primary: true }]);
}

// ---------- Menú contextual ----------
function showMenu(x, y, items) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'ctx';
  items.forEach((it) => {
    if (it === '-') { m.append(document.createElement('hr')); return; }
    const b = document.createElement('button'); b.className = 'ctx-item'; b.disabled = !!it.disabled;
    b.innerHTML = (it.icon ? ico(it.icon) : '<span class="sp"></span>') + '<span></span>' + (it.key ? `<kbd>${it.key}</kbd>` : '');
    b.children[1].textContent = it.label;
    b.onclick = () => { closeMenu(); it.fn(); };
    m.append(b);
  });
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
}
function closeMenu() { $$('.ctx').forEach((m) => m.remove()); }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.ctx')) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, true);
window.addEventListener('blur', closeMenu);

// ---------- Tema ----------
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch (e) { /* nada */ }
}
function toggleTheme() { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }
try { setTheme(localStorage.getItem('theme') || 'light'); } catch (e) { /* nada */ }

// ---------- Archivos recientes ----------
const Recents = {
  get() { try { return JSON.parse(localStorage.getItem('recents') || '[]'); } catch (e) { return []; } },
  set(l) { try { localStorage.setItem('recents', JSON.stringify(l.slice(0, 8))); } catch (e) { /* nada */ } },
  add(path, name) { if (!path) return; this.set([{ path, name }, ...this.get().filter((r) => r.path !== path)]); },
  remove(path) { this.set(this.get().filter((r) => r.path !== path)); },
};
