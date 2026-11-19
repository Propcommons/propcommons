// Prop Commons Studio: build a scene from the library in the browser.
//
// Pick a prop, click where it should go: it is lowered onto whatever is under it (the floor, a
// table, a shelf), the same rule as `propcommons settle`. Drag to move, Q/E to turn, Delete to
// remove. Scenes save in this browser, open from the published compositions or a file, and
// export as one .glb (for any engine) or as a composition.json (to publish to the library).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { boundsOf, createRenderer, createStage, enableShadows, fitStage } from "../scene/stage.js";

const REACH = 0.02; // a surface this far above an item's start still catches it (as in settle)
const STORE = "propcommons-studio-scene";
const $ = (id) => document.getElementById(id);
const app = $("studio");
const base = app.dataset.base;
const canvas = $("viewport");
const hint = $("hint");

// ---------------------------------------------------------------------------------------------
// Library

let assets = []; // live assets from index.json
const byRef = new Map();
let compositions = [];

function cardSrc(a) {
  return `${base}${a.previews.thumb.replace(/thumb\.png$/, "card.webp")}`;
}

function renderLibrary() {
  const q = $("search").value.trim().toLowerCase();
  const kit = app.dataset.kit || "";
  const list = $("library");
  list.textContent = "";
  let shown = 0;
  for (const a of assets) {
    const m = a.manifest;
    const tags = m.tags ?? [];
    if (kit && !tags.includes(kit)) continue;
    const hay = `${m.name} ${tags.join(" ")} ${a.id}`.toLowerCase();
    if (q && !q.split(/\s+/).every((w) => hay.includes(w))) continue;
    shown++;
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lib-item";
    b.draggable = true;
    b.dataset.ref = a.ref;
    b.title = `${m.name}: click, then click in the scene to place it`;
    if (a.previews?.thumb) {
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.width = 96;
      img.height = 96;
      img.src = cardSrc(a);
      img.addEventListener("error", () => {
        if (!img.dataset.fallback) {
          img.dataset.fallback = "1";
          img.src = `${base}${a.previews.thumb}`;
        }
      });
      b.append(img);
    }
    const label = document.createElement("span");
    label.className = "lib-name";
    label.textContent = m.name;
    const size = document.createElement("span");
    size.className = "lib-size";
    size.textContent = dims(a.measured?.bounds_m);
    b.append(label, size);
    b.addEventListener("click", () => startPlacing(a.ref));
    b.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", a.ref);
      e.dataTransfer.effectAllowed = "copy";
      startPlacing(a.ref);
    });
    li.append(b);
    list.append(li);
  }
  $("lib-empty").hidden = shown > 0;
  $("lib-count").textContent = `${shown} of ${assets.length} props`;
}

function dims(b) {
  if (!b) return "";
  const cm = b.map((v) => Math.round(v * 100));
  return `${cm[0]} × ${cm[2]} × ${cm[1]} cm`;
}

function renderKits() {
  const counts = new Map();
  for (const a of assets)
    for (const t of a.manifest.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  const preferred = [
    "kitchen",
    "workshop",
    "living-room",
    "bedroom",
    "garden",
    "food",
    "furniture",
    "tool",
  ];
  const kits = preferred.filter((t) => counts.has(t));
  const wrap = $("kits");
  wrap.textContent = "";
  for (const t of ["", ...kits]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = t ? t.replace("-", " ") : "all";
    b.setAttribute("aria-pressed", String((app.dataset.kit || "") === t));
    b.addEventListener("click", () => {
      app.dataset.kit = t;
      for (const c of wrap.children) c.setAttribute("aria-pressed", String(c === b));
      renderLibrary();
    });
    wrap.append(b);
  }
}

// ---------------------------------------------------------------------------------------------
// The 3D stage

const renderer = createRenderer(canvas, { width: 800, height: 600, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
let stage;
const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.02, 200);
camera.position.set(2.4, 1.9, 3.2);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.35, 0);
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.minDistance = 0.15;
controls.maxDistance = 40;
controls.update();
const grid = new THREE.GridHelper(20, 40, 0xb9bbb6, 0xcfd0cc);
grid.position.y = 0.0005;
grid.material.transparent = true;
grid.material.opacity = 0.55;
const world = new THREE.Group(); // placed items only
let pending = false;
function redraw() {
  if (pending || !stage) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    renderer.render(stage.scene, camera);
  });
}
controls.addEventListener("change", redraw);

function resize() {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  redraw();
}
new ResizeObserver(resize).observe(canvas);

function refitStage() {
  const box = new THREE.Box3(new THREE.Vector3(-1.5, 0, -1.5), new THREE.Vector3(1.5, 1, 1.5));
  for (const it of items) box.union(boundsOf(it.obj));
  fitStage(stage, box);
}

// ---------------------------------------------------------------------------------------------
// Models: loaded once per asset version, then cloned.

const loader = new GLTFLoader();
const models = new Map(); // ref → Promise<{ template, samples }>

function loadModel(ref) {
  if (!models.has(ref)) {
    const a = byRef.get(ref);
    if (!a) return Promise.reject(new Error(`${ref} is not in the library`));
    models.set(
      ref,
      loader.loadAsync(`${base}${a.files.model}`).then((gltf) => {
        const template = gltf.scene;
        enableShadows(template);
        return { template, samples: bottomSamples(template) };
      }),
    );
  }
  return models.get(ref);
}

/**
 * Points on an asset's underside (its lowest quarter), in its own space: the points that land on
 * things. At most about 60: the outline in 24 directions, a ring further in, and the centre.
 */
function bottomSamples(object) {
  object.updateMatrixWorld(true);
  const pts = [];
  const v = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  object.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      pts.push(v.clone());
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
  });
  const band = minY + Math.max(0.01, 0.25 * (maxY - minY));
  const low = pts.filter((p) => p.y <= band);
  const picks = new Set();
  const choose = (score) => {
    let best = null;
    let bestS = -Infinity;
    for (const p of low) {
      const s = score(p);
      if (s > bestS) [best, bestS] = [p, s];
    }
    if (best) picks.add(best);
  };
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    choose((p) => p.x * dx + p.z * dz - p.y * 0.5);
  }
  // A ring halfway in, and the lowest points overall.
  const cx = low.reduce((s, p) => s + p.x, 0) / (low.length || 1);
  const cz = low.reduce((s, p) => s + p.z, 0) / (low.length || 1);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const tx = cx + Math.cos(a) * 0.5 * Math.max(...[...picks].map((p) => Math.abs(p.x - cx)), 0);
    const tz = cz + Math.sin(a) * 0.5 * Math.max(...[...picks].map((p) => Math.abs(p.z - cz)), 0);
    choose((p) => -((p.x - tx) ** 2 + (p.z - tz) ** 2) - p.y * 0.1);
  }
  const lowest = [...low].sort((p, q) => p.y - q.y).slice(0, 12);
  for (const p of lowest) picks.add(p);
  return [...picks];
}

// ---------------------------------------------------------------------------------------------
// Scene items

let items = []; // { id, ref, obj }
/** Scene object → its item. (Not in userData: three copies userData as JSON when cloning.) */
const itemOf = new WeakMap();
let nextId = 1;
let selected = null;
const selBox = new THREE.BoxHelper(undefined, 0x2563eb);
selBox.visible = false;

function makeObject(ref, template) {
  const obj = template.clone(true);
  obj.userData.ref = ref;
  return obj;
}

async function addItem(ref, position, quaternion, scale = 1, id) {
  const { template, samples } = await loadModel(ref);
  const obj = makeObject(ref, template);
  obj.position.fromArray(position);
  if (quaternion) obj.quaternion.fromArray(quaternion);
  obj.scale.setScalar(scale);
  // Raycasts use world matrices, which otherwise update only when a frame is drawn: a prop
  // placed right after this one (building a plan) must already see it where it is.
  obj.updateMatrixWorld(true);
  const it = { id: id ?? nextId++, ref, obj, samples };
  itemOf.set(obj, it);
  world.add(obj);
  items.push(it);
  return it;
}

function removeItem(it) {
  world.remove(it.obj);
  items = items.filter((x) => x !== it);
  if (selected === it) select(null);
}

function select(it) {
  selected = it;
  if (it) {
    selBox.setFromObject(it.obj);
    selBox.visible = true;
  } else selBox.visible = false;
  updateInspector();
  updateButtons();
  redraw();
}

// ---------------------------------------------------------------------------------------------
// Resting on things: lower an item from a start height until any underside point touches.

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

/** `exclude` is one item, a Set of items, or null. */
const others = (exclude) =>
  items.filter((it) => (exclude instanceof Set ? !exclude.has(it) : it !== exclude));

/** The height an item rests at when lowered at (x, z) from `start`. */
function restHeight(samples, quaternion, scale, x, z, start, exclude) {
  const targets = others(exclude).map((it) => it.obj);
  const p = new THREE.Vector3();
  const origin = new THREE.Vector3();
  let y = -Infinity;
  for (const s of samples) {
    p.copy(s).multiplyScalar(scale).applyQuaternion(quaternion);
    // The ground.
    let rest = -p.y;
    if (targets.length) {
      origin.set(x + p.x, start + p.y + REACH, z + p.z);
      raycaster.set(origin, DOWN);
      raycaster.far = start + p.y + REACH + 1;
      const hit = raycaster.intersectObjects(targets, true)[0];
      if (hit) rest = Math.max(rest, hit.point.y - p.y);
    }
    y = Math.max(y, rest);
  }
  return y;
}

async function settleItem(it, start, exclude = it) {
  const { samples } = await loadModel(it.ref);
  const y = restHeight(
    samples,
    it.obj.quaternion,
    it.obj.scale.x,
    it.obj.position.x,
    it.obj.position.z,
    start,
    exclude,
  );
  it.obj.position.y = y;
  it.obj.updateMatrixWorld(true);
}

/** The item `b` rests on (where most of its low points touch), or null for the floor. */
function supportOf(b) {
  const targets = others(b).map((it) => it.obj);
  if (!targets.length) return null;
  const o = b.obj;
  const p = new THREE.Vector3();
  const counts = new Map();
  for (const s of b.samples) {
    p.copy(s).multiplyScalar(o.scale.x).applyQuaternion(o.quaternion).add(o.position);
    raycaster.set(new THREE.Vector3(p.x, p.y + 0.005, p.z), DOWN);
    raycaster.far = 0.015; // touching: a surface within a centimetre below
    const hit = raycaster.intersectObjects(targets, true)[0];
    let x = hit?.object;
    while (x && !itemOf.has(x)) x = x.parent;
    if (x) counts.set(itemOf.get(x), (counts.get(itemOf.get(x)) ?? 0) + 1);
  }
  let best = null;
  let most = 0;
  for (const [it, n] of counts) if (n > most) [best, most] = [it, n];
  return best;
}

/** Everything resting on `it`, directly or on something that does (a plate, the fruit on it). */
function carriedBy(it) {
  const support = new Map(items.map((x) => [x, supportOf(x)]));
  const out = [];
  let frontier = new Set([it]);
  while (frontier.size) {
    const next = new Set();
    for (const x of items)
      if (x !== it && !out.includes(x) && frontier.has(support.get(x))) {
        out.push(x);
        next.add(x);
      }
    frontier = next;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pointer: placing, selecting and dragging

const pointer = new THREE.Vector2();
/** Snap positions to a 5 cm grid: the Snap button, or hold Shift to flip it for one move. */
const SNAP = 0.05;
let snapOn = false;
let shiftHeld = false;
const snapping = () => snapOn !== shiftHeld;
const snap = (v) => (snapping() ? Math.round(v / SNAP) * SNAP : v);

function setPointer(e) {
  shiftHeld = !!e.shiftKey;
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Where the pointer meets the scene (ignoring `exclude`), or the ground plane. */
function pick(exclude) {
  raycaster.setFromCamera(pointer, camera);
  raycaster.far = Infinity;
  const targets = others(exclude).map((it) => it.obj);
  const hit = raycaster.intersectObjects(targets, true)[0];
  if (hit) {
    let o = hit.object;
    while (o && !itemOf.has(o)) o = o.parent;
    return { point: hit.point, item: (o && itemOf.get(o)) ?? null, normal: hit.face?.normal };
  }
  const p = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, p)) return { point: p, item: null };
  return null;
}

// Placing: a translucent ghost follows the pointer.
let placing = null; // { ref, ghost, samples, yaw }

async function startPlacing(ref) {
  cancelPlacing();
  select(null);
  setHint("Loading…");
  const { template, samples } = await loadModel(ref);
  const ghost = template.clone(true);
  ghost.traverse((o) => {
    if (o.isMesh) {
      o.material = Array.isArray(o.material) ? o.material.map(ghostly) : ghostly(o.material);
      o.castShadow = false;
    }
  });
  ghost.visible = false;
  placing = { ref, ghost, samples, yaw: 0 };
  stage.scene.add(ghost);
  updateButtons();
  setHint(
    `Click to place the ${byRef.get(ref).manifest.name.toLowerCase()}. Q / E turn it, Esc cancels.`,
  );
  for (const b of document.querySelectorAll(".lib-item"))
    b.classList.toggle("active", b.dataset.ref === ref);
}
function ghostly(m) {
  const g = m.clone();
  g.transparent = true;
  g.opacity = 0.55;
  g.depthWrite = false;
  return g;
}
function cancelPlacing() {
  if (!placing) return;
  stage.scene.remove(placing.ghost);
  placing = null;
  for (const b of document.querySelectorAll(".lib-item.active")) b.classList.remove("active");
  updateButtons();
  setHint(defaultHint());
  redraw();
}
function movePlacing() {
  const at = pick(null);
  if (!at) {
    placing.ghost.visible = false;
    return redraw();
  }
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placing.yaw);
  placing.ghost.quaternion.copy(q);
  const x = snap(at.point.x);
  const z = snap(at.point.z);
  const y = restHeight(placing.samples, q, 1, x, z, at.point.y, null);
  placing.ghost.position.set(x, y, z);
  placing.ghost.visible = true;
  redraw();
}
async function commitPlacing() {
  if (!placing?.ghost.visible) return;
  const g = placing.ghost;
  const it = await addItem(placing.ref, g.position.toArray(), g.quaternion.toArray());
  commit(`Placed ${byRef.get(it.ref).manifest.name}`);
  // Keep placing the same prop until Esc, which is how people lay a table.
  movePlacing();
  select(null);
}

let drag = null; // { it, dx, dz, moved }
let downAt = null;

canvas.addEventListener("pointermove", (e) => {
  setPointer(e);
  if (placing) return movePlacing();
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4) return;
    drag.moved = true;
    const at = pick(drag.moving);
    if (!at) return;
    const o = drag.it.obj;
    o.position.x = snap(at.point.x - drag.dx);
    o.position.z = snap(at.point.z - drag.dz);
    o.position.y = restHeight(
      drag.samples,
      o.quaternion,
      o.scale.x,
      o.position.x,
      o.position.z,
      at.point.y,
      drag.moving,
    );
    o.updateMatrixWorld(true);
    // What rests on it comes along.
    for (const c of drag.carried) {
      c.it.obj.position.copy(o.position).add(c.offset);
      c.it.obj.updateMatrixWorld(true);
    }
    selBox.setFromObject(o);
    updateInspector();
    redraw();
  }
});

canvas.addEventListener("pointerdown", async (e) => {
  if (e.button !== 0) return;
  setPointer(e);
  downAt = { x: e.clientX, y: e.clientY };
  if (placing) return;
  const at = pick(null);
  if (at?.item) {
    select(at.item);
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    const { samples } = await loadModel(at.item.ref);
    const carried = carriedBy(at.item).map((c) => ({
      it: c,
      offset: c.obj.position.clone().sub(at.item.obj.position),
    }));
    drag = {
      it: at.item,
      carried,
      moving: new Set([at.item, ...carried.map((c) => c.it)]),
      dx: at.point.x - at.item.obj.position.x,
      dz: at.point.z - at.item.obj.position.z,
      moved: false,
      samples,
    };
  }
});

canvas.addEventListener("pointerup", (e) => {
  if (e.button !== 0) return;
  if (placing) {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) commitPlacing();
    downAt = null;
    return;
  }
  if (drag) {
    if (drag.moved) commit(`Moved ${byRef.get(drag.it.ref).manifest.name}`);
    drag = null;
    controls.enabled = true;
    canvas.releasePointerCapture(e.pointerId);
  } else if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4) select(null);
  downAt = null;
});

canvas.addEventListener("pointerleave", () => {
  if (placing) {
    placing.ghost.visible = false;
    redraw();
  }
});
canvas.addEventListener("dragover", (e) => {
  if (!placing) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  setPointer(e);
  movePlacing();
});
canvas.addEventListener("drop", (e) => {
  if (!placing) return;
  e.preventDefault();
  setPointer(e);
  movePlacing();
  commitPlacing().then(cancelPlacing);
});

// ---------------------------------------------------------------------------------------------
// Editing

async function turn(deg) {
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    (deg * Math.PI) / 180,
  );
  if (placing) {
    placing.yaw += (deg * Math.PI) / 180;
    return movePlacing();
  }
  if (!selected) return;
  const o = selected.obj;
  const carried = carriedBy(selected);
  const before = o.position.clone();
  o.quaternion.premultiply(q);
  // What rests on it turns with it, about its centre.
  for (const c of carried) {
    c.obj.position.sub(before).applyQuaternion(q).add(before);
    c.obj.quaternion.premultiply(q);
  }
  await settleItem(selected, o.position.y, new Set([selected, ...carried]));
  const dy = o.position.y - before.y;
  for (const c of carried) {
    c.obj.position.y += dy;
    c.obj.updateMatrixWorld(true);
  }
  select(selected);
  commit(`Turned ${byRef.get(selected.ref).manifest.name}`);
}

async function duplicate() {
  if (!selected) return;
  const o = selected.obj;
  const b = boundsOf(o);
  const shift = Math.max(0.05, (b.max.x - b.min.x) * 1.1);
  const it = await addItem(
    selected.ref,
    [o.position.x + shift, o.position.y, o.position.z],
    o.quaternion.toArray(),
    o.scale.x,
  );
  await settleItem(it, o.position.y + 0.05);
  select(it);
  commit(`Duplicated ${byRef.get(it.ref).manifest.name}`);
}

async function deleteSelected() {
  if (!selected) return;
  const name = byRef.get(selected.ref).manifest.name;
  const carried = carriedBy(selected);
  removeItem(selected);
  // What rested on it drops onto whatever is below, lowest first.
  carried.sort((a, b) => a.obj.position.y - b.obj.position.y);
  for (const c of carried) await settleItem(c, c.obj.position.y);
  commit(`Deleted ${name}`);
}

// ---------------------------------------------------------------------------------------------
// History and saving

let history = [];
let future = [];
/** Whether an AI assistant laid out any of this scene (Describe a scene); exports say so. */
let aiUsed = false;
const snapshot = () =>
  JSON.stringify({
    name: $("scene-name").value,
    ...(aiUsed ? { ai: true } : {}),
    items: items.map((it) => ({
      id: it.id,
      asset: it.ref,
      position: it.obj.position.toArray().map(round),
      rotation: it.obj.quaternion.toArray().map((v) => Math.round(v * 1e6) / 1e6),
      ...(it.obj.scale.x !== 1 ? { scale: it.obj.scale.x } : {}),
    })),
  });
const round = (v) => Math.round(v * 1e5) / 1e5 + 0;

function commit(label) {
  const s = snapshot();
  if (history[history.length - 1] === s) return;
  history.push(s);
  future = [];
  if (history.length > 200) history.shift();
  save(s);
  refitStage();
  updateButtons();
  updateInspector();
  if (label) toast(label);
  redraw();
}
function save(s) {
  try {
    localStorage.setItem(STORE, s);
  } catch {
    // Private windows can refuse storage; the scene still works, it just isn't kept.
  }
}

/** Downloads every model a scene needs at once (not one after another), showing progress. */
async function preload(refs) {
  const todo = [...new Set(refs)].filter((r) => byRef.has(r));
  if (!todo.length) return;
  let done = 0;
  loading = true;
  updateButtons();
  setHint(`Loading ${todo.length} props…`);
  try {
    await Promise.all(
      todo.map((r) =>
        loadModel(r).then(() => {
          done++;
          setHint(`Loading props… ${done} of ${todo.length}`);
        }),
      ),
    );
  } finally {
    loading = false;
  }
}
let loading = false;

async function restore(s) {
  const data = JSON.parse(s);
  for (const it of [...items]) world.remove(it.obj);
  items = [];
  select(null);
  $("scene-name").value = data.name ?? "Untitled scene";
  aiUsed = data.ai === true;
  const missing = [];
  await preload((data.items ?? []).map((i) => i.asset));
  for (const i of data.items ?? []) {
    if (!byRef.has(i.asset)) {
      missing.push(i.asset);
      continue;
    }
    await addItem(i.asset, i.position, i.rotation, i.scale ?? 1, i.id);
  }
  nextId = Math.max(1, ...items.map((it) => it.id + 1));
  refitStage();
  updateButtons();
  if (!placing) setHint(defaultHint());
  redraw();
  if (missing.length)
    toast(
      `${missing.length} item(s) left out: not in the library (${missing.slice(0, 2).join(", ")})`,
    );
}

async function undo() {
  if (history.length < 2) return;
  future.push(history.pop());
  await restore(history[history.length - 1]);
  save(history[history.length - 1]);
  toast("Undone");
}
async function redo() {
  if (!future.length) return;
  const s = future.pop();
  history.push(s);
  await restore(s);
  save(s);
  toast("Redone");
}

async function openScene(data, label) {
  cancelPlacing();
  await restore(JSON.stringify(data));
  history = [snapshot()];
  future = [];
  save(history[0]);
  frameScene();
  updateButtons();
  if (label) toast(label);
}

async function openComposition(ref) {
  const c = compositions.find((x) => x.ref === ref || x.id === ref);
  if (!c) return toast(`No published scene called ${ref}`);
  setHint("Loading the scene…");
  const doc = await fetch(`${base}${c.path}/composition.json`).then((r) => r.json());
  await openScene({ name: doc.name, items: doc.items }, `Opened ${doc.name}`);
  setHint(defaultHint());
}

// ---------------------------------------------------------------------------------------------
// Export

function slugify(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "my-scene"
  );
}
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** The scene as published compositions need it: resting on y = 0, footprint centred. */
function placedForExport() {
  const box = new THREE.Box3();
  for (const it of items) box.union(boundsOf(it.obj));
  const dx = -(box.min.x + box.max.x) / 2;
  const dz = -(box.min.z + box.max.z) / 2;
  const dy = -box.min.y;
  return items.map((it) => ({
    asset: it.ref,
    position: [
      round(it.obj.position.x + dx),
      round(it.obj.position.y + dy),
      round(it.obj.position.z + dz),
    ],
    rotation: it.obj.quaternion.toArray().map((v) => Math.round(v * 1e6) / 1e6 + 0),
    ...(it.obj.scale.x !== 1 ? { scale: it.obj.scale.x } : {}),
  }));
}

async function exportGlb() {
  if (!items.length) return toast("Add something to the scene first");
  const group = new THREE.Group();
  group.name = $("scene-name").value || "Scene";
  for (const [i, it] of items.entries()) {
    const placed = placedForExport()[i];
    const o = it.obj.clone(true);
    o.position.fromArray(placed.position);
    o.name = `${i + 1} ${byRef.get(it.ref).manifest.name}`;
    o.userData = { propcommons: it.ref };
    group.add(o);
  }
  const glb = await new GLTFExporter().parseAsync(group, { binary: true });
  download(new Blob([glb], { type: "model/gltf-binary" }), `${slugify(group.name)}.glb`);
  toast("Downloaded the scene as .glb");
}

function exportComposition() {
  if (!items.length) return toast("Add something to the scene first");
  const dlg = $("export-dialog");
  $("export-name").value = $("scene-name").value;
  dlg.showModal();
}
$("export-form").addEventListener("submit", (e) => {
  const dlg = $("export-dialog");
  if (e.submitter?.value !== "download") return;
  const name = $("export-name").value.trim() || "Untitled scene";
  const handle =
    $("export-handle").value.trim().toLowerCase().replace(/^@/, "") || "your-github-name";
  const slug = slugify(name);
  const doc = {
    spec: "0.1",
    id: `${handle}/${slug}`,
    version: 1,
    name,
    license: "CC0-1.0",
    tags: [],
    credits: [{ github: handle, roles: ["directed"] }],
    ai_assisted: aiUsed,
    tools: aiUsed
      ? ["Prop Commons Studio", "an AI assistant (Describe a scene)"]
      : ["Prop Commons Studio"],
    items: placedForExport(),
  };
  download(
    new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: "application/json" }),
    "composition.json",
  );
  $("scene-name").value = name;
  commit();
  toast(`Downloaded composition.json. To publish it, put it in compositions/${handle}/${slug}/v1/`);
  dlg.close();
});

function exportPicture() {
  const was = selBox.visible;
  selBox.visible = false;
  grid.visible = false;
  renderer.render(stage.scene, camera);
  canvas.toBlob((b) => {
    download(b, `${slugify($("scene-name").value)}.png`);
    selBox.visible = was;
    grid.visible = $("grid").getAttribute("aria-pressed") === "true";
    redraw();
  }, "image/png");
}

// ---------------------------------------------------------------------------------------------
// Share: the whole scene, compressed, in the link's #fragment (never sent to the server).

const b64url = (bytes) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
const fromB64url = (s) =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
async function pack(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function unpack(s) {
  const stream = new Blob([fromB64url(s)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

async function shareLink() {
  if (!items.length) return toast("Add something to the scene first");
  // Short form: [name, [[ref, x, y, z, yawDeg or quaternion, scale?], ...]].
  const rows = items.map((it) => {
    const o = it.obj;
    const e = new THREE.Euler().setFromQuaternion(o.quaternion, "YXZ");
    const yawOnly = Math.abs(e.x) < 1e-4 && Math.abs(e.z) < 1e-4;
    const rot = yawOnly
      ? Math.round(((e.y * 180) / Math.PI) * 10) / 10
      : o.quaternion.toArray().map((v) => Math.round(v * 1e5) / 1e5);
    const row = [it.ref, ...o.position.toArray().map((v) => Math.round(v * 1e4) / 1e4), rot];
    if (o.scale.x !== 1) row.push(o.scale.x);
    return row;
  });
  const url = `${location.origin}${location.pathname}#s=${await pack(JSON.stringify([$("scene-name").value, rows, aiUsed ? 1 : 0]))}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied: it opens this scene for anyone");
  } catch {
    prompt("Copy this link:", url);
  }
}

async function openShared(fragment) {
  const [name, rows, ai] = JSON.parse(await unpack(fragment));
  const yawQ = (deg) =>
    new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180)
      .toArray();
  await openScene(
    {
      name,
      ai: ai === 1,
      items: rows.map(([asset, x, y, z, rot, scale]) => ({
        asset,
        position: [x, y, z],
        rotation: Array.isArray(rot) ? rot : yawQ(rot),
        ...(scale ? { scale } : {}),
      })),
    },
    `Opened the shared scene "${name}"`,
  );
}

// ---------------------------------------------------------------------------------------------
// Describe a scene: a prompt for any AI assistant, and building the plan it returns.

function describePrompt(text) {
  const lines = assets.map((a) => {
    const [w, h, d] = (a.measured?.bounds_m ?? [0, 0, 0]).map((v) => Math.round(v * 100));
    return `${a.ref} | ${a.manifest.name} | ${w} × ${d} cm footprint, ${h} cm tall | ${(a.manifest.tags ?? []).join(", ")}`;
  });
  return `You are laying out a 3D scene from a fixed library of props. Only these props exist; use each one's exact ID.

Scene to make: ${text || "(describe it here)"}

Rules for positions:
- Units are metres. The floor is y = 0. +Y is up. The viewer looks at the scene from the +Z side, so the front of the scene is +Z.
- x and z are where the CENTRE OF A PROP'S FOOTPRINT goes. y is the height of the surface it stands on: 0 for the floor, a table's height for something on that table (the sizes below tell you heights). The Studio lowers every prop onto whatever is under it, so y only needs to be roughly right, never too high above the surface.
- turn is degrees about the vertical axis, anticlockwise seen from above. At turn 0 a prop faces +Z (a chair's seat faces +Z, its back is towards -Z). At 180 it faces -Z. Long thin things (cutlery, knives, tools) lie along X at turn 0.
- List props in the order they should be placed: furniture first, then what goes on it.
- Leave room: props must not overlap each other except where one rests on another. Use the footprint sizes.
- A chair pulled up to a table sits just outside the table's edge, facing it.

Reply with JSON only, no other text:
{"items": [{"asset": "<id>", "x": 0, "z": 0, "y": 0, "turn": 0}]}

The library (ID | name | size | tags):
${lines.join("\n")}
`;
}

function parsePlan(reply) {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the reply has no JSON in it");
  let plan;
  try {
    plan = JSON.parse(reply.slice(start, end + 1));
  } catch (e) {
    throw new Error(`the JSON in the reply doesn't parse (${e.message})`);
  }
  const list = Array.isArray(plan) ? plan : plan.items;
  if (!Array.isArray(list) || !list.length) throw new Error("the reply has no items list");
  const unknown = [];
  const steps = [];
  for (const i of list) {
    const ref = byRef.has(i.asset)
      ? i.asset
      : assets.find((a) => a.id === i.asset || a.manifest.name === i.asset)?.ref;
    if (!ref) {
      unknown.push(String(i.asset));
      continue;
    }
    const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
    steps.push({
      ref,
      x: num(i.x),
      z: num(i.z),
      y: Math.max(0, num(i.y)),
      turn: num(i.turn ?? i.yaw),
    });
  }
  if (!steps.length)
    throw new Error(
      `none of the props in the reply are in the library (${unknown.slice(0, 3).join(", ")})`,
    );
  return { steps, unknown };
}

async function buildPlan(steps) {
  aiUsed = true;
  await preload(steps.map((x) => x.ref));
  // Bottom of the pile first: by the height given, then flat things before tall ones, so a rug
  // goes down before the table that stands on it, whatever order the plan lists them in.
  const height = (ref) => byRef.get(ref)?.measured?.bounds_m?.[1] ?? 0;
  steps = steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.y - b.s.y || height(a.s.ref) - height(b.s.ref) || a.i - b.i)
    .map((x) => x.s);
  for (const it of [...items]) world.remove(it.obj);
  items = [];
  select(null);
  for (const s of steps) {
    const { samples } = await loadModel(s.ref);
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      (s.turn * Math.PI) / 180,
    );
    // Lowered from a little above the height the plan gives, as `propcommons settle` does.
    const y = restHeight(samples, q, 1, s.x, s.z, s.y + 0.03, null);
    await addItem(s.ref, [s.x, y, s.z], q.toArray());
  }
}

bind("describe", () => {
  $("describe-error").textContent = "";
  $("describe-copied").textContent = "";
  $("describe-dialog").showModal();
});
bind("describe-copy", async () => {
  const prompt = describePrompt($("describe-text").value.trim());
  try {
    await navigator.clipboard.writeText(prompt);
    $("describe-copied").textContent = "Copied. Paste it into your AI assistant.";
  } catch {
    // Clipboard blocked: put the prompt in the reply box, selected, to copy by hand.
    $("describe-reply").value = prompt;
    $("describe-reply").select();
    $("describe-copied").textContent =
      "Couldn't copy automatically: the prompt is in the box below, selected. Copy it, then replace it with the reply.";
  }
});
bind("describe-build", async () => {
  try {
    const { steps, unknown } = parsePlan($("describe-reply").value);
    $("describe-dialog").close();
    setHint("Building the scene…");
    const name = $("describe-text").value.trim();
    if (name) $("scene-name").value = name.length > 60 ? `${name.slice(0, 57)}…` : name;
    await buildPlan(steps);
    commit(
      `Built ${steps.length} props${unknown.length ? `; left out ${unknown.length} not in the library` : ""}`,
    );
    frameScene();
    setHint(defaultHint());
  } catch (e) {
    $("describe-error").textContent = `Couldn't build it: ${e.message}.`;
  }
});

// ---------------------------------------------------------------------------------------------
// Inspector, buttons, hints

function updateInspector() {
  const box = $("inspector");
  if (!selected) {
    box.hidden = true;
    return;
  }
  const a = byRef.get(selected.ref);
  const o = selected.obj;
  const yaw = Math.round(
    (new THREE.Euler().setFromQuaternion(o.quaternion, "YXZ").y * 180) / Math.PI,
  );
  box.hidden = false;
  $("insp-name").textContent = a.manifest.name;
  $("insp-name").href = `${base}${a.path}/`;
  const on = supportOf(selected);
  const carrying = carriedBy(selected).length;
  $("insp-meta").textContent = [
    dims(a.measured?.bounds_m),
    on ? `on the ${byRef.get(on.ref).manifest.name.split(",")[0].toLowerCase()}` : "on the floor",
    carrying ? `carrying ${carrying} prop${carrying === 1 ? "" : "s"}` : "",
    `turned ${((yaw % 360) + 360) % 360}°`,
  ]
    .filter(Boolean)
    .join(" · ");
}
function updateButtons() {
  for (const id of ["turn-left", "turn-right", "duplicate", "delete"]) $(id).disabled = !selected;
  $("undo").disabled = history.length < 2;
  $("redo").disabled = !future.length;
  $("count").textContent = items.length
    ? `${items.length} item${items.length === 1 ? "" : "s"}`
    : "Empty scene";
  $("empty").hidden = items.length > 0 || !!placing || loading;
}
const defaultHint = () =>
  items.length
    ? "Drag a prop to move it. Q / E turn it, Delete removes it. Drag empty space to look around."
    : "Pick a prop on the left, then click in the scene to place it.";
function setHint(s) {
  hint.textContent = s;
}
let toastTimer;
function toast(s) {
  const t = $("toast");
  t.textContent = s;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 3500);
}

function frameScene() {
  const box = new THREE.Box3();
  for (const it of items) box.union(boundsOf(it.obj));
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0.8, 1));
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.15);
  const dist = (r / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
  const dir = new THREE.Vector3(0.55, 0.5, 0.75).normalize();
  controls.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, dist);
  camera.near = Math.max(0.005, dist / 200);
  camera.updateProjectionMatrix();
  controls.update();
  redraw();
}

// ---------------------------------------------------------------------------------------------
// Wiring

function bind(id, fn) {
  $(id).addEventListener("click", fn);
}
bind("turn-left", () => turn(15));
bind("turn-right", () => turn(-15));
bind("duplicate", duplicate);
bind("delete", deleteSelected);
bind("undo", undo);
bind("redo", redo);
bind("frame", frameScene);
bind("export-glb", exportGlb);
bind("export-json", exportComposition);
bind("picture", exportPicture);
bind("share", shareLink);
bind("help", () => $("help-dialog").showModal());
bind("snap", () => {
  snapOn = !snapOn;
  $("snap").setAttribute("aria-pressed", String(snapOn));
  try {
    localStorage.setItem("propcommons-studio-snap", snapOn ? "1" : "0");
  } catch {}
});
try {
  snapOn = localStorage.getItem("propcommons-studio-snap") === "1";
  $("snap").setAttribute("aria-pressed", String(snapOn));
} catch {}
bind("try-scene", () => {
  // The scene with the most items shows off the most.
  const best = [...compositions].sort((a, b) => b.items.length - a.items.length)[0];
  if (best) openComposition(best.ref);
});
bind("grid", () => {
  const on = $("grid").getAttribute("aria-pressed") !== "true";
  $("grid").setAttribute("aria-pressed", String(on));
  grid.visible = on;
  redraw();
});
bind("new", async () => {
  if (
    items.length &&
    !confirm("Start a new, empty scene? The current one is replaced (Undo brings it back).")
  )
    return;
  for (const it of [...items]) removeItem(it);
  $("scene-name").value = "Untitled scene";
  aiUsed = false;
  commit("New scene");
  frameScene();
});
$("open").addEventListener("change", async (e) => {
  const v = e.target.value;
  e.target.value = "";
  if (v) await openComposition(v);
});
$("open-file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  try {
    const doc = JSON.parse(await f.text());
    if (!Array.isArray(doc.items)) throw new Error("it has no items list");
    await openScene({ name: doc.name, items: doc.items }, `Opened ${f.name}`);
  } catch (err) {
    toast(`Couldn't open ${f.name}: ${err.message}`);
  }
});
$("scene-name").addEventListener("change", () => commit());
$("search").addEventListener("input", renderLibrary);

window.addEventListener("keydown", (e) => {
  const typing = e.target.closest?.("input, textarea, select, dialog");
  if (typing) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    return redo();
  }
  if (mod && e.key.toLowerCase() === "d") {
    e.preventDefault();
    return duplicate();
  }
  if (mod) return;
  const k = e.key.toLowerCase();
  if (k === "q") turn(e.shiftKey ? 90 : 15);
  else if (k === "e") turn(e.shiftKey ? -90 : -15);
  else if (k === "delete" || k === "backspace") deleteSelected();
  else if (k === "escape") {
    if (placing) cancelPlacing();
    else select(null);
  } else if (k === "f") frameScene();
  else if (e.key === "?") $("help-dialog").showModal();
  else if (k === "/") {
    e.preventDefault();
    $("search").focus();
  }
});

// A shared link pasted into a tab that already has the Studio open changes only the #fragment,
// which doesn't reload the page.
window.addEventListener("hashchange", async () => {
  if (!location.hash.startsWith("#s=")) return;
  try {
    await openShared(location.hash.slice(3));
  } catch {
    toast("That shared link is damaged");
  }
  window.history.replaceState(null, "", location.pathname + location.search);
});

// For automated checks and for agents driving the page.
window.studio = {
  get items() {
    return items.map((it) => ({
      asset: it.ref,
      position: it.obj.position.toArray(),
      bounds: (() => {
        const b = boundsOf(it.obj);
        return { min: b.min.toArray(), max: b.max.toArray() };
      })(),
    }));
  },
  async place(ref, x, z, yawDeg = 0) {
    const { samples } = await loadModel(ref);
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      (yawDeg * Math.PI) / 180,
    );
    // Start from just above whatever is highest there, as a click on it would.
    raycaster.set(new THREE.Vector3(x, 50, z), DOWN);
    raycaster.far = 100;
    const hit = raycaster.intersectObjects(
      items.map((it) => it.obj),
      true,
    )[0];
    const y = restHeight(samples, q, 1, x, z, hit ? hit.point.y : 0, null);
    const it = await addItem(ref, [x, y, z], q.toArray());
    commit(`Placed ${byRef.get(ref).manifest.name}`);
    return it.obj.position.toArray();
  },
  open: openComposition,
  snapshot,
  describePrompt,
  async build(reply) {
    const { steps } = parsePlan(reply);
    await buildPlan(steps);
    commit();
    frameScene();
    return items.length;
  },
};

async function main() {
  const index = await fetch(app.dataset.index).then((r) => r.json());
  assets = index.assets
    .filter((a) => a.latest && !a.taken_down && a.files?.model && a.manifest)
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  for (const a of index.assets)
    if (!a.taken_down && a.files?.model && a.manifest) byRef.set(a.ref, a);
  compositions = index.compositions.filter((c) => c.latest && !c.taken_down);
  const open = $("open");
  for (const c of compositions) {
    const o = document.createElement("option");
    o.value = c.ref;
    o.textContent = c.manifest?.name ?? c.id;
    open.append(o);
  }
  renderKits();
  renderLibrary();

  stage = await createStage(renderer, `${base}scene/studio.hdr`);
  stage.scene.add(grid, world, selBox);
  resize();

  // Start from: ?scene=author/slug (a published scene), else ?add=ref, else the last scene here.
  const params = new URLSearchParams(location.search);
  let saved = null;
  try {
    saved = localStorage.getItem(STORE);
  } catch {}
  if (location.hash.startsWith("#s=")) {
    try {
      await openShared(location.hash.slice(3));
      // Edits from here are this browser's own copy; a reload shouldn't throw them away.
      window.history.replaceState(null, "", location.pathname + location.search);
    } catch {
      toast("That shared link is damaged; opened your last scene instead");
      if (saved) await restore(saved);
    }
    history = [snapshot()];
  } else if (params.get("scene")) await openComposition(params.get("scene"));
  else if (saved) {
    await restore(saved);
    history = [snapshot()];
    frameScene();
  } else {
    history = [snapshot()];
    frameScene();
  }
  if (params.get("add") && byRef.has(params.get("add"))) startPlacing(params.get("add"));
  refitStage();
  updateButtons();
  if (!placing) setHint(defaultHint());
  app.classList.add("ready");
  window.studioReady = true;
  redraw();
}

main().catch((e) => {
  setHint(`The studio could not start: ${e.message}`);
  window.studioError = String(e);
});
