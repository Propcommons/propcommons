// Cut-outs for the site: a prop, or a whole scene, seen from the three-quarter front on a
// transparent background, with a soft shadow under it that fades away. The site can stand one on
// any colour, at any size, with no square of backdrop around it. Same stage, lighting and camera
// as the review close-up. Kept apart from render.js and flat.js so that changing this file
// re-renders nothing else.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  boundsOf,
  createStage,
  enableShadows,
  fitCameraToBox,
  fitStage,
  frameCamera,
  viewDirection,
} from "./stage.js";

/** How much of the frame the prop may fill, leaving room for its shadow. */
const FILL = 0.84;
/** Towards the light the floor shadow comes from: nearly overhead, leaning as the key light does. */
const SUN = new THREE.Vector3(-0.2, 1, 0.24).normalize();

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

// One renderer and one stage serve every picture; a site build makes hundreds of these.
let shared = null;
async function setUp() {
  if (shared) return shared;
  const renderer = new THREE.WebGLRenderer({
    canvas: document.createElement("canvas"),
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
  const stage = await createStage(renderer, "/scene/studio.hdr");
  stage.scene.background = null;
  stage.ground.material = new THREE.ShadowMaterial({ opacity: 1 });
  // A light that adds no light: it is only there to cast the floor shadow.
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.002;
  sun.shadow.radius = 5;
  stage.scene.add(sun, sun.target);
  shared = { renderer, stage, sun };
  return shared;
}

function aimSun(sun, box) {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.01) * 1.5;
  const cam = sun.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = 0.001;
  cam.far = radius * 8;
  cam.updateProjectionMatrix();
  sun.target.position.copy(centre);
  sun.position.copy(centre).addScaledVector(SUN, radius * 4);
  sun.shadow.needsUpdate = true;
}

/** Stops objects being drawn while they still cast shadows; returns a function that undoes it. */
function ghost(objects) {
  const before = new Map();
  for (const object of objects)
    object.traverse((o) => {
      for (const m of o.isMesh ? [o.material].flat() : []) {
        if (!m || before.has(m)) continue;
        before.set(m, [m.colorWrite, m.depthWrite]);
        m.colorWrite = false;
        m.depthWrite = false;
      }
    });
  return () => {
    for (const [m, [colorWrite, depthWrite]] of before) {
      m.colorWrite = colorWrite;
      m.depthWrite = depthWrite;
    }
  };
}

function copyOf(canvas) {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  c.getContext("2d").drawImage(canvas, 0, 0);
  return c;
}

/**
 * Renders objects already placed in the world. Two passes: the floor shadow alone (the objects
 * cast it but are not drawn), then the objects alone. The shadow is blurred, faded out before the
 * frame's edge so it never ends on a hard line, and the objects are laid over it.
 */
async function cutout(objects, box, width, height) {
  const { renderer, stage, sun } = await setUp();
  renderer.setSize(width, height, false);
  for (const o of objects) stage.scene.add(o);
  fitStage(stage, box);
  aimSun(sun, box);
  const camera = fitCameraToBox(
    frameCamera(box, viewDirection("front"), width / height),
    box,
    FILL,
  );

  stage.ground.visible = true;
  stage.key.castShadow = false;
  const show = ghost(objects);
  renderer.render(stage.scene, camera);
  const shadow = copyOf(renderer.domElement);
  show();

  stage.ground.visible = false;
  stage.key.castShadow = true;
  renderer.render(stage.scene, camera);
  for (const o of objects) stage.scene.remove(o);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  const unit = Math.min(width, height);
  // A wide, faint shadow and a tighter, darker one where the prop touches the floor.
  for (const [blur, alpha] of [
    [unit * 0.022, 0.13],
    [unit * 0.006, 0.17],
  ]) {
    ctx.filter = `blur(${blur.toFixed(1)}px)`;
    ctx.globalAlpha = alpha;
    ctx.drawImage(shadow, 0, 0);
  }
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-in";
  for (const [x, y] of [
    [width, 0],
    [0, height],
  ]) {
    const g = ctx.createLinearGradient(0, 0, x, y);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.06, "rgba(0,0,0,1)");
    g.addColorStop(0.94, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(renderer.domElement, 0, 0);
  return out;
}

function scaled(canvas, width) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = Math.round((canvas.height * width) / canvas.width);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

/**
 * One prop alone. job = { url, size, small }: returns WebP data URLs `size` and `small` pixels
 * square.
 */
window.renderCutout = async (job) => {
  const obj = await load(job.url);
  const full = await cutout([obj], boundsOf(obj), job.size, job.size);
  return {
    image: full.toDataURL("image/webp", 0.9),
    small: scaled(full, job.small).toDataURL("image/webp", 0.86),
  };
};

/**
 * A scene. job = { width, height, small, items: [{ url, position, rotation, scale }] }: returns
 * WebP data URLs `width` and `small` pixels wide.
 */
window.renderSceneCutout = async (job) => {
  const objects = [];
  const box = new THREE.Box3();
  for (const item of job.items) {
    const obj = await load(item.url);
    obj.position.fromArray(item.position);
    obj.quaternion.fromArray(item.rotation);
    obj.scale.setScalar(item.scale ?? 1);
    objects.push(obj);
    box.union(boundsOf(obj));
  }
  const full = await cutout(objects, box, job.width, job.height);
  return {
    image: full.toDataURL("image/webp", 0.9),
    small: scaled(full, job.small).toDataURL("image/webp", 0.86),
  };
};
