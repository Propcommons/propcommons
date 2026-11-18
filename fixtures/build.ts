// Builds the validator's fixtures at test time: one valid textured box, then one mutation per rule
// that produces its failing case. Generated files go to fixtures/generated/ and are not committed.
//
// Each case is its own small repository tree, e.g.
//   fixtures/generated/GEO-TRIS/assets/fixture/box/v1/{asset.json, model.glb}
// so that path-based rules (MAN-PATH, MAN-PARENT, CMP-REFS) see a real layout.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { readGlb, writeGlb } from "../packages/validator/src/glb.ts";
import { addPrimitive, box } from "../tools/lib/mesh.ts";
import { encodePng } from "../tools/lib/png.ts";

export const GENERATED = path.join(import.meta.dirname, "generated");

export interface FixtureCase {
  /** Unique name; also the folder name under fixtures/generated/. */
  name: string;
  /** The rule this case exercises. */
  rule: string;
  expect: "pass" | "fail";
  /** The version folder to validate. */
  folder: string;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const checker = (size: number, a: number[], b: number[]) =>
  encodePng(size, size, (x, y) => (((x >> 3) + (y >> 3)) % 2 ? a : b));

interface BoxOptions {
  textured?: boolean;
  div?: number;
  size?: number;
  imageSize?: [number, number];
  mutate?: (doc: Document) => void;
}

/** The base model: a 10 cm textured box resting on y = 0, centred on the origin. */
export async function boxGlb(opts: BoxOptions = {}): Promise<Uint8Array> {
  const s = opts.size ?? 0.1;
  const doc = new Document();
  doc.createBuffer();
  const material = doc.createMaterial("Box").setRoughnessFactor(0.8).setMetallicFactor(0);
  if (opts.textured !== false) {
    const [w, h] = opts.imageSize ?? [64, 64];
    const png =
      w === h
        ? checker(w, [200, 180, 150], [120, 100, 80])
        : encodePng(w, h, (x, y) => ((x + y) % 2 ? [200, 180, 150] : [120, 100, 80]));
    material.setBaseColorTexture(
      doc.createTexture("BoxColor").setImage(png).setMimeType("image/png"),
    );
  }
  const mesh = doc.createMesh("Box");
  mesh.addPrimitive(
    addPrimitive(doc, box(-s / 2, 0, -s / 2, s / 2, s, s / 2, opts.div ?? 1), material),
  );
  const child = doc.createNode("Box").setMesh(mesh);
  const root = doc.createNode("Asset").addChild(child);
  doc.createScene("Scene").addChild(root);
  opts.mutate?.(doc);
  return io.writeBinary(doc);
}

/** A collision file built from boxes; no materials. */
async function collisionGlb(
  boxes: number[][],
  extra?: (doc: Document) => void,
): Promise<Uint8Array> {
  const doc = new Document();
  doc.createBuffer();
  const root = doc.createNode("Collision");
  boxes.forEach((b, i) => {
    const data = box(...(b as [number, number, number, number, number, number]));
    delete data.uvs;
    const mesh = doc.createMesh(`hull-${i + 1}`).addPrimitive(addPrimitive(doc, data, null));
    root.addChild(doc.createNode(`hull-${i + 1}`).setMesh(mesh));
  });
  doc.createScene().addChild(root);
  extra?.(doc);
  return io.writeBinary(doc);
}

/** Rewrites the raw glTF JSON inside a GLB. */
function patchGlb(
  bytes: Uint8Array,
  fn: (json: any, glb: { bin: Uint8Array | null }) => void,
): Uint8Array {
  const glb = readGlb(bytes);
  fn(glb.json, glb);
  return writeGlb(glb);
}

export function manifest(id: string, version: number, extra: Record<string, unknown> = {}) {
  return {
    spec: "0.1",
    id,
    version,
    name: "Test box",
    license: "CC0-1.0",
    size_class: "small",
    tags: ["test"],
    credits: [{ github: "fixture", roles: ["coded"] }],
    ai_assisted: true,
    tools: ["glTF-Transform"],
    ...extra,
  };
}

interface Files {
  [name: string]: Uint8Array | string | object;
}

function writeFolder(dir: string, files: Files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const data =
      content instanceof Uint8Array
        ? content
        : typeof content === "string"
          ? content
          : `${JSON.stringify(content, null, 2)}\n`;
    writeFileSync(path.join(dir, name), data);
  }
}

export async function buildFixtures(outDir = GENERATED): Promise<FixtureCase[]> {
  rmSync(outDir, { recursive: true, force: true });
  const cases: FixtureCase[] = [];
  const base = await boxGlb();
  const baseManifest = manifest("fixture/box", 1);
  const s = 0.05; // half the box size

  const add = async (
    name: string,
    rule: string,
    expect: "pass" | "fail",
    files: Files,
    more: { other?: Record<string, Files>; kind?: "assets" | "compositions" } = {},
  ) => {
    const root = path.join(outDir, name);
    const folder = path.join(
      root,
      more.kind ?? "assets",
      "fixture",
      more.kind === "compositions" ? "scene" : "box",
      "v1",
    );
    writeFolder(folder, files);
    for (const [rel, f] of Object.entries(more.other ?? {})) writeFolder(path.join(root, rel), f);
    cases.push({ name, rule, expect, folder });
  };
  const asset = (model: Uint8Array = base, extra: Files = {}, m: object = baseManifest): Files => ({
    "asset.json": m,
    "model.glb": model,
    ...extra,
  });

  // The valid base fixture is the passing case for every folder rule without its own.
  await add("base", "*", "pass", asset());

  // Folder and manifest
  await add("FOLDER-FILES", "FOLDER-FILES", "fail", asset(base, { "notes.txt": "hello" }));
  const bigBin = (n: number) =>
    patchGlb(base, (json, glb) => {
      const padded = new Uint8Array(n);
      padded.set(glb.bin ?? new Uint8Array());
      glb.bin = padded;
      json.buffers[0].byteLength = n;
    });
  await add("FILE-SIZE", "FILE-SIZE", "fail", asset(bigBin(5_100_000)));
  await add("FILE-SIZE-unread", "FILE-SIZE", "fail", asset(bigBin(10_100_000)));
  const noTools: Record<string, unknown> = { ...baseManifest };
  delete noTools.tools;
  await add("MAN-SCHEMA", "MAN-SCHEMA", "fail", asset(base, {}, noTools));
  await add("MAN-SCHEMA-json", "MAN-SCHEMA", "fail", {
    "asset.json": "{ not json",
    "model.glb": base,
  });
  await add("MAN-PATH", "MAN-PATH", "fail", asset(base, {}, manifest("fixture/other", 1)));
  await add(
    "MAN-PARENT",
    "MAN-PARENT",
    "fail",
    asset(base, {}, manifest("fixture/box", 1, { parent: "fixture/box@9" })),
  );
  await add(
    "MAN-PARENT-pass",
    "MAN-PARENT",
    "pass",
    asset(base, {}, manifest("fixture/box", 1, { parent: "fixture/base@1" })),
    {
      other: { "assets/fixture/base/v1": asset(base, {}, manifest("fixture/base", 1)) },
    },
  );
  await add(
    "MAN-PARENT-taken-down",
    "MAN-PARENT",
    "fail",
    asset(base, {}, manifest("fixture/box", 1, { parent: "fixture/gone@1" })),
    {
      other: {
        "assets/fixture/gone/v1": {
          "tombstone.json": { reason: "test", date: "2026-11-18", by: "fixture" },
        },
      },
    },
  );

  // Model file
  await add(
    "FILE-VALID",
    "FILE-VALID",
    "fail",
    asset(
      patchGlb(base, (json) => {
        delete json.asset.version;
      }),
    ),
  );
  await add(
    "FILE-EMBEDDED",
    "FILE-EMBEDDED",
    "fail",
    asset(
      patchGlb(base, (json) => {
        delete json.images[0].bufferView;
        json.images[0].uri = "texture.png";
      }),
    ),
  );
  await add(
    "FILE-EXT",
    "FILE-EXT",
    "fail",
    asset(
      patchGlb(base, (json) => {
        json.extensionsUsed = ["KHR_materials_clearcoat"];
        json.materials[0].extensions = { KHR_materials_clearcoat: { clearcoatFactor: 1 } };
      }),
    ),
  );
  await add(
    "FILE-EXT-pass",
    "FILE-EXT",
    "pass",
    asset(
      patchGlb(base, (json) => {
        json.extensionsUsed = ["KHR_materials_ior"];
        json.materials[0].extensions = { KHR_materials_ior: { ior: 1.5 } };
      }),
    ),
  );
  await add(
    "SCENE-ROOT",
    "SCENE-ROOT",
    "fail",
    asset(
      await boxGlb({
        mutate: (doc) => doc.getRoot().listScenes()[0]?.addChild(doc.createNode("Extra root")),
      }),
    ),
  );
  await add(
    "SCENE-SCALE",
    "SCENE-SCALE",
    "fail",
    asset(
      await boxGlb({
        mutate: (doc) =>
          doc
            .getRoot()
            .listNodes()
            .find((n) => n.getName() === "Box")
            ?.setScale([1.0005, 1, 1]),
      }),
    ),
  );
  await add(
    "SCENE-STATIC",
    "SCENE-STATIC",
    "fail",
    asset(
      await boxGlb({
        mutate: (doc) => {
          const cam = doc
            .createCamera("Cam")
            .setType("perspective")
            .setYFov(0.8)
            .setZNear(0.01)
            .setZFar(10)
            .setAspectRatio(1);
          doc
            .getRoot()
            .listNodes()
            .find((n) => n.getName() === "Asset")
            ?.addChild(doc.createNode("Cam").setCamera(cam));
        },
      }),
    ),
  );
  await add(
    "SIZE-CLASS",
    "SIZE-CLASS",
    "fail",
    asset(base, {}, manifest("fixture/box", 1, { size_class: "medium" })),
  );
  const moveBox = (t: [number, number, number]) =>
    boxGlb({
      mutate: (doc) =>
        doc
          .getRoot()
          .listNodes()
          .find((n) => n.getName() === "Box")
          ?.setTranslation(t),
    });
  await add("ORIGIN-Y", "ORIGIN-Y", "fail", asset(await moveBox([0, 0.041, 0])));
  await add("ORIGIN-XZ", "ORIGIN-XZ", "fail", asset(await moveBox([0.2, 0, 0])));
  await add("ORIGIN-CENTER", "ORIGIN-CENTER", "fail", asset(await moveBox([0.03, 0, 0])));
  await add(
    "GEO-MODE",
    "GEO-MODE",
    "fail",
    asset(
      await boxGlb({
        mutate: (doc) => {
          const line = addPrimitive(
            doc,
            { positions: [0, 0.01, 0, 0, 0.05, 0], normals: [0, 1, 0, 0, 1, 0], indices: [0, 1] },
            null,
          ).setMode(1);
          doc.getRoot().listMeshes()[0]?.addPrimitive(line);
        },
      }),
    ),
  );
  await add("GEO-TRIS", "GEO-TRIS", "fail", asset(await boxGlb({ div: 30 })));
  await add(
    "GEO-ATTRS",
    "GEO-ATTRS",
    "fail",
    asset(
      await boxGlb({
        mutate: (doc) =>
          doc.getRoot().listMeshes()[0]?.listPrimitives()[0]?.setAttribute("NORMAL", null),
      }),
    ),
  );
  await add(
    "GEO-COLOR",
    "GEO-COLOR",
    "fail",
    asset(
      await boxGlb({
        mutate: (doc) => {
          const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0];
          const n = prim?.getAttribute("POSITION")?.getCount() ?? 0;
          prim?.setAttribute(
            "COLOR_0",
            doc
              .createAccessor()
              .setType("VEC3")
              .setArray(new Float32Array(n * 3).fill(1))
              .setBuffer(doc.getRoot().listBuffers()[0] ?? null),
          );
        },
      }),
    ),
  );
  await add(
    "MAT-COUNT",
    "MAT-COUNT",
    "fail",
    asset(
      await boxGlb({
        mutate: (doc) => {
          for (const name of ["Extra A", "Extra B"]) {
            const tri = {
              positions: [0, 0.02, 0, 0.01, 0.02, 0, 0, 0.03, 0],
              normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
              indices: [0, 1, 2],
            };
            doc
              .getRoot()
              .listMeshes()[0]
              ?.addPrimitive(addPrimitive(doc, tri, doc.createMaterial(name)));
          }
        },
      }),
    ),
  );
  await add(
    "MAT-BLEND",
    "MAT-BLEND",
    "fail",
    asset(
      await boxGlb({
        mutate: (doc) => doc.getRoot().listMaterials()[0]?.setAlphaMode("BLEND"),
      }),
    ),
  );
  await add(
    "TEX-FORMAT",
    "TEX-FORMAT",
    "fail",
    asset(
      await boxGlb({
        mutate: (doc) => {
          const bytes = new Uint8Array(256).map((_, i) => (i * 37 + 11) % 256);
          doc.getRoot().listTextures()[0]?.setImage(bytes);
        },
      }),
    ),
  );
  await add("TEX-SIZE", "TEX-SIZE", "fail", asset(await boxGlb({ imageSize: [96, 64] })));
  await add(
    "TEX-SIZE-budget",
    "TEX-SIZE",
    "fail",
    asset(await boxGlb({ imageSize: [2048, 2048] })),
  );
  await add(
    "TEX-ORM",
    "TEX-ORM",
    "fail",
    asset(
      await boxGlb({
        mutate: (doc) => {
          const m = doc.getRoot().listMaterials()[0];
          m?.setOcclusionTexture(
            doc
              .createTexture("AO")
              .setImage(checker(32, [255, 255, 255], [200, 200, 200]))
              .setMimeType("image/png"),
          );
          m?.setMetallicRoughnessTexture(
            doc
              .createTexture("MR")
              .setImage(checker(32, [0, 200, 0], [0, 150, 0]))
              .setMimeType("image/png"),
          );
        },
      }),
    ),
  );
  await add(
    "TEX-ORM-pass",
    "TEX-ORM",
    "pass",
    asset(
      await boxGlb({
        mutate: (doc) => {
          const m = doc.getRoot().listMaterials()[0];
          const orm = doc
            .createTexture("ORM")
            .setImage(checker(32, [255, 200, 0], [200, 150, 0]))
            .setMimeType("image/png");
          m?.setOcclusionTexture(orm);
          m?.setMetallicRoughnessTexture(orm);
        },
      }),
    ),
  );
  await add("TEX-DENSITY", "TEX-DENSITY", "fail", asset(await boxGlb({ textured: false })));

  // Collision
  const fullBox = [-s, 0, -s, s, 2 * s, s];
  await add(
    "COL-pass",
    "COL-CLEAN",
    "pass",
    asset(base, { "collision.glb": await collisionGlb([fullBox]) }),
  );
  await add(
    "COL-CLEAN",
    "COL-CLEAN",
    "fail",
    asset(base, {
      "collision.glb": await collisionGlb([fullBox], (doc) => {
        const m = doc.createMaterial("Oops");
        for (const mesh of doc.getRoot().listMeshes())
          for (const p of mesh.listPrimitives()) p.setMaterial(m);
      }),
    }),
  );
  const nine = Array.from({ length: 9 }, (_, i) => [-s, i * 0.01, -s, s, i * 0.01 + 0.009, s]);
  await add(
    "COL-CONVEX",
    "COL-CONVEX",
    "fail",
    asset(base, { "collision.glb": await collisionGlb(nine) }),
  );
  await add(
    "COL-CONVEX-open",
    "COL-CONVEX",
    "fail",
    asset(base, {
      "collision.glb": await collisionGlb([fullBox], (doc) => {
        const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0];
        const idx = prim?.getIndices();
        if (idx) idx.setArray((idx.getArray() as Uint16Array).slice(0, 30)); // drop one face
      }),
    }),
  );
  await add(
    "COL-CONVEX-concave",
    "COL-CONVEX",
    "fail",
    asset(base, {
      "collision.glb": await collisionGlb([fullBox], (doc) => {
        // Push one corner of the box inward, making a dent.
        const pos = doc.getRoot().listMeshes()[0]?.listPrimitives()[0]?.getAttribute("POSITION");
        const el: number[] = [];
        for (let i = 0; i < (pos?.getCount() ?? 0); i++) {
          pos?.getElement(i, el);
          if (Math.hypot((el[0] ?? 0) - s, (el[1] ?? 0) - 2 * s, (el[2] ?? 0) - s) < 1e-6)
            pos?.setElement(i, [0.01, 0.06, 0.01]);
        }
      }),
    }),
  );
  await add(
    "COL-BOUNDS",
    "COL-BOUNDS",
    "fail",
    asset(base, {
      "collision.glb": await collisionGlb([[-0.06, 0, -0.06, 0.06, 0.12, 0.06]]),
    }),
  );

  // Compositions
  const comp = (items: unknown[], extra: Record<string, unknown> = {}) => ({
    "composition.json": {
      spec: "0.1",
      id: "fixture/scene",
      version: 1,
      name: "Test scene",
      license: "CC0-1.0",
      credits: [{ github: "fixture", roles: ["directed"] }],
      ai_assisted: false,
      tools: ["glTF-Transform"],
      items,
      ...extra,
    },
  });
  const item = (asset: string, position = [0, 0, 0], rotation = [0, 0, 0, 1], scale?: number) => ({
    asset,
    position,
    rotation,
    ...(scale === undefined ? {} : { scale }),
  });
  const compOther = {
    "assets/fixture/box/v1": asset(),
    "assets/fixture/gone/v1": {
      "tombstone.json": { reason: "test", date: "2026-11-18", by: "fixture" },
    },
  };
  const two = [
    item("fixture/box@1"),
    item("fixture/box@1", [0, 0.1, 0], [0, 0.383, 0, 0.924], 0.9),
  ];
  const addComp = (name: string, rule: string, expect: "pass" | "fail", files: Files) =>
    add(name, rule, expect, files, { kind: "compositions", other: compOther });
  await addComp("CMP-pass", "CMP-SCHEMA", "pass", comp(two));
  const noItems = comp(two);
  delete (noItems["composition.json"] as Record<string, unknown>).items;
  await addComp("CMP-SCHEMA", "CMP-SCHEMA", "fail", noItems);
  await addComp("CMP-REFS", "CMP-REFS", "fail", comp([...two, item("fixture/box@7")]));
  await addComp("CMP-REFS-taken-down", "CMP-REFS", "fail", comp([...two, item("fixture/gone@1")]));
  await addComp(
    "CMP-ROT",
    "CMP-ROT",
    "fail",
    comp([...two, item("fixture/box@1", [0, 0, 0], [0, 0, 0, 2])]),
  );
  await addComp("CMP-COUNT", "CMP-COUNT", "fail", comp([item("fixture/box@1")]));
  await addComp(
    "CMP-SCALE",
    "CMP-SCALE",
    "fail",
    comp([...two, item("fixture/box@1", [0, 0, 0], [0, 0, 0, 1], 3)]),
  );

  // A takedown passes FOLDER-FILES and skips everything else.
  await add("tombstone", "FOLDER-FILES", "pass", {
    "tombstone.json": { reason: "test", date: "2026-11-18", by: "fixture" },
  });
  return cases;
}

if (import.meta.main) {
  const cases = await buildFixtures();
  console.log(`Built ${cases.length} fixture cases in ${GENERATED}`);
}
