// Generates the seed content: five simple assets and one composition that combines them, all under
// assets/mattashes/ and compositions/mattashes/. They exist to exercise the pipeline end to end, so
// they aim for correct rather than beautiful; the real kit comes from contributors.
//
// Everything is deterministic: running this again produces the same files.
// Run: node tools/seed/build.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Document, type Material, NodeIO } from "@gltf-transform/core";
import { addPrimitive, box, type MeshData } from "../lib/mesh.ts";
import { encodePng, seededRandom } from "../lib/png.ts";

const REPO = path.resolve(import.meta.dirname, "../..");
// SEED_OUT lets tests regenerate into a scratch folder and compare with the committed files.
const ROOT = process.env.SEED_OUT ? path.resolve(process.env.SEED_OUT) : REPO;
const AUTHOR = "mattashes";
const config = JSON.parse(readFileSync(path.join(REPO, "project.config.json"), "utf8"));
const SOURCE_URL = `https://github.com/${config.github.owner}/${config.github.repo}/blob/main/tools/seed/build.ts`;
const io = new NodeIO();

// ---------------------------------------------------------------------------------------------
// Procedural textures

/** Smooth 2D value noise in [0, 1], tiling with the given period. */
function valueNoise(seed: number, period: number) {
  const rand = seededRandom(seed);
  const grid = Array.from({ length: period * period }, () => rand());
  const at = (x: number, y: number) =>
    grid[
      (((y % period) + period) % period) * period + (((x % period) + period) % period)
    ] as number;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f);
    amp /= 2;
    f *= 2;
  }
  return sum / (1 - 0.5 ** octaves);
}

const mix = (a: number[], b: number[], t: number) =>
  a.map((v, i) => v + ((b[i] as number) - v) * t);

/** Wood grain running along the texture's u axis. */
function woodTexture(size: number, seed: number, light: number[], dark: number[]): Uint8Array {
  const n = valueNoise(seed, 16);
  return encodePng(size, size, (x, y) => {
    const u = x / size;
    const v = y / size;
    const warp = fbm(n, u * 4, v * 16) * 2.5;
    const rings = 0.5 + 0.5 * Math.sin((v * 22 + warp) * Math.PI * 2);
    const streak = fbm(n, u * 32, v * 64, 2);
    return mix(light, dark, Math.min(1, rings * 0.65 + streak * 0.35));
  });
}

function appleTexture(size: number): Uint8Array {
  const n = valueNoise(11, 16);
  const rand = seededRandom(12);
  const speck = Array.from({ length: 900 }, () => [rand() * size, rand() * size]);
  return encodePng(size, size, (x, y) => {
    const u = x / size;
    const v = y / size; // 0 = top of the image = v of 0 in glTF (top of the apple at the stem)
    const streaks = fbm(n, u * 24, v * 3, 3);
    let c = mix([196, 32, 34], [228, 150, 50], Math.max(0, streaks - 0.45) * 1.6);
    c = mix(c, [120, 20, 24], Math.max(0, 0.35 - v) * 0.8); // darker near the stem cavity
    if (v < 0.035) c = [92, 64, 34]; // the stem
    for (const [sx, sy] of speck)
      if (Math.hypot(x - (sx as number), y - (sy as number)) < 1.2)
        c = mix(c, [240, 210, 140], 0.6);
    return c;
  });
}

function lemonTexture(size: number): Uint8Array {
  const n = valueNoise(21, 32);
  return encodePng(size, size, (x, y) => {
    const pores = fbm(n, (x / size) * 32, (y / size) * 32, 2);
    return mix([246, 214, 60], [214, 172, 30], pores * 0.7);
  });
}

// ---------------------------------------------------------------------------------------------
// Geometry

type P2 = [number, number];

/** Catmull-Rom subdivision of a polyline, keeping its end points. */
function smoothPath(points: P2[], steps: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)] as P2;
    const p1 = points[i] as P2;
    const p2 = points[i + 1] as P2;
    const p3 = points[Math.min(points.length - 1, i + 2)] as P2;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1] as P2);
  return out;
}

/**
 * A surface of revolution around +Y. The profile is a list of (radius, height) points; the
 * visible side is to the right of the direction of travel, so go outward along the bottom, up the
 * outside, and back in along the top or inside.
 */
function lathe(profile: P2[], segments: number): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const lengths = [0];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1] as P2;
    const b = profile[i] as P2;
    lengths.push((lengths[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lengths[lengths.length - 1] as number;
  const rows = profile.length;
  for (let i = 0; i < rows; i++) {
    const prev = profile[Math.max(0, i - 1)] as P2;
    const next = profile[Math.min(rows - 1, i + 1)] as P2;
    const tr = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const len = Math.hypot(tr, ty) || 1;
    const [nr, ny] = [ty / len, -tr / len];
    const [r, y] = profile[i] as P2;
    for (let j = 0; j <= segments; j++) {
      const th = (j / segments) * Math.PI * 2;
      positions.push(r * Math.cos(th), y, r * Math.sin(th));
      normals.push(nr * Math.cos(th), ny, nr * Math.sin(th));
      uvs.push(j / segments, 1 - (lengths[i] as number) / total);
    }
  }
  const w = segments + 1;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * w + j;
      const b = (i + 1) * w + j;
      const c = (i + 1) * w + j + 1;
      const d = i * w + j + 1;
      if ((profile[i + 1] as P2)[0] > 1e-9) indices.push(a, b, c); // skip triangles collapsed on the axis
      if ((profile[i] as P2)[0] > 1e-9) indices.push(a, c, d);
    }
  }
  // Flip v so the top of the profile is at the top of the image (glTF v = 0 at the top).
  for (let k = 1; k < uvs.length; k += 2) uvs[k] = 1 - (uvs[k] as number);
  return { positions, normals, uvs, indices };
}

/**
 * Extrudes a convex outline in the XZ plane from y0 to y1, with a top and bottom cap.
 * UVs: caps are planar (scaled by `uvScale` per metre), sides run along the perimeter.
 */
function extrude(outline: P2[], y0: number, y1: number, uvScale: number): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const n = outline.length;
  // Make the outline counter-clockwise seen from above (+Y), i.e. clockwise in (x, z).
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = outline[i] as P2;
    const b = outline[(i + 1) % n] as P2;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const pts = area > 0 ? [...outline].reverse() : outline;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cz = pts.reduce((s, p) => s + p[1], 0) / n;
  for (const [y, ny] of [
    [y1, 1],
    [y0, -1],
  ] as const) {
    const start = positions.length / 3;
    positions.push(cx, y, cz);
    normals.push(0, ny, 0);
    uvs.push(cx * uvScale, cz * uvScale);
    for (const [x, z] of pts) {
      positions.push(x, y, z);
      normals.push(0, ny, 0);
      uvs.push(x * uvScale, z * uvScale);
    }
    for (let i = 0; i < n; i++) {
      const a = start + 1 + i;
      const b = start + 1 + ((i + 1) % n);
      if (ny > 0) indices.push(start, b, a);
      else indices.push(start, a, b);
    }
  }
  // Sides, with normals averaged at each outline point for a smooth look on curves.
  const edgeNormal = (i: number): P2 => {
    const a = pts[i] as P2;
    const b = pts[(i + 1) % n] as P2;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const nrm: P2 = [-dz / l, dx / l];
    // Point away from the centre (the outline is convex).
    const mx = (a[0] + b[0]) / 2 - cx;
    const mz = (a[1] + b[1]) / 2 - cz;
    return nrm[0] * mx + nrm[1] * mz < 0 ? [-nrm[0], -nrm[1]] : nrm;
  };
  let run = 0;
  const start = positions.length / 3;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const p = pts[k] as P2;
    const e1 = edgeNormal((k - 1 + n) % n);
    const e2 = edgeNormal(k);
    const sharp = e1[0] * e2[0] + e1[1] * e2[1] < 0.7;
    const nn: P2 = sharp ? e2 : [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2];
    const l = Math.hypot(nn[0], nn[1]) || 1;
    if (i > 0) {
      const q = pts[(i - 1) % n] as P2;
      run += Math.hypot(p[0] - q[0], p[1] - q[1]);
    }
    positions.push(p[0], y0, p[1], p[0], y1, p[1]);
    normals.push(nn[0] / l, 0, nn[1] / l, nn[0] / l, 0, nn[1] / l);
    uvs.push(run * uvScale, y0 * uvScale, run * uvScale, y1 * uvScale);
  }
  for (let i = 0; i < n; i++) {
    const a = start + i * 2;
    indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
  }
  return { positions, normals, uvs, indices };
}

/** Outward normals check: flips the winding of any triangle whose face normal disagrees. */
function fixWinding(m: MeshData): MeshData {
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [
      m.indices[t] as number,
      m.indices[t + 1] as number,
      m.indices[t + 2] as number,
    ];
    const p = (i: number) => [
      m.positions[i * 3] as number,
      m.positions[i * 3 + 1] as number,
      m.positions[i * 3 + 2] as number,
    ];
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const u = pb.map((v, k) => v - (pa[k] as number));
    const v = pc.map((x, k) => x - (pa[k] as number));
    const fn = [
      (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
      (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
      (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
    ];
    const vn = [0, 1, 2].map(
      (k) =>
        (m.normals[a * 3 + k] as number) +
        (m.normals[b * 3 + k] as number) +
        (m.normals[c * 3 + k] as number),
    );
    const dot = fn.reduce((sum, f, k) => sum + (f as number) * (vn[k] as number), 0);
    if (dot < 0) {
      m.indices[t + 1] = c;
      m.indices[t + 2] = b;
    }
  }
  return m;
}

function roundedRect(w: number, d: number, r: number, cornerSteps = 8): P2[] {
  const pts: P2[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, d / 2 - r, 0],
    [-w / 2 + r, d / 2 - r, 90],
    [-w / 2 + r, -d / 2 + r, 180],
    [w / 2 - r, -d / 2 + r, 270],
  ];
  for (const [cx, cz, start] of corners) {
    for (let s = 0; s <= cornerSteps; s++) {
      const a = ((start + (s / cornerSteps) * 90) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  }
  return pts;
}

function transform(
  m: MeshData,
  f: (p: number[]) => number[],
  g: (n: number[]) => number[],
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < m.positions.length; i += 3) {
    positions.push(...f(m.positions.slice(i, i + 3)));
    normals.push(...g(m.normals.slice(i, i + 3)));
  }
  return { ...m, positions, normals };
}

function bounds(meshes: MeshData[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, m.positions[i + k] as number);
        max[k] = Math.max(max[k] as number, m.positions[i + k] as number);
      }
  return { min, max };
}

/** Moves meshes so the lowest point is at y = 0 and the footprint is centred on the origin. */
function ground(meshes: MeshData[]): MeshData[] {
  const { min, max } = bounds(meshes);
  const dx = -((min[0] as number) + (max[0] as number)) / 2;
  const dy = -(min[1] as number);
  const dz = -((min[2] as number) + (max[2] as number)) / 2;
  return meshes.map((m) =>
    transform(
      m,
      ([x, y, z]) => [(x as number) + dx, (y as number) + dy, (z as number) + dz],
      (n) => n,
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// The assets

interface Part {
  mesh: MeshData;
  material: string;
}

interface AssetDef {
  slug: string;
  name: string;
  sizeClass: "small" | "medium" | "large";
  tags: string[];
  parts: Part[];
  materials: Record<string, (doc: Document) => Material>;
  collision?: MeshData[];
}

const texMaterial = (name: string, png: Uint8Array, roughness: number) => (doc: Document) =>
  doc
    .createMaterial(name)
    .setRoughnessFactor(roughness)
    .setMetallicFactor(0)
    .setBaseColorTexture(doc.createTexture(name).setImage(png).setMimeType("image/png"));

// Cutting board: 42 × 30 × 2 cm, rounded corners.
const BOARD = { w: 0.42, d: 0.3, h: 0.02 };
const cuttingBoard: AssetDef = {
  slug: "cutting-board",
  name: "Cutting board, wooden",
  sizeClass: "medium",
  tags: ["kitchen", "wood", "board"],
  parts: [
    { mesh: extrude(roundedRect(BOARD.w, BOARD.d, 0.025), 0, BOARD.h, 2), material: "Board" },
  ],
  materials: {
    Board: texMaterial("Board", woodTexture(512, 1, [214, 170, 118], [168, 118, 70]), 0.75),
  },
  collision: [
    (() => {
      const b = box(-BOARD.w / 2, 0, -BOARD.d / 2, BOARD.w / 2, BOARD.h, BOARD.d / 2);
      delete b.uvs;
      return b;
    })(),
  ],
};

// Bowl: 24 cm across, 8 cm tall, turned wood.
const BOWL_INNER: P2[] = smoothPath(
  [
    [0.112, 0.08],
    [0.108, 0.06],
    [0.098, 0.04],
    [0.08, 0.024],
    [0.05, 0.014],
    [0.0, 0.012],
  ],
  4,
);
const BOWL_PROFILE: P2[] = [
  [0, 0],
  [0.03, 0],
  [0.045, 0],
  [0.047, 0.003],
  ...smoothPath(
    [
      [0.05, 0.005],
      [0.075, 0.015],
      [0.1, 0.035],
      [0.114, 0.058],
      [0.12, 0.079],
    ],
    4,
  ),
  [0.119, 0.0815],
  [0.116, 0.0825],
  [0.113, 0.0815],
  ...BOWL_INNER,
];
const woodenBowl: AssetDef = {
  slug: "wooden-bowl",
  name: "Bowl, turned wood",
  sizeClass: "small",
  tags: ["kitchen", "wood", "bowl", "tableware"],
  parts: [{ mesh: lathe(BOWL_PROFILE, 56), material: "Bowl" }],
  materials: { Bowl: texMaterial("Bowl", woodTexture(512, 2, [176, 120, 72], [124, 80, 44]), 0.6) },
};

/** Height of the bowl's inner surface at radius r (from the asset's own origin). */
function bowlInnerHeight(r: number): number {
  const pts = [...BOWL_INNER].reverse(); // increasing radius
  if (r > (pts[pts.length - 1] as P2)[0]) return Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as P2;
    const b = pts[i] as P2;
    if (r <= b[0]) return a[1] + ((b[1] - a[1]) * (r - a[0])) / (b[0] - a[0] || 1);
  }
  return Infinity;
}

// Apple: about 8.4 cm across, with a stem.
const APPLE_PROFILE = smoothPath(
  [
    [0, 0.005],
    [0.01, 0.0018],
    [0.02, 0.0],
    [0.031, 0.004],
    [0.038, 0.012],
    [0.042, 0.025],
    [0.0425, 0.037],
    [0.04, 0.049],
    [0.034, 0.059],
    [0.025, 0.066],
    [0.016, 0.0695],
    [0.008, 0.068],
    [0.003, 0.0635],
    [0, 0.0625],
  ],
  4,
);
const stem = (() => {
  const s = lathe(
    [
      [0, 0.06],
      [0.0022, 0.06],
      [0.0018, 0.074],
      [0.0012, 0.079],
      [0, 0.0795],
    ],
    8,
  );
  // Squeeze the stem's UVs into the brown band at the top of the apple texture.
  for (let k = 1; k < (s.uvs as number[]).length; k += 2) (s.uvs as number[])[k] = 0.012;
  // Lean it a little.
  return transform(
    s,
    ([x, y, z]) => [(x as number) + ((y as number) - 0.06) * 0.15, y as number, z as number],
    (n) => n,
  );
})();
const apple: AssetDef = {
  slug: "apple-red",
  name: "Apple, red",
  sizeClass: "small",
  tags: ["food", "fruit", "kitchen"],
  parts: [
    { mesh: lathe(APPLE_PROFILE, 48), material: "Apple" },
    { mesh: stem, material: "Apple" },
  ],
  materials: { Apple: texMaterial("Apple", appleTexture(256), 0.45) },
};

// Lemon: about 7.6 cm long, lying on its side (long axis along X).
const LEMON_PROFILE: P2[] = (() => {
  const pts: P2[] = [];
  const L = 0.033;
  const R = 0.026;
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI;
    const tip = Math.exp(-((t / 0.25) ** 2)) + Math.exp(-(((Math.PI - t) / 0.25) ** 2));
    const r = R * Math.sin(t) ** 0.85;
    const y = -Math.cos(t) * (L + 0.005 * tip);
    pts.push([i === 0 || i === 40 ? 0 : r, y]);
  }
  return pts;
})();
const lemonMesh = transform(
  lathe(LEMON_PROFILE, 40),
  // Rotate -90° about Z: the long axis (Y) becomes X.
  ([x, y, z]) => [y as number, -(x as number), z as number],
  ([x, y, z]) => [y as number, -(x as number), z as number],
);
const lemon: AssetDef = {
  slug: "lemon",
  name: "Lemon",
  sizeClass: "small",
  tags: ["food", "fruit", "kitchen", "citrus"],
  parts: [{ mesh: lemonMesh, material: "Lemon" }],
  materials: { Lemon: texMaterial("Lemon", lemonTexture(256), 0.55) },
};

// Kitchen knife: 26 cm, lying flat, blade along +X.
const BLADE: P2[] = [
  [0, 0.001],
  [0, 0.036],
  [0.06, 0.035],
  [0.1, 0.031],
  [0.125, 0.024],
  [0.142, 0.014],
  [0.15, 0.005],
  [0.152, 0.001],
];
const knife: AssetDef = {
  slug: "kitchen-knife",
  name: "Kitchen knife",
  sizeClass: "small",
  tags: ["kitchen", "utensil", "knife"],
  parts: [
    { mesh: extrude(BLADE, 0, 0.0025, 4), material: "Steel" },
    {
      mesh: transform(
        extrude(roundedRect(0.11, 0.026, 0.009, 6), 0, 0.019, 6),
        ([x, y, z]) => [(x as number) - 0.056, y as number, (z as number) + 0.0175],
        (n) => n,
      ),
      material: "Handle",
    },
  ],
  materials: {
    Steel: (doc) =>
      doc
        .createMaterial("Steel")
        .setBaseColorFactor([0.78, 0.79, 0.8, 1])
        .setMetallicFactor(1)
        .setRoughnessFactor(0.28),
    Handle: texMaterial("Handle", woodTexture(256, 3, [92, 60, 40], [52, 32, 22]), 0.55),
  },
};

export const SEED_ASSETS = [cuttingBoard, woodenBowl, apple, lemon, knife];

async function writeAsset(def: AssetDef) {
  const grounded = ground([...def.parts.map((p) => p.mesh), ...(def.collision ?? [])]);
  const doc = new Document();
  doc.createBuffer();
  const mats = new Map(Object.entries(def.materials).map(([k, make]) => [k, make(doc)]));
  const mesh = doc.createMesh(def.name);
  def.parts.forEach((p, i) => {
    mesh.addPrimitive(
      addPrimitive(doc, fixWinding(grounded[i] as MeshData), mats.get(p.material) ?? null),
    );
  });
  doc.createScene("Scene").addChild(doc.createNode(def.name).setMesh(mesh));
  const dir = path.join(ROOT, "assets", AUTHOR, def.slug, "v1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "model.glb"), await io.writeBinary(doc));

  if (def.collision) {
    const cdoc = new Document();
    cdoc.createBuffer();
    const root = cdoc.createNode("Collision");
    def.collision.forEach((_, i) => {
      const m = grounded[def.parts.length + i] as MeshData;
      root.addChild(
        cdoc
          .createNode(`hull-${i + 1}`)
          .setMesh(cdoc.createMesh(`hull-${i + 1}`).addPrimitive(addPrimitive(cdoc, m, null))),
      );
    });
    cdoc.createScene().addChild(root);
    writeFileSync(path.join(dir, "collision.glb"), await io.writeBinary(cdoc));
  }
  const manifest = {
    spec: "0.1",
    id: `${AUTHOR}/${def.slug}`,
    version: 1,
    name: def.name,
    license: "CC0-1.0",
    size_class: def.sizeClass,
    tags: def.tags,
    credits: [{ github: AUTHOR, roles: ["directed", "coded"] }],
    ai_assisted: true,
    tools: ["tools/seed/build.ts", "glTF-Transform", "Claude"],
    source_url: SOURCE_URL,
  };
  writeFileSync(path.join(dir, "asset.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return grounded.slice(0, def.parts.length);
}

// ---------------------------------------------------------------------------------------------
// The composition: everything on the board, fruit resting in the bowl.

type Quat = [number, number, number, number];
const yaw = (deg: number): Quat => {
  const a = (deg * Math.PI) / 360;
  return [0, Number(Math.sin(a).toFixed(7)), 0, Number(Math.cos(a).toFixed(7))];
};
const rotateY = ([x, y, z]: number[], q: Quat): number[] => {
  const a = 2 * Math.atan2(q[1], q[3]);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    (x as number) * c + (z as number) * s,
    y as number,
    -(x as number) * s + (z as number) * c,
  ];
};
const r4 = (n: number) => Number(n.toFixed(4));

/**
 * The height at which a fruit placed at (px, pz) inside the bowl first touches the bowl's inner
 * surface: the smallest lift so no vertex is below the surface.
 */
function restInBowl(meshes: MeshData[], q: Quat, px: number, pz: number): number {
  let lift = -Infinity;
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i += 3) {
      const [x, y, z] = rotateY(m.positions.slice(i, i + 3), q);
      const h = bowlInnerHeight(Math.hypot((x as number) + px, (z as number) + pz));
      if (!Number.isFinite(h)) throw new Error("fruit sticks out of the bowl");
      lift = Math.max(lift, h - (y as number));
    }
  return lift;
}

async function main() {
  const meshes = new Map<string, MeshData[]>();
  for (const def of SEED_ASSETS) meshes.set(def.slug, await writeAsset(def));
  const ref = (slug: string) => `${AUTHOR}/${slug}@1`;

  const top = BOARD.h; // the board's top surface
  const bowlAt = [-0.07, top, 0];
  const fruit: { slug: string; q: Quat; px: number; pz: number }[] = [
    { slug: "apple-red", q: yaw(0), px: -0.042, pz: 0.024 },
    { slug: "apple-red", q: yaw(130), px: 0.044, pz: 0.03 },
    { slug: "lemon", q: yaw(12), px: 0.0, pz: -0.052 },
  ];
  const items = [
    { asset: ref("cutting-board"), position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    { asset: ref("wooden-bowl"), position: bowlAt, rotation: [0, 0, 0, 1] },
    ...fruit.map((f) => {
      const lift = restInBowl(meshes.get(f.slug) as MeshData[], f.q, f.px, f.pz) + 0.0003;
      return {
        asset: ref(f.slug),
        position: [
          r4((bowlAt[0] as number) + f.px),
          r4((bowlAt[1] as number) + lift),
          r4((bowlAt[2] as number) + f.pz),
        ],
        rotation: f.q,
      };
    }),
    { asset: ref("kitchen-knife"), position: [0.135, top, 0.0], rotation: yaw(90) },
  ];
  const composition = {
    spec: "0.1",
    id: `${AUTHOR}/fruit-bowl`,
    version: 1,
    name: "Fruit bowl on a cutting board",
    license: "CC0-1.0",
    tags: ["kitchen", "food", "still-life"],
    credits: [{ github: AUTHOR, roles: ["directed"] }],
    ai_assisted: true,
    tools: ["tools/seed/build.ts", "Claude"],
    source_url: SOURCE_URL,
    items,
  };
  const dir = path.join(ROOT, "compositions", AUTHOR, "fruit-bowl", "v1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "composition.json"), `${JSON.stringify(composition, null, 2)}\n`);
  console.log(`Wrote ${SEED_ASSETS.length} assets and 1 composition.`);
}

if (import.meta.main) await main();
