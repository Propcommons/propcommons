// The Prop Commons reference scene, shared by the preview renderer and the site's viewers, so what
// a contributor's agent sees is what a reviewer and a visitor see.
//
// One fixed neutral environment (studio.hdr), a matte ground plane at y = 0 with a soft shadow,
// neutral tone mapping, and no animation or randomness.
import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

export const BACKGROUND = 0xe6e6e3;
export const GROUND = 0xd8d8d4;

/** Creates a renderer configured identically everywhere. */
export function createRenderer(canvas, { width, height, preserveDrawingBuffer = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

/** Loads the environment and returns a scene with lights and ground. */
export async function createStage(renderer, hdrUrl) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  const hdr = await new HDRLoader().loadAsync(hdrUrl);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 0.9;
  hdr.dispose();
  pmrem.dispose();

  // One shadow-casting key light, matching the bright patch in the environment.
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-0.6, 0.75, 0.7).normalize();
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.002;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(key.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);

  return { scene, key, ground };
}

/** Sizes the ground and the key light's shadow camera to a box of content. */
export function fitStage(stage, box) {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.01);
  stage.ground.scale.set(span * 40, span * 40, 1);
  stage.ground.position.set(centre.x, 0, centre.z);
  const radius = span * 1.5;
  const cam = stage.key.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = 0.001;
  cam.far = radius * 8;
  cam.updateProjectionMatrix();
  const dir = new THREE.Vector3(-0.6, 0.75, 0.7).normalize();
  stage.key.target.position.copy(centre);
  stage.key.position.copy(centre).addScaledVector(dir, radius * 4);
  stage.key.shadow.needsUpdate = true;
}

/** Makes every mesh in an object cast and receive shadows. */
export function enableShadows(object) {
  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return object;
}

/** World-space bounds from vertex positions (not accessor min/max). */
export function boundsOf(object) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object, true);
}

/**
 * The scale reference: a 10 cm cube for small assets, a 1 m cube otherwise, light grey with
 * darker edges so its size reads clearly.
 */
export function scaleCube(sizeClass) {
  const s = sizeClass === "small" ? 0.1 : 1;
  const group = new THREE.Group();
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(s, s, s),
    new THREE.MeshStandardMaterial({ color: 0xbfc3c7, roughness: 0.9 }),
  );
  cube.position.y = s / 2;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0x4a4f55 }),
  );
  edges.position.y = s / 2;
  group.add(cube, edges);
  group.name = `scale-${s}m`;
  return enableShadows(group);
}

const VIEWS = {
  // Three-quarter front: 35° round from the front (+Z) towards +X, 22° above.
  front: { azimuth: 35, elevation: 22 },
  side: { azimuth: 90, elevation: 6 },
  top: { azimuth: 0, elevation: 90 },
};

export const VIEW_NAMES = Object.keys(VIEWS);

/** Direction from the target to the camera for a named view. */
export function viewDirection(name) {
  const v = VIEWS[name] ?? VIEWS.front;
  const az = (v.azimuth * Math.PI) / 180;
  const el = (v.elevation * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/** A camera that frames a box from a direction, with a fixed margin. */
export function frameCamera(box, direction, aspect = 1, margin = 1.2) {
  const camera = new THREE.PerspectiveCamera(30, aspect, 0.001, 1000);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fov = (camera.fov * Math.PI) / 180;
  const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect));
  const distance = (sphere.radius * margin) / Math.sin(fit / 2);
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  camera.near = distance / 100;
  camera.far = distance * 100;
  if (Math.abs(direction.y) > 0.999) camera.up.set(0, 0, -1); // top view: front at the bottom
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
  return camera;
}
