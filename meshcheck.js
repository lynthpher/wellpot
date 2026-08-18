#!/usr/bin/env node
/*
 * meshcheck.js — watertightness / manifold check for the wellpot outer pot.
 *
 * The geometry lives inline in index.html (browser). This script extracts the
 * pure-geometry module (defaultParams … PotCore, no DOM/THREE deps), evaluates
 * it in Node, exports the outer-pot binary STL for a spread of presets
 * (smallest and largest included), parses the STL back, and verifies the mesh
 * is a closed manifold: every directed edge (a→b) appears exactly once and is
 * paired with exactly one reverse (b→a). Any unpaired edge is a hole; any edge
 * seen more than once is non-manifold.
 *
 * Run:  node meshcheck.js
 * Exit: 0 if every preset is watertight, 1 otherwise.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ---- load the geometry module out of index.html -------------------------
function loadPotCore() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const start = html.indexOf('function defaultParams');
  const marker = 'const PotCore = {';
  const pcIdx = html.indexOf(marker, start);
  if (start < 0 || pcIdx < 0) throw new Error('could not locate geometry module in index.html');
  const end = html.indexOf('};', pcIdx) + 2;
  const code = html.slice(start, end);
  // The block is plain JS (function decls + a couple consts + PotCore literal).
  return new Function(code + '\nreturn PotCore;')();
}

// ---- rebuild a preset's outer-pot params the way the app does -----------
// (Only outer-pot-relevant fields matter here; buildOuter ignores foot params.)
function preset(PotCore, over) {
  const p = Object.assign({}, PotCore.defaultParams(), over);
  if (p.RIB_DEPTH !== 0) {                    // app's "look" normalization
    p.RIB_DEPTH = 1.0;
    p.RIB_COUNT = Math.round(Math.PI * p.OUTER_D / 6);
  }
  return p;
}

const PRESETS = [
  { n: 'Test pot (smallest)', p: { OUTER_D: 70, H: 32, LEDGE_Z: 20, RIB_DEPTH: 0, BASE_BAND_H: 0, TOP_BAND_H: 0 } },
  { n: 'Thyme (small)',       p: { OUTER_D: 100, H: 120, LEDGE_Z: 25 } },
  { n: 'Oregano (dry)',       p: { OUTER_D: 120, H: 150, LEDGE_Z: 30 } },
  { n: 'Medium',              p: { OUTER_D: 130, H: 150, LEDGE_Z: 40 } },
  { n: 'Large',               p: { OUTER_D: 170, H: 180, LEDGE_Z: 45 } },
  { n: 'Cherry tomato (largest)', p: { OUTER_D: 200, H: 200, LEDGE_Z: 52 } },
];

// ---- parse binary STL into a flat triangle-vertex list ------------------
function parseBinarySTL(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const count = dv.getUint32(80, true);
  const tris = [];
  let o = 84;
  for (let i = 0; i < count; i++) {
    o += 12; // skip normal
    const v = [];
    for (let k = 0; k < 9; k++) { v.push(dv.getFloat32(o, true)); o += 4; }
    o += 2;  // attribute byte count
    tris.push(v);
  }
  return tris;
}

// ---- manifold / watertight check ----------------------------------------
function checkWatertight(tris) {
  // Fuse coincident vertices on a fine grid: shared edges reuse bit-identical
  // vertices (fuse at any tolerance), while genuinely-distinct vertices near the
  // cap centers stay ~5e-5 mm apart, so 1e-5 separates them without false holes.
  const EPS = Number(process.env.EPS || 1e-5);
  const key = (x, y, z) =>
    Math.round(x / EPS) + ',' + Math.round(y / EPS) + ',' + Math.round(z / EPS);
  const edges = new Map(); // "ka|kb" -> count
  let degenerate = 0;
  for (const t of tris) {
    const a = key(t[0], t[1], t[2]);
    const b = key(t[3], t[4], t[5]);
    const c = key(t[6], t[7], t[8]);
    if (a === b || b === c || c === a) { degenerate++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = u + '|' + v;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let nonmanifold = 0, boundary = 0;
  for (const [k, n] of edges) {
    if (n !== 1) nonmanifold++;                 // directed edge seen more than once
    const [u, v] = k.split('|');
    if (!edges.has(v + '|' + u)) boundary++;     // no reverse → open edge (hole)
  }
  return { tris: tris.length, degenerate, nonmanifold, boundary,
           ok: degenerate === 0 && nonmanifold === 0 && boundary === 0 };
}

// ---- run -----------------------------------------------------------------
function main() {
  const PotCore = loadPotCore();
  let allOk = true;
  console.log('meshcheck — outer pot watertightness\n');
  for (const { n, p } of PRESETS) {
    const params = preset(PotCore, p);
    const mesh = PotCore.buildOuter(params);
    const stl = PotCore.toBinarySTL(mesh); // ArrayBuffer
    const r = checkWatertight(parseBinarySTL(stl));
    allOk = allOk && r.ok;
    console.log(
      (r.ok ? 'PASS' : 'FAIL') + '  ' + n.padEnd(24) +
      '  tris=' + String(r.tris).padStart(6) +
      '  nonmanifold=' + r.nonmanifold +
      '  openEdges=' + r.boundary +
      '  degenerate=' + r.degenerate
    );
  }
  console.log('\n' + (allOk ? 'ALL WATERTIGHT' : 'WATERTIGHTNESS FAILED'));
  process.exit(allOk ? 0 : 1);
}

main();
