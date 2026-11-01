/* eslint-disable -- the prototype's art generator, kept only until Phase 58 replaces it. */
// Paints each look's art as SVG and rasterizes it (filters, grain and marble need a real renderer).
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const OUT = process.env.ART_OUT || path.join(__dirname, "design/art"); fs.mkdirSync(OUT, { recursive: true });
let seed = 7; const rnd = (a = 1, b) => { seed = (seed * 16807) % 2147483647; const r = seed / 2147483647; return b === undefined ? r * a : a + r * (b - a); };
const svg = (w, h, body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
const A = {};

/* ---------- Texture ---------- */
A.grain = [256, 256, svg(256, 256, `<rect width="256" height="256" filter="url(#n)"/>`, `<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .9 -.28"/></filter>`), true];
A.paper = [512, 512, svg(512, 512, `<rect width="512" height="512" filter="url(#n)"/>`, `<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".012 .05" numOctaves="5" stitchTiles="stitch"/><feDiffuseLighting surfaceScale="3" lighting-color="#fff"><feDistantLight azimuth="45" elevation="62"/></feDiffuseLighting><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1.6 0 0 0 1.25"/></filter>`), true];

/* ---------- Goth ---------- */
function lancet(x, y, w, h) { return `M${x} ${y + h}V${y + h * .34}Q${x} ${y + h * .1} ${x + w / 2} ${y}Q${x + w} ${y + h * .1} ${x + w} ${y + h * .34}V${y + h}Z`; }
function spire(x, base, w, h, c) {
  let s = `<path d="M${x - w / 2} ${base}L${x} ${base - h}L${x + w / 2} ${base}Z" fill="${c.stone}" stroke="${c.line}" stroke-width="1.5"/>`;
  const n = Math.floor(h / 15);
  for (let i = 1; i < n; i++) { const t = i / n, yy = base - h * t, off = (w / 2) * (1 - t); s += `<path d="M${x - off} ${yy}l-5 -7l6 3zM${x + off} ${yy}l5 -7l-6 3z" fill="${c.stone}" stroke="${c.line}" stroke-width=".8"/>`; }
  return s + `<path d="M${x} ${base - h - 12}v20M${x - 5} ${base - h - 5}h10" stroke="${c.line}" stroke-width="2"/>`;
}
function tower(x, base, w, h, c, big) {
  let s = spire(x + w / 2, base - h * 1.0, w * .86, h * .95, c);
  s += `<path d="${lancet(x, base - h * 1.08, w, h * 1.08)}" fill="${c.stone}" stroke="${c.line}" stroke-width="2"/>`;
  for (const yy of [.72, .36]) {
    const wh = h * .3, ww = w * .24;
    for (const k of big ? [.14, .38, .62] : [.17, .59]) s += `<path d="${lancet(x + w * k, base - h * yy, ww, wh)}" fill="${c.glass}" stroke="${c.line}" stroke-width="1.5"/><path d="M${x + w * k + ww / 2} ${base - h * yy + 4}V${base - h * yy + wh}" stroke="${c.lead}" stroke-width="1.5"/><path d="M${x + w * k} ${base - h * yy + wh * .6}h${ww}" stroke="${c.lead}" stroke-width="1"/>`;
    s += `<path d="M${x} ${base - h * (yy - .03)}h${w}" stroke="${c.line}" stroke-width="3"/>`;
  }
  return s;
}
function rose(cx, cy, r, c) {
  let s = `<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="${c.stone}" stroke="${c.line}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.dark}"/>`;
  for (let i = 0; i < 16; i++) { const col = c.rose[i % c.rose.length]; s += `<path transform="rotate(${i * 22.5} ${cx} ${cy})" d="M${cx} ${cy - r * .28}Q${cx - r * .19} ${cy - r * .68} ${cx} ${cy - r * .96}Q${cx + r * .19} ${cy - r * .68} ${cx} ${cy - r * .28}Z" fill="${col}" stroke="${c.lead}" stroke-width="1.5"/>`; }
  for (let i = 0; i < 8; i++) s += `<circle transform="rotate(${i * 45 + 11} ${cx} ${cy})" cx="${cx}" cy="${cy - r * .2}" r="${r * .07}" fill="${c.rose[(i + 1) % c.rose.length]}" stroke="${c.lead}"/>`;
  return s + `<circle cx="${cx}" cy="${cy}" r="${r * .09}" fill="${c.rose[0]}" stroke="${c.lead}" stroke-width="2"/>`;
}
const bat = (x, y, s, f) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 0Q-8-14-26-16Q-22-8-26-2Q-18-6-14 0Q-10-4-7 3Q-3 0 0 8Q3 0 7 3Q10-4 14 0Q18-6 26-2Q22-8 26-16Q8-14 0 0ZM-3-5L-4-10L-1-7H1L4-10L3-5Z" fill="${f}"/>`;
function cathedral(c) {
  const W = 1400, H = 520, B = 520;
  let s = c.back;
  for (let i = 0; i < 2; i++) s += "";
  // Buttresses behind everything.
  for (const [x, f] of [[250, 1], [1150, -1], [90, 1], [1310, -1]]) s += `<path d="M${x} ${B}V${B - 170}Q${x + f * 90} ${B - 280} ${x + f * 170} ${B - 300}" fill="none" stroke="${c.stone}" stroke-width="16"/><path d="M${x} ${B}V${B - 170}Q${x + f * 90} ${B - 280} ${x + f * 170} ${B - 300}" fill="none" stroke="${c.line}" stroke-width="2"/>`;
  s += tower(40, B, 110, 150, c) + tower(1250, B, 110, 150, c);
  s += tower(170, B, 120, 200, c) + tower(1110, B, 120, 200, c);
  s += tower(320, B, 150, 260, c, 1) + tower(930, B, 150, 260, c, 1);
  s += spire(700, B - 300, 300, 200, c);
  s += `<path d="M480 ${B}V${B - 300}L700 ${B - 410}L920 ${B - 300}V${B}Z" fill="${c.stone}" stroke="${c.line}" stroke-width="3"/>`;
  s += rose(700, B - 268, 92, c);
  s += `<path d="M480 ${B - 150}H920" stroke="${c.line}" stroke-width="4"/>`;
  for (let i = 0; i < 9; i++) s += `<path d="${lancet(500 + i * 44, B - 148, 34, 62)}" fill="${c.dark}" stroke="${c.line}"/>`;
  for (const x of [510, 830]) s += `<path d="${lancet(x, B - 76, 60, 76)}" fill="${c.glass}" stroke="${c.line}" stroke-width="2"/>`;
  s += `<path d="${lancet(640, B - 112, 120, 112)}" fill="${c.dark}" stroke="${c.line}" stroke-width="3"/><path d="${lancet(656, B - 92, 88, 92)}" fill="${c.stone}" stroke="${c.line}" stroke-width="2"/><path d="M700 ${B - 92}V${B}" stroke="${c.line}" stroke-width="3"/>`;
  s += `<rect width="${W}" height="${H}" fill="url(#ht)"/>` + c.front;
  return svg(W, H, s, `<pattern id="ht" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="3.5" cy="3.5" r="1.1" fill="${c.dot}"/></pattern><radialGradient id="mg"><stop offset="0" stop-color="${c.moon}"/><stop offset=".62" stop-color="${c.moon}"/><stop offset=".64" stop-color="${c.moon}" stop-opacity=".25"/><stop offset="1" stop-color="${c.moon}" stop-opacity="0"/></radialGradient><linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.fog}" stop-opacity="0"/><stop offset="1" stop-color="${c.fog}" stop-opacity=".95"/></linearGradient>`);
}
const nightC = { stone: "#1a0a10", line: "#7a1c28", glass: "#d98a2b", lead: "#1a0508", dark: "#050304", dot: "#ffffff0a", moon: "#e9d9c0", fog: "#0a090c", rose: ["#e5263a", "#ffb347", "#7a1030", "#3a4fbf", "#ffd98a"] };
nightC.back = `<circle cx="1120" cy="110" r="150" fill="url(#mg)"/>` + bat(980, 80, 1.2, "#000") + bat(1180, 150, .8, "#000") + bat(240, 70, 1, "#c9b9a6") + bat(330, 130, .6, "#c9b9a6") + bat(1270, 60, .7, "#000");
nightC.front = `<rect y="400" width="1400" height="120" fill="url(#fog)"/>`;
const dayC = { stone: "#16120e", line: "#cfc6b2", glass: "#c9262c", lead: "#16120e", dark: "#000", dot: "#ffffff10", moon: "#c9262c", fog: "#16120e", rose: ["#c9262c", "#e8e1cf", "#7a1016", "#c9262c", "#e8e1cf"] };
dayC.back = Array.from({ length: 90 }, (_, i) => { const a = (i / 90) * Math.PI * 2, r1 = 170 + (i % 3) * 18, r2 = 760; return `<path d="M${700 + Math.cos(a) * r1} ${250 + Math.sin(a) * r1}L${700 + Math.cos(a) * r2} ${250 + Math.sin(a) * r2}" stroke="#e8e1cf" stroke-width="${i % 2 ? 1 : 2.2}" opacity=".55"/>`; }).join("");
dayC.front = "";
A["goth-night"] = [1400, 520, cathedral(nightC)];
A["goth-day"] = [1400, 520, cathedral(dayC)];
function scrollCorner(col, col2) {
  return `<g fill="none" stroke="${col}" stroke-linecap="round"><path d="M8 110V52Q8 8 52 8H110" stroke-width="4"/><path d="M16 110V56Q16 16 56 16H110" stroke-width="1.5"/><path d="M30 92C22 58 34 34 60 30C80 28 86 52 68 56C56 58 54 44 64 42" stroke-width="3.5"/><path d="M92 30C60 22 40 30 34 54" stroke-width="2.5"/><path d="M40 118C44 96 40 80 28 70M118 40C96 44 80 40 70 28" stroke-width="2.5"/><path d="M14 150C24 136 22 124 12 114M150 14C136 24 124 22 114 12" stroke-width="2.5"/></g><g fill="${col}"><path d="M30 92Q44 100 40 118Q26 108 30 92ZM92 30Q100 44 118 40Q108 26 92 30Z"/><path d="M28 28L46 22L40 40Z"/><circle cx="64" cy="42" r="4"/></g><path d="M22 22l8 3-3 3-3 3-3-8z" fill="${col2}"/>`;
}
function frame(col, col2, W = 360) { const c = scrollCorner(col, col2); return svg(W, W, `<g>${c}</g><g transform="translate(${W} 0) scale(-1 1)">${c}</g><g transform="translate(0 ${W}) scale(1 -1)">${c}</g><g transform="translate(${W} ${W}) scale(-1 -1)">${c}</g><rect x="8" y="110" width="4" height="140" fill="${col}"/><rect x="16" y="110" width="1.5" height="140" fill="${col}"/><rect x="${W - 12}" y="110" width="4" height="140" fill="${col}"/><rect x="${W - 17.5}" y="110" width="1.5" height="140" fill="${col}"/><rect y="8" x="110" height="4" width="140" fill="${col}"/><rect y="16" x="110" height="1.5" width="140" fill="${col}"/><rect y="${W - 12}" x="110" height="4" width="140" fill="${col}"/><rect y="${W - 17.5}" x="110" height="1.5" width="140" fill="${col}"/>`); }
A["goth-frame-night"] = [360, 360, frame("#c4182b", "#ff6a70")];
A["goth-frame-day"] = [360, 360, frame("#16120e", "#9c1319")];
A["goth-frame-oxblood"] = A["goth-frame-night"];
A["goth-frame-absinthe"] = [360, 360, frame("#5fa82e", "#b6f07f")];
A["goth-frame-amethyst"] = [360, 360, frame("#8a4fd0", "#c39bff")];
A["goth-frame-rosewater"] = [360, 360, frame("#c9477f", "#ff9ad0")];
const skull = (f, k) => svg(120, 120, `<path d="M60 10C30 10 16 30 18 56C19 68 26 74 32 78L34 96C34 102 40 104 44 102V94H52V104H68V94H76V102C80 104 86 102 86 96L88 78C94 74 101 68 102 56C104 30 90 10 60 10Z" fill="${f}"/><path d="M28 54C28 44 36 40 46 42C54 44 54 56 48 62C40 68 28 64 28 54ZM92 54C92 44 84 40 74 42C66 44 66 56 72 62C80 68 92 64 92 54Z" fill="${k}"/><path d="M60 62L54 78H66Z" fill="${k}"/><path d="M6 110L114 90M6 90L114 110" stroke="${f}" stroke-width="7" stroke-linecap="round"/>`);
A["goth-skull"] = [120, 120, skull("#e5263a", "#0a090c")];

/* ---------- Kawaii ---------- */
const die = `<filter id="die" x="-15%" y="-15%" width="130%" height="130%"><feMorphology in="SourceAlpha" operator="dilate" radius="6" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="w"/><feDropShadow in="w" dx="2" dy="4" stdDeviation="2" flood-color="#3e0f2c" flood-opacity=".45" result="sh"/><feMerge><feMergeNode in="sh"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
const K = "#3e0f2c";
function cat(fur, eyes = "open", extra = "") {
  const e = eyes === "open" ? `<ellipse cx="72" cy="104" rx="15" ry="20" fill="${K}"/><ellipse cx="148" cy="104" rx="15" ry="20" fill="${K}"/><circle cx="77" cy="95" r="6" fill="#fff"/><circle cx="153" cy="95" r="6" fill="#fff"/><circle cx="67" cy="112" r="3" fill="#fff"/><circle cx="143" cy="112" r="3" fill="#fff"/>` : `<path d="M56 108Q72 88 88 108M132 108Q148 88 164 108" fill="none" stroke="${K}" stroke-width="7" stroke-linecap="round"/>`;
  return `<g stroke="${K}" stroke-width="6" stroke-linejoin="round"><path d="M34 74L28 12L88 40Z" fill="${fur}"/><path d="M186 74L192 12L132 40Z" fill="${fur}"/><path d="M42 54L40 26L66 40Z" fill="#ffb3d4" stroke="none"/><path d="M178 54L180 26L154 40Z" fill="#ffb3d4" stroke="none"/><ellipse cx="110" cy="102" rx="92" ry="72" fill="${fur}"/></g>${e}<ellipse cx="46" cy="130" rx="15" ry="9" fill="#ff8fb8"/><ellipse cx="174" cy="130" rx="15" ry="9" fill="#ff8fb8"/><path d="M98 126q6 8 12 0q6 8 12 0" fill="none" stroke="${K}" stroke-width="5" stroke-linecap="round"/><path d="M14 104L-4 98M14 118H-6M206 104L224 98M206 118H226" stroke="${K}" stroke-width="4" stroke-linecap="round"/>${extra}`;
}
A["kawaii-cat"] = [260, 200, svg(260, 200, `<g filter="url(#die)" transform="translate(20 8)">${cat("#fffdfb")}</g>`, die)];
A["kawaii-cat2"] = [260, 200, svg(260, 200, `<g filter="url(#die)" transform="translate(20 8)">${cat("#ffe14d", "happy", `<path d="M110 10l6 14 14 6-14 6-6 14-6-14-14-6 14-6z" fill="#ff5c9c" stroke="${K}" stroke-width="4"/>`)}</g>`, die)];
A["kawaii-cat3"] = [260, 200, svg(260, 200, `<g filter="url(#die)" transform="translate(20 8)">${cat("#a8e6ff", "open")}</g>`, die)];
A["kawaii-tomato"] = [160, 160, svg(160, 160, `<g filter="url(#die)"><circle cx="80" cy="90" r="52" fill="#ff5a4f" stroke="${K}" stroke-width="5"/><path d="M80 44L66 26L82 34L96 22L90 42L110 46L86 52L72 62L74 48L54 46Z" fill="#6fce5a" stroke="${K}" stroke-width="4" stroke-linejoin="round"/><ellipse cx="60" cy="74" rx="11" ry="6" fill="#ffc7c0" transform="rotate(-30 60 74)"/><circle cx="66" cy="98" r="5" fill="${K}"/><circle cx="94" cy="98" r="5" fill="${K}"/><path d="M74 108q6 6 12 0" fill="none" stroke="${K}" stroke-width="4" stroke-linecap="round"/></g>`, die)];
A["kawaii-ramune"] = [130, 300, svg(130, 300, `<g filter="url(#die)"><path d="M46 18H84V52C84 62 92 66 98 78C110 98 110 124 104 150C100 170 106 190 106 230C106 270 96 284 65 284C34 284 24 270 24 230C24 190 30 170 26 150C20 124 20 98 32 78C38 66 46 62 46 52Z" fill="url(#gl)" stroke="${K}" stroke-width="5"/><rect x="42" y="8" width="46" height="16" rx="6" fill="#ff8fb8" stroke="${K}" stroke-width="5"/><circle cx="65" cy="88" r="17" fill="#fff" stroke="${K}" stroke-width="4"/><circle cx="60" cy="83" r="5" fill="#bfe9ff"/><rect x="28" y="168" width="74" height="62" rx="10" fill="#fff" stroke="${K}" stroke-width="4"/><path d="M65 178c12-12 22 4 0 18c-22-14-12-30 0-18z" fill="#ff5c9c"/><text x="65" y="222" font-family="sans-serif" font-size="15" font-weight="800" text-anchor="middle" fill="${K}">SODA</text><circle cx="42" cy="130" r="4" fill="#fff"/><circle cx="84" cy="148" r="3" fill="#fff"/><circle cx="52" cy="154" r="3" fill="#fff"/></g>`, die + `<linearGradient id="gl" x1="0" x2="1"><stop offset="0" stop-color="#ffd0e4"/><stop offset=".5" stop-color="#ff9cc4"/><stop offset="1" stop-color="#ffd0e4"/></linearGradient>`)];
A["kawaii-doodles"] = [420, 420, svg(420, 420, [["M30 60q10-18 20 0t20 0t20 0", "#ff7fb5"], ["M300 340q10-18 20 0t20 0t20 0", "#7fdcff"], ["M60 300c20-30 50 10 30 30s-50-10-20-40", "#ffd400"], ["M320 70c20-30 50 10 30 30s-50-10-20-40", "#a78bff"]].map(([d, c]) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`).join("") + [[200, 60, "#ffd400"], [120, 180, "#7fdcff"], [360, 210, "#ff7fb5"], [240, 330, "#a78bff"]].map(([x, y, c]) => `<path transform="translate(${x} ${y})" d="M0-16l5 11 11 5-11 5-5 11-5-11-11-5 11-5z" fill="${c}"/>`).join("") + `<path transform="translate(40 150) scale(.9)" d="M0 8c-12-14-26 2-12 16l12 12 12-12c14-14 0-30-12-16z" fill="#ff7fb5"/><path transform="translate(270 180) scale(.8)" d="M0 8c-12-14-26 2-12 16l12 12 12-12c14-14 0-30-12-16z" fill="#ffd400"/>`)];
A["kawaii-doodles"].push(true);

/* ---------- Acanthus ---------- */
function acLeaf(len, lobes, c1, c2, vein) {
  let top = `M0 0`, bot = `M0 0`, v = "";
  const w = len * .42, steps = lobes;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, t0 = (i - 1) / steps, x = t * len, x0 = t0 * len, wid = w * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** .75 * (1 - t * .25);
    const tipx = x0 + (x - x0) * 1.15, curl = wid * .25;
    top += `Q${x0 + 2} ${-wid * 1.1} ${tipx} ${-wid - curl}Q${tipx - 4} ${-wid * .5} ${x} ${-wid * .42}`;
    bot += `Q${x0 + 2} ${wid * 1.1} ${tipx} ${wid + curl}Q${tipx - 4} ${wid * .5} ${x} ${wid * .42}`;
    v += `M${x0 + (x - x0) * .2} 0Q${x0 + 6} ${-wid * .5} ${tipx - 3} ${-wid * .9}M${x0 + (x - x0) * .2} 0Q${x0 + 6} ${wid * .5} ${tipx - 3} ${wid * .9}`;
  }
  return `<path d="${top}L${len * 1.08} 0L0 0Z" fill="${c1}" stroke="${c2}" stroke-width=".8"/><path d="${bot}L${len * 1.08} 0L0 0Z" fill="${c2}" stroke="${c1}" stroke-width=".8"/><path d="M0 0L${len * 1.05} 0" stroke="${vein}" stroke-width="2.2"/><path d="${v}" fill="none" stroke="${vein}" stroke-width="1.1"/>`;
}
function acFlower(r, c1, c2, c3) { let s = ""; for (let i = 0; i < 8; i++) s += `<path transform="rotate(${i * 45})" d="M0 0C${-r * .55} ${-r * .4} ${-r * .5} ${-r * 1.05} 0 ${-r * 1.1}C${r * .5} ${-r * 1.05} ${r * .55} ${-r * .4} 0 0Z" fill="${c1}" stroke="${c2}" stroke-width="1.2"/><path transform="rotate(${i * 45})" d="M0 ${-r * .3}L0 ${-r * .95}" stroke="${c2}" stroke-width="1"/>`; for (let i = 0; i < 6; i++) s += `<path transform="rotate(${i * 60 + 20})" d="M0 0C${-r * .3} ${-r * .2} ${-r * .28} ${-r * .55} 0 ${-r * .6}C${r * .28} ${-r * .55} ${r * .3} ${-r * .2} 0 0Z" fill="${c2}"/>`; return s + `<circle r="${r * .2}" fill="${c3}" stroke="${c2}"/>`; }
function wall(p) {
  const S = 600; let els = "";
  const stems = [`M0 300C150 80 450 520 600 300`, `M300 0C80 150 520 450 300 600`, `M0 90C120 40 200 160 300 120S520 40 600 90`, `M0 510C120 460 220 580 300 540S480 460 600 510`];
  const stem = stems.map((d) => `<path d="${d}" fill="none" stroke="${p.stem}" stroke-width="7"/><path d="${d}" fill="none" stroke="${p.stemHi}" stroke-width="1.5"/>`).join("");
  const L = [[40, 240, -50, 130], [150, 190, 35, 150], [200, 330, 150, 120], [330, 230, -30, 150], [440, 370, 40, 150], [560, 340, -140, 120], [270, 90, 200, 120], [330, 480, 100, 130], [230, 500, -70, 110], [100, 420, 110, 130], [470, 150, -60, 130], [520, 240, 80, 110], [60, 60, 30, 100], [430, 510, -20, 110], [160, 40, 130, 90]];
  L.forEach(([x, y, r, l], i) => { const [a, b] = p.leaves[i % p.leaves.length]; const g = acLeaf(l * 1.5, 6, a, b, p.vein); for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) if (x + dx > -180 && x + dx < S + 180 && y + dy > -180 && y + dy < S + 180) els += `<g transform="translate(${x + dx} ${y + dy}) rotate(${r})">${g}</g>`; });
  const F = [[120, 110, 44, 0], [420, 90, 34, 1], [300, 300, 52, 0], [90, 490, 36, 1], [500, 470, 46, 0], [590, 200, 26, 1], [210, 410, 24, 1], [400, 250, 22, 0]];
  F.forEach(([x, y, r, k]) => { const [a, b, c] = p.flowers[k]; const g = acFlower(r, a, b, c); for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) if (x + dx > -80 && x + dx < S + 80 && y + dy > -80 && y + dy < S + 80) els += `<g transform="translate(${x + dx} ${y + dy})">${g}</g>`; });
  let bits = ""; for (let i = 0; i < 40; i++) { const x = rnd(600), y = rnd(600); bits += `<circle cx="${x}" cy="${y}" r="${rnd(1.5, 3.5)}" fill="${p.dot}"/>`; }
  return svg(S, S, `<rect width="${S}" height="${S}" fill="${p.bg}"/>${bits}${stem}${els}`);
}
A["acanthus-wall-night"] = [600, 600, wall({ bg: "#101a30", stem: "#8c7a4d", stemHi: "#d8c07f", vein: "#0f2a26", dot: "#3a4a6a", leaves: [["#5f8a6a", "#3f6b52"], ["#8fae7f", "#5f8a6a"], ["#a9b97f", "#6f9163"]], flowers: [["#e58b7e", "#a2453e", "#f1cf6b"], ["#f1cf6b", "#a8791f", "#e58b7e"]] }), false, 1];
A["acanthus-wall-day"] = [600, 600, wall({ bg: "#e6dec3", stem: "#a8955f", stemHi: "#efe6c8", vein: "#6f8469", dot: "#cfc5a2", leaves: [["#a8bb98", "#8aa17e"], ["#bfcda6", "#a8bb98"], ["#98ae88", "#7d9672"]], flowers: [["#e0a08c", "#b86a58", "#edd28e"], ["#edd28e", "#c39b4a", "#e0a08c"]] }), false, 1];
const goldDefs = `<linearGradient id="au" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8e7a8"/><stop offset=".35" stop-color="#c9a24a"/><stop offset=".55" stop-color="#fff2bf"/><stop offset=".8" stop-color="#a97f2c"/><stop offset="1" stop-color="#e8cc7a"/></linearGradient><linearGradient id="bl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9db6d6"/><stop offset="1" stop-color="#4f6e9c"/></linearGradient><filter id="dp" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="1.5" dy="2" stdDeviation="1.2" flood-color="#2a1d05" flood-opacity=".6"/></filter>`;
function cScroll() {
  const d = "M8 150C2 90 20 40 70 18C110 2 152 8 150 40C148 64 112 62 112 42C112 30 128 28 130 40";
  const d2 = "M40 160C30 110 44 70 80 54C100 46 118 56 110 72";
  return `<g filter="url(#dp)" fill="none" stroke-linecap="round"><path d="${d}" stroke="url(#au)" stroke-width="13"/><path d="${d}" stroke="#7a5a1e" stroke-width="1.2" transform="translate(3 2)"/><path d="${d2}" stroke="url(#bl)" stroke-width="7"/><path d="M160 12C190 2 214 10 226 22" stroke="url(#au)" stroke-width="7"/><path d="M12 160C2 190 10 214 22 226" stroke="url(#au)" stroke-width="7"/></g><g filter="url(#dp)"><path transform="translate(60 74) rotate(-40)" d="${"M0 0C10-14 30-14 44 0C30 8 10 8 0 0Z"}" fill="url(#au)"/><path transform="translate(30 104) rotate(-100)" d="M0 0C8-10 22-10 32 0C22 6 8 6 0 0Z" fill="url(#au)"/><circle cx="130" cy="40" r="6" fill="url(#bl)"/><circle cx="26" cy="26" r="9" fill="url(#au)"/></g>`;
}
{ const W = 520, c = cScroll(); A["acanthus-cartouche"] = [W, W, svg(W, W, `<g>${c}</g><g transform="translate(${W} 0) scale(-1 1)">${c}</g><g transform="translate(0 ${W}) scale(1 -1)">${c}</g><g transform="translate(${W} ${W}) scale(-1 -1)">${c}</g><g fill="url(#au)"><rect x="220" y="6" width="80" height="6"/><rect x="220" y="${W - 12}" width="80" height="6"/><rect x="6" y="220" width="6" height="80"/><rect x="${W - 12}" y="220" width="6" height="80"/></g>`, goldDefs)]; }
{ let s = ""; for (let i = -6; i <= 6; i++) s += `<path transform="rotate(${i * 14} 100 96)" d="M100 96C88 66 90 30 100 8C110 30 112 66 100 96Z" fill="url(#au)" stroke="#7a5a1e" stroke-width="1"/>`; A["acanthus-shell"] = [200, 110, svg(200, 110, `<g filter="url(#dp)">${s}<path d="M60 98C80 88 120 88 140 98C120 108 80 108 60 98Z" fill="url(#bl)" stroke="#2c4468"/></g>`, goldDefs)]; }
function vignette(ink, hatch) {
  let h = ""; for (let i = 0; i < 26; i++) h += `<path d="M${30 + rnd(10)} ${10 + i * 5}H${370 - rnd(10)}" stroke="${hatch}" stroke-width=".7"/>`;
  let cols = ""; for (let i = 0; i < 6; i++) { const x = 96 + i * 42; cols += `<rect x="${x}" y="108" width="14" height="66" fill="none" stroke="${ink}" stroke-width="1.5"/><path d="M${x + 4} 110V172M${x + 8} 110V172M${x + 11} 110V172" stroke="${ink}" stroke-width=".6"/><path d="M${x - 3} 106h20M${x - 3} 176h20" stroke="${ink}" stroke-width="2"/>`; }
  const tree = (x, s) => { let t = `<path d="M${x} 190V${190 - 40 * s}" stroke="${ink}" stroke-width="3"/>`; for (let i = 0; i < 46; i++) { const a = rnd(6.28), r = rnd(0, 26 * s); t += `<path d="M${x + Math.cos(a) * r} ${190 - 62 * s + Math.sin(a) * r}q3-5 6 0" fill="none" stroke="${ink}" stroke-width="1"/>`; } return t; };
  return svg(400, 220, `${h}<path d="M100 104L200 54L300 104Z" fill="none" stroke="${ink}" stroke-width="2.5"/><path d="M122 100L200 64L278 100" fill="none" stroke="${ink}"/><circle cx="200" cy="84" r="8" fill="none" stroke="${ink}"/><path d="M160 58Q200 14 240 58" fill="none" stroke="${ink}" stroke-width="2"/><path d="M170 58Q200 26 230 58M185 42V58M200 34V58M215 42V58" fill="none" stroke="${ink}"/><path d="M200 22v-10M196 12h8" stroke="${ink}" stroke-width="2"/>${cols}<path d="M70 178H330M60 184H340M50 190H350" stroke="${ink}" stroke-width="2"/><path d="M88 106H312" stroke="${ink}" stroke-width="3"/>${tree(50, 1.1)}${tree(350, 1.1)}<path d="M186 176V136Q200 120 214 136V176Z" fill="${ink}"/>`);
}
A["acanthus-vignette-day"] = [400, 220, vignette("#23302c", "#23302c55")];
A["acanthus-vignette-night"] = [400, 220, vignette("#e6cf8b", "#e6cf8b44")];
A["acanthus-seal"] = [120, 120, svg(120, 120, `<g filter="url(#dp)"><path d="M60 6C72 4 76 14 86 14C98 16 96 28 104 34C114 42 106 52 110 62C114 74 102 78 100 88C96 100 84 96 76 104C66 112 56 104 46 108C34 110 32 98 22 94C10 88 16 76 10 68C4 56 14 50 14 40C14 28 26 28 32 20C40 10 50 14 60 6Z" fill="url(#w)"/><circle cx="60" cy="58" r="33" fill="none" stroke="#6e1410" stroke-width="3"/><circle cx="60" cy="58" r="33" fill="none" stroke="#e8857a" stroke-width="1" transform="translate(1 1)"/><path d="M60 34C50 46 50 62 60 80C70 62 70 46 60 34ZM60 80C50 72 42 62 38 50C48 54 56 64 60 80ZM60 80C70 72 78 62 82 50C72 54 64 64 60 80Z" fill="#6e1410"/></g>`, goldDefs + `<radialGradient id="w" cx=".35" cy=".3"><stop offset="0" stop-color="#d9463a"/><stop offset="1" stop-color="#8e1a14"/></radialGradient>`)];

/* ---------- Synthwave ---------- */
function palm(x, base, h, f) {
  const tx = x + h * .12, ty = base - h; let s = `<path d="M${x - 7} ${base}C${x - 2} ${base - h * .5} ${x + 2} ${base - h * .8} ${tx - 3} ${ty}L${tx + 3} ${ty}C${x + 9} ${base - h * .8} ${x + 8} ${base - h * .5} ${x + 7} ${base}Z" fill="${f}"/>`;
  for (const [a, l] of [[-170, 1], [-140, .95], [-110, .8], [-75, .8], [-40, .95], [-10, 1], [20, .85], [160, .85]]) { const L = h * .46 * l, rad = (a * Math.PI) / 180, ex = tx + Math.cos(rad) * L, ey = ty + Math.sin(rad) * L + L * .42, mx = tx + Math.cos(rad) * L * .5, my = ty + Math.sin(rad) * L * .6 - L * .1; let fr = `<path d="M${tx} ${ty}Q${mx} ${my} ${ex} ${ey}Q${mx} ${my + L * .2} ${tx} ${ty}Z" fill="${f}"/>`; for (let i = 2; i < 9; i++) { const t = i / 9, px = (1 - t) ** 2 * tx + 2 * (1 - t) * t * mx + t * t * ex, py = (1 - t) ** 2 * ty + 2 * (1 - t) * t * my + t * t * ey; fr += `<path d="M${px} ${py}l${-6 + (ex > tx ? 10 : -6)} ${16 * (1 - t) + 6}l4 -${10 * (1 - t) + 6}z" fill="${f}" stroke="${f}"/>`; } s += fr; }
  return s;
}
function synth(c) {
  const W = 1400, H = 700, Hz = 440; let s = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  if (c.stars) for (let i = 0; i < 180; i++) s += `<circle cx="${rnd(W)}" cy="${rnd(Hz - 60)}" r="${rnd(.5, 1.9)}" fill="#fff" opacity="${rnd(.3, 1)}"/>`;
  s += `<circle cx="700" cy="300" r="250" fill="${c.sun2}" opacity=".35" filter="url(#b)"/><g clip-path="url(#sc)"><circle cx="700" cy="290" r="190" fill="url(#sun)"/></g>`;
  // Mountains, wireframed.
  const mts = (base, amp, col, fill) => { const pts = []; for (let x = -40; x <= W + 40; x += 60) pts.push([x, base - Math.abs(x - 700) / 700 * amp * rnd(.55, 1.1) - rnd(0, 26)]); let d = `M-40 ${Hz}`; pts.forEach((p) => (d += `L${p[0]} ${p[1]}`)); d += `L${W + 40} ${Hz}Z`; let w = `<path d="${d}" fill="${fill}" stroke="${col}" stroke-width="2"/>`; pts.forEach((p, i) => { w += `<path d="M${p[0]} ${p[1]}L${p[0] + (700 - p[0]) * .08} ${Hz}" stroke="${col}" stroke-width="1" opacity=".7"/>`; if (pts[i + 1]) w += `<path d="M${p[0]} ${p[1]}L${pts[i + 1][0] + (700 - pts[i + 1][0]) * .08} ${Hz}" stroke="${col}" stroke-width=".8" opacity=".5"/>`; }); return w; };
  s += mts(Hz - 10, 200, c.mt2, c.mf2) + mts(Hz, 110, c.mt, c.mf);
  // Ground and grid.
  s += `<rect y="${Hz}" width="${W}" height="${H - Hz}" fill="url(#gnd)"/>`;
  for (let i = -24; i <= 24; i++) s += `<path d="M${700 + i * 26} ${Hz}L${700 + i * 190} ${H}" stroke="${c.grid}" stroke-width="2"/>`;
  for (let i = 1; i < 16; i++) { const y = Hz + (H - Hz) * (i / 16) ** 2.1; s += `<path d="M0 ${y}H${W}" stroke="${c.grid}" stroke-width="${1 + i * .12}"/>`; }
  s += `<path d="M640 ${Hz}L220 ${H}H1180L760 ${Hz}Z" fill="${c.road}"/>`;
  for (let i = 0; i < 7; i++) { const a = (i / 7) ** 2, b = ((i + .5) / 7) ** 2; const y1 = Hz + (H - Hz) * a, y2 = Hz + (H - Hz) * b, w1 = 2 + a * 12, w2 = 2 + b * 12; s += `<path d="M${700 - w1} ${y1}H${700 + w1}L${700 + w2} ${y2}H${700 - w2}Z" fill="${c.lane}"/>`; }
  s += `<path d="M640 ${Hz}L220 ${H}M760 ${Hz}L1180 ${H}" stroke="${c.lane2}" stroke-width="4"/>`;
  s += `<rect y="${Hz - 3}" width="${W}" height="6" fill="${c.lane2}" filter="url(#b2)"/>`;
  s += palm(150, 610, 400, c.palm) + palm(1260, 620, 430, c.palm) + palm(290, 520, 240, c.palm) + palm(1120, 520, 220, c.palm);
  // A wedge sports car, from behind.
  s += `<g transform="translate(700 610)"><ellipse cx="0" cy="62" rx="190" ry="16" fill="#000" opacity=".5"/><path d="M-170 40L-158 -4L-92 -60H92L158 -4L170 40V56H-170Z" fill="${c.car}" stroke="${c.carL}" stroke-width="2.5"/><path d="M-84 -54H84L128 -10H-128Z" fill="url(#gls)" stroke="${c.carL}" stroke-width="2"/><path d="M-84 -38H84M-96 -28H96M-108 -19H108" stroke="${c.carL}" stroke-width="2.5"/><rect x="-166" y="2" width="332" height="24" fill="#120410" stroke="${c.carL}" stroke-width="2"/><rect x="-160" y="6" width="70" height="16" fill="#ff1f3d" filter="url(#g)"/><rect x="90" y="6" width="70" height="16" fill="#ff1f3d" filter="url(#g)"/><path d="M-80 14H80" stroke="#ff1f3d" stroke-width="3" filter="url(#g)"/><rect x="-168" y="-2" width="336" height="3" fill="${c.carL}"/><rect x="-160" y="52" width="52" height="16" fill="#000"/><rect x="108" y="52" width="52" height="16" fill="#000"/></g>`;
  if (c.bolt) s += `<path d="M1040 0L1010 70L1036 74L990 170L1010 110L986 106L1020 0Z" fill="#fff" filter="url(#g2)" opacity=".9"/>`;
  return svg(W, H, s, `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.s1}"/><stop offset=".45" stop-color="${c.s2}"/><stop offset=".65" stop-color="${c.s3}"/></linearGradient><linearGradient id="gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.g1}"/><stop offset="1" stop-color="${c.g2}"/></linearGradient><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset=".1" stop-color="${c.sun1}"/><stop offset=".85" stop-color="${c.sun2}"/></linearGradient><linearGradient id="gls" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1d5e"/><stop offset="1" stop-color="#ff4fb0"/></linearGradient><clipPath id="sc">${[[0, 268], [282, 26], [316, 22], [346, 18], [374, 14], [398, 10], [418, 6]].map(([y, h]) => `<rect x="400" y="${y}" width="600" height="${h}"/>`).join("")}<rect x="400" y="100" width="600" height="0"/></clipPath><filter id="b"><feGaussianBlur stdDeviation="50"/></filter><filter id="b2" x="-5%" y="-300%" width="110%" height="700%"><feGaussianBlur stdDeviation="5"/></filter><filter id="g" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="5" result="x"/><feMerge><feMergeNode in="x"/><feMergeNode in="x"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="g2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="x"/><feMerge><feMergeNode in="x"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
}
A["synth-night"] = [1400, 700, synth({ stars: 1, bolt: 1, s1: "#07031a", s2: "#2d0f63", s3: "#a11c8c", g1: "#16052f", g2: "#07021a", sun1: "#ffe45e", sun2: "#ff2fa0", mt: "#27e8ff", mf: "#10062c", mt2: "#7a3cff", mf2: "#1c0a44", grid: "#ff2fa0", road: "#0b0420cc", lane: "#fff", lane2: "#27e8ff", palm: "#05020f", car: "#1a0a3a", carL: "#27e8ff" })];
A["synth-day"] = [1400, 700, synth({ s1: "#fbe3b4", s2: "#f7b768", s3: "#ee6f45", g1: "#8a2348", g2: "#3a1226", sun1: "#fff0b0", sun2: "#d92f4d", mt: "#7f1a3f", mf: "#c2475a", mt2: "#a8354f", mf2: "#e8835a", grid: "#ffb36b", road: "#2a0c1ccc", lane: "#ffe9b8", lane2: "#ffc15e", palm: "#2a0c1c", car: "#3a1226", carL: "#ffc15e" })];
A["synth-glint"] = [80, 80, svg(80, 80, `<path d="M40 0Q42 36 80 40Q42 44 40 80Q38 44 0 40Q38 36 40 0Z" fill="#fff" filter="url(#g)"/>`, `<filter id="g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2" result="x"/><feMerge><feMergeNode in="x"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`)];

/* ---------- Vaporwave ---------- */
const marble = `<filter id="m" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="turbulence" baseFrequency=".012 .03" numOctaves="4" seed="4" result="t"/><feColorMatrix in="t" values="0 0 0 0 .55 0 0 0 0 .5 0 0 0 0 .7 1.5 0 0 0 -.25" result="v"/><feComposite in="v" in2="SourceAlpha" operator="in" result="vv"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="vv"/></feMerge></filter><radialGradient id="st" cx=".32" cy=".3" r=".85"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#e9e2ee"/><stop offset=".78" stop-color="#ff9fe0"/><stop offset="1" stop-color="#6a4fd8"/></radialGradient><linearGradient id="st2" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#dcd2ea"/><stop offset="1" stop-color="#7f5fe0"/></linearGradient>`;
{ let curls = ""; const C = [[98, 74, 26], [130, 50, 30], [170, 38, 32], [212, 44, 30], [248, 66, 28], [270, 100, 24], [84, 106, 24], [278, 138, 20], [74, 142, 20], [120, 84, 18], [160, 72, 18], [206, 76, 18], [244, 96, 16]]; C.forEach(([x, y, r]) => (curls += `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#st)"/><path d="M${x - r * .5} ${y}a${r * .5} ${r * .5} 0 1 1 ${r * .7} ${r * .4}" fill="none" stroke="#8d7ac0" stroke-width="2"/>`));
  let px = ""; const G = ["0111111100111111100", "1222222210122222221", "1233222210123322221", "1222222111122222221", "0122222100012222210", "0011111000001111100"]; G.forEach((r, y) => [...r].forEach((v, x) => { if (v !== "0") px += `<rect x="${x * 9}" y="${y * 9}" width="9.4" height="9.4" fill="${v === "1" ? "#000" : v === "3" ? "#fff" : "#111"}"/>`; }));
  A["vapor-bust"] = [360, 520, svg(360, 520, `<g filter="url(#m)"><path d="M40 520C40 440 70 400 136 380L134 300H226L224 380C290 400 320 440 320 520Z" fill="url(#st2)"/><path d="M92 170C90 260 120 330 180 340C240 330 270 260 268 170C266 100 94 100 92 170Z" fill="url(#st)"/>${curls}<path d="M92 190C74 186 72 226 96 238ZM268 190C286 186 288 226 264 238Z" fill="url(#st)"/><path d="M180 186L168 250C176 258 186 258 194 250Z" fill="#d6c6ea"/><path d="M152 282Q180 272 208 282Q180 300 152 282Z" fill="#f2b9de"/></g><path d="M152 282Q180 288 208 282" fill="none" stroke="#6a4fd8" stroke-width="2"/><path d="M70 460Q180 410 290 460" fill="none" stroke="#8d7ac0" stroke-width="2"/><path d="M90 490Q180 440 270 490" fill="none" stroke="#8d7ac0" stroke-width="2"/><g transform="translate(95 172)">${px}</g><path d="M92 196L60 186M268 196L300 186" stroke="#000" stroke-width="8"/><circle cx="238" cy="296" r="34" fill="url(#gum)"/><ellipse cx="228" cy="284" rx="9" ry="6" fill="#fff" opacity=".8"/>`, marble + `<radialGradient id="gum" cx=".35" cy=".3"><stop offset="0" stop-color="#ffc7ee"/><stop offset="1" stop-color="#ff3fb8"/></radialGradient>`)]; }
A["vapor-column"] = [160, 520, svg(160, 520, `<g filter="url(#m)"><path d="M10 0H150V18H134L126 44H34L26 18H10Z" fill="url(#st2)"/><path d="M34 44H126L134 480H26Z" fill="url(#st2)"/><path d="M18 480H142V520H18Z" fill="url(#st2)"/></g><path d="M52 46L46 478M72 46L70 478M92 46L94 478M112 46L118 478" stroke="#8d7ac0" stroke-width="3"/><path d="M34 44H126M26 480H134" stroke="#6a4fd8" stroke-width="3"/>`, marble)];
A["vapor-sphere"] = [200, 200, svg(200, 200, `<circle cx="100" cy="100" r="96" fill="url(#ch)"/><path d="M6 100Q100 150 194 100Q190 190 100 196Q10 190 6 100Z" fill="url(#ch2)" opacity=".9"/><path d="M4 100Q100 138 196 100" fill="none" stroke="#14093f" stroke-width="3"/><ellipse cx="66" cy="50" rx="26" ry="14" fill="#fff" opacity=".9" transform="rotate(-30 66 50)"/>`, `<linearGradient id="ch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05e6ff"/><stop offset=".45" stop-color="#fff"/><stop offset=".5" stop-color="#ff71ce"/></linearGradient><linearGradient id="ch2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14093f"/><stop offset=".5" stop-color="#ff71ce"/><stop offset="1" stop-color="#fff"/></linearGradient>`)];
A["vapor-palm"] = [340, 500, svg(340, 500, palm(150, 500, 420, "url(#p)"), `<linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7dffcf"/><stop offset=".55" stop-color="#05b8a8"/><stop offset="1" stop-color="#ff71ce"/></linearGradient>`)];
A["vapor-cursor"] = [64, 80, svg(64, 80, `<path d="M26 6C20 6 20 12 20 16V44L12 36C8 32 2 36 6 42L22 66C26 72 30 74 38 74H46C54 74 58 68 58 60V36C58 30 50 30 50 36V34C50 28 42 28 42 34V32C42 26 34 26 34 32V16C34 10 32 6 26 6Z" fill="#fff" stroke="#000" stroke-width="4" stroke-linejoin="round"/>`)];

/* ---------- Neo-brutal ---------- */
const B = "#000";
A["brut-computer"] = [240, 240, svg(240, 240, `<g stroke="${B}" stroke-width="6" stroke-linejoin="round"><path d="M46 28H206V170H46Z" fill="#000"/><path d="M34 16H194V158H34Z" fill="#f4ead8"/><path d="M52 34H176V118H52Z" fill="#7fdcff"/><path d="M50 196H190V222H50Z" fill="#f4ead8"/><path d="M92 158H138V196H92Z" fill="#f4ead8"/><rect x="146" y="130" width="30" height="10" fill="#ff5cad"/></g><circle cx="90" cy="70" r="7" fill="${B}"/><circle cx="138" cy="70" r="7" fill="${B}"/><path d="M92 90Q114 110 136 90" fill="none" stroke="${B}" stroke-width="6" stroke-linecap="round"/>`)];
A["brut-heart"] = [200, 190, svg(200, 190, `<path d="M108 58C126 16 196 28 186 86C180 124 138 150 108 176C78 150 36 124 30 86C20 28 90 16 108 58Z" fill="#000" transform="translate(6 6)"/><path d="M100 54C118 12 188 24 178 82C172 120 130 146 100 172C70 146 28 120 22 82C12 24 82 12 100 54Z" fill="#ff5a3c" stroke="${B}" stroke-width="6"/><circle cx="74" cy="78" r="7" fill="${B}"/><circle cx="126" cy="78" r="7" fill="${B}"/><path d="M78 102Q100 122 122 102" fill="none" stroke="${B}" stroke-width="6" stroke-linecap="round"/>`)];
A["brut-burst"] = [220, 220, svg(220, 220, `<polygon points="${Array.from({ length: 28 }, (_, i) => { const r = i % 2 ? 72 : 104, a = (i / 28) * 6.283; return `${110 + Math.cos(a) * r},${110 + Math.sin(a) * r}`; }).join(" ")}" fill="#ffd400" stroke="${B}" stroke-width="6" stroke-linejoin="round"/>`)];
A["brut-smile"] = [160, 160, svg(160, 160, `<circle cx="84" cy="84" r="66" fill="#000"/><circle cx="76" cy="76" r="66" fill="#a7f070" stroke="${B}" stroke-width="6"/><path d="M54 52V78M98 52V78" stroke="${B}" stroke-width="9" stroke-linecap="round"/><path d="M40 92Q76 136 112 92" fill="none" stroke="${B}" stroke-width="7" stroke-linecap="round"/>`)];
A["brut-hello"] = [260, 150, svg(260, 150, `<path d="M18 16H250V104H90L52 140L58 104H18Z" fill="#000" transform="translate(6 6)"/><path d="M12 10H244V98H84L46 134L52 98H12Z" fill="#fff" stroke="${B}" stroke-width="6" stroke-linejoin="round"/><text x="128" y="72" text-anchor="middle" font-family="Archivo Black" font-size="46" fill="#000">HELLO!</text>`)];

(async () => {
  const b = await chromium.launch();
  const only = process.argv.slice(2);
  for (const [name, [w, h, src, tile, one]] of Object.entries(A)) {
    if (only.length && !only.some((o) => name.startsWith(o))) continue;
    const scale = tile || one ? 1 : w > 1000 ? 1 : 2;
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    await p.setContent(`<!doctype html><link rel=stylesheet href="https://fonts.googleapis.com/css2?family=Archivo+Black"><style>html,body{margin:0;background:transparent}svg{display:block}</style>${src}`, { waitUntil: "networkidle" });
    await p.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: true });
    await p.close();
  }
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith(".png"));
  const q = await b.newPage({ viewport: { width: 1800, height: 1500 } });
  await q.setContent(`<body style="margin:0;background:#667;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;color:#fff;font:11px sans-serif">${files.map((f) => `<div><img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, f)).toString("base64")}" style="max-width:${/night|day/.test(f) && !/frame|vignette/.test(f) ? 440 : 210}px;max-height:300px;display:block"><span>${f}</span></div>`).join("")}`);
  await q.screenshot({ path: path.join(__dirname, "art.png") });
  for (const f of files) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + "KB");
  await b.close();
})();
