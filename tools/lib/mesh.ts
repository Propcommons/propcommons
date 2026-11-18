// Helpers to build glTF-Transform meshes from plain arrays of positions, normals, UVs and indices.
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
