// The preview page. The Node renderer calls window.renderJob(job) and gets back PNG data URLs.
// Deterministic: fixed size, no animation, no randomness; resolves only when loading is complete.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  boundsOf,
  createRenderer,
  createStage,
  enableShadows,
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

  // Kit view: the asset between up to two neighbours of the same size class.
  scene.remove(cube);
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

window.previewReady = true;
