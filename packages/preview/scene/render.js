// The preview page. The Node renderer calls window.renderJob(job) and gets back PNG data URLs.
// Deterministic: fixed size, no animation, no randomness; resolves only when loading is complete.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  boundsOf,
  createRenderer,
  createStage,
  enableShadows,
  fitCameraToBox,
  fitStage,
  frameCamera,
  scaleCube,
  VIEW_NAMES,
  viewDirection,
} from "./stage.js";

const SIZE = 1024;

async function loadModel(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  enableShadows(root);
  return root;
}

/** Centre of a box's footprint, and its half-extent along a ground direction. */
function halfExtentAlong(box, dir) {
  const size = box.getSize(new THREE.Vector3());
  return Math.abs(dir.x) * (size.x / 2) + Math.abs(dir.z) * (size.z / 2);
}

function isTransmissive(object) {
  let found = false;
  object.traverse((o) => {
    const materials = o.isMesh ? [o.material].flat() : [];
    if (materials.some((m) => (m?.transmission ?? 0) > 0)) found = true;
  });
  return found;
}

/** An upright card with dark and light stripes, standing behind a box as seen from a direction. */
function stripedCard(box, direction) {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? "#2f3a3a" : "#e9e6dc";
    ctx.fillRect(i * 32, 0, 32, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
  );
  const back = new THREE.Vector3(-direction.x, 0, -direction.z).normalize();
  card.position.copy(centre).addScaledVector(back, Math.max(size.x, size.z) * 0.58);
  card.position.y = span / 2;
  card.lookAt(centre.x, span / 2, centre.z);
  card.receiveShadow = true;
  return card;
}

function snapshot(renderer, scene, camera) {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}

/**
 * job = { model: url, sizeClass, neighbours: [url, url] }
 * returns { front, side, top, kit } as PNG data URLs, plus the measured bounds.
 */
window.renderJob = async (job) => {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  document.body.appendChild(canvas);
  const renderer = createRenderer(canvas, {
    width: SIZE,
    height: SIZE,
    preserveDrawingBuffer: true,
  });
  const stage = await createStage(renderer, "/scene/studio.hdr");
  const { scene } = stage;

  const asset = await loadModel(job.model);
  scene.add(asset);
  const assetBox = boundsOf(asset);
  const cube = scaleCube(job.sizeClass);
  scene.add(cube);
  const cubeBox = boundsOf(cube);
  const cubeSize = cubeBox.getSize(new THREE.Vector3()).x;

  const out = {};
  for (const name of VIEW_NAMES) {
    // Place the scale cube beside the asset, to the camera's right, on the ground.
    const dir = viewDirection(name);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.y = 0;
    right.normalize();
    const centre = assetBox.getCenter(new THREE.Vector3());
    const gap = Math.max(cubeSize * 0.3, 0.005);
    const offset = halfExtentAlong(assetBox, right) + gap + cubeSize / 2;
    cube.position.set(centre.x + right.x * offset, 0, centre.z + right.z * offset);
    const box = assetBox.clone().union(boundsOf(cube));
    fitStage(stage, box);
    out[name] = snapshot(renderer, scene, frameCamera(box, dir));
  }

  // Close-up: the asset alone, without the scale cube. See-through (transmissive) materials get a
  // striped card behind them, because clear glass on a plain grey background looks milky.
  scene.remove(cube);
  fitStage(stage, assetBox);
  const thumbCamera = frameCamera(assetBox, viewDirection("front"), 1, 1.1);
  const backdrop = isTransmissive(asset) ? stripedCard(assetBox, viewDirection("front")) : null;
  if (backdrop) scene.add(backdrop);
  out.thumb = snapshot(renderer, scene, thumbCamera);
  if (backdrop) scene.remove(backdrop);

  // Kit view: the asset between up to two neighbours of the same size class.
  const row = [];
  const neighbours = [];
  for (const url of job.neighbours ?? []) neighbours.push(await loadModel(url));
  if (neighbours[0]) row.push(neighbours[0]);
  row.push(asset);
  if (neighbours[1]) row.push(neighbours[1]);
  for (const n of neighbours) scene.add(n);
  const boxes = row.map((o) => boundsOf(o));
  const spacing = Math.max(...boxes.map((b) => b.getSize(new THREE.Vector3()).length())) * 0.15;
  const totalWidth =
    boxes.reduce((w, b) => w + (b.max.x - b.min.x), 0) + spacing * (row.length - 1);
  let x = -totalWidth / 2;
  row.forEach((o, i) => {
    const b = boxes[i];
    const c = b.getCenter(new THREE.Vector3());
    o.position.x += x - b.min.x;
    o.position.z -= c.z;
    x += b.max.x - b.min.x + spacing;
  });
  const kitBox = new THREE.Box3();
  for (const o of row) kitBox.union(boundsOf(o));
  fitStage(stage, kitBox);
  out.kit = snapshot(renderer, scene, frameCamera(kitBox, viewDirection("front")));

  const size = assetBox.getSize(new THREE.Vector3());
  out.bounds = [size.x, size.y, size.z];
  renderer.dispose();
  return out;
};

/**
 * Renders a composition: job = { width, height, items: [{ url, position, rotation, scale }] }.
 * Returns a PNG data URL of the three-quarter front view.
 */
window.renderComposition = async (job) => {
  const canvas = document.createElement("canvas");
  canvas.width = job.width;
  canvas.height = job.height;
  document.body.appendChild(canvas);
  const renderer = createRenderer(canvas, {
    width: job.width,
    height: job.height,
    preserveDrawingBuffer: true,
  });
  const stage = await createStage(renderer, "/scene/studio.hdr");
  const models = new Map();
  for (const item of job.items)
    if (!models.has(item.url)) models.set(item.url, await loadModel(item.url));
  const box = new THREE.Box3();
  // Each placed item's world-space bounds, for checks that compare engines.
  window.compositionBounds = [];
  for (const item of job.items) {
    const obj = models.get(item.url).clone(true);
    obj.position.fromArray(item.position);
    obj.quaternion.fromArray(item.rotation);
    obj.scale.setScalar(item.scale ?? 1);
    enableShadows(obj);
    stage.scene.add(obj);
    const b = boundsOf(obj);
    window.compositionBounds.push({ min: b.min.toArray(), max: b.max.toArray() });
    box.union(b);
  }
  fitStage(stage, box);
  const camera = fitCameraToBox(
    frameCamera(box, viewDirection("front"), job.width / job.height),
    box,
  );
  const png = snapshot(renderer, stage.scene, camera);
  renderer.dispose();
  return png;
};

/**
 * A close-up of one model alone (no scale cube), three-quarter front: job = { model }.
 * Used for the fallback image of assets with glass extensions.
 */
window.renderThumb = async (job) => {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  document.body.appendChild(canvas);
  const renderer = createRenderer(canvas, {
    width: SIZE,
    height: SIZE,
    preserveDrawingBuffer: true,
  });
  const stage = await createStage(renderer, "/scene/studio.hdr");
  const model = await loadModel(job.model);
  stage.scene.add(model);
  const box = boundsOf(model);
  fitStage(stage, box);
  const png = snapshot(renderer, stage.scene, frameCamera(box, viewDirection("front"), 1, 1.1));
  renderer.dispose();
  return png;
};

/** Loads each model and returns its world-space size [x, y, z] in metres. */
window.measureBounds = async (urls) => {
  const sizes = [];
  for (const url of urls) {
    const size = boundsOf(await loadModel(url)).getSize(new THREE.Vector3());
    sizes.push([size.x, size.y, size.z]);
  }
  return sizes;
};

window.previewReady = true;
