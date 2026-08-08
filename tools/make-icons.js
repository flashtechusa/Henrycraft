#!/usr/bin/env node
/*
 * Regenerates Henry's launcher icons. No dependencies - Node's built-in zlib only.
 *
 *   node make-icons.js android/app/src/main/res
 *
 * Writes mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png,
 * ic_launcher_round.png and ic_launcher_foreground.png, plus web icons at the
 * root of the output dir. The art is a blocky front-on portrait of Henry:
 * ginger hair with a top swoop, brown eyes, freckles, small smile, on sky blue.
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const G = 24;                       // logical pixel grid
const SKY      = [122,193,238];
const HAIR     = [190, 98, 42];
const HAIR_HI  = [216,126, 60];
const HAIR_DK  = [150, 74, 30];
const SKIN     = [241,199,159];
const SKIN_SH  = [216,170,130];
const FRECK    = [199,141, 99];
const EYE      = [ 66, 42, 30];
const WHITE    = [255,252,248];
const MOUTH    = [158, 84, 74];
const CHEEK    = [240,163,149];

function blank(w, h){ return new Uint8Array(w * h * 4); }
function put(buf, w, x, y, c, a){
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  buf[i] = c[0]; buf[i+1] = c[1]; buf[i+2] = c[2]; buf[i+3] = a === undefined ? 255 : a;
}
/* inclusive rectangle, matching the original drawing */
function rect(buf, w, x0, y0, x1, y1, c){
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(buf, w, x, y, c);
}

/* the portrait, drawn on a transparent 24x24 grid */
function face(){
  const b = blank(G, G);
  rect(b, G,  3,  3, 20, 11, HAIR);        // hair mass
  rect(b, G,  4,  2, 19,  3, HAIR_HI);
  rect(b, G, 13,  1, 18,  3, HAIR_HI);     // top swoop
  rect(b, G,  3, 11,  4, 18, HAIR_DK);     // sideburns
  rect(b, G, 19, 11, 20, 18, HAIR_DK);
  rect(b, G,  5, 11, 18, 22, SKIN);        // face
  rect(b, G,  5, 10, 18, 11, HAIR_HI);     // fringe on the brow
  rect(b, G,  5, 22, 18, 22, SKIN_SH);     // chin shadow
  rect(b, G,  7, 14,  8, 16, EYE);         // eyes, with one highlight pixel
  rect(b, G,  7, 14,  7, 14, WHITE);
  rect(b, G, 15, 14, 16, 16, EYE);
  rect(b, G, 15, 14, 15, 14, WHITE);
  rect(b, G,  5, 18,  6, 19, CHEEK);       // cheeks
  rect(b, G, 17, 18, 18, 19, CHEEK);
  [[9,17],[12,18],[14,17]].forEach(p => rect(b, G, p[0], p[1], p[0], p[1], FRECK));
  rect(b, G, 10, 20, 13, 20, MOUTH);       // smile, corners tucked up
  rect(b, G,  9, 19,  9, 19, MOUTH);
  rect(b, G, 14, 19, 14, 19, MOUTH);
  return b;
}

function nearest(src, sw, sh, dw, dh){
  const out = blank(dw, dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++){
    const sx = Math.min(sw - 1, Math.floor(x * sw / dw));
    const sy = Math.min(sh - 1, Math.floor(y * sh / dh));
    const s = (sy * sw + sx) * 4, d = (y * dw + x) * 4;
    out[d] = src[s]; out[d+1] = src[s+1]; out[d+2] = src[s+2]; out[d+3] = src[s+3];
  }
  return out;
}

/* bg=true paints the sky behind; scale<1 insets the art for the adaptive safe zone */
function compose(size, bg, scale){
  let canvas = blank(G, G);
  if (bg) rect(canvas, G, 0, 0, G - 1, G - 1, SKY);
  let art = face(), aw = G;
  if (scale !== 1){
    aw = Math.round(G * scale);
    art = nearest(art, G, G, aw, aw);
  }
  const off = Math.floor((G - aw) / 2);
  for (let y = 0; y < aw; y++) for (let x = 0; x < aw; x++){
    const s = (y * aw + x) * 4;
    if (art[s+3] === 0) continue;
    put(canvas, G, x + off, y + off, [art[s], art[s+1], art[s+2]], art[s+3]);
  }
  return nearest(canvas, G, G, size, size);
}

/* minimal PNG writer: 8-bit RGBA, no interlace */
function crc32(buf){
  let c, t = [];
  for (let n = 0; n < 256; n++){
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  let r = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) r = t[(r ^ buf[i]) & 0xFF] ^ (r >>> 8);
  return (r ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function png(rgba, w, h){
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++){
    raw[y * (w * 4 + 1)] = 0;                        // filter: none
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const out = process.argv[2] || 'res';
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
let n = 0;
for (const [name, m] of Object.entries(densities)){
  const dir = path.join(out, 'mipmap-' + name);
  fs.mkdirSync(dir, { recursive: true });
  const legacy = Math.round(48 * m);
  const fg     = Math.round(108 * m);          // adaptive icons are 108dp
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'),            png(compose(legacy, true, 1), legacy, legacy));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'),      png(compose(legacy, true, 1), legacy, legacy));
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), png(compose(fg, false, 0.66), fg, fg));
  n += 3;
}
for (const size of [180, 192, 512]){
  fs.writeFileSync(path.join(out, (size === 180 ? 'apple-touch-icon' : 'icon-' + size) + '.png'),
                   png(compose(size, true, 1), size, size));
  n++;
}
console.log('wrote ' + n + ' icons into ' + out);
console.log('adaptive icon background colour: #7AC1EE');
