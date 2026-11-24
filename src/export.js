'use strict';

const FONT_NAMES = {
  helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};

const hexRgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// Reemplaza por "?" los caracteres que las fuentes estándar (WinAnsi) no pueden codificar
function safeText(font, s) {
  let r = '';
  for (const ch of s) {
    try { font.widthOfTextAtSize(ch, 10); r += ch; } catch (e) { r += '?'; }
  }
  return r;
}

async function buildPdf(pagesList = S.pages) {
  const { PDFDocument, StandardFonts, degrees, LineCapStyle, BlendMode } = PDFLib;
  const out = await PDFDocument.create();
  const srcDocs = new Map(), fontCache = new Map(), imgCache = new Map();

  // 1) Copiar páginas de cada fuente en un solo lote (evita duplicar recursos)
  const need = new Map();
  for (const pg of pagesList) if (pg.src) {
    if (!need.has(pg.src)) need.set(pg.src, []);
    need.get(pg.src).push(pg.idx);
  }
  const batch = new Map();
  for (const [src, list] of need) {
    const sd = await PDFDocument.load(S.sources.get(src).bytes, { ignoreEncryption: true });
    srcDocs.set(src, sd);
    const uniq = [...new Set(list)];
    const copied = await out.copyPages(sd, uniq);
    batch.set(src, new Map(uniq.map((ix, k) => [ix, copied[k]])));
  }

  async function getFont(o) {
    const key = `${o.font}-${o.bold ? 1 : 0}-${o.italic ? 1 : 0}`;
    if (!fontCache.has(key)) {
      const name = FONT_NAMES[o.font][(o.bold ? 1 : 0) + (o.italic ? 2 : 0)];
      fontCache.set(key, await out.embedFont(StandardFonts[name]));
    }
    return fontCache.get(key);
  }

  async function drawObj(page, pg, o) {
    const R = rotOf(pg);
    switch (o.type) {
      case 'text': {
        const font = await getFont(o);
        const th = ((o.angle || 0) * Math.PI) / 180, s = Math.sin(th), c = Math.cos(th);
        o.text.replace(/\t/g, '    ').split('\n').forEach((line, i) => {
          if (!line) return;
          const d = ASC * o.size + i * LH * o.size;
          const [X, Y] = toUser(pg, o.x - d * s, o.y + d * c);
          page.drawText(safeText(font, line), { x: X, y: Y, size: o.size, font, color: hexRgb(o.color), opacity: o.op ?? 1, rotate: degrees(R - (o.angle || 0)) });
        });
        break;
      }
      case 'rect': case 'ellipse': case 'highlight': case 'whiteout': {
        const [ax, ay] = toUser(pg, o.x, o.y), [bx, by] = toUser(pg, o.x + o.w, o.y + o.h);
        const X = Math.min(ax, bx), Y = Math.min(ay, by), W = Math.abs(bx - ax), Hh = Math.abs(by - ay);
        const opt = {
          color: o.fill ? hexRgb(o.fill) : undefined,
          opacity: o.op ?? 1,
          borderColor: o.stroke ? hexRgb(o.stroke) : undefined,
          borderWidth: o.stroke ? o.sw : 0,
          borderOpacity: o.op ?? 1,
        };
        if (o.type === 'highlight') opt.blendMode = BlendMode.Multiply;
        if (o.type === 'ellipse') page.drawEllipse({ x: X + W / 2, y: Y + Hh / 2, xScale: W / 2, yScale: Hh / 2, ...opt });
        else page.drawRectangle({ x: X, y: Y, width: W, height: Hh, ...opt });
        break;
      }
      case 'line': {
        const a = toUser(pg, o.x1, o.y1), b = toUser(pg, o.x2, o.y2), col = hexRgb(o.stroke);
        const L = (p, q) => page.drawLine({ start: { x: p[0], y: p[1] }, end: { x: q[0], y: q[1] }, thickness: o.sw, color: col, lineCap: LineCapStyle.Round });
        L(a, b);
        if (o.arrow) for (const w of arrowWings(o)) L(b, toUser(pg, w[0], w[1]));
        break;
      }
      case 'draw': {
        const col = hexRgb(o.stroke);
        for (let i = 1; i < o.pts.length; i++) {
          const a = toUser(pg, ...o.pts[i - 1]), b = toUser(pg, ...o.pts[i]);
          page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: o.sw, color: col, lineCap: LineCapStyle.Round });
        }
        break;
      }
      case 'image': {
        let emb = imgCache.get(o.imgId);
        if (!emb) {
          const im = S.images.get(o.imgId);
          emb = im.type === 'png' ? await out.embedPng(im.bytes) : await out.embedJpg(im.bytes);
          imgCache.set(o.imgId, emb);
        }
        const th = ((o.angle || 0) * Math.PI) / 180;
        const [X, Y] = toUser(pg, o.x - o.h * Math.sin(th), o.y + o.h * Math.cos(th));
        page.drawImage(emb, { x: X, y: Y, width: o.w, height: o.h, rotate: degrees(R - (o.angle || 0)) });
        break;
      }
    }
  }

  // 2) Armar el documento final en el orden actual
  const used = new Set();
  for (const pg of pagesList) {
    let page;
    if (pg.src) {
      const key = pg.src + ':' + pg.idx;
      if (!used.has(key)) { page = batch.get(pg.src).get(pg.idx); used.add(key); }
      else [page] = await out.copyPages(srcDocs.get(pg.src), [pg.idx]);
      out.addPage(page);
    } else {
      page = out.addPage([pg.w, pg.h]);
    }
    page.setRotation(degrees(rotOf(pg)));
    for (const o of pg.objs) await drawObj(page, pg, o);
  }
  out.setProducer('Editor PDF');
  return out.save();
}
