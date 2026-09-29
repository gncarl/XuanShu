// 生成「玄枢」多尺寸 ICO 图标（深靛紫渐变圆角块 + 中央发光枢纽：多路汇入一点）。
//
// 重要：ICO 内每张图必须用「标准 DIB(BMP) 条目」编码，不能用 PNG 条目。
// NSIS 3.0.x（electron-builder 内置版本）解析 PNG 条目会报
// "invalid icon file size" 并中止编译。因此手写 BITMAPINFOHEADER
// + 32bpp BGRA 位图 + 1bpp AND 掩码（自下而上、行按 4 字节对齐）。
//
// 渲染走 4× 超采样抗锯齿：先在高分辨率 float 缓冲上合成，再盒式下采样到目标尺寸，
// 无需任何外部依赖。同时导出一张 256px 的 PNG 预览（assets/icon-preview.png）。
import fs from 'node:fs';
import zlib from 'node:zlib';

const S = 4; // 超采样倍数

// ---------- 合成基元 ----------
function over(buf, SS, x, y, cr, cg, cb, ca) {
  const ix = Math.round(x), iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= SS || iy >= SS) return;
  const o = (iy * SS + ix) * 4;
  const da = buf[o + 3];
  const outA = ca + da * (1 - ca);
  if (outA > 1e-6) {
    buf[o] = (cr * ca + buf[o] * da * (1 - ca)) / outA;
    buf[o + 1] = (cg * ca + buf[o + 1] * da * (1 - ca)) / outA;
    buf[o + 2] = (cb * ca + buf[o + 2] * da * (1 - ca)) / outA;
    buf[o + 3] = outA;
  }
}
function fillDisc(buf, SS, cx, cy, r, cr, cg, cb, ca = 1) {
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (Math.hypot(x - cx, y - cy) <= r) over(buf, SS, x, y, cr, cg, cb, ca);
}
function fillCapsule(buf, SS, ax, ay, bx, by, r, cr, cg, cb, ca = 1) {
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillDisc(buf, SS, ax + (bx - ax) * t, ay + (by - ay) * t, r, cr, cg, cb, ca);
  }
}
function roundedInside(x, y, SS, m, r) {
  const inX = x >= m && x <= SS - 1 - m;
  const inY = y >= m && y <= SS - 1 - m;
  if (inX && inY) return true;
  const cx = x < SS / 2 ? m + r : SS - 1 - m - r;
  const cy = y < SS / 2 ? m + r : SS - 1 - m - r;
  return Math.hypot(x - cx, y - cy) <= r;
}

// ---------- 画面 ----------
function renderIcon(size) {
  const SS = size * S;
  const buf = new Float32Array(SS * SS * 4); // RGBA, 0..1

  // 1) 圆角块：深靛 → 紫罗兰 渐变 + 中心辉光（玄 = 深幽）
  const m = Math.max(1, Math.round(SS * 0.06));
  const r = Math.round(SS * 0.22);
  for (let y = 0; y < SS; y++) for (let x = 0; x < SS; x++) {
    if (!roundedInside(x, y, SS, m, r)) continue;
    const ty = y / SS;
    let rr = 0.10 + (0.27 - 0.10) * ty;
    let gg = 0.08 + (0.18 - 0.08) * ty;
    let bb = 0.20 + (0.52 - 0.20) * ty;
    const dx = x / SS - 0.5, dy = y / SS - 0.5;
    const glow = Math.max(0, 1 - Math.hypot(dx, dy) * 1.6);
    rr += glow * 0.16; gg += glow * 0.14; bb += glow * 0.28;
    over(buf, SS, x, y, rr, gg, bb, 1);
  }

  // 2) 枢纽图形（枢 = 枢纽）：多路汇入中心一点
  const cx = SS * 0.52, cy = SS * 0.52;
  const lineW = SS * 0.040;
  const hub = SS * 0.115;
  const white = [0.88, 0.95, 1.0];
  // 三路来源（左上 / 左 / 左下）
  const srcs = [
    [SS * 0.19, SS * 0.31],
    [SS * 0.15, SS * 0.55],
    [SS * 0.19, SS * 0.79],
  ];
  for (const [sx, sy] of srcs) {
    fillCapsule(buf, SS, sx, sy, cx, cy, lineW, ...white, 1);   // 汇入线
    fillDisc(buf, SS, sx, sy, lineW * 1.3, ...white, 1);         // 源点
  }
  // 出口（向右）
  fillCapsule(buf, SS, cx, cy, SS * 0.88, cy, lineW * 1.15, ...white, 1);
  // 外圈淡环
  fillDisc(buf, SS, cx, cy, hub * 1.8, ...white, 0.13);
  fillDisc(buf, SS, cx, cy, hub * 1.4, ...white, 0.32);
  // 枢纽辉光 + 实心
  fillDisc(buf, SS, cx, cy, hub, 1.0, 1.0, 1.0, 1.0);

  // 3) 下采样到目标尺寸
  const out = new Uint8Array(size * size * 4);
  const n = S * S;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let R = 0, G = 0, B = 0, A = 0;
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
      const o = ((y * S + dy) * SS + (x * S + dx)) * 4;
      R += buf[o]; G += buf[o + 1]; B += buf[o + 2]; A += buf[o + 3];
    }
    const o = (y * size + x) * 4;
    out[o] = R / n * 255; out[o + 1] = G / n * 255; out[o + 2] = B / n * 255; out[o + 3] = A / n * 255;
  }
  return out;
}

// ---------- ICO (DIB) ----------
function makeDib(size, rgba) {
  const W = size, H = size;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(W, 4);
  header.writeInt32LE(H * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(W * H * 4, 20);
  header.writeInt32LE(0, 24);
  header.writeInt32LE(0, 28);
  header.writeUInt32LE(0, 32);
  header.writeUInt32LE(0, 36);

  const xor = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const srcY = H - 1 - y;
    for (let x = 0; x < W; x++) {
      const s = (srcY * W + x) * 4;
      const d = (y * W + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
  }
  const maskRow = Math.ceil(W / 32) * 4;
  const mask = Buffer.alloc(maskRow * H);
  return Buffer.concat([header, xor, mask]);
}

// ---------- PNG 预览 ----------
const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function writePNG(file, size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size * 4; x++) raw[y * (size * 4 + 1) + 1 + x] = rgba[y * size * 4 + x];
  }
  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}

// ---------- 主流程 ----------
const sizes = [16, 32, 48, 64, 128, 256];
const dibs = sizes.map((s) => makeDib(s, renderIcon(s)));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);

const entries = [];
const datas = [];
let offset = 6 + 16 * sizes.length;
for (let i = 0; i < sizes.length; i++) {
  const dib = dibs[i], s = sizes[i];
  const entry = Buffer.alloc(16);
  entry.writeUInt8(s >= 256 ? 0 : s, 0);
  entry.writeUInt8(s >= 256 ? 0 : s, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(dib.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry); datas.push(dib); offset += dib.length;
}
fs.writeFileSync('assets/icon.ico', Buffer.concat([header, ...entries, ...datas]));
writePNG('assets/icon-preview.png', 256, renderIcon(256));
writePNG('assets/tray.png', 32, renderIcon(32));
console.log('icon.ico', Buffer.concat([header, ...entries, ...datas]).length, 'bytes, sizes:', sizes.join(','), '(DIB 条目)');
console.log('icon-preview.png written (256px)');
console.log('tray.png written (32px)');
