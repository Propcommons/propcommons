// Flat (orthographic) pictures at an exact scale, on a transparent background, for the site:
// a row of props standing side by side, and one prop's front, side and top. Because the scale is
// known, the site can draw rulers and dimension lines over them. Same stage and lighting as the
// previews. Kept apart from render.js so that changing one does not re-render the other.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  BACKGROUND,
  boundsOf,
  createStage,
  enableShadows,
  fitCameraToBox,
  fitStage,
  frameCamera,
  GROUND,
  viewDirection,
} from "./stage.js";

/**
 * Clear glass shows what is behind it, and here nothing is: on a transparent background it would
 * vanish. So see-through materials are drawn as plain tinted, part-transparent ones instead.
 */
function solidGlass(object) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      if (!((m?.transmission ?? 0) > 0)) return m;
      const c = m.clone();
      c.transmission = 0;
      c.thickness = 0;
      c.transparent = true;
      c.opacity = 0.5;
      c.roughness = Math.max(c.roughness, 0.15);
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return object;
}

const cache = new Map();
async function load(url) {
  if (!cache.has(url)) cache.set(url, (await new GLTFLoader().loadAsync(url)).scene);
  return solidGlass(enableShadows(cache.get(url).clone(true)));
}

// One renderer and one stage serve every picture: setting them up (the environment map above
// all) costs far more than a render, and a site build makes hundreds of these.
let shared = null;
async function setUp() {
  if (shared) return shared;
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The reference stage with no background, and a ground that shows only the shadow.
  const stage = await createStage(renderer, "/scene/studio.hdr");
  stage.scene.background = null;
  stage.ground.material = new THREE.ShadowMaterial({ opacity: 0.2 });
  stage.key.shadow.mapSize.set(4096, 4096);
  shared = { renderer, stage };
  return shared;
}

/** Screen axes for a view: `back` points from the scene to the camera. */
function axes(back, upHint) {
  const b = back.clone().normalize();
  const r = new THREE.Vector3().crossVectors(upHint, b).normalize();
  const u = new THREE.Vector3().crossVectors(b, r);
  return { b, r, u };
}

function project(box, ax) {
  const out = { minR: Infinity, maxR: -Infinity, minU: Infinity, maxU: -Infinity };
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z);
        const R = p.dot(ax.r);
        const U = p.dot(ax.u);
        out.minR = Math.min(out.minR, R);
        out.maxR = Math.max(out.maxR, R);
        out.minU = Math.min(out.minU, U);
        out.maxU = Math.max(out.maxU, U);
      }
  return out;
}

/** Renders objects from a direction at `s` pixels per metre, with `pad` pixels around them. */
async function shot({ objects, box, back, upHint, s, pad, shadow }) {
  const ax = axes(back, upHint);
  const p = project(box, ax);
  const frame = {
    left: p.minR - pad.l / s,
    right: p.maxR + pad.r / s,
    top: p.maxU + pad.t / s,
    bottom: p.minU - pad.b / s,
  };
  const width = Math.max(1, Math.round((frame.right - frame.left) * s));
  const height = Math.max(1, Math.round((frame.top - frame.bottom) * s));
  const { renderer, stage } = await setUp();
  renderer.setSize(width, height, false);
  stage.ground.visible = shadow;
  for (const o of objects) stage.scene.add(o);
  fitStage(stage, box);
  const camera = new THREE.OrthographicCamera(
    frame.left,
    frame.right,
    frame.top,
    frame.bottom,
    0.1,
    1000,
  );
  camera.position.copy(ax.b).multiplyScalar(200);
  camera.up.copy(upHint);
  camera.lookAt(0, 0, 0);
  renderer.render(stage.scene, camera);
  const image = renderer.domElement.toDataURL("image/webp", 0.92);
  for (const o of objects) stage.scene.remove(o);
  const toPx = (v) => ({ x: (v.dot(ax.r) - frame.left) * s, y: (frame.top - v.dot(ax.u)) * s });
  return { image, width, height, toPx };
}

/**
 * A row of props standing side by side, seen from the front and slightly above.
 * job = { items: [{ id, url, on: [{ id, url, dx, dz }] }], gap, width, elevation, pad }
 * `gap` is in metres; `width` is the picture's width in pixels, which sets the scale.
 */
window.renderRow = async (job) => {
  const objects = [];
  const placed = [];
  const all = new THREE.Box3();
  let cursor = 0;
  for (const item of job.items) {
    const obj = await load(item.url);
    obj.position.x = cursor - boundsOf(obj).min.x;
    const box = boundsOf(obj);
    objects.push(obj);
    all.union(box);
    placed.push({ id: item.id, box, on: null });
    for (const child of item.on ?? []) {
      const c = await load(child.url);
      c.position.set(obj.position.x + child.dx, box.max.y, child.dz ?? 0);
      objects.push(c);
      const cb = boundsOf(c);
      all.union(cb);
      placed.push({ id: child.id, box: cb, on: item.id });
    }
    cursor = box.max.x + job.gap;
  }
  const e = (job.elevation * Math.PI) / 180;
  const s = (job.width - job.pad.l - job.pad.r) / (all.max.x - all.min.x);
  const r = await shot({
    objects,
    box: all,
    back: new THREE.Vector3(0, Math.sin(e), Math.cos(e)),
    upHint: new THREE.Vector3(0, 1, 0),
    s,
    pad: job.pad,
    shadow: true,
  });
  const origin = r.toPx(new THREE.Vector3(all.min.x, 0, 0));
  return {
    image: r.image,
    width: r.width,
    height: r.height,
    pxPerMetre: s,
    originX: origin.x,
    baseY: origin.y,
    rise: Math.cos(e),
    gapPx: job.gap * s,
    items: placed.map((p) => {
      const a = r.toPx(new THREE.Vector3(p.box.min.x, p.box.max.y, 0));
      const b = r.toPx(new THREE.Vector3(p.box.max.x, p.box.min.y, 0));
      return {
        id: p.id,
        on: p.on,
        x0: a.x,
        x1: b.x,
        top: a.y,
        size: p.box.getSize(new THREE.Vector3()).toArray(),
      };
    }),
  };
};

/**
 * Front, side and top of one prop with no ground, all at one scale: the longest side is
 * `longest` pixels. job = { url, longest, pad }.
 */
window.renderFlat = async (job) => {
  const obj = await load(job.url);
  const box = boundsOf(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = job.longest / Math.max(size.x, size.y, size.z, 0.001);
  const pad = { l: job.pad, r: job.pad, t: job.pad, b: job.pad };
  const views = {
    front: { back: new THREE.Vector3(0, 0, 1), upHint: new THREE.Vector3(0, 1, 0) },
    // From the lit side (the left), so the front is on the right of the picture.
    side: { back: new THREE.Vector3(-1, 0, 0), upHint: new THREE.Vector3(0, 1, 0) },
    // From above, front at the bottom.
    top: { back: new THREE.Vector3(0, 1, 0), upHint: new THREE.Vector3(0, 0, -1) },
  };
  const out = { size: size.toArray(), pxPerMetre: s, pad: job.pad };
  for (const [name, v] of Object.entries(views)) {
    const r = await shot({ objects: [obj], box, ...v, s, pad, shadow: false });
    out[name] = { image: r.image, width: r.width, height: r.height };
  }
  return out;
};

/**
 * A close-up of one prop alone on the plain stage, three-quarter front, like the gallery
 * thumbnail but with nothing behind it. For glass props, whose thumbnail has a striped card.
 * job = { url, size, small }: returns WebP data URLs at `size` and `small` pixels square.
 */
window.renderPlain = async (job) => {
  if (!cache.has(job.url)) cache.set(job.url, (await new GLTFLoader().loadAsync(job.url)).scene);
  const obj = enableShadows(cache.get(job.url).clone(true));
  const { renderer, stage } = await setUp();
  const shadowGround = stage.ground.material;
  stage.scene.background = new THREE.Color(BACKGROUND);
  stage.ground.material = new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1 });
  stage.ground.visible = true;
  renderer.setSize(job.size, job.size, false);
  stage.scene.add(obj);
  const box = boundsOf(obj);
  fitStage(stage, box);
  const camera = fitCameraToBox(frameCamera(box, viewDirection("front")), box, 0.9);
  renderer.render(stage.scene, camera);
  const image = renderer.domElement.toDataURL("image/webp", 0.9);
  const c = document.createElement("canvas");
  c.width = job.small;
  c.height = job.small;
  c.getContext("2d").drawImage(renderer.domElement, 0, 0, job.small, job.small);
  stage.scene.remove(obj);
  stage.scene.background = null;
  stage.ground.material = shadowGround;
  return { image, small: c.toDataURL("image/webp", 0.85) };
};
