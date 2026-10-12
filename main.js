"use strict";

const td = new TextDecoder();

/* ---------- inflate (raw deflate) ---------- */
const LBt = Uint16Array.from([3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258]);
const LEt = Uint8Array.from([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0]);
const DBt = Uint16Array.from([1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577]);
const DEt = Uint8Array.from([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13]);
const CLt = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

function huff(L, from, cnt) {
  const count = new Uint16Array(16); let mb = 0;
  for (let i = 0; i < cnt; i++) { const l = L[from + i]; count[l]++; if (l > mb) mb = l; }
  count[0] = 0; if (!mb) mb = 1; const next = new Uint16Array(16); let code = 0;
  for (let l = 1; l < 16; l++) { code = (code + count[l - 1]) << 1; next[l] = code; }
  const size = 1 << mb, t = new Uint16Array(size);
  for (let i = 0; i < cnt; i++) {
    const l = L[from + i]; if (!l) continue; let c = next[l]++, r = 0;
    for (let k = 0; k < l; k++) { r = r << 1 | c & 1; c >>= 1; }
    for (let j = r, st = 1 << l; j < size; j += st) t[j] = i << 4 | l;
  }
  return { t, m: size - 1 };
}

let FIX = null;
function inflate(s, p, sz) {
  let o = new Uint8Array(sz || Math.max(4096, s.length * 4)), n = 0, bb = 0, bc = 0, last = 0;
  do {
    while (bc < 25) { bb |= s[p++] << bc; bc += 8; }
    last = bb & 1; const ty = bb >>> 1 & 3; bb >>>= 3; bc -= 3;
    if (ty == 0) {
      p -= bc >> 3; bc = 0; bb = 0; const l = s[p] | s[p + 1] << 8; p += 4;
      if (n + l > o.length) { let c = o.length * 2; while (c < n + l) c *= 2; const x = new Uint8Array(c); x.set(o); o = x; }
      o.set(s.subarray(p, p + l), n); n += l; p += l; continue;
    }
    if (ty == 3) throw Error('inflate');
    let lt, dt;
    if (ty == 1) {
      if (!FIX) FIX = [huff(new Uint8Array(288).fill(8, 0, 144).fill(9, 144, 256).fill(7, 256, 280).fill(8, 280), 0, 288), huff(new Uint8Array(32).fill(5), 0, 32)];
      lt = FIX[0]; dt = FIX[1];
    } else {
      const hl = (bb & 31) + 257, hd = (bb >>> 5 & 31) + 1, hc = (bb >>> 10 & 15) + 4; bb >>>= 14; bc -= 14;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hc; i++) { while (bc < 3) { bb |= s[p++] << bc; bc += 8; } cl[CLt[i]] = bb & 7; bb >>>= 3; bc -= 3; }
      const ch = huff(cl, 0, 19), tot = hl + hd, L = new Uint8Array(tot), ct = ch.t, cm = ch.m;
      for (let i = 0; i < tot;) {
        while (bc < 25) { bb |= s[p++] << bc; bc += 8; }
        const e = ct[bb & cm], l = e & 15; if (!l) throw Error('inflate'); bb >>>= l; bc -= l; const y = e >> 4;
        if (y < 16) L[i++] = y;
        else {
          let r, v = 0;
          if (y == 16) { if (!i) throw Error('inflate'); v = L[i - 1]; r = 3 + (bb & 3); bb >>>= 2; bc -= 2; }
          else if (y == 17) { r = 3 + (bb & 7); bb >>>= 3; bc -= 3; }
          else { r = 11 + (bb & 127); bb >>>= 7; bc -= 7; }
          while (r-- && i < tot) L[i++] = v;
        }
      }
      lt = huff(L, 0, hl); dt = huff(L, hl, hd);
    }
    const LT = lt.t, lm = lt.m, DT = dt.t, dm = dt.m;
    for (;;) {
      if (n + 258 > o.length) { let c = o.length * 2; while (c < n + 258) c *= 2; const x = new Uint8Array(c); x.set(o); o = x; }
      while (bc < 25) { bb |= s[p++] << bc; bc += 8; }
      let e = LT[bb & lm], l = e & 15; if (!l) throw Error('inflate'); bb >>>= l; bc -= l; let y = e >> 4;
      if (y < 256) { o[n++] = y; continue; }
      if (y == 256) break;
      y -= 257; let len = LBt[y]; const eb = LEt[y]; if (eb) { len += bb & ((1 << eb) - 1); bb >>>= eb; bc -= eb; }
      while (bc < 25) { bb |= s[p++] << bc; bc += 8; }
      e = DT[bb & dm]; l = e & 15; if (!l) throw Error('inflate'); bb >>>= l; bc -= l; y = e >> 4;
      let dist = DBt[y]; const de = DEt[y]; if (de) { while (bc < 14) { bb |= s[p++] << bc; bc += 8; } dist += bb & ((1 << de) - 1); bb >>>= de; bc -= de; }
      let q = n - dist; if (q < 0) throw Error('inflate');
      if (dist >= len && len >= 24) { o.copyWithin(n, q, q + len); n += len; }
      else { for (let i = 0; i < len; i++) o[n++] = o[q++]; }
    }
  } while (!last);
  return o.subarray(0, n);
}

function snappy(s) {
  let p = 0, len = 0, sh = 0, b;
  do { b = s[p++]; len |= (b & 127) << sh; sh += 7; } while (b & 128);
  const o = new Uint8Array(len); let n = 0;
  while (p < s.length) {
    const t = s[p++], k = t & 3;
    if (!k) {
      let l = t >> 2; if (l >= 60) { const e = l - 59; l = 0; for (let i = 0; i < e; i++) l |= s[p++] << 8 * i; }
      l++; o.set(s.subarray(p, p + l), n); p += l; n += l;
    } else {
      let l, off;
      if (k == 1) { l = 4 + (t >> 2 & 7); off = (t >> 5) << 8 | s[p++]; }
      else if (k == 2) { l = 1 + (t >> 2); off = s[p] | s[p + 1] << 8; p += 2; }
      else { l = 1 + (t >> 2); off = s[p] | s[p + 1] << 8 | s[p + 2] << 16 | s[p + 3] << 24; p += 4; }
      for (let i = 0; i < l; i++, n++) o[n] = o[n - off];
    }
  }
  return o;
}

/* ---------- LevelDB ---------- */
function vi(d, r) { let v = 0, s = 0, b; do { b = d[r.p++]; v += (b & 127) * 2 ** s; s += 7; } while (b & 128); return v; }
function blk(f, o, sz) { const t = f[o + sz]; let d = f.subarray(o, o + sz); return t == 1 ? snappy(d) : t == 2 ? inflate(d, 2) : t == 4 ? inflate(d, 0) : d; }
function ents(d, cb) {
  const nr = new DataView(d.buffer, d.byteOffset, d.length).getUint32(d.length - 4, true), end = d.length - 4 - nr * 4, r = { p: 0 }, key = new Uint8Array(4096);
  while (r.p < end) {
    const sh = vi(d, r), ns = vi(d, r), vl = vi(d, r); if (sh + ns > 4096) throw Error('key');
    for (let i = 0; i < ns; i++) key[sh + i] = d[r.p + i]; r.p += ns; cb(key, sh + ns, r.p, vl); r.p += vl;
  }
}
function ldb(f, cb) {
  const r = { p: f.length - 48 }; vi(f, r); vi(f, r); const io = vi(f, r), is = vi(f, r), idx = [], ib = blk(f, io, is);
  ents(ib, (k, kl, vo, vl) => idx.push(ib.slice(vo, vo + vl)));
  for (const h of idx) {
    const q = { p: 0 }, bo = vi(h, q), bs = vi(h, q), d = blk(f, bo, bs);
    ents(d, (k, kl, vo, vl) => {
      const L = kl - 8; if ((L != 10 && L != 14) || k[L - 2] != 47) return;
      let s = 0; for (let i = 7; i >= 1; i--) s = s * 256 + k[L + i];
      cb(k.subarray(0, L), s, k[L], d.subarray(vo, vo + vl), { bo, bs, eo: vo, vl });
    });
  }
}
function wal(f, cb) {
  let cur = [];
  for (let p = 0; p + 7 <= f.length;) {
    const r = 32768 - p % 32768; if (r < 7) { p += r; continue; }
    const l = f[p + 4] | f[p + 5] << 8, t = f[p + 6]; p += 7; if (!t && !l) continue;
    const part = f.subarray(p, p + l); p += l;
    if (t == 1 || t == 2) cur = [part]; else cur.push(part);
    if (t == 1 || t == 4) {
      let n = 0; for (const c of cur) n += c.length; const b = new Uint8Array(n); n = 0;
      for (const c of cur) { b.set(c, n); n += c.length; }
      const dv = new DataView(b.buffer); let s = dv.getUint32(0, true) + dv.getUint32(4, true) * 2 ** 32; const c = dv.getUint32(8, true), q = { p: 12 };
      for (let i = 0; i < c && q.p < b.length; i++) {
        const ty = b[q.p++], kl = vi(b, q), k = b.subarray(q.p, q.p + kl); q.p += kl; let v = null;
        if (ty) { const vl = vi(b, q); v = b.subarray(q.p, q.p + vl); q.p += vl; }
        cb(k, s + i, ty, v);
      }
    }
  }
}

/* ---------- NBT (little endian) ---------- */
function nbt(d, r) {
  const v = new DataView(d.buffer, d.byteOffset, d.length), u = () => d[r.p++],
    s = () => { const l = v.getUint16(r.p, true); r.p += 2; const t = td.decode(d.subarray(r.p, r.p + l)); r.p += l; return t; },
    i4 = () => { r.p += 4; return v.getInt32(r.p - 4, true); },
    pl = t => {
      switch (t) {
        case 1: return u(); case 2: r.p += 2; return v.getInt16(r.p - 2, true); case 3: return i4();
        case 4: case 6: r.p += 8; return 0; case 5: r.p += 4; return 0; case 7: r.p += i4(); return 0; case 8: return s();
        case 9: { const c = u(), n = i4(), a = []; for (let i = 0; i < n; i++) a.push(pl(c)); return a; }
        case 10: { const o = {}; for (let t; (t = u());) { const k = s(); o[k] = pl(t); } return o; }
        case 11: r.p += 4 * i4(); return 0; case 12: r.p += 8 * i4(); return 0;
      }
      throw Error('NBT');
    };
  u(); s(); return pl(10);
}

/* ---------- Blocks ---------- */
const DYE = { white: 0xe9ecec, orange: 0xf07613, magenta: 0xbd44b3, light_blue: 0x3ab3da, yellow: 0xf8c527, lime: 0x70b919, pink: 0xed8dac, gray: 0x3e4447, light_gray: 0x8e8e86, silver: 0x8e8e86, cyan: 0x158991, purple: 0x792aac, blue: 0x35399d, brown: 0x724728, green: 0x546d1b, red: 0xa12722, black: 0x141519 };
const TERRA = { white: 0xd1b1a1, orange: 0x9f5224, magenta: 0x95576c, light_blue: 0x706c8a, yellow: 0xba8524, lime: 0x677535, pink: 0xa04d4e, gray: 0x392923, light_gray: 0x876b62, silver: 0x876b62, cyan: 0x575c5c, purple: 0x7a4958, blue: 0x4c3e5c, brown: 0x4c3223, green: 0x4c522a, red: 0x8e3c2e, black: 0x251610 };
const WOOD = { dark_oak: 0x3e2912, oak: 0x9c7a4a, spruce: 0x6b4f2d, birch: 0xd5c98a, jungle: 0xa87b52, acacia: 0xba6a3b, mangrove: 0x7a3a3a, cherry: 0xe3b5b0, bamboo: 0xc8b04a, crimson: 0x7a2a45, warped: 0x2a7a7a, pale_oak: 0xe3dcd6 };
const RA = [[/iron_chain|^chain$/, 0x4b4e5a], [/pale_oak_(leaves|sapling)/, 0x8f9c86], [/pale_(hanging_)?moss/, 0x93a384], [/leaf_litter/, 0x9a6b2e], [/^barrier$/, 0xd03030], [/^light(_block)?$/, 0xf8e8a0], [/structure_void/, 0xc0e0f0],
[/^grass$/, 0x6aa84f], [/^(flowering_)?azalea$/, 0x5a8a3a],
[/wither_rose/, 0x201818], [/poppy|red_flower|red_tulip/, 0xc02a2a], [/orange_tulip/, 0xe07020], [/white_tulip/, 0xe8e8e8], [/pink_tulip/, 0xe8a0c0], [/dandelion|yellow_flower/, 0xe8d020], [/azure_bluet|oxeye_daisy/, 0xe8e8e0], [/cornflower/, 0x4a6ac0], [/lily_of_the_valley/, 0xf0f0f0], [/allium/, 0xb070d0], [/blue_orchid/, 0x30a0d0], [/torchflower/, 0xe07030], [/sunflower/, 0xe8c820], [/lilac/, 0xc090d0], [/rose_bush/, 0xc02030], [/peony/, 0xe0a0c0], [/pink_petals/, 0xe8a0c8],
[/tallgrass|short_grass|^fern$|large_fern|double_plant|tall_grass|dry_grass/, 0x5a9a3a], [/sapling$/, 0x4a8a3a], [/dead_?bush/, 0x7a5a30], [/seagrass/, 0x2a8a3a], [/^kelp$/, 0x3a7a30], [/vine/, 0x3a7a30],
[/^red_mushroom$/, 0xc02020], [/^brown_mushroom$/, 0x8a6a4a], [/crimson_fungus/, 0xa03040], [/warped_fungus/, 0x30a090], [/crimson_roots/, 0x8a2a4a], [/warped_roots/, 0x2a7a6a], [/nether_sprouts/, 0x30a090], [/hanging_roots/, 0x8a6a4a],
[/soul_torch/, 0x40c8e0], [/redstone_torch/, 0xd02020], [/copper_torch/, 0x60e0a0], [/torch$/, 0xf0c040], [/soul_lantern/, 0x40a0c0], [/lantern$/, 0xe0a040], [/^candle(_cake)?$/, 0xe0d0b0],
[/^rail$/, 0x8a7a6a], [/powered_rail|golden_rail/, 0xc0a040], [/detector_rail/, 0x906060], [/activator_rail/, 0xa04040], [/^ladder$/, 0x8b6b3f],
[/light_weighted/, 0xf3d34a], [/heavy_weighted/, 0xcfd3d6], [/redstone_wire/, 0xb01010], [/^lever$/, 0x7a7a7a], [/tripwire_hook/, 0x8b6b3f], [/^tripwire$/, 0xe0e0e0], [/^(web|cobweb)$/, 0xe8e8e8],
[/soul_fire/, 0x3cc8e8], [/^fire$/, 0xe8651a], [/standing_sign|wall_sign|^sign$/, 0x9c7a4a], [/banner/, 0xe0e0e0],
[/^flower_pot$/, 0xa0552d], [/waterlily|lily_pad/, 0x2a7a2a], [/moss_carpet/, 0x5a8a3a],
[/sea_pickle/, 0x6a8a30], [/turtle_egg/, 0xe8e4d0], [/frog_spawn/, 0x3a4a2a], [/cake/, 0xf0e0d0], [/brewing_stand/, 0x808080], [/enchanting_table/, 0x7a1a24], [/end_portal_frame/, 0x4a6a5a], [/^end_portal$/, 0x0a0a20], [/^end_gateway$/, 0x101030], [/portal$/, 0x5a2ca0], [/ender_chest/, 0x1a2a30], [/^skull$/, 0xd8d4c8], [/scaffolding/, 0xc8a060],
[/glow_lichen/, 0x7a9a6a], [/dripleaf/, 0x5a9a3a], [/spore_blossom/, 0xe070b0], [/sweet_berry_bush/, 0x4a7a3a], [/cocoa/, 0x8a5a2a], [/^nether_wart$/, 0xa02020], [/sugar_cane|reeds/, 0x8ac060], [/^bamboo$/, 0x7aa030], [/^wheat$/, 0xa8b050], [/carrots|potatoes|beetroot/, 0x5a9a3a], [/(pumpkin|melon)_stem/, 0x6a9a40], [/pitcher/, 0x7a9ac0],
[/^bed$/, 0xa02020], [/campfire/, 0x7a5230], [/^end_rod$/, 0xf0e8f8], [/oxidized_lightning_rod/, 0x4fb89a], [/weathered_lightning_rod/, 0x6a9b78], [/exposed_lightning_rod/, 0xa08a6c], [/lightning_rod/, 0xc77b58], [/daylight_detector/, 0xb09a70], [/repeater|comparator/, 0x8a8a8a], [/^bell$/, 0xe8c840], [/conduit/, 0x8a7a60], [/heavy_core/, 0x6a6a70], [/item_frame|glow_frame/, 0x9c7a4a], [/anvil/, 0x404040],
[/dead_.*coral|coral_fan_dead|coral_block.*dead/, 0x7a7470], [/lava/, 0xe8650f], [/magma/, 0x8a3a1a], [/cherry_leaves/, 0xe8a8c8], [/leaves/, 0x3f8a30], [/packed_ice/, 0x7aa0e0], [/blue_ice/, 0x5a8ee0], [/ice$/, 0x8fb4ee], [/snow/, 0xf2f6f8],
[/coal_ore/, 0x555050], [/iron_ore/, 0xb59a85], [/copper_ore/, 0x8a7a60], [/gold_ore/, 0xcdbb55], [/redstone_ore/, 0xa04040], [/emerald_ore/, 0x5a9a70], [/lapis_ore/, 0x4a5fa0], [/diamond_ore/, 0x5ecfc4], [/quartz_ore/, 0xe0d8d0], [/ancient_debris/, 0x5c4033], [/ore/, 0x8a8f8a],
[/lit_redstone_lamp/, 0xf0c880], [/redstone_lamp/, 0x5a3a22], [/coal_block/, 0x111111], [/lapis_block/, 0x2a4fb0], [/redstone_block/, 0xb02020], [/emerald_block/, 0x3ec06b], [/diamond_block/, 0x4fd1c5], [/netherite/, 0x3a3538], [/amethyst/, 0x8a5fc8],
[/oxidized/, 0x4fb89a], [/weathered/, 0x6a9b78], [/exposed/, 0xa08a6c], [/copper/, 0xc77b58], [/gold/, 0xf3d34a], [/iron/, 0xcfd3d6],
[/red_sand/, 0xb5683a], [/soul_sand|soul_soil/, 0x5a4638], [/sand/, 0xdbcf9b], [/gravel/, 0x857f7b], [/hardened_clay/, 0x985e43], [/clay/, 0xa4a9b8], [/mycelium/, 0x6f6369], [/grass_block|moss_block/, 0x6aa84f],
[/mud/, 0x3c3836], [/dirt|podzol|farmland|path|rooted/, 0x8a6a4a],
[/crimson_nylium/, 0x8a2a4a], [/warped_nylium/, 0x2a7a6a], [/warped_wart/, 0x167e86], [/nether_wart_block/, 0x7a0a0a], [/shroomlight/, 0xf0a050], [/glowstone/, 0xe8b860], [/red_nether_brick/, 0x6b1f23], [/nether_brick/, 0x2c161a], [/netherrack/, 0x6e2f2f], [/sculk/, 0x0d2a30],
[/end_brick/, 0xdbe0a5], [/end_stone/, 0xdad8a0], [/purpur/, 0xa77ba7], [/chorus/, 0x5a3a5a], [/crying_obsidian/, 0x3a1060], [/obsidian/, 0x1a1224], [/bedrock/, 0x333333], [/quartz/, 0xe8e4dc],
[/dark_prismarine/, 0x345c4c], [/prismarine_brick/, 0x63ab9e], [/sea_lantern/, 0xcfe8e0], [/prismarine/, 0x5ba08a],
[/hay/, 0xc9a020], [/petrified_oak/, 0x9c7a4a], [/^fence(_gate)?$/, 0x9c7a4a], [/dried_kelp/, 0x353b2b], [/melon/, 0x6aa020], [/pumpkin/, 0xc87010], [/tnt/, 0xc03030], [/sponge/, 0xc8c050], [/slime/, 0x70c060], [/honey/, 0xe8a030], [/bone/, 0xe0dcc8], [/cactus/, 0x2a7a2a],
[/tube_coral/, 0x3050c8], [/brain_coral/, 0xc85090], [/bubble_coral/, 0xa020a0], [/fire_coral/, 0xc03030], [/horn_coral/, 0xc8b030]];

const RB = [[/tinted_glass/, 0x2c242f], [/glass/, 0xb8e0e8], [/deepslate/, 0x4a4a52], [/blackstone/, 0x2c262d], [/basalt/, 0x4a4a4e], [/tuff/, 0x6b6e60], [/calcite/, 0xe0e0da], [/dripstone/, 0x866a56], [/granite/, 0x9a6b57], [/diorite/, 0xc8c8c4], [/andesite/, 0x888888], [/mossy/, 0x6a7a5a], [/cobble/, 0x6f6f6f], [/stone_brick/, 0x7a7a7a], [/brick/, 0xa0554a], [/terracotta/, 0xa8603e], [/stone|smooth|slab/, 0x7d7d7d],
[/furnace|dispenser|dropper|observer|piston|hopper|cauldron|anvil|bars|chain/, 0x666666], [/planks|log|wood|table|bookshelf|barrel|chest|door|lectern|loom|composter|jukebox|note/, 0x8b6b3f], [/lamp/, 0x8a5a30]];

function hsl(h, s, l) { const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return (f(0) * 255 | 0) << 16 | (f(8) * 255 | 0) << 8 | (f(4) * 255 | 0); }
function hash(s) { let h = 7; for (let i = 0; i < s.length; i++) h = Math.imul(h, 31) + s.charCodeAt(i) | 0; return h >>> 0; }
function nm(o) {
  let n = (o.name || o.Name || 'air').replace('minecraft:', '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(); const s = o.states || {}, wt = s.wood_type, c = s.color;
  if (typeof wt == 'string' && /^(planks|fence|wooden_slab|double_wooden_slab)$/.test(n)) return wt + (n == 'planks' ? '_planks' : n == 'fence' ? '_fence' : n == 'double_wooden_slab' ? '_double_slab' : '_slab');
  if (typeof c == 'string') { if (n == 'stained_hardened_clay') return c + '_terracotta'; if (/^(wool|concrete|concrete_powder|stained_glass|stained_glass_pane|carpet|shulker_box)$/.test(n)) return c + '_' + n; }
  if (n == 'coral_block') { const k = { blue: 'tube', pink: 'brain', purple: 'bubble', red: 'fire', yellow: 'horn' }[s.coral_color]; if (k) return (s.dead_bit ? 'dead_' : '') + k + '_coral_block'; }
  if (n == 'stone_stairs') return 'cobblestone_stairs';
  return n;
}

const BOXES = [], BM = new Map();
function bx(a, b, c, d, e, f) { const k = a + ',' + b + ',' + c + ',' + d + ',' + e + ',' + f, i = BM.get(k); if (i !== undefined) return i; BM.set(k, BOXES.length); BOXES.push([a / 16, b / 16, c / 16, d / 16, e / 16, f / 16]); return BOXES.length - 1; }
bx(0, 0, 0, 16, 16, 16);
function rotb(b, k) { let [x0, y0, z0, x1, y1, z1] = b; for (let i = 0; i < k; i++)[x0, z0, x1, z1] = [16 - z1, x0, 16 - z0, x1]; return bx(x0, y0, z0, x1, y1, z1); }

const TD = [[0, 0, 0, 3, 16, 16], [13, 0, 0, 16, 16, 16], [0, 0, 0, 16, 16, 3], [0, 0, 13, 16, 16, 16]];
const DL = [[0, 0, 13, 16, 16, 16], [0, 0, 0, 3, 16, 16], [0, 0, 0, 16, 16, 3], [13, 0, 0, 16, 16, 16]], DRr = [[0, 0, 0, 16, 16, 3], [13, 0, 0, 16, 16, 16], [0, 0, 13, 16, 16, 16], [0, 0, 0, 3, 16, 16]], DC = [[0, 0, 0, 3, 16, 16], [0, 0, 0, 16, 16, 3], [13, 0, 0, 16, 16, 16], [0, 0, 13, 16, 16, 16]];
const LD = [[0, 0, 14, 16, 16, 16], [0, 0, 0, 16, 16, 2], [14, 0, 0, 16, 16, 16], [0, 0, 0, 2, 16, 16]];
const VN = [[0, 0, 14, 16, 16, 16], [0, 0, 0, 2, 16, 16], [0, 0, 0, 16, 16, 2], [14, 0, 0, 16, 16, 16]];
const LN = [[0, 0, 0, 16, 2, 16], [0, 14, 0, 16, 16, 16], [0, 0, 0, 16, 16, 2], [0, 0, 14, 16, 16, 16], [0, 0, 0, 2, 16, 16], [14, 0, 0, 16, 16, 16]];
const bitsS = (v, t) => { const l = t.filter((_, i) => v >> i & 1); return (l.length ? l : [t[0]]).map(b => bx(...b)); };
const FA = [[7, 6, 0, 9, 9, 6], [7, 12, 0, 9, 15, 6], [7, 6, 10, 9, 9, 16], [7, 12, 10, 9, 15, 16], [0, 6, 7, 6, 9, 9], [0, 12, 7, 6, 15, 9], [10, 6, 7, 16, 9, 9], [10, 12, 7, 16, 15, 9]], PA = [[7, 0, 0, 9, 16, 7], [7, 0, 9, 9, 16, 16], [0, 0, 7, 7, 16, 9], [9, 0, 7, 16, 16, 9]];
const WA = [[[5, 0, 0, 11, 14, 8], [5, 0, 0, 11, 16, 8]], [[5, 0, 8, 11, 14, 16], [5, 0, 8, 11, 16, 16]], [[0, 0, 5, 8, 14, 11], [0, 0, 5, 8, 16, 11]], [[8, 0, 5, 16, 14, 11], [8, 0, 5, 16, 16, 11]]];
const FACE_OFFSETS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const DX = [0, 0, -1, 1], DZ = [-1, 1, 0, 0], CS = { 1: [], 2: [] }, FQ = [5, 4, 1, 0], CK = [];
for (let m = 0; m < 16; m++) {
  const f = [bx(6, 0, 6, 10, 16, 10)], p = [bx(7, 0, 7, 9, 16, 9)];
  for (let q = 0; q < 4; q++) if (m >> q & 1) { f.push(bx(...FA[q * 2]), bx(...FA[q * 2 + 1])); p.push(bx(...PA[q])); }
  CS[1][m] = f; CS[2][m] = p; const km = [0]; let pm = 0;
  for (let q = 0; q < 4; q++) if (m >> q & 1) { pm |= 1 << FQ[q]; km.push(1 << FQ[q] | 1 << (FQ[q] ^ 1)); }
  km[0] = pm; CK[m] = km;
}
for (const a of WA) for (const b of a) bx(...b); bx(4, 0, 4, 12, 16, 12);
function cn(t, n) { if (n <= 0) return false; const k = kind[n], c = cfa[n]; return c == 5 || (t == 1 ? k == 1 || c == 1 || c == 3 : k == 1 || k == 3 || c == 2); }
const VX = [1, -1, 0, 0], VZ = [0, 0, 1, -1];
const qd = (xh, zh, u) => bx(xh ? 8 : 0, u ? 0 : 8, zh ? 8 : 0, xh ? 16 : 8, u ? 8 : 16, zh ? 16 : 8), STAIR = [];
for (let d = 0; d < 4; d++) {
  STAIR[d] = []; for (let u = 0; u < 2; u++) {
    const base = bx(0, u ? 8 : 0, 0, 16, u ? 16 : 8, 16), half = rotb([8, u ? 0 : 8, 0, 16, u ? 8 : 16, 16], [0, 2, 1, 3][d]), L = [[base, half], {}, {}];
    for (let e = 0; e < 4; e++) {
      if ((e >> 1) == (d >> 1)) continue; const xa = d < 2 ? d : e, za = d < 2 ? e : d;
      L[1][e] = [base, qd(xa == 0 ? 1 : 0, za == 2 ? 1 : 0, u)];
      L[2][e] = [base, half, qd(d < 2 ? (d == 0 ? 0 : 1) : (e == 0 ? 1 : 0), d < 2 ? (e == 2 ? 1 : 0) : (d == 2 ? 0 : 1), u)];
    }
    STAIR[d][u] = L;
  }
}
function stS(nbr, x, y, zz, sv) {
  const d = sv.d, u = sv.u, ok = (o, dir) => { if (!(o && o.u == u && (o.d >> 1) != (d >> 1))) return 0; const m = nbr(x, y, zz, VX[dir], VZ[dir]), p = m > 0 ? sti[m] : 0; return !(p && p.d == d && p.u == u); };
  let n = nbr(x, y, zz, VX[d], VZ[d]), o = n > 0 ? sti[n] : 0;
  if (o && ok(o, o.d ^ 1)) return STAIR[d][u][1][o.d];
  n = nbr(x, y, zz, VX[d ^ 1], VZ[d ^ 1]); o = n > 0 ? sti[n] : 0;
  if (o && ok(o, o.d)) return STAIR[d][u][2][o.d];
  return STAIR[d][u][0];
}
const ROD = [[6, 0, 6, 10, 16, 10], [6, 6, 0, 10, 10, 16], [0, 6, 6, 16, 10, 10]], TOR = { west: [2, 3, 7, 5, 13, 9], east: [11, 3, 7, 14, 13, 9], north: [7, 3, 2, 9, 13, 5], south: [7, 3, 11, 9, 13, 14] };
for (const b of ROD) bx(...b); for (const k in TOR) bx(...TOR[k]);
const tdBox = (d, o, u) => bx(...(o ? TD[d & 3] : [0, u ? 13 : 0, 0, 16, u ? 16 : 3, 16]));
const doorBox = (d, o, h) => bx(...(o ? (h ? DRr : DL) : DC)[d & 3]);
function gateS(d, o, w) { const y = w ? 13 : 16, z = d & 1; return o ? (z ? [bx(6, 0, 0, 10, y, 2), bx(6, 0, 14, 10, y, 16)] : [bx(0, 0, 6, 2, y, 10), bx(14, 0, 6, 16, y, 10)]) : [z ? bx(6, 0, 0, 10, y, 16) : bx(0, 0, 6, 16, y, 10)]; }
const SH = [
  [/^(barrier|light_block|light|structure_void)$/, [[5, 5, 5, 11, 11, 11]]],
  [/cake$/, [[1, 0, 1, 15, 8, 15]]], [/candle$/, [[6, 0, 6, 10, 6, 10]]], [/carpet$/, [[0, 0, 0, 16, 1, 16]]], [/pressure_plate$/, [[1, 0, 1, 15, 1, 15]]], [/rail$/, [[0, 0, 0, 16, 2, 16]]],
  [/redstone_wire$|^tripwire$|waterlily|lily_pad|frog_spawn|leaf_litter/, [[0, 0, 0, 16, 1, 16]]], [/repeater|comparator/, [[0, 0, 0, 16, 2, 16]]],
  [/pink_petals/, [[0, 0, 0, 16, 3, 16]]], [/trapdoor$/, [[0, 0, 0, 16, 3, 16]]], [/fence_gate$/, [[0, 0, 6, 16, 16, 10]]], [/fence$/, [[6, 0, 6, 10, 16, 10]]],
  [/_door$|^wooden_door$/, [[0, 0, 0, 16, 16, 3]]], [/_wall$/, [[4, 0, 4, 12, 16, 12]]], [/glass_pane$|_bars$/, [[7, 0, 7, 9, 16, 9]]],
  [/torch$/, [[7, 0, 7, 9, 10, 9]]], [/lantern$/, [[5, 0, 5, 11, 8, 11]]], [/campfire$/, [[0, 0, 0, 16, 7, 16]]], [/^end_rod$|lightning_rod$/, [[6, 0, 6, 10, 16, 10]]],
  [/^web$|^cobweb$/, [[1, 1, 1, 15, 15, 15]]], [/^(vine|ladder)$|glow_lichen|sculk_vein/, [[0, 0, 14, 16, 16, 16]]],
  [/sign$/, [[2, 4, 7, 14, 14, 9]]], [/banner$/, [[3, 0, 7, 13, 16, 9]]], [/button$/, [[5, 0, 5, 11, 3, 11]]], [/^lever$/, [[5, 0, 5, 11, 10, 11]]], [/tripwire_hook/, [[6, 0, 6, 10, 10, 10]]],
  [/daylight_detector/, [[0, 0, 0, 16, 6, 16]]], [/sea_pickle/, [[5, 0, 5, 11, 6, 11]]], [/turtle_egg/, [[3, 0, 3, 12, 7, 12]]], [/flower_pot$/, [[5, 0, 5, 11, 6, 11]]],
  [/brewing_stand/, [[6, 0, 6, 10, 14, 10]]], [/enchanting_table/, [[0, 0, 0, 16, 12, 16]]], [/end_portal_frame/, [[0, 0, 0, 16, 13, 16]]], [/^end_portal$/, [[0, 0, 0, 16, 12, 16]]], [/portal$/, [[0, 0, 6, 16, 16, 10]]],
  [/^(trapped_|ender_)?chest$/, [[1, 0, 1, 15, 14, 15]]], [/bed$/, [[0, 3, 0, 16, 9, 16]]], [/^skull$/, [[4, 0, 4, 12, 8, 12]]], [/^anvil$|chipped_anvil|damaged_anvil/, [[3, 0, 3, 13, 16, 13]]],
  [/conduit/, [[5, 5, 5, 11, 11, 11]]], [/^bell$/, [[4, 4, 4, 12, 16, 12]]], [/item_frame|glow_frame/, [[3, 3, 14, 13, 13, 16]]], [/^(dirt_path|grass_path|farmland)$/, [[0, 0, 0, 16, 15, 16]]], [/stonecutter/, [[0, 0, 0, 16, 9, 16]]],
  [/pointed_dripstone/, [[4, 0, 4, 12, 16, 12]]], [/amethyst_cluster|amethyst_bud/, [[4, 0, 4, 12, 12, 12]]], [/big_dripleaf/, [[0, 12, 0, 16, 16, 16]]], [/small_dripleaf/, [[3, 0, 3, 13, 16, 13]]],
  [/spore_blossom/, [[2, 13, 2, 14, 16, 14]]], [/hanging_roots/, [[4, 6, 4, 12, 16, 12]]], [/cocoa/, [[5, 3, 5, 11, 12, 11]]], [/heavy_core/, [[4, 0, 4, 12, 8, 12]]],
  [/^(soul_)?fire$/, [[2, 0, 2, 14, 14, 14]]], [/piston_arm_collision/, [[6, 0, 6, 10, 16, 10]]],
  [/^(wheat|carrots|potatoes|beetroots?|nether_wart)$|^(pumpkin|melon)_stem$|attached_.*_stem/, [[2, 0, 2, 14, 10, 14]]],
  [/^bamboo$|vines/, [[3, 0, 3, 13, 16, 13]]]
];
for (const [, l] of SH) for (const b of l) bx(...b);

const CR = [[/^(double_plant|tall_grass|large_fern|sunflower|lilac|rose_bush|peony|tall_seagrass|sugar_cane|reeds|kelp|pitcher_plant|pitcher_crop|sweet_berry_bush|torchflower_crop|tall_dry_grass)$/, [[1, 0, 1, 15, 16, 15]]],
[/^(poppy|dandelion|[a-z]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|wither_rose|torchflower|open_eyeblossom|closed_eyeblossom|red_flower|yellow_flower|wildflowers)$/, [[4, 0, 4, 12, 8, 12]]],
[/^(red|brown)_mushroom$|^(crimson|warped)_fungus$/, [[5, 0, 5, 11, 6, 11]]],
[/^(deadbush|dead_bush|fern|short_grass|tallgrass|seagrass|nether_sprouts|short_dry_grass|bush|firefly_bush)$|sapling$|^(crimson|warped)_roots$/, [[1, 0, 1, 15, 12, 15]]]];
for (const [, l] of CR) for (const b of l) bx(...b);

const CH = { y: [6.5, 0, 6.5, 9.5, 16, 9.5], x: [0, 6.5, 6.5, 16, 9.5, 9.5], z: [6.5, 6.5, 0, 9.5, 9.5, 16] };
for (const k in CH) bx(...CH[k]);
let XC = 0, RT = 0;
const WB = [[3, 0, 14, 13, 16, 16], [3, 0, 0, 13, 16, 2], [14, 0, 3, 16, 16, 13], [0, 0, 3, 2, 16, 13]];
for (const b of WB) bx(...b);
for (let t = 0; t < 2; t++) bx(0, t ? 8 : 0, 0, 16, t ? 16 : 8, 16);
for (let u = 0; u < 2; u++) for (let k = 0; k < 4; k++) { bx(0, u ? 8 : 0, 0, 16, u ? 16 : 8, 16); rotb([8, u ? 0 : 8, 0, 16, u ? 8 : 16, 16], k); }
for (let h = 1; h <= 8; h++) bx(0, 0, 0, 16, h * 2, 16);
const WTOP = bx(0, 0, 0, 16, 14, 16);
for (let v = 0; v < 64; v++) { bitsS(v & 15, VN); bitsS(v, LN); }
for (let d = 0; d < 4; d++) { for (let o = 0; o < 2; o++) { tdBox(d, o, 0); tdBox(d, o, 1); for (let h = 0; h < 2; h++) { doorBox(d, o, h); gateS(d, o, h); } } bx(...LD[d]); }

function shape(n, st) {
  XC = 0; RT = 0; const m = n.replace(/^waxed_/, '');
  if (/slab$/.test(m) && !/double/.test(m)) {
    const top = (st['minecraft:vertical_half'] || st.vertical_half) === 'top' || st.top_slot_bit === 1;
    return [bx(0, top ? 8 : 0, 0, 16, top ? 16 : 8, 16)];
  }
  if (/stairs$/.test(m)) { const d = +st.weirdo_direction || 0, u = st.upside_down_bit == 1; return [bx(0, u ? 8 : 0, 0, 16, u ? 16 : 8, 16), rotb([8, u ? 0 : 8, 0, 16, u ? 8 : 16, 16], [0, 2, 1, 3][d & 3])]; }
  if (/trapdoor$/.test(m)) return [tdBox(st.direction | 0, st.open_bit | 0, st.upside_down_bit | 0)];
  if (/fence_gate$/.test(m)) return gateS(st.direction | 0, st.open_bit | 0, st.in_wall_bit | 0);
  if (m == 'ladder') { const f = st.facing_direction | 0; return [bx(...LD[f >= 2 && f <= 5 ? f - 2 : 0])]; }
  if (/_wall$/.test(m)) { const o = [];[st.wall_connection_type_north, st.wall_connection_type_south, st.wall_connection_type_west, st.wall_connection_type_east].forEach((v, i) => { const h = v == 'tall' ? 2 : v == 'short' ? 1 : 0; if (h) o.push(bx(...WA[i][h - 1])); }); if (st.wall_post_bit != 0 || !o.length) o.push(bx(4, 0, 4, 12, 16, 12)); return o; }
  if (/^end_rod$|lightning_rod$/.test(m)) return [bx(...ROD[(st.facing_direction | 0) >> 1])];
  if (/torch$/.test(m) && TOR[st.torch_facing_direction]) return [bx(...TOR[st.torch_facing_direction])];
  if (m == 'standing_banner') { RT = (st.ground_sign_direction | 0) & 15; return [bx(3, 0, 7, 13, 16, 9)]; }
  if (m == 'wall_banner') { const f = st.facing_direction | 0; return [bx(...WB[f >= 2 && f <= 5 ? f - 2 : 0])]; }
  if (/(^|_)chain$/.test(m)) return [bx(...(CH[st.pillar_axis || st['minecraft:pillar_axis']] || CH.y))];
  if (m == 'vine') return bitsS(st.vine_direction_bits | 0, VN);
  if (m == 'glow_lichen' || m == 'sculk_vein') return bitsS(st.multi_face_direction_bits | 0, LN);
  if (/(^|_)door$/.test(m)) return [doorBox(st.direction | 0, st.open_bit | 0, st.door_hinge_bit | 0)];
  if (m == 'snow_layer') return [bx(0, 0, 0, 16, Math.min(16, ((st.height | 0) + 1) * 2), 16)];
  for (const [r, l] of SH) if (r.test(m)) return l.map(b => bx(...b));
  for (const [r, l] of CR) if (r.test(m)) { XC = 1; return l.map(b => bx(...b)); }
  return null;
}

function vk(st, n) {
  const isTop = ((st['minecraft:vertical_half'] || st.vertical_half) === 'top' || st.top_slot_bit === 1) ? 1 : 0;
  return (/door|gate|ladder|vine|lichen|wall|rod|torch/.test(n) ? st.torch_facing_direction + ',' : '') +
         (/door|gate|ladder|vine|lichen|wall|rod|torch/.test(n) ? st.wall_post_bit + st.wall_connection_type_north + st.wall_connection_type_east + st.wall_connection_type_south + st.wall_connection_type_west + ',' + st.vine_direction_bits + ',' + st.multi_face_direction_bits + ',' + st.direction + ',' + st.open_bit + ',' + st.door_hinge_bit + ',' + st.upper_block_bit + ',' + st.in_wall_bit + ',' + st.facing_direction + ',' : '') +
         (st.weirdo_direction | 0) + ',' + (st.upside_down_bit | 0) + ',' + isTop + ',' + (st.height | 0) +
         (/chain/.test(n) ? ',' + (st.pillar_axis || st['minecraft:pillar_axis'] || '') : '') +
         (/banner/.test(n) ? ',g' + ((st.ground_sign_direction | 0) & 15) : '');
}

const ids = new Map(), col = [], kind = [], shp = [], dinf = [], cfa = [], tr = [], sti = [], crs = [], rts = [], wl = [], wlOf = new Map();
function gid(n, st) {
  st = st || {}; n = n.replace('minecraft:', ''); const ck = n + '|' + vk(st, n); let i = ids.get(ck); if (i !== undefined) return i;
  i = col.length;
  let k = 1, c = 0, bs = null, di = 0, cf = 0, sv = 0, xc = 0, rt = 0;
  if (/^(cave_|void_)?air$/.test(n)) k = 0; else if (/^(flowing_)?water$|bubble_column/.test(n)) { k = 2; c = 0x3f76e4; } else {
    if (/glass|ice$/.test(n)) k = 3;
    const m = n.replace(/^waxed_/, '').replace(/_(stairs|slab|double_slab|wall|fence_gate|fence|trapdoor|door)$/, ''); let f = 0;
    const tm = m.match(/^(light_blue|light_gray|white|orange|magenta|yellow|lime|pink|gray|silver|cyan|purple|blue|brown|green|red|black)_terracotta$/); if (tm) { c = TERRA[tm[1]]; f = 1; }
    if (!f) for (const [r, h] of RA) if (r.test(m)) { c = h; f = 1; break; }
    if (!f) { const d = m.match(/^(light_blue|light_gray|white|orange|magenta|yellow|lime|pink|gray|silver|cyan|purple|blue|brown|green|red|black)_/); if (d) { c = DYE[d[1]]; f = 1; } }
    if (!f) { const w = m.match(/^(?:stripped_)?(dark_oak|oak|spruce|birch|jungle|acacia|mangrove|cherry|bamboo|crimson|warped|pale_oak)(?:_|$)/); if (w) { c = WOOD[w[1]]; f = 1; } }
    if (!f) for (const [r, h] of RB) if (r.test(m)) { c = h; f = 1; break; }
    if (!f) c = hsl(hash(m) % 360, .42, .5);
    bs = shape(n, st); if (bs) { k = 4; xc = XC; rt = RT; if (/stairs$/.test(n)) sv = { d: (st.weirdo_direction | 0) & 3, u: st.upside_down_bit | 0 }; cf = /fence$/.test(n) ? 1 : /(glass_pane|_bars)$/.test(n) ? 2 : /fence_gate$/.test(n) ? 3 : /^structure_void$/.test(n) ? 5 : 0; if (/(^|_)door$/.test(n)) di = { u: st.upper_block_bit | 0, d: st.direction | 0, o: st.open_bit | 0, h: st.door_hinge_bit | 0 }; }
  }
  col.push(c); crs.push(xc); rts.push(rt); kind.push(k); shp.push(bs); dinf.push(di); sti.push(sv); cfa.push(cf); tr.push((k == 2 || /glass/.test(n) || /^(frosted_)?ice$/.test(n)) ? 1 : 0); wl.push(0); ids.set(ck, i); return i;
}
gid('minecraft:air');

function wlId(a) {
  let i = wlOf.get(a); if (i !== undefined) return i; i = col.length; wlOf.set(a, i);
  col.push(col[a]); crs.push(crs[a]); rts.push(rts[a]); kind.push(kind[a]); shp.push(shp[a]); dinf.push(dinf[a]); sti.push(sti[a]); cfa.push(cfa[a]); tr.push(tr[a]); wl.push(1); return i;
}

function skipPl(d, t, r, dv) {
  switch (t) {
    case 1: r.p += 1; break; case 2: r.p += 2; break; case 3: case 5: r.p += 4; break; case 4: case 6: r.p += 8; break;
    case 7: r.p += dv.getInt32(r.p, true) + 4; break; case 8: r.p += 2 + dv.getUint16(r.p, true); break;
    case 9: { const c = d[r.p++], n = dv.getInt32(r.p, true); r.p += 4; for (let i = 0; i < n; i++) skipPl(d, c, r, dv); break; }
    case 10: { for (let tt; (tt = d[r.p++]);) { r.p += 2 + dv.getUint16(r.p, true); skipPl(d, tt, r, dv); } break; }
    case 11: r.p += 4 + 4 * dv.getInt32(r.p, true); break; case 12: r.p += 4 + 8 * dv.getInt32(r.p, true); break;
  }
}

const PM = new Map();
function palId(d, r, dv) {
  const st = r.p; r.p++; r.p += 2 + dv.getUint16(r.p, true); skipPl(d, 10, r, dv); const en = r.p, len = en - st;
  let h = 2166136261; for (let i = st; i < en; i++) h = Math.imul(h ^ d[i], 16777619); h >>>= 0;
  let a = PM.get(h); if (a) for (const e of a) { if (e.b.length == len) { let ok = 1; for (let i = 0; i < len; i++) if (e.b[i] !== d[st + i]) { ok = 0; break; } if (ok) return e.id; } }
  r.p = st; const o = nbt(d, r), id = gid(nm(o), o.states); r.p = en;
  if (!a) PM.set(h, a = []); a.push({ b: d.slice(st, en), id }); return id;
}

function sub(d) {
  let p = 0; const ver = d[p++]; if (ver != 1 && ver != 8 && ver != 9) return null;
  const n = ver == 1 ? 1 : d[p++]; if (ver == 9) p++; const dw = new DataView(d.buffer, d.byteOffset, d.length), L = [];
  for (let l = 0; l < n; l++) {
    const bits = d[p++] >> 1, r = { p }; let idx = null, pal = [];
    if (bits) {
      const per = 32 / bits | 0, m = (1 << bits) - 1; idx = new Uint16Array(4096);
      for (let i = 0, w = p; i < 4096; w += 4) { const x = dw.getUint32(w, true); for (let k = 0; k < per && i < 4096; k++, i++) idx[i] = x >>> (k * bits) & m; }
      p += Math.ceil(4096 / per) * 4; const c = dw.getInt32(p, true); r.p = p + 4;
      for (let i = 0; i < c; i++) pal.push(palId(d, r, dw));
    } else pal = [palId(d, r, dw)];
    p = r.p; L.push({ idx, pal });
  }
  const o = new Uint16Array(4096); let any = 0;
  const L0 = L[0], P0 = L0.pal, I0 = L0.idx, L1 = L[1], P1 = L1 && L1.pal, I1 = L1 && L1.idx;
  for (let i = 0; i < 4096; i++) {
    let a = P0[I0 ? I0[i] : 0];
    if (L1) { const b = P1[I1 ? I1[i] : 0]; if (!kind[a]) { if (kind[b]) a = b; } else if (kind[b] == 2 && kind[a] > 2) a = wlId(a); }
    if (kind[a]) { o[i] = a; any = 1; } else o[i] = 0;
  }
  return any ? o : null;
}

/* ---------- State & UI ---------- */
const MOB = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || '')));
const LIM = MOB ? { fc: 9e7, bc: 3e7, raw: 15000, S: 5000, mc: 1.1, mcn: 150000, wk: 4, win: 1500 } : { fc: 3e8, bc: 1.5e8, raw: 40000, S: 14000, mc: 1.5, mcn: 400000, wk: 8, win: 900 };
const ckey = (x, z) => (x + 2097152) * 4194304 + (z + 2097152), unckey = c => { const zz = c % 4194304; return [(c - zz) / 4194304 - 2097152, zz - 2097152]; }, CLC = new Map();
let W = null, btok = 0, bc = [0, 0, 0];
let renderDistance = 12; // 0 = unlimited, otherwise chunks
const key = (x, y, z) => ((x + 2097152) * 4194304 + (z + 2097152)) * 64 + y + 16;

const msg = text => {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = text || '';
  const loadingText = document.getElementById('loadingText');
  if (loadingText) loadingText.textContent = text || '';
};

const showLoading = show => {
  const loading = document.getElementById('loading');
  if (loading) loading.classList.toggle('hidden', !show);
  const emptyState = document.getElementById('emptyState');
  if (emptyState && show) emptyState.classList.add('hidden');
};

function getS(x, y, z) {
  const k = key(x, y, z); let s = W.S.get(k); if (s !== undefined) return s;
  const o = W.M.get(k); if (!o || !o.t) return 0; if (!o.v) return 0;
  try { s = sub(o.v) || 0; } catch (e) { s = 0; } W.S.set(k, s); return s;
}

async function getFile(fi) {
  let d = W.fc.get(fi); if (d) { W.fc.delete(fi); W.fc.set(fi, d); return d; }
  d = await W.z.get(W.fl[fi]); W.fc.set(fi, d); W.fcb += d.length;
  while (W.fcb > LIM.fc && W.fc.size > 1) { const k = W.fc.keys().next().value; W.fcb -= W.fc.get(k).length; W.fc.delete(k); } return d;
}

async function getBlk(fi, bo, bs) {
  const bk = fi + ':' + bo; let d = W.bc.get(bk); if (d) { W.bc.delete(bk); W.bc.set(bk, d); return d; }
  const e = W.fl[fi];
  if (!e.meth) { const ds = await W.z.ds(e); d = blk(new Uint8Array(await W.z.file.slice(ds + bo, ds + bo + bs + 5).arrayBuffer()), 0, bs); }
  else d = blk(await getFile(fi), bo, bs);
  W.bc.set(bk, d); W.bcb += d.length; while (W.bcb > LIM.bc && W.bc.size > 1) { const k = W.bc.keys().next().value; W.bcb -= W.bc.get(k).length; W.bc.delete(k); } return d;
}

async function fetchRaw(need, tok) {
  const byF = new Map(); for (const o of need) { let a = byF.get(o.fi); if (!a) byF.set(o.fi, a = []); a.push(o); }
  for (const [fi, a] of byF) {
    a.sort((p, q) => p.bo - q.bo); let lb = -1, d = null;
    for (const o of a) { if (o.bo !== lb) { d = await getBlk(fi, o.bo, o.bs); lb = o.bo; } o.v = d.slice(o.eo, o.eo + o.vl); W.raw++; }
    await tick(); if (tok != btok) return false;
  }
  return true;
}

async function colNeed(cx, cz) {
  const need = []; for (let sy = W.y0; sy <= W.y1; sy++) { const o = W.M.get(key(cx, sy, cz)); if (o && o.t && !o.v && o.r) need.push(o); }
  if (need.length) await fetchRaw(need, btok);
}

function topOf(cx, cz, px, pz) {
  for (let sy = W.y1; sy >= W.y0; sy--) {
    const b = getS(cx, sy, cz); if (!b) continue;
    for (let yy = 15; yy >= 0; yy--) if (b[px * 256 + pz * 16 + yy]) return sy * 16 + yy;
  }
  return null;
}

function getB(x, y, z) {
  const s = getS(x >> 4, y >> 4, z >> 4);
  if (s) return s[(x & 15) * 256 + (z & 15) * 16 + (y & 15)];
  return W.cols.has(ckey(x >> 4, z >> 4)) ? 0 : -1;
}

const mkO = () => { const o = { n: 0, buf: new ArrayBuffer(12 * 2048) }; o.v = () => { o.i16 = new Int16Array(o.buf); o.bu = new Uint8Array(o.buf); }; o.v(); return o; };
const OPs = [0, 1, 2, 3, 4, 5, 6].map(mkO), TRs = [0, 1, 2, 3, 4, 5, 6].map(mkO);

function emit(Og, wx, wy, wz, c, f, sid, rt) {
  const O = Og[(rt | 0) > 0 || f >= 6 ? 6 : f];
  if ((O.n + 1) * 12 > O.buf.byteLength) { const nb = new ArrayBuffer(O.buf.byteLength * 2); new Uint8Array(nb).set(O.bu); O.buf = nb; O.v(); }
  const q = O.n * 6, i16 = O.i16, bu = O.bu; i16[q] = wx; i16[q + 1] = wy; i16[q + 2] = wz; i16[q + 3] = f | ((wx * 7 + wy * 13 + wz * 5) & 7) << 3 | (rt | 0) << 6;
  bu[O.n * 12 + 8] = c >> 16; bu[O.n * 12 + 9] = c >> 8 & 255; bu[O.n * 12 + 10] = c & 255; bu[O.n * 12 + 11] = sid; O.n++;
}

const EMPTY = { no: 0, nt: 0 };
let MID = 0;
function fin(G) {
  let tot = 0; for (const g of G) tot += g.n; if (!tot) return null;
  const buf = new ArrayBuffer(tot * 12), u8 = new Uint8Array(buf), cnt = []; let off = 0;
  for (const g of G) { cnt.push(g.n); if (g.n) { u8.set(g.bu.subarray(0, g.n * 12), off); off += g.n * 12; } }
  return { buf, cnt, n: tot };
}

function meshSub(scx, sy, scz, b) {
  const { ox, oz } = W; for (let g = 0; g < 7; g++) { OPs[g].n = 0; TRs[g].n = 0; }
  const nbr = (x, y, zz, dx, dz) => { const nx = x + dx, nz = zz + dz; return nx >= 0 && nx < 16 && nz >= 0 && nz < 16 ? b[nx * 256 + nz * 16 + y] : getB(scx * 16 + nx, sy * 16 + y, scz * 16 + nz); };
  for (let i = 0; i < 4096; i++) {
    const a = b[i]; if (!a) continue; const x = i >> 8, zz = i >> 4 & 15, y = i & 15, ka = kind[a];
    const wx = scx * 16 + x - ox, wy = sy * 16 + y, wz = scz * 16 + zz - oz, c = col[a], O = tr[a] ? TRs : OPs;
    if (wl[a]) { const ny = y + 1; let n; if (ny < 16) n = b[x * 256 + zz * 16 + ny]; else n = getB(scx * 16 + x, sy * 16 + ny, scz * 16 + zz); if (n >= 0 && !(n > 0 && (kind[n] == 1 || kind[n] == 2 || wl[n]))) emit(TRs, wx, wy, wz, 0x3f76e4, 2, WTOP); }
    if (ka == 4) {
      if (crs[a]) { const S = shp[a]; for (let si = 0; si < S.length; si++) { emit(O, wx, wy, wz, c, 6, S[si]); emit(O, wx, wy, wz, c, 7, S[si]); } continue; }
      let S = shp[a], SK = 0; const di = dinf[a], sv = sti[a];
      if (di) { const py = di.u ? y - 1 : y + 1, pa = py >= 0 && py < 16 ? b[x * 256 + zz * 16 + py] : getB(scx * 16 + x, sy * 16 + py, scz * 16 + zz), pd = pa > 0 ? dinf[pa] : 0, lo = (di.u ? pd : di) || di, up = (di.u ? di : pd) || di; S = [doorBox(lo.d, lo.o, up.h)]; }
      else if (sv) S = stS(nbr, x, y, zz, sv);
      else { const ct = cfa[a]; if (ct && ct < 3) { let mk = 0; for (let q = 0; q < 4; q++) if (cn(ct, nbr(x, y, zz, DX[q], DZ[q]))) mk |= 1 << q; S = CS[ct][mk]; if (ct == 2) SK = CK[mk]; } }
      for (let si = 0; si < S.length; si++) {
        const sid = S[si], B = BOXES[sid], msk = SK ? SK[si] : 0;
        for (let f = 0; f < 6; f++) {
          const ax = f >> 1; if (msk >> f & 1) continue;
          if (f & 1 ? B[ax] == 0 : B[3 + ax] == 1) {
            const d = FACE_OFFSETS[f], nx = x + d[0], ny = y + d[1], nz = zz + d[2]; let n;
            if (nx >= 0 && nx < 16 && ny >= 0 && ny < 16 && nz >= 0 && nz < 16) n = b[nx * 256 + nz * 16 + ny]; else n = getB(scx * 16 + nx, sy * 16 + ny, scz * 16 + nz);
            if (n > 0 && (kind[n] == 1 || (cfa[a] == 2 && cfa[n] == 2))) continue;
          }
          emit(O, wx, wy, wz, c, f, sid, rts[a]);
        }
      }
      continue;
    }
    for (let f = 0; f < 6; f++) {
      const d = FACE_OFFSETS[f], nx = x + d[0], ny = y + d[1], nz = zz + d[2]; let n;
      if (nx >= 0 && nx < 16 && ny >= 0 && ny < 16 && nz >= 0 && nz < 16) n = b[nx * 256 + nz * 16 + ny]; else n = getB(scx * 16 + nx, sy * 16 + ny, scz * 16 + nz);
      if (n < 0) continue; if (n && (kind[n] == 1 || (ka == 2 && (kind[n] == 2 || wl[n])) || n == a)) continue;
      emit(O, wx, wy, wz, c, f, 0);
    }
  }
  const A = fin(OPs), B = fin(TRs); if (!A && !B) return EMPTY;
  return { x: scx, z: scz, sy, id: ++MID, no: A ? A.n : 0, nt: B ? B.n : 0, o: A && A.buf, go: A && A.cnt, t: B && B.buf, gt: B && B.cnt };
}

const unkey = k => { const y = k % 64, r = (k - y) / 64, z = r % 4194304; return [(r - z) / 4194304 - 2097152, z - 2097152]; };

function rebase() {
  if (Math.abs(T[0]) < 8192 && Math.abs(T[2]) < 8192) return;
  const dx = Math.round(T[0] / 16) * 16, dz = Math.round(T[2] / 16) * 16;
  W.ox += dx; W.oz += dz; T[0] -= dx; T[2] -= dz; W.MC.clear(); W.mcF = 0; upload([]);
}

function updateUIStats(chunks, faces) {
  const chunkEl = document.getElementById('chunkCount');
  const renderEl = document.getElementById('renderCount');
  if (chunkEl) chunkEl.textContent = chunks.toLocaleString();
  if (renderEl) renderEl.textContent = `${faces.toLocaleString()} 面`;
}

function setupRenderDistanceControl() {
  if (document.getElementById('renderDistanceControl')) return;
  const viewport = document.getElementById('viewport');
  if (!viewport) return;

  const panel = document.createElement('div');
  panel.id = 'renderDistanceControl';
  panel.style.cssText = 'display:inline-flex;align-items:center;justify-content:flex-end;gap:5px;box-sizing:border-box;width:auto;max-width:100%;flex:0 1 auto;padding:0;margin:0;border:0;border-radius:0;background:transparent;color:#737b87;font:12px/1.3 system-ui,-apple-system,sans-serif;box-shadow:none;';
  panel.innerHTML = '<label for="renderDistanceSlider" style="font-weight:500;white-space:nowrap">チャンク:</label><input id="renderDistanceSlider" aria-label="描画チャンク数" type="range" min="5" max="121" step="1" value="12" style="appearance:auto;-webkit-appearance:slider-horizontal;display:block;box-sizing:border-box;width:clamp(72px, 20vw, 115px);height:16px;margin:0;padding:0;accent-color:#27865b;touch-action:pan-y;cursor:pointer"><output id="renderDistanceValue" for="renderDistanceSlider" style="font-weight:600;white-space:nowrap;min-width:42px;text-align:right">12</output>';

  const dimensionSelect = document.getElementById('dimensionSelect');
  const infoRow = dimensionSelect && dimensionSelect.parentElement;
  const viewerPanel = viewport.closest('.viewer-panel');
  let previewLabel = null;
  if (infoRow) {
    const candidates = infoRow.querySelectorAll('*');
    for (const el of candidates) {
      if (el.children.length === 0 && el.textContent.trim() === '3D Preview') {
        previewLabel = el;
        break;
      }
    }
  }
  if (previewLabel) {
    previewLabel.replaceWith(panel);
  } else if (infoRow) {
    infoRow.appendChild(panel);
  } else if (viewerPanel) {
    viewerPanel.insertBefore(panel, viewport.parentElement || viewport);
  } else if (viewport.parentElement) {
    viewport.parentElement.insertBefore(panel, viewport);
  } else return;

  const slider = panel.querySelector('#renderDistanceSlider');
  const output = panel.querySelector('#renderDistanceValue');
  const updateLabel = () => {
    const value = Number(slider.value);
    renderDistance = value === 121 ? 0 : value;
    output.textContent = renderDistance === 0 ? '∞' : String(renderDistance);
    output.title = renderDistance === 0 ? '無制限' : `${renderDistance}チャンク`;
  };
  slider.addEventListener('input', updateLabel);
  slider.addEventListener('change', () => {
    updateLabel();
    if (!W) return;
    W.MC.clear(); W.mcF = 0;
    upload([]);
    build();
  });
  updateLabel();
}
async function build() {
  rebase();
  const tok = ++btok, { y0, y1 } = W, unlimited = renderDistance === 0, R = unlimited ? 0 : renderDistance;
  const cx = Math.floor((T[0] + W.ox) / 16), cz = Math.floor((T[2] + W.oz) / 16), cy = Math.floor(T[1] / 16);
  bc = [cx, cz, cy];

  if (W.raw > LIM.raw) {
    if (!unlimited) {
      const lim = (R + 4) * (R + 4);
      for (const o of W.M.values()) if (o.r && o.v) { const dx = o.x - cx, dz = o.z - cz; if (dx * dx + dz * dz > lim) { o.v = null; W.raw--; } }
    }
    W.S.clear();
  } else if (W.S.size > LIM.S) W.S.clear();

  const MC = W.MC, MAXF = 7e6; let total = 0; const list = [], todo = [];
  msg('描画準備中…');

  let cl;
  if (unlimited) {
    cl = [];
    for (const columnKey of W.cols) {
      const [scx, scz] = unckey(columnKey), dx = scx - cx, dz = scz - cz;
      cl.push([dx * dx + dz * dz, dx, dz]);
    }
    cl.sort((a, b) => a[0] - b[0]);
  } else {
    cl = CLC.get(R);
    if (!cl) {
      cl = []; for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) { const d = dx * dx + dz * dz; if (d <= R * R) cl.push([d, dx, dz]); }
      cl.sort((p, q) => p[0] - q[0]); if (CLC.size > 3) CLC.clear(); CLC.set(R, cl);
    }
  }
  const sa = unlimited ? y0 : Math.max(y0, cy - R), sb = unlimited ? y1 : Math.min(y1, cy + R);

  for (const [, dx, dz] of cl) {
    const scx = cx + dx, scz = cz + dz; if (!unlimited && !W.cols.has(ckey(scx, scz))) continue;
    for (let sy = sa; sy <= sb; sy++) {
      const k = key(scx, sy, scz), m = MC.get(k);
      if (m === undefined) todo.push([scx, sy, scz, k]);
      else if (m.no || m.nt) { list.push(m); total += m.no + m.nt; }
    }
    if (!unlimited && total > MAXF) break;
  }

  let lu = 0, gap = 300;
  const flush = () => {
    const t0 = performance.now(); upload(list); draw(); lu = performance.now(); gap = Math.max(300, (lu - t0) * 4);
    updateUIStats(list.length, total);
  };
  if (todo.length) flush();

  let ready = 0, win = 300;
  for (let j = 0; j < todo.length; j++) {
    if (!unlimited && total > MAXF) break;
    if (j >= ready) {
      const end = Math.min(todo.length, ready + win), need = [], seen = new Set();
      for (let q = ready; q < end; q++) {
        const [sx, sy, sz] = todo[q];
        for (let ex = -1; ex <= 1; ex++) for (let ez = -1; ez <= 1; ez++) {
          if (!W.cols.has(ckey(sx + ex, sz + ez))) continue;
          for (let ey = -1; ey <= 1; ey++) {
            const o = W.M.get(key(sx + ex, sy + ey, sz + ez));
            if (o && o.t && !o.v && o.r && !seen.has(o)) { seen.add(o); need.push(o); }
          }
        }
      }
      win = Math.min(win * 2, LIM.win); ready = end;
      if (need.length) { msg(`読み込み中… ${j.toLocaleString()}/${todo.length.toLocaleString()}`); if (!await fetchRaw(need, tok)) return; }
    }
    const [scx, sy, scz, k] = todo[j], bb = getS(scx, sy, scz), m = bb ? meshSub(scx, sy, scz, bb) : EMPTY;
    MC.set(k, m); W.mcF += m.no + m.nt;
    if (m.no || m.nt) { list.push(m); total += m.no + m.nt; }
    if ((j & 15) == 15) {
      msg(`描画中… ${(j + 1).toLocaleString()}/${todo.length.toLocaleString()}`);
      await tick(); if (tok != btok) return; if (performance.now() - lu > gap) flush();
    }
  }
  flush();

  if (!unlimited && (W.mcF > MAXF * LIM.mc || MC.size > LIM.mcn)) {
    const lim = (R + 2) * (R + 2);
    for (const [k, m] of MC) { const [mx, mz] = unkey(k), dx = mx - cx, dz = mz - cz; if (dx * dx + dz * dz > lim) { MC.delete(k); W.mcF -= m.no + m.nt; } }
  }
  updateUIStats(list.length, total);
  showLoading(false);
  msg(total ? '読み込み完了' : 'この範囲に描画できるブロックがありません');
}

function maybe() {
  if (!W || renderDistance === 0) return; const R = renderDistance, t = Math.max(2, Math.min(R >> 2, 6)), cx = Math.floor((T[0] + W.ox) / 16), cz = Math.floor((T[2] + W.oz) / 16), cy = Math.floor(T[1] / 16);
  if (Math.abs(cx - bc[0]) > t || Math.abs(cz - bc[1]) > t || Math.abs(cy - bc[2]) > t) build();
}

const tick = () => new Promise(r => setTimeout(r));

/* ---- Zip Reader ---- */
async function openZip(f) {
  const rd = async (a, b) => new Uint8Array(await f.slice(a, b).arrayBuffer());
  const sz = f.size, tl = Math.min(sz, 65536 + 22 + 20), tail = await rd(sz - tl, sz), tv = new DataView(tail.buffer); let e = tail.length - 22;
  while (e >= 0 && tv.getUint32(e, true) != 0x06054b50) e--; if (e < 0) throw Error('ZIPとして読めません');
  let n = tv.getUint16(e + 10, true), cs = tv.getUint32(e + 12, true), co = tv.getUint32(e + 16, true);
  if ((n == 0xffff || cs == 0xffffffff || co == 0xffffffff) && e >= 20 && tv.getUint32(e - 20, true) == 0x07064b50) {
    const zo = Number(tv.getBigUint64(e - 12, true)), z4 = await rd(zo, zo + 56), zv = new DataView(z4.buffer);
    n = Number(zv.getBigUint64(32, true)); cs = Number(zv.getBigUint64(40, true)); co = Number(zv.getBigUint64(48, true));
  }
  const cd = await rd(co, co + cs), v = new DataView(cd.buffer), m = []; let p = 0;
  for (let i = 0; i < n && p + 46 <= cd.length; i++) {
    if (v.getUint32(p, true) != 0x02014b50) break;
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const o = { name: td.decode(cd.subarray(p + 46, p + 46 + nl)), meth: v.getUint16(p + 10, true), cs: v.getUint32(p + 20, true), us: v.getUint32(p + 24, true), lo: v.getUint32(p + 42, true), ds: undefined };
    if (o.us == 0xffffffff || o.cs == 0xffffffff || o.lo == 0xffffffff) {
      let q = p + 46 + nl; const end = q + el;
      while (q + 4 <= end) {
        const id = v.getUint16(q, true), sx = v.getUint16(q + 2, true);
        if (id == 1) {
          let r = q + 4;
          if (o.us == 0xffffffff) { o.us = Number(v.getBigUint64(r, true)); r += 8; }
          if (o.cs == 0xffffffff) { o.cs = Number(v.getBigUint64(r, true)); r += 8; }
          if (o.lo == 0xffffffff) { o.lo = Number(v.getBigUint64(r, true)); }
          break;
        }
        q += 4 + sx;
      }
    }
    m.push(o); p += 46 + nl + el + cl;
  }
  m.file = f;
  m.ds = async e => { if (e.ds === undefined) { const h = await rd(e.lo, e.lo + 30), hv = new DataView(h.buffer); e.ds = e.lo + 30 + hv.getUint16(26, true) + hv.getUint16(28, true); } return e.ds; };
  m.raw = async e => { const q = await m.ds(e); return rd(q, q + e.cs); };
  m.get = async e => { const s = await m.raw(e); return e.meth ? inflate(s, 0, e.us) : s; };
  return m;
}

/* Worker Source Generator */
function workerSource() {
  return `
    const td = new TextDecoder();
    ${huff.toString()}
    ${inflate.toString()}
    ${snappy.toString()}
    ${vi.toString()}
    ${blk.toString()}
    ${ents.toString()}
    ${ldb.toString()}
    self.onmessage = e => {
      const { i, s, meth, us } = e.data;
      try {
        const d = meth ? inflate(s, 0, us) : s;
        const X = [], Z = [], Y = [], S = [], Dm = [], Tt = [], BO = [], BS = [], EO = [], VL = [];
        ldb(d, (k, sq, t, v, ref) => {
          const L = k.length, dm = L == 14 ? k[8] | k[9] << 8 | k[10] << 16 : 0;
          if (dm > 2) return;
          X.push(k[0] | k[1] << 8 | k[2] << 16 | k[3] << 24);
          Z.push(k[4] | k[5] << 8 | k[6] << 16 | k[7] << 24);
          Y.push(k[L - 1] << 24 >> 24);
          S.push(sq); Dm.push(dm); Tt.push(t);
          BO.push(ref.bo); BS.push(ref.bs); EO.push(ref.eo); VL.push(ref.vl);
        });
        const r = {
          i, n: X.length,
          X: Int32Array.from(X), Z: Int32Array.from(Z), Y: Int8Array.from(Y),
          S: Float64Array.from(S), Dm: Uint8Array.from(Dm), T: Uint8Array.from(Tt),
          BO: Float64Array.from(BO), BS: Float64Array.from(BS), EO: Float64Array.from(EO), VL: Float64Array.from(VL),
          file: meth ? (d.byteLength === d.buffer.byteLength ? d.buffer : d.slice().buffer) : null
        };
        const tr = [r.X.buffer, r.Z.buffer, r.Y.buffer, r.S.buffer, r.Dm.buffer, r.T.buffer, r.BO.buffer, r.BS.buffer, r.EO.buffer, r.VL.buffer];
        if (r.file) tr.push(r.file);
        self.postMessage(r, tr);
      } catch (err) {
        self.postMessage({ i, err: String(err && err.message || err) });
      }
    };
  `;
}

function applyParsed(Ms, r) {
  for (let j = 0; j < r.n; j++) {
    const M = Ms[r.Dm[j]], x = r.X[j], zz = r.Z[j], y = r.Y[j], kk = key(x, y, zz), o = M.get(kk), sq = r.S[j];
    if (!o || o.s < sq) {
      const t = r.T[j];
      M.set(kk, { s: sq, t, v: null, x, z: zz, y, fi: r.i, r: t ? 1 : 0, bo: t ? r.BO[j] : 0, bs: t ? r.BS[j] : 0, eo: t ? r.EO[j] : 0, vl: t ? r.VL[j] : 0 });
    }
  }
}

async function parseLdbPool(z, fl, idxs, Ms, onFile) {
  const left = new Set(idxs);
  let tot = 0; for (const i of idxs) tot += fl[i].us;
  if (typeof Worker === 'undefined' || idxs.length < 2 || tot < 2e7) return [...left];
  const nw = Math.min(idxs.length, Math.max(2, Math.min(LIM.wk, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4))), ws = [];
  let url = null, next = 0, dead = false;
  try {
    url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
    for (let k = 0; k < nw; k++) ws.push(new Worker(url));
  } catch (e) {
    for (const w of ws) w.terminate(); return [...left];
  }
  const run = w => new Promise((res, rej) => {
    const pump = async () => {
      if (next >= idxs.length || dead) { res(); return; }
      const i = idxs[next++], e = fl[i]; let sb;
      try { sb = await z.raw(e); } catch (err) { rej(err); return; }
      if (dead) return;
      w.onmessage = ev => {
        if (dead) return; const r = ev.data;
        if (r.err) { rej(Error(r.err)); return; }
        applyParsed(Ms, r); left.delete(i); onFile(i, r.file ? new Uint8Array(r.file) : null); pump();
      };
      w.postMessage({ i, s: sb, meth: e.meth, us: e.us }, [sb.buffer]);
    };
    w.onerror = ev => rej(Error(ev.message || 'worker error'));
    pump();
  });
  try { await Promise.all(ws.map(run)); } catch (err) { console.warn('worker parse failed', err); }
  dead = true; for (const w of ws) w.terminate(); URL.revokeObjectURL(url); return [...left];
}

async function loadWorld(f) {
  showLoading(true);
  msg('ワールドファイルを解析中…');
  await tick();
  try {
    const z = await openZip(f);
    const lv = z.find(e => /(^|\/)level\.dat$/.test(e.name)); let name = f.name.replace(/\.\w+$/, ''), sx = 0, sz = 0;
    if (lv) { try { const d = await z.get(lv), o = nbt(d.subarray(8), { p: 0 }); if (o.LevelName) name = o.LevelName; sx = o.SpawnX | 0; sz = o.SpawnZ | 0; } catch (e) { } }
    const Ms = [new Map(), new Map(), new Map()], fc = new Map(); let cf = 0, fcb = 0;
    const take = (k, s, t, v, ref) => {
      const L = k.length; if ((L != 10 && L != 14) || k[L - 2] != 47) return;
      const dm = L == 14 ? k[8] | k[9] << 8 | k[10] << 16 : 0; if (dm > 2) return; const M = Ms[dm];
      const x = k[0] | k[1] << 8 | k[2] << 16 | k[3] << 24, zz = k[4] | k[5] << 8 | k[6] << 16 | k[7] << 24;
      const y = k[L - 1] << 24 >> 24, kk = key(x, y, zz), o = M.get(kk);
      if (!o || o.s < s) {
        const rr = t && ref;
        M.set(kk, { s, t, v: t && !ref ? v.slice() : null, x, z: zz, y, fi: cf, r: rr ? 1 : 0, bo: rr ? ref.bo : 0, bs: rr ? ref.bs : 0, eo: rr ? ref.eo : 0, vl: rr ? ref.vl : 0 });
      }
    };
    const fl = z.filter(e => /\.(ldb|log)$/.test(e.name));
    if (!fl.length) throw Error('LevelDBが見つかりません。統合版ワールドか確認してください');

    let done = 0;
    const cachePut = (i, d) => {
      fc.set(i, d); fcb += d.length;
      while (fcb > LIM.fc && fc.size > 1) { const k = fc.keys().next().value; fcb -= fc.get(k).length; fc.delete(k); }
    };
    const ldbs = [], logs = []; fl.forEach((e, i) => (e.name.endsWith('.ldb') ? ldbs : logs).push(i));
    msg(`解析中 0/${fl.length}`); await tick();

    const left = await parseLdbPool(z, fl, ldbs, Ms, (i, file) => { done++; msg(`解析中 ${done}/${fl.length}`); if (file) cachePut(i, file); });
    for (const i of left.concat(logs)) {
      const e = fl[i]; cf = i; done++; msg(`解析中 ${done}/${fl.length}`); await tick();
      const d = await z.get(e);
      e.name.endsWith('.ldb') ? ldb(d, take) : wal(d, take); if (e.meth && e.name.endsWith('.ldb')) cachePut(i, d);
    }
    msg('ワールドを準備中…'); await tick();

    const av = [0, 1, 2].filter(d => { for (const o of Ms[d].values()) if (o.t) return true; return false; });
    if (!av.length) throw Error('ブロックを復元できませんでした');

    W = { Ms, M: null, z, fl, fc, fcb, bc: new Map(), bcb: 0, sx, sz };

    const ds = document.getElementById('dimensionSelect');
    if (ds) {
      ds.innerHTML = av.map(d => `<option value="${d}">${['オーバーワールド', 'ネザー', 'ジ・エンド'][d]}</option>`).join('');
      ds.disabled = av.length < 2;
    }

    const hintEl = document.getElementById('viewerHint');
    if (hintEl) hintEl.textContent = name;

    const blockCountEl = document.getElementById('blockCount');
    if (blockCountEl) {
      let totalBlocks = 0;
      for (const map of Ms) totalBlocks += map.size;
      blockCountEl.textContent = `${totalBlocks.toLocaleString()} チャンク`;
    }

    initWebGLCanvas();
    await setDimension(av[0]);
  } catch (e) {
    console.error(e);
    showLoading(false);
    msg('エラー: ' + (e.message || e));
  }
}

async function setDimension(d) {
  if (!W) return;
  if (W.M) for (const o of W.M.values()) if (o.r) o.v = null;
  const M = W.Ms[d], cols = new Set(); let y0 = 99, y1 = -99;
  for (const o of M.values()) { if (!o.t) continue; cols.add(ckey(o.x, o.z)); if (o.y < y0) y0 = o.y; if (o.y > y1) y1 = o.y; }
  let tx = W.sx >> 4, tz = W.sz >> 4; if (d == 1) { tx >>= 3; tz >>= 3; } else if (d == 2) { tx = 0; tz = 0; }
  Object.assign(W, { M, S: new Map(), MC: new Map(), mcF: 0, cols, ox: tx * 16, oz: tz * 16, y0, y1, raw: 0, dim: d });
  let ccx = tx, ccz = tz, px = d ? 8 : W.sx & 15, pz = d ? 8 : W.sz & 15;
  if (!cols.has(ckey(ccx, ccz))) {
    let bd = 1e18;
    for (const c of cols) { const [a, b] = unckey(c), q = (a - tx) * (a - tx) + (b - tz) * (b - tz); if (q < bd) { bd = q; ccx = a; ccz = b; } }
    px = pz = 8;
  }
  if (gl) { upload([]); draw(); }
  await colNeed(ccx, ccz); let ty = topOf(ccx, ccz, px, pz); if (d == 1 || ty === null) ty = (y0 + y1 + 1) * 8;
  T = [ccx * 16 + px - W.ox + .5, ty, ccz * 16 + pz - W.oz + .5]; Dst = 100; ya = .8; pi = .65;
  await build();
}

/* ---------- WebGL Rendering ---------- */
let cv = null, gl = null;
let T = [0, 0, 0], Dst = 100, ya = .8, pi = .6, regions = new Map(), prog, uVP, uCam, uA, dirty = 0;

const VS = `#version 300 es
in ivec4 aP;in vec4 aC;uniform mat4 uVP;uniform vec3 uCam;out vec3 vC;
const float SH[6]=float[](.8,.7,1.,.5,.75,.65);
vec3 vivid(vec3 c){float l=dot(c,vec3(.299,.587,.114));return clamp(mix(vec3(l),c,1.28),0.,1.);}
const vec3 LO[${BOXES.length}]=vec3[](${BOXES.map(b => `vec3(${b[0].toFixed(4)},${b[1].toFixed(4)},${b[2].toFixed(4)})`).join(',')});
const vec3 HI[${BOXES.length}]=vec3[](${BOXES.map(b => `vec3(${b[3].toFixed(4)},${b[4].toFixed(4)},${b[5].toFixed(4)})`).join(',')});
void main(){
  int sid=int(aC.a*255.+.5);int f=aP.w&7;int a=f>>1;float s=(f&1)==0?1.:0.;float u=float(gl_VertexID&1),v=float(gl_VertexID>>1);
  if(f>=6){vec3 l=LO[sid],h=HI[sid];vec3 p=vec3(aP.xyz)+vec3(mix(l.x,h.x,u),mix(l.y,h.y,v),f==6?mix(l.z,h.z,u):mix(h.z,l.z,u));vC=vivid(aC.rgb);gl_Position=uVP*vec4(p,1.);return;}
  vec3 q=a==0?vec3(s,u,v):a==1?vec3(u,s,v):vec3(u,v,s);vec3 p=vec3(aP.xyz)+mix(LO[sid],HI[sid],q);
  vC=vivid(aC.rgb)*SH[f]*(.94+.012*float((aP.w>>3)&7));
  int rt=(aP.w>>6)&15;
  if(rt>0){
    float an=-float(rt)*.3926991;float cs=cos(an);float sn=sin(an);
    vec3 nm=(a==0?vec3(1.,0.,0.):a==1?vec3(0.,1.,0.):vec3(0.,0.,1.))*(s*2.-1.);
    vec3 c0=vec3(float(aP.x)+.5,0.,float(aP.z)+.5);vec3 r=p-c0;
    p=c0+vec3(r.x*cs+r.z*sn,r.y,r.z*cs-r.x*sn);nm=vec3(nm.x*cs+nm.z*sn,nm.y,nm.z*cs-nm.x*sn);
    if(dot(uCam-p,nm)<0.){gl_Position=vec4(2.,2.,2.,1.);return;}
    gl_Position=uVP*vec4(p,1.);return;
  }
  float pa=a==0?p.x:a==1?p.y:p.z,ce=a==0?uCam.x:a==1?uCam.y:uCam.z;
  if((ce-pa)*(s*2.-1.)<0.){gl_Position=vec4(2.,2.,2.,1.);return;}
  gl_Position=uVP*vec4(p,1.);
}`;
const FS = `#version 300 es
precision mediump float;in vec3 vC;uniform float uA;out vec4 o;void main(){o=vec4(vC,uA);}`;

function initWebGLCanvas() {
  if (gl) return;
  const viewport = document.getElementById('viewport');
  if (!viewport) return;

  cv = document.createElement('canvas');
  viewport.appendChild(cv);

  gl = cv.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  if (!gl) { msg('WebGL2に対応していないブラウザです'); return; }

  const sh = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); return h; };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  uVP = gl.getUniformLocation(prog, 'uVP');
  uCam = gl.getUniformLocation(prog, 'uCam');
  uA = gl.getUniformLocation(prog, 'uA');
  gl.enable(gl.DEPTH_TEST);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(.078, .086, .102, 1);

  bindPointerEvents();
}

function freeReg(g) { for (const v of g.vs) gl.deleteVertexArray(v.vao); for (const b of g.bos) gl.deleteBuffer(b); }
function upload(list) {
  if (!gl) return; const by = new Map();
  for (const m of list) {
    const rx = m.x >> 2, rz = m.z >> 2, k = rx + ',' + rz; let r = by.get(k);
    if (!r) by.set(k, r = { rx, rz, ms: [], s1: 0, s2: 0, lo: 1e9, hi: -1e9 });
    r.ms.push(m); r.s1 += m.id; r.s2 += m.id * m.id; if (m.sy < r.lo) r.lo = m.sy; if (m.sy > r.hi) r.hi = m.sy;
  }
  for (const [k, g] of regions) { const r = by.get(k); if (!r || r.s1 !== g.s1 || r.s2 !== g.s2 || r.ms.length !== g.cnt) { freeReg(g); regions.delete(k); } }
  const aP = gl.getAttribLocation(prog, 'aP'), aC = gl.getAttribLocation(prog, 'aC');
  for (const [k, r] of by) {
    if (regions.has(k)) continue;
    const xl = r.rx * 64 - W.ox, zl = r.rz * 64 - W.oz, g = { s1: r.s1, s2: r.s2, cnt: r.ms.length, lo: [xl, r.lo * 16, zl], hi: [xl + 64, (r.hi + 1) * 16, zl + 64], vs: [], bos: [] };
    for (let t = 0; t < 2; t++) {
      let tot = 0; for (const m of r.ms) tot += t ? m.nt : m.no; if (!tot) continue;
      const u8 = new Uint8Array(tot * 12), gs = []; let off = 0;
      for (let q = 0; q < 7; q++) {
        gs.push(off); for (const m of r.ms) { const c = t ? m.gt : m.go; if (!c || !c[q]) continue; let so = 0; for (let j = 0; j < q; j++) so += c[j]; u8.set(new Uint8Array(t ? m.t : m.o, so * 12, c[q] * 12), off * 12); off += c[q]; }
      }
      gs.push(off);
      const bo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bo); gl.bufferData(gl.ARRAY_BUFFER, u8, gl.STATIC_DRAW); g.bos.push(bo);
      for (let q = 0; q < 7; q++) {
        const n = gs[q + 1] - gs[q]; if (!n) continue; const vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, bo);
        gl.enableVertexAttribArray(aP); gl.vertexAttribIPointer(aP, 4, gl.SHORT, 12, gs[q] * 12); gl.vertexAttribDivisor(aP, 1);
        gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 4, gl.UNSIGNED_BYTE, true, 12, gs[q] * 12 + 8); gl.vertexAttribDivisor(aC, 1);
        g.vs.push({ vao, g: q, n, t });
      }
    }
    regions.set(k, g);
  }
  gl.bindVertexArray(null);
}

function mat() {
  const e = [T[0] + Dst * Math.cos(pi) * Math.sin(ya), T[1] + Dst * Math.sin(pi), T[2] + Dst * Math.cos(pi) * Math.cos(ya)];
  let z = [e[0] - T[0], e[1] - T[1], e[2] - T[2]]; const nz = Math.hypot(...z); z = z.map(v => v / nz);
  let x = [z[2], 0, -z[0]]; const nx = Math.hypot(...x); x = x.map(v => v / nx);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const V = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  const R = renderDistance === 0 ? 120 : renderDistance, N = Math.max(1, Dst * .01), F = Dst * 8 + 2000 + R * 32, f = 1 / Math.tan(.4), a = cv.width / cv.height, P = [f / a, 0, 0, 0, 0, f, 0, 0, 0, 0, (F + N) / (N - F), -1, 0, 0, 2 * F * N / (N - F), 0], o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += P[k * 4 + r] * V[c * 4 + k]; o[c * 4 + r] = s; }
  return { m: o, x, y, e };
}

function draw() {
  dirty = 0; if (!gl || !cv) return;
  const r = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth * r | 0, h = cv.clientHeight * r | 0;
  if (cv.width != w || cv.height != h) { cv.width = w; cv.height = h; }
  gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); if (!regions.size) return;
  gl.useProgram(prog); const M = mat(); gl.uniformMatrix4fv(uVP, false, M.m); gl.uniform3fv(uCam, M.e);
  const o = M.m, ce = M.e, pl = [], vis = [];
  for (const [sg, r] of [[1, 0], [-1, 0], [1, 1], [-1, 1], [1, 2], [-1, 2]]) pl.push([o[3] + sg * o[r], o[7] + sg * o[4 + r], o[11] + sg * o[8 + r], o[15] + sg * o[12 + r]]);
  for (const g of regions.values()) {
    let ok = 1; for (const [a, b, c, d] of pl) { if (a * (a >= 0 ? g.hi[0] : g.lo[0]) + b * (b >= 0 ? g.hi[1] : g.lo[1]) + c * (c >= 0 ? g.hi[2] : g.lo[2]) + d < 0) { ok = 0; break; } }
    if (ok) vis.push(g);
  }
  const pass = t => {
    for (const g of vis) for (const v of g.vs) {
      if (v.t !== t) continue;
      if (v.g < 6) { const ax = v.g >> 1; if (v.g & 1) { if (ce[ax] > g.hi[ax]) continue; } else if (ce[ax] < g.lo[ax]) continue; }
      gl.bindVertexArray(v.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, v.n);
    }
  };
  gl.uniform1f(uA, 1); pass(0); gl.enable(gl.BLEND); gl.depthMask(false); gl.uniform1f(uA, .55); pass(1); gl.depthMask(true); gl.disable(gl.BLEND);
}

const redraw = () => { if (!dirty) { dirty = 1; requestAnimationFrame(draw); } };

function resetCameraView() {
  Dst = 100; ya = .8; pi = .65; redraw();
}

/* ---------- User Input Binding ---------- */
function bindPointerEvents() {
  if (!cv) return;
  const P = new Map();
  function pan(dx, dy) { const { x, y } = mat(), k = Dst * 2 * Math.tan(.4) / cv.clientHeight; for (let i = 0; i < 3; i++) T[i] += (-x[i] * dx + y[i] * dy) * k; }
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); P.set(e.pointerId, e); };
  cv.onpointerup = cv.onpointercancel = e => { P.delete(e.pointerId); if (!P.size) maybe(); };
  cv.onpointermove = e => {
    const o = P.get(e.pointerId); if (!o) return;
    if (P.size == 1) {
      const dx = e.clientX - o.clientX, dy = e.clientY - o.clientY;
      if (e.buttons & 2 || e.shiftKey) pan(dx, dy); else { ya -= dx * .006; pi = Math.max(-1.5, Math.min(1.5, pi + dy * .006)); }
    } else if (P.size == 2) {
      const q = [...P.values()], a = q[0].pointerId == e.pointerId ? q[1] : q[0],
        d0 = Math.hypot(o.clientX - a.clientX, o.clientY - a.clientY), d1 = Math.hypot(e.clientX - a.clientX, e.clientY - a.clientY);
      Dst = Math.max(5, Dst * d0 / Math.max(d1, 1)); pan((e.clientX - o.clientX) / 2, (e.clientY - o.clientY) / 2);
    }
    P.set(e.pointerId, e); redraw();
  };
  let wt = 0;
  cv.onwheel = e => { e.preventDefault(); Dst = Math.max(5, Dst * Math.exp(e.deltaY * .001)); redraw(); clearTimeout(wt); wt = setTimeout(maybe, 300); };
  cv.oncontextmenu = e => e.preventDefault();
  window.addEventListener('resize', redraw);
}

/* ---------- Entry Points for index.html ---------- */
window.startWorldViewer = async function (file) {
  await loadWorld(file);
};

const initializeViewerUI = () => {
  setupRenderDistanceControl();
  const dimensionSelect = document.getElementById('dimensionSelect');
  const resetButton = document.getElementById('resetView');
  const fullscreenButton = document.getElementById('fullscreen');
  const viewerPanel = document.querySelector('.viewer-panel');

  if (dimensionSelect) {
    dimensionSelect.addEventListener('change', (e) => {
      setDimension(parseInt(e.target.value, 10));
    });
  }

  if (resetButton) {
    resetButton.addEventListener('click', () => {
      resetCameraView();
    });
  }

  if (fullscreenButton && viewerPanel) {
    fullscreenButton.addEventListener('click', () => {
      document.body.classList.toggle('viewer-fullscreen');
    });
  }
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeViewerUI, { once: true });
} else {
  initializeViewerUI();
}
