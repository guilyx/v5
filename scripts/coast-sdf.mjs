// Bakes Natural Earth land polygons (public domain, naturalearthdata.com) into
// small signed-distance PNGs: the shaders draw land, coastline and the "water
// lines" of an old atlas from them, and they stay smooth when magnified.
//
//   node scripts/coast-sdf.mjs ne_50m_land.geojson ne_10m_land.geojson ne_10m_minor_islands.geojson
//
// Writes public/geo/{earth,gulf,bay}.png. 128 = coastline, >128 = sea.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const [world50, land10, islands10] = process.argv.slice(2);
const AD = { lat: 24.454, lon: 54.377 }; // Abu Dhabi, the centre of the local maps
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32 * Math.cos((AD.lat * Math.PI) / 180);

function rings(path) {
  const out = [];
  for (const f of JSON.parse(readFileSync(path, "utf8")).features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const p of polys) out.push(p); // [outer, ...holes]
  }
  return out;
}

/** Even-odd scanline fill of polygons already projected to pixel space. */
function rasterize(polys, W, H) {
  const m = new Uint8Array(W * H);
  for (const poly of polys) {
    const rows = new Map(); // row -> x crossings, filled edge by edge
    for (const r of poly)
      for (let i = 0, n = r.length; i < n; i++) {
        const [ax, ay] = r[i], [bx, by] = r[(i + 1) % n];
        if (ay === by) continue;
        const ya = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5)), yb = Math.min(H - 1, Math.floor(Math.max(ay, by) - 0.5));
        for (let y = ya; y <= yb; y++) {
          const cy = y + 0.5;
          if (ay <= cy === by <= cy) continue;
          let xs = rows.get(y);
          if (!xs) rows.set(y, (xs = []));
          xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
        }
      }
    for (const [y, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) m[y * W + x] ^= 1;
      }
    }
  }
  return m;
}

/** Felzenszwalb & Huttenlocher squared EDT, in place on a Float64Array grid. */
function edt(grid, W, H) {
  const n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len, get, set) => {
    for (let i = 0; i < len; i++) f[i] = get(i);
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
    for (let i = 0; i < len; i++) set(i, d[i]);
  };
  for (let x = 0; x < W; x++) pass(H, (y) => grid[y * W + x], (y, val) => (grid[y * W + x] = val));
  for (let y = 0; y < H; y++) pass(W, (x) => grid[y * W + x], (x, val) => (grid[y * W + x] = val));
}

function sdf(mask, W, H) {
  const INF = 1e20, a = new Float64Array(W * H), b = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) { a[i] = mask[i] ? 0 : INF; b[i] = mask[i] ? INF : 0; }
  edt(a, W, H); edt(b, W, H);
  const out = new Float32Array(W * H); // + in the sea, - on land, in pixels
  for (let i = 0; i < W * H; i++) out[i] = mask[i] ? -(Math.sqrt(b[i]) - 0.5) : Math.sqrt(a[i]) - 0.5;
  return out;
}

/** separable gaussian blur: rounds off the corners of coarse coastline data */
function blur(a, W, H, sigma) {
  const r = Math.ceil(sigma * 3), k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = k.reduce((x, y) => x + y, 0);
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += a[y * W + Math.min(W - 1, Math.max(0, x + i))] * k[i + r];
      tmp[y * W + x] = v / sum;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x] * k[i + r];
      a[y * W + x] = v / sum;
    }
}

function bake(polys, W, H, ss, range, file, sigma = 0) {
  const big = rasterize(polys, W * ss, H * ss);
  const d = sdf(big, W * ss, H * ss);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) s += d[(y * ss + j) * W * ss + x * ss + i];
      out[y * W + x] = s / (ss * ss) / ss; // back to output pixels
    }
  if (sigma) blur(out, W, H, sigma);
  const px = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) px[i] = Math.max(0, Math.min(255, Math.round(128 + (out[i] / range) * 127)));
  writeFileSync(file, png(px, W, H));
  console.log(file, W, H);
}

function png(gray, W, H) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) { // "up" filter: smooth fields compress far better
    raw[y * (W + 1)] = 2;
    for (let x = 0; x < W; x++) raw[y * (W + 1) + 1 + x] = (gray[y * W + x] - (y ? gray[(y - 1) * W + x] : 0)) & 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/geo", { recursive: true });

// 1. the globe: equirectangular, whole world
{
  const W = 2048, H = 1024, ss = 2;
  const polys = rings(world50).map((p) => p.map((r) => r.map(([lon, lat]) => [((lon + 180) / 360) * W * ss, ((90 - lat) / 180) * H * ss])));
  bake(polys, W, H, ss, 12, "public/geo/earth.png");
}

// 2. & 3. flat maps centred on Abu Dhabi (km east / north), drawn north-up
function local(halfKm, W, ss, range, file, sigma) {
  const toPx = ([lon, lat]) => [
    (((lon - AD.lon) * KM_PER_DEG_LON + halfKm) / (2 * halfKm)) * W * ss,
    ((halfKm - (lat - AD.lat) * KM_PER_DEG_LAT) / (2 * halfKm)) * W * ss,
  ];
  const latPad = (halfKm * 1.2) / KM_PER_DEG_LAT, lonPad = (halfKm * 1.2) / KM_PER_DEG_LON;
  const near = (p) => p[0].some(([lon, lat]) => Math.abs(lat - AD.lat) < latPad && Math.abs(lon - AD.lon) < lonPad) ||
    (Math.min(...p[0].map((c) => c[0])) < AD.lon && Math.max(...p[0].map((c) => c[0])) > AD.lon && Math.min(...p[0].map((c) => c[1])) < AD.lat && Math.max(...p[0].map((c) => c[1])) > AD.lat);
  const polys = [...rings(land10), ...rings(islands10)].filter(near).map((p) => p.map((r) => r.map(toPx)));
  bake(polys, W, W, ss, range, file, sigma);
}
local(640, 1024, 4, 24, "public/geo/gulf.png", 1.2);
local(40, 1024, 4, 32, "public/geo/bay.png", 5);
