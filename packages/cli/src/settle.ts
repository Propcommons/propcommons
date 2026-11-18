// `propcommons settle <composition folder>`: drops every item of a composition straight down,
// bottom of the pile first, until it rests on the ground or on an item settled before it, then
// centres the scene's footprint on the origin. No physics: each item keeps its x, z and rotation,
// and only its height changes. This replaces "lower each item until it touches" by hand, and a
// physics drop when the positions and rotations are already chosen.
//
// Contact is found by casting vertical rays from every vertex of the falling item down onto the
// triangles below it, and from every vertex below up onto the falling item's triangles. Points
// every millimetre along long edges catch contacts where edges cross, to within a fraction of a
// millimetre.
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  CannotValidate,
  findRepoRoot,
  PINNED,
  placedPrimitives,
  readModelFile,
  UsageError,
  type Vec3,
} from "@propcommons/validator";

export interface SettleItem {
  asset: string;
  position: number[];
  rotation: number[];
  scale?: number;
}

export interface SettledItem {
  index: number;
  asset: string;
  /** Height before and after settling, in metres. */
  from: number;
  to: number;
  /** What it rests on: "ground" or the 1-based index of an earlier item. */
  restsOn: "ground" | number;
}

export interface SettleResult {
  items: SettledItem[];
  /** How far the whole scene moved in x and z to centre its footprint. */
  shift: [number, number];
  /** The composition as it was written (or would be, with dryRun). */
  composition: { items: SettleItem[] } & Record<string, unknown>;
}

interface LocalMesh {
  positions: Vec3[];
  triangles: number[];
}

const CELL = 0.01; // metres; grid cell for ray queries
const EDGE_STEP = 0.001; // metres between extra points along an edge
const EDGE_STEPS_MAX = 200; // at most this many per edge

/** A grid over x and z of triangles, for vertical ray queries. */
class TriangleGrid {
  cells = new Map<string, number[]>();
  ax: number[] = [];
  ay: number[] = [];
  az: number[] = [];
  owner: number[] = [];

  add(points: Vec3[], triangles: number[], owner: number) {
    for (let t = 0; t + 2 < triangles.length; t += 3) {
      const a = points[triangles[t] as number] as Vec3;
      const b = points[triangles[t + 1] as number] as Vec3;
      const c = points[triangles[t + 2] as number] as Vec3;
      const id = this.owner.length;
      this.ax.push(a[0], b[0], c[0]);
      this.ay.push(a[1], b[1], c[1]);
      this.az.push(a[2], b[2], c[2]);
      this.owner.push(owner);
      const x0 = Math.floor(Math.min(a[0], b[0], c[0]) / CELL);
      const x1 = Math.floor(Math.max(a[0], b[0], c[0]) / CELL);
      const z0 = Math.floor(Math.min(a[2], b[2], c[2]) / CELL);
      const z1 = Math.floor(Math.max(a[2], b[2], c[2]) / CELL);
      for (let i = x0; i <= x1; i++)
        for (let k = z0; k <= z1; k++) {
          const key = `${i},${k}`;
          const list = this.cells.get(key);
          if (list) list.push(id);
          else this.cells.set(key, [id]);
        }
    }
  }

  /** Heights where a vertical line at (x, z) crosses the triangles, with each one's owner. */
  *hits(x: number, z: number): Generator<[number, number]> {
    const list = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!list) return;
    for (const id of list) {
      const j = id * 3;
      const x1 = this.ax[j] as number;
      const z1 = this.az[j] as number;
      const x2 = this.ax[j + 1] as number;
      const z2 = this.az[j + 1] as number;
      const x3 = this.ax[j + 2] as number;
      const z3 = this.az[j + 2] as number;
      const d = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3);
      if (Math.abs(d) < 1e-14) continue; // seen edge-on from above
      const u = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / d;
      const v = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / d;
      const w = 1 - u - v;
      const eps = -1e-9;
      if (u < eps || v < eps || w < eps) continue;
      const y =
        u * (this.ay[j] as number) +
        v * (this.ay[j + 1] as number) +
        w * (this.ay[j + 2] as number);
      yield [y, this.owner[id] as number];
    }
  }
}

/** The item's vertices placed by its rotation (normalised), scale and x, z; y position 0. */
function placeAtGround(item: SettleItem, points: Vec3[]): Vec3[] {
  const [px, , pz] = item.position as Vec3;
  const q = item.rotation as [number, number, number, number];
  const n = Math.hypot(...q) || 1;
  const [x, y, z, w] = q.map((c) => c / n) as [number, number, number, number];
  const s = typeof item.scale === "number" ? item.scale : 1;
  const r0 = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)].map((v) => v * s);
  const r1 = [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)].map((v) => v * s);
  const r2 = [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)].map((v) => v * s);
  return points.map(([a, b, c]) => [
    (r0[0] as number) * a + (r0[1] as number) * b + (r0[2] as number) * c + px,
    (r1[0] as number) * a + (r1[1] as number) * b + (r1[2] as number) * c,
    (r2[0] as number) * a + (r2[1] as number) * b + (r2[2] as number) * c + pz,
  ]);
}

async function loadMesh(root: string, ref: string): Promise<LocalMesh> {
  const m = PINNED.exec(ref);
  if (!m) throw new CannotValidate(`"${ref}" is not a pinned asset ID like author/slug@1.`);
  const file = path.join(root, "assets", m[1] as string, m[2] as string, `v${m[3]}`, "model.glb");
  try {
    if (!lstatSync(file).isFile()) throw new Error("not a file");
  } catch {
    throw new CannotValidate(`${ref} has no model at ${path.relative(root, file)}.`);
  }
  const prims = placedPrimitives(await readModelFile(file));
  const positions: Vec3[] = [];
  const triangles: number[] = [];
  for (const p of prims) {
    const offset = positions.length;
    positions.push(...p.positions);
    for (const t of p.triangles) triangles.push(t + offset);
  }
  // Extra points along long edges, so contacts where edges cross (two boxes at an angle) are
  // found too. They only serve as ray origins: no triangle uses them.
  const seen = new Set<string>();
  const vertexCount = positions.length;
  for (let t = 0; t + 2 < triangles.length; t += 3)
    for (const [i, j] of [
      [triangles[t], triangles[t + 1]],
      [triangles[t + 1], triangles[t + 2]],
      [triangles[t + 2], triangles[t]],
    ] as [number, number][]) {
      if (i >= vertexCount || j >= vertexCount) continue;
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = positions[i] as Vec3;
      const b = positions[j] as Vec3;
      const steps = Math.min(
        EDGE_STEPS_MAX,
        Math.floor(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / EDGE_STEP),
      );
      for (let k = 1; k < steps; k++) {
        const f = k / steps;
        positions.push([
          a[0] + (b[0] - a[0]) * f,
          a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f,
        ]);
      }
    }
  return { positions, triangles };
}

/**
 * The order to settle items in: an item goes before every item that sits above it where the two
 * overlap seen from above, as they are placed now. Each pair is decided by casting vertical rays
 * from one item's vertices onto the other's triangles and counting which is on top more often.
 * Among items free to go next, the one whose lowest point is lowest goes first; if items each sit
 * partly on the other, the lowest of them goes first.
 */
function settleOrder(
  items: SettleItem[],
  locals: Vec3[][],
  meshes: Map<string, LocalMesh>,
): number[] {
  const n = items.length;
  const placed = locals.map((local, i) => {
    const y = items[i]?.position[1] as number;
    return local.map((p) => [p[0], p[1] + y, p[2]] as Vec3);
  });
  const box = placed.map((pts) => {
    const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity];
    for (const p of pts) {
      b[0] = Math.min(b[0] as number, p[0]);
      b[1] = Math.max(b[1] as number, p[0]);
      b[2] = Math.min(b[2] as number, p[2]);
      b[3] = Math.max(b[3] as number, p[2]);
      b[4] = Math.min(b[4] as number, p[1]);
    }
    return b as [number, number, number, number, number];
  });
  const grids = placed.map((pts, i) => {
    const g = new TriangleGrid();
    g.add(pts, (meshes.get(items[i]?.asset as string) as LocalMesh).triangles, i);
    return g;
  });
  /** Votes that b is above a: b's vertices above a's surface, a's vertices below b's surface. */
  const votes = (a: number, b: number): number => {
    let v = 0;
    const [x0, x1, z0, z1] = box[a] as number[];
    for (const p of placed[b] as Vec3[]) {
      if (
        p[0] < (x0 as number) ||
        p[0] > (x1 as number) ||
        p[2] < (z0 as number) ||
        p[2] > (z1 as number)
      )
        continue;
      for (const [y] of (grids[a] as TriangleGrid).hits(p[0], p[2])) v += p[1] >= y ? 1 : -1;
    }
    return v;
  };
  const below: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      const A = box[a] as number[];
      const B = box[b] as number[];
      if ((A[1] as number) < (B[0] as number) || (B[1] as number) < (A[0] as number)) continue;
      if ((A[3] as number) < (B[2] as number) || (B[3] as number) < (A[2] as number)) continue;
      const v = votes(a, b) - votes(b, a);
      if (v > 0) (below[b] as Set<number>).add(a);
      else if (v < 0) (below[a] as Set<number>).add(b);
    }
  const done = new Set<number>();
  const order: number[] = [];
  const lowest = (i: number) => (box[i] as number[])[4] as number;
  const byLowest = (a: number, b: number) => lowest(a) - lowest(b) || a - b;
  while (order.length < n) {
    const left = [...Array(n).keys()].filter((i) => !done.has(i));
    const free = left.filter((i) => [...(below[i] as Set<number>)].every((j) => done.has(j)));
    const next = (free.length ? free : left).sort(byLowest)[0] as number;
    done.add(next);
    order.push(next);
  }
  return order;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5 + 0;

export async function settleComposition(
  folder: string,
  options: { root?: string; dryRun?: boolean; center?: boolean } = {},
): Promise<SettleResult> {
  const file = path.join(folder, "composition.json");
  let composition: SettleResult["composition"];
  try {
    composition = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new CannotValidate(`Couldn't read ${file} as JSON.`);
  }
  if (!Array.isArray(composition?.items)) throw new CannotValidate(`${file} has no "items" list.`);
  const root = options.root ?? findRepoRoot(folder);
  const meshes = new Map<string, LocalMesh>();
  const scene = new TriangleGrid();
  const scenePoints: { p: Vec3; owner: number }[] = [];
  const settled: SettledItem[] = [];
  const allPlaced: Vec3[][] = [];

  const locals: Vec3[][] = [];
  for (const [i, item] of composition.items.entries()) {
    if (
      typeof item?.asset !== "string" ||
      !Array.isArray(item.position) ||
      item.position.length !== 3 ||
      !Array.isArray(item.rotation) ||
      item.rotation.length !== 4
    )
      throw new CannotValidate(
        `Item ${i + 1} needs an asset, a position [x, y, z] and a rotation [x, y, z, w].`,
      );
    let mesh = meshes.get(item.asset);
    if (!mesh) {
      mesh = await loadMesh(root, item.asset);
      meshes.set(item.asset, mesh);
    }
    locals.push(placeAtGround(item, mesh.positions));
  }
  const order = settleOrder(composition.items, locals, meshes);

  for (const i of order) {
    const item = composition.items[i] as SettleItem;
    const mesh = meshes.get(item.asset) as LocalMesh;
    const local = locals[i] as Vec3[];
    // The ground: the item's lowest point at y = 0.
    let lift = -Math.min(...local.map((p) => p[1]));
    let restsOn: "ground" | number = "ground";
    // The item's vertices onto what is already placed.
    for (const p of local)
      for (const [y, owner] of scene.hits(p[0], p[2]))
        if (y - p[1] > lift) {
          lift = y - p[1];
          restsOn = owner + 1;
        }
    // What is already placed onto the item's underside.
    const own = new TriangleGrid();
    own.add(local, mesh.triangles, i);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of local) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    for (const { p, owner } of scenePoints) {
      if (p[0] < minX || p[0] > maxX || p[2] < minZ || p[2] > maxZ) continue;
      for (const [y] of own.hits(p[0], p[2]))
        if (p[1] - y > lift) {
          lift = p[1] - y;
          restsOn = owner + 1;
        }
    }
    const placed = local.map((p) => [p[0], p[1] + lift, p[2]] as Vec3);
    scene.add(placed, mesh.triangles, i);
    for (const p of placed) scenePoints.push({ p, owner: i });
    allPlaced.push(placed);
    settled[i] = {
      index: i + 1,
      asset: item.asset,
      from: item.position[1] as number,
      to: round5(lift),
      restsOn,
    };
  }

  // Centre the footprint on the origin.
  let shift: [number, number] = [0, 0];
  if (options.center !== false) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const pts of allPlaced)
      for (const p of pts) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[2]);
        maxZ = Math.max(maxZ, p[2]);
      }
    shift = [round5(-(minX + maxX) / 2), round5(-(minZ + maxZ) / 2)];
  }
  composition.items.forEach((item, i) => {
    item.position = [
      round5((item.position[0] as number) + shift[0]),
      (settled[i] as SettledItem).to,
      round5((item.position[2] as number) + shift[1]),
    ];
  });
  if (!options.dryRun) writeFileSync(file, `${JSON.stringify(composition, null, 2)}\n`);
  return { items: settled, shift, composition };
}

export async function cmdSettle(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean" },
      "no-center": { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  const folder = positionals[0];
  if (!folder) throw new UsageError("settle needs a composition folder.");
  const r = await settleComposition(path.resolve(folder), {
    dryRun: values["dry-run"],
    center: !values["no-center"],
  });
  if (values.json) {
    console.log(JSON.stringify({ items: r.items, shift: r.shift }, null, 2));
    return 0;
  }
  const mm = (n: number) => `${(n * 1000).toFixed(1)} mm`;
  for (const s of r.items) {
    const on = s.restsOn === "ground" ? "the ground" : `item ${s.restsOn}`;
    const moved = Math.abs(s.to - s.from) < 0.0001 ? "unchanged" : `was ${round5(s.from)}`;
    console.log(`  ${String(s.index).padStart(3)}  ${s.asset}: y = ${s.to} (${moved}), on ${on}`);
  }
  if (r.shift[0] || r.shift[1])
    console.log(
      `Centred the footprint: moved everything ${mm(r.shift[0])} in x, ${mm(r.shift[1])} in z.`,
    );
  console.log(
    values["dry-run"]
      ? "Dry run: composition.json was not changed."
      : `Wrote ${path.join(folder, "composition.json")}. Validate it, then look at the preview.`,
  );
  return 0;
}
