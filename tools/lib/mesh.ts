// Helpers to build glTF-Transform meshes from plain arrays of positions, normals, UVs and indices,
// and to make simple shapes: boxes, surfaces of revolution (lathe), extruded outlines, and to put a
// model on the ground. Used by the fixtures, the seed assets and anyone's generator script.
import type { Document, Material, Primitive } from "@gltf-transform/core";

export interface MeshData {
  positions: number[];
  normals: number[];
  uvs?: number[];
  indices: number[];
}

export function addPrimitive(doc: Document, data: MeshData, material: Material | null): Primitive {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(new Float32Array(data.positions))
        .setBuffer(buffer),
    )
    .setAttribute(
      "NORMAL",
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(new Float32Array(data.normals))
        .setBuffer(buffer),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType("SCALAR")
        .setArray(
          data.positions.length / 3 > 65535
            ? new Uint32Array(data.indices)
            : new Uint16Array(data.indices),
        )
        .setBuffer(buffer),
    );
  if (data.uvs)
    prim.setAttribute(
      "TEXCOORD_0",
      doc.createAccessor().setType("VEC2").setArray(new Float32Array(data.uvs)).setBuffer(buffer),
    );
  if (material) prim.setMaterial(material);
  return prim;
}

/**
 * An axis-aligned box from (x0, y0, z0) to (x1, y1, z1), with outward normals and each face
 * mapped to the full 0–1 UV square, split into `div` × `div` quads per face.
 */
export function box(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  div = 1,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // Each face: origin corner, u axis, v axis, normal. u × v points along the normal.
  const faces: [number[], number[], number[], number[]][] = [
    [
      [x1, y0, z1],
      [0, 0, z0 - z1],
      [0, y1 - y0, 0],
      [1, 0, 0],
    ],
    [
      [x0, y0, z0],
      [0, 0, z1 - z0],
      [0, y1 - y0, 0],
      [-1, 0, 0],
    ],
    [
      [x0, y1, z1],
      [x1 - x0, 0, 0],
      [0, 0, z0 - z1],
      [0, 1, 0],
    ],
    [
      [x0, y0, z0],
      [x1 - x0, 0, 0],
      [0, 0, z1 - z0],
      [0, -1, 0],
    ],
    [
      [x0, y0, z1],
      [x1 - x0, 0, 0],
      [0, y1 - y0, 0],
      [0, 0, 1],
    ],
    [
      [x1, y0, z0],
      [x0 - x1, 0, 0],
      [0, y1 - y0, 0],
      [0, 0, -1],
    ],
  ];
  for (const [o, u, v, n] of faces) {
    const start = positions.length / 3;
    for (let j = 0; j <= div; j++) {
      for (let i = 0; i <= div; i++) {
        const s = i / div;
        const t = j / div;
        for (let a = 0; a < 3; a++)
          positions.push((o[a] as number) + (u[a] as number) * s + (v[a] as number) * t);
        normals.push(...n);
        uvs.push(s, 1 - t);
      }
    }
    for (let j = 0; j < div; j++) {
      for (let i = 0; i < div; i++) {
        const a = start + j * (div + 1) + i;
        const b = a + 1;
        const c = a + (div + 1);
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }
  }
  return { positions, normals, uvs, indices };
}

// ---- Shapes (from the seed assets' generator) ----

export type P2 = [number, number];

/** Catmull-Rom subdivision of a polyline, keeping its end points. */
export function smoothPath(points: P2[], steps: number): P2[] {
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
export function lathe(profile: P2[], segments: number): MeshData {
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
export function extrude(outline: P2[], y0: number, y1: number, uvScale: number): MeshData {
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
export function fixWinding(m: MeshData): MeshData {
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

export function roundedRect(w: number, d: number, r: number, cornerSteps = 8): P2[] {
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

export function transform(
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

export function bounds(meshes: MeshData[]) {
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
export function ground(meshes: MeshData[]): MeshData[] {
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
