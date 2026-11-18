// The composition viewer: loads each pinned asset version at its placement in the reference scene.
// Positions are metres, rotations glTF quaternions (x, y, z, w), scale one optional number.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  boundsOf,
  createRenderer,
  createStage,
  enableShadows,
  fitCameraToBox,
  fitStage,
  frameCamera,
  viewDirection,
} from "../scene/stage.js";

const canvas = document.getElementById("composition");
const status = document.getElementById("status");
const base = canvas.dataset.base;

async function main() {
  const [composition, index] = await Promise.all([
    fetch(canvas.dataset.composition).then((r) => r.json()),
    fetch(canvas.dataset.index).then((r) => r.json()),
  ]);
  const byRef = new Map(index.assets.map((a) => [a.ref, a]));

  const width = canvas.clientWidth || 960;
  const height = Math.round((width * 2) / 3);
  const renderer = createRenderer(canvas, { width, height, preserveDrawingBuffer: true });
  const stage = await createStage(renderer, `${base}scene/studio.hdr`);
  const { scene } = stage;

  const loader = new GLTFLoader();
  const models = new Map();
  const missing = new Set();
  for (const ref of new Set(composition.items.map((i) => i.asset))) {
    const a = byRef.get(ref);
    // A taken-down or missing asset is left out of the scene, not an error.
    if (!a || a.taken_down || !a.files) missing.add(ref);
    else models.set(ref, (await loader.loadAsync(`${base}${a.files.model}`)).scene);
  }

  const placed = [];
  for (const item of composition.items) {
    if (missing.has(item.asset)) continue;
    const obj = models.get(item.asset).clone(true);
    obj.position.fromArray(item.position);
    obj.quaternion.fromArray(item.rotation);
    obj.scale.setScalar(item.scale ?? 1);
    obj.name = item.asset;
    enableShadows(obj);
    scene.add(obj);
    placed.push(obj);
  }

  if (!placed.length) throw new Error("every asset in it has been taken down");
  const box = new THREE.Box3();
  for (const o of placed) box.union(boundsOf(o));
  fitStage(stage, box);
  const camera = fitCameraToBox(frameCamera(box, viewDirection("front"), width / height), box, 0.8);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(box.getCenter(new THREE.Vector3()));
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // stay above the ground
  controls.update();
  const draw = () => renderer.render(scene, camera);
  controls.addEventListener("change", draw);
  draw();

  const size = box.getSize(new THREE.Vector3());
  const left = composition.items.length - placed.length;
  status.textContent = `${left ? `${left} item(s) left out because their asset was taken down · ` : ""}${placed.length} items from ${models.size} assets · ${(size.x * 100).toFixed(0)} × ${(size.y * 100).toFixed(0)} × ${(size.z * 100).toFixed(0)} cm · drag to orbit, scroll to zoom`;
  // For automated checks: each placed item's world-space bounds.
  window.compositionBounds = placed.map((o) => {
    const b = boundsOf(o);
    return { asset: o.name, min: b.min.toArray(), max: b.max.toArray() };
  });
  window.viewerReady = true;
}

main().catch((e) => {
  status.textContent = `The composition could not be loaded: ${e.message}`;
  window.viewerError = String(e);
});
