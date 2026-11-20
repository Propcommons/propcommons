// The composition viewer: loads each pinned asset version at its placement in the reference scene.
// Positions are metres, rotations glTF quaternions (x, y, z, w), scale one optional number.
//
// The index has every model's measured size, so the stage and camera are set up from those before
// any model arrives: the empty stage shows at once, the models download together, and each one
// appears as soon as it lands. A big model then only delays itself, not the whole scene.
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
const loading = document.getElementById("loading");
const base = canvas.dataset.base;

const megabytes = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

/** Where an item will sit, from its asset's measured size (models rest on y = 0, centred). */
function expectedBox(asset, item) {
  const size = asset.measured?.bounds_m;
  if (!size) return null;
  const [w, h, d] = size;
  const box = new THREE.Box3(
    new THREE.Vector3(-w / 2, 0, -d / 2),
    new THREE.Vector3(w / 2, h, d / 2),
  );
  const s = item.scale ?? 1;
  return box.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(item.position),
      new THREE.Quaternion().fromArray(item.rotation),
      new THREE.Vector3(s, s, s),
    ),
  );
}

async function main() {
  const [composition, index] = await Promise.all([
    fetch(canvas.dataset.composition).then((r) => r.json()),
    fetch(canvas.dataset.index).then((r) => r.json()),
  ]);
  const byRef = new Map(index.assets.map((a) => [a.ref, a]));
  // A taken-down or missing asset is left out of the scene, not an error.
  const shown = (ref) => {
    const a = byRef.get(ref);
    return a && !a.taken_down && a.files;
  };
  const items = composition.items.filter((i) => shown(i.asset));
  if (!items.length) throw new Error("every asset in it has been taken down");
  const refs = [...new Set(items.map((i) => i.asset))];

  const width = canvas.clientWidth || 960;
  const height = Math.round((width * 2) / 3);
  const renderer = createRenderer(canvas, { width, height, preserveDrawingBuffer: true });
  const stage = await createStage(renderer, `${base}scene/studio.hdr`);
  const { scene } = stage;

  let camera = null;
  const draw = () => camera && renderer.render(scene, camera);
  const frame = (box) => {
    fitStage(stage, box);
    camera = fitCameraToBox(frameCamera(box, viewDirection("front"), width / height), box, 0.8);
    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(box.getCenter(new THREE.Vector3()));
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // stay above the ground
    controls.update();
    // Zoom on scroll only after a click, so scrolling down the page never gets stuck here.
    controls.enableZoom = false;
    canvas.addEventListener("pointerdown", () => {
      controls.enableZoom = true;
    });
    canvas.addEventListener("pointerleave", () => {
      controls.enableZoom = false;
    });
    controls.addEventListener("change", draw);
    draw();
  };

  // Frame the scene now when every size is known; otherwise once the models are in.
  const expected = items.map((i) => expectedBox(byRef.get(i.asset), i));
  if (expected.every(Boolean)) frame(expected.reduce((a, b) => a.union(b), new THREE.Box3()));

  const pending = new Set(refs);
  const progress = () => {
    const done = refs.length - pending.size;
    const last = pending.size === 1 ? byRef.get([...pending][0]) : null;
    const waiting = last
      ? ` · waiting for ${last.manifest?.name ?? last.ref}${last.measured?.file_bytes ? ` (${megabytes(last.measured.file_bytes)})` : ""}`
      : "";
    const text = `Loading models: ${done} of ${refs.length}${waiting}…`;
    status.textContent = text;
    if (loading) loading.textContent = text;
  };
  progress();

  const loader = new GLTFLoader();
  const placed = new Array(items.length);
  await Promise.all(
    refs.map(async (ref) => {
      const model = (await loader.loadAsync(`${base}${byRef.get(ref).files.model}`)).scene;
      items.forEach((item, n) => {
        if (item.asset !== ref) return;
        const obj = model.clone(true);
        obj.position.fromArray(item.position);
        obj.quaternion.fromArray(item.rotation);
        obj.scale.setScalar(item.scale ?? 1);
        obj.name = item.asset;
        enableShadows(obj);
        scene.add(obj);
        placed[n] = obj;
      });
      pending.delete(ref);
      progress();
      draw();
    }),
  );

  const box = new THREE.Box3();
  for (const o of placed) box.union(boundsOf(o));
  if (!camera) frame(box);
  if (loading) loading.hidden = true;

  const size = box.getSize(new THREE.Vector3());
  const left = composition.items.length - items.length;
  status.textContent = `${left ? `${left} item(s) left out because their asset was taken down · ` : ""}${items.length} items from ${refs.length} assets · ${(size.x * 100).toFixed(0)} × ${(size.y * 100).toFixed(0)} × ${(size.z * 100).toFixed(0)} cm · drag to look around; click it, then scroll to zoom`;
  // For automated checks: each placed item's world-space bounds.
  window.compositionBounds = placed.map((o) => {
    const b = boundsOf(o);
    return { asset: o.name, min: b.min.toArray(), max: b.max.toArray() };
  });
  window.viewerReady = true;
}

main().catch((e) => {
  status.textContent = `The composition could not be loaded: ${e.message}`;
  if (loading) loading.hidden = true;
  window.viewerError = String(e);
});
