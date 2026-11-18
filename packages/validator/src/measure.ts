// Measurements computed from a glTF-Transform document, as defined in the implementation brief:
// bounds from world-space vertex positions, triangle counts, footprint, texel density, and the
// per-mesh data the collision rules need.
import {
  type Document,
  ImageUtils,
  type Material,
  type mat4,
  type Node,
  type Primitive,
  type Texture,
} from "@gltf-transform/core";
import { listTextureSlots } from "@gltf-transform/functions";
import { sniffImage } from "./glb.ts";
import type { TextureMeasure } from "./result.ts";

export type Vec3 = [number, number, number];

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** One mesh primitive placed in the world by its node. */
export interface PlacedPrimitive {
  node: Node;
  primitive: Primitive;
  /** World-space positions, one per vertex. */
  positions: Vec3[];
  /** Vertex indices of triangles, three per triangle (only for triangle lists). */
  triangles: number[];
}

export function transformPoint(m: mat4, p: Vec3): Vec3 {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/** Every node reachable from the document's scenes, depth first. */
export function sceneNodes(doc: Document): Node[] {
  const out: Node[] = [];
  const visit = (n: Node) => {
    out.push(n);
    for (const c of n.listChildren()) visit(c);
  };
  for (const scene of doc.getRoot().listScenes()) for (const n of scene.listChildren()) visit(n);
  return out;
}

export function placedPrimitives(doc: Document): PlacedPrimitive[] {
  const out: PlacedPrimitive[] = [];
  for (const node of sceneNodes(doc)) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const pos = primitive.getAttribute("POSITION");
      const positions: Vec3[] = [];
      if (pos) {
        const el: number[] = [];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, el);
          positions.push(transformPoint(world, [el[0] ?? 0, el[1] ?? 0, el[2] ?? 0]));
        }
      }
      const triangles: number[] = [];
      if (primitive.getMode() === 4) {
        const idx = primitive.getIndices();
        if (idx) for (let i = 0; i < idx.getCount(); i++) triangles.push(idx.getScalar(i));
        else for (let i = 0; i < positions.length; i++) triangles.push(i);
        triangles.length -= triangles.length % 3;
      }
      out.push({ node, primitive, positions, triangles });
    }
  }
  return out;
}

export function boundsOf(points: Iterable<Vec3>): Box | null {
  let box: Box | null = null;
  for (const p of points) {
    if (!box) {
      box = { min: [...p], max: [...p] };
      continue;
    }
    for (let a = 0; a < 3; a++) {
      box.min[a] = Math.min(box.min[a] as number, p[a] as number);
      box.max[a] = Math.max(box.max[a] as number, p[a] as number);
    }
  }
  return box;
}

export function round(n: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(n * f) / f + 0; // + 0 turns -0 into 0
}

export function size(box: Box): Vec3 {
  return [
    round(box.max[0] - box.min[0]),
    round(box.max[1] - box.min[1]),
    round(box.max[2] - box.min[2]),
  ];
}

/** Triangle count: index count / 3, or vertex count / 3 without indices; triangle lists only. */
export function triangleCount(prims: PlacedPrimitive[]): number {
  return prims.reduce((sum, p) => sum + p.triangles.length / 3, 0);
}

export interface Footprint {
  centre: [number, number];
  width: number;
}

/** The XZ rectangle bounding all vertices; centre is its midpoint, width its longer side. */
export function footprint(box: Box): Footprint {
  const dx = box.max[0] - box.min[0];
  const dz = box.max[2] - box.min[2];
  return {
    centre: [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2],
    width: Math.max(dx, dz),
  };
}

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cx = (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number);
  const cy = (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number);
  const cz = (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number);
  return Math.hypot(cx, cy, cz) / 2;
}

export function imageSize(texture: Texture): { width: number; height: number } | null {
  const image = texture.getImage();
  if (!image) return null;
  const kind = sniffImage(image);
  if (kind === "unknown") return null;
  try {
    const s = ImageUtils.getSize(image, kind === "png" ? "image/png" : "image/jpeg");
    return s ? { width: s[0], height: s[1] } : null;
  } catch {
    return null;
  }
}

/** The texture used to measure density: base colour if present, else the first texture used. */
function densityTexture(material: Material): { texture: Texture; texCoord: number } | null {
  const base = material.getBaseColorTexture();
  const baseInfo = material.getBaseColorTextureInfo();
  if (base && baseInfo) return { texture: base, texCoord: baseInfo.getTexCoord() };
  const slots: [Texture | null, { getTexCoord(): number } | null][] = [
    [material.getNormalTexture(), material.getNormalTextureInfo()],
    [material.getMetallicRoughnessTexture(), material.getMetallicRoughnessTextureInfo()],
    [material.getOcclusionTexture(), material.getOcclusionTextureInfo()],
    [material.getEmissiveTexture(), material.getEmissiveTextureInfo()],
  ];
  for (const [t, i] of slots) if (t && i) return { texture: t, texCoord: i.getTexCoord() };
  return null;
}

/**
 * Texel density in px/m: per textured primitive, sqrt(texture pixels covered by UV triangles /
 * world-space triangle area); the result is the area-weighted mean over primitives.
 */
export function texelDensity(prims: PlacedPrimitive[]): number | null {
  let weighted = 0;
  let totalArea = 0;
  for (const p of prims) {
    const material = p.primitive.getMaterial();
    if (!material || p.triangles.length === 0) continue;
    const dt = densityTexture(material);
    if (!dt) continue;
    const dims = imageSize(dt.texture);
    const uv = p.primitive.getAttribute(`TEXCOORD_${dt.texCoord}`);
    if (!dims || !uv) continue;
    let pixels = 0;
    let area = 0;
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    for (let t = 0; t < p.triangles.length; t += 3) {
      const i0 = p.triangles[t] as number;
      const i1 = p.triangles[t + 1] as number;
      const i2 = p.triangles[t + 2] as number;
      uv.getElement(i0, a);
      uv.getElement(i1, b);
      uv.getElement(i2, c);
      const uvArea =
        Math.abs(
          ((b[0] as number) - (a[0] as number)) * ((c[1] as number) - (a[1] as number)) -
            ((c[0] as number) - (a[0] as number)) * ((b[1] as number) - (a[1] as number)),
        ) / 2;
      pixels += uvArea * dims.width * dims.height;
      area += triangleArea(
        p.positions[i0] as Vec3,
        p.positions[i1] as Vec3,
        p.positions[i2] as Vec3,
      );
    }
    if (area <= 0) continue;
    weighted += Math.sqrt(pixels / area) * area;
    totalArea += area;
  }
  return totalArea > 0 ? Math.round(weighted / totalArea) : null;
}

const SLOT_NAMES: Record<string, string> = {
  baseColorTexture: "baseColor",
  normalTexture: "normal",
  metallicRoughnessTexture: "metallicRoughness",
  occlusionTexture: "occlusion",
  emissiveTexture: "emissive",
};

export function textureMeasures(doc: Document): TextureMeasure[] {
  return doc
    .getRoot()
    .listTextures()
    .map((t) => {
      const image = t.getImage();
      const kind = image ? sniffImage(image) : "unknown";
      const dims = imageSize(t);
      const slot = listTextureSlots(t)[0] ?? "unused";
      return {
        slot: SLOT_NAMES[slot] ?? slot.replace(/Texture$/, ""),
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        format: kind,
      };
    });
}

// ---- Collision geometry ----

const WELD = 1e-6;

/** Welds positions that coincide within a micrometre; returns unique points and an index map. */
export function weld(points: Vec3[]): { unique: Vec3[]; map: number[] } {
  const unique: Vec3[] = [];
  const keys = new Map<string, number>();
  const map = points.map((p) => {
    const key = p.map((v) => Math.round(v / WELD)).join(",");
    let i = keys.get(key);
    if (i === undefined) {
      i = unique.length;
      unique.push(p);
      keys.set(key, i);
    }
    return i;
  });
  return { unique, map };
}

export interface HullCheck {
  vertices: number;
  closed: boolean;
  /** Largest distance any vertex lies in front of a triangle's plane, in metres. */
  maxOutside: number;
}

/** A closed mesh where no vertex is in front of any face plane (by winding) is convex. */
export function checkHull(p: PlacedPrimitive): HullCheck {
  const { unique, map } = weld(p.positions);
  const tris: [number, number, number][] = [];
  for (let t = 0; t < p.triangles.length; t += 3) {
    const tri: [number, number, number] = [
      map[p.triangles[t] as number] as number,
      map[p.triangles[t + 1] as number] as number,
      map[p.triangles[t + 2] as number] as number,
    ];
    if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) tris.push(tri);
  }
  // Closed: every undirected edge is shared by exactly two triangles.
  const edges = new Map<string, number>();
  for (const [a, b, c] of tris) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const closed = tris.length >= 4 && [...edges.values()].every((n) => n === 2);
  let maxOutside = 0;
  for (const [a, b, c] of tris) {
    const A = unique[a] as Vec3;
    const B = unique[b] as Vec3;
    const C = unique[c] as Vec3;
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]] as Vec3;
    const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]] as Vec3;
    const n: Vec3 = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const len = Math.hypot(...n);
    if (len === 0) continue;
    for (const P of unique) {
      const d = ((P[0] - A[0]) * n[0] + (P[1] - A[1]) * n[1] + (P[2] - A[2]) * n[2]) / len;
      if (d > maxOutside) maxOutside = d;
    }
  }
  return { vertices: unique.length, closed, maxOutside };
}
