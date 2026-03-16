// Ported from three.js r183 examples/webgpu_compute_particles.html
import Electrobun, { Electroview } from "electrobun/view";
import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  uniform,
  float,
  uv,
  vec3,
  hash,
  shapeCircle,
  instancedArray,
  instanceIndex,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const rpc = Electroview.defineRPC<any>({
  maxRequestTime: 600000,
  handlers: {
    requests: {},
    messages: {},
  },
});

const electrobun = new Electrobun.Electroview({ rpc });

const particleCount = 200000;

const gravity = uniform(-0.00098);
const bounce = uniform(0.8);
const friction = uniform(0.99);
const size = uniform(0.12);
const clickPosition = uniform(new THREE.Vector3());

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("doneBtn")?.addEventListener("click", () => {
    (electrobun.rpc as any)?.request.closeWindow({});
  });

  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const statusEl = document.getElementById("status")!;
  const fpsEl = document.getElementById("fps")!;

  if (!(navigator as any).gpu) {
    statusEl.textContent = "Status: WebGPU not available";
    statusEl.style.color = "#ef4444";
    return;
  }

  statusEl.textContent = "Status: initializing...";

  // Renderer
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  await renderer.init();

  statusEl.textContent = "Status: running (200k particles)";
  statusEl.style.color = "#4ade80";

  // Scene & camera
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    50,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 5, 20);

  // Storage buffers
  const positions = instancedArray(particleCount, "vec3");
  const velocities = instancedArray(particleCount, "vec3");
  const colors = instancedArray(particleCount, "vec3");

  // Compute: init particles in a grid
  const separation = 0.2;
  const amount = Math.sqrt(particleCount);
  const offset = float(amount / 2);

  const computeInit = Fn(() => {
    const position = positions.element(instanceIndex);
    const color = colors.element(instanceIndex);

    const x = instanceIndex.mod(amount);
    const z = instanceIndex.div(amount);

    position.x = offset.sub(x).mul(separation);
    position.z = offset.sub(z).mul(separation);

    color.x = hash(instanceIndex);
    color.y = hash(instanceIndex.add(2));
  })().compute(particleCount);

  // Compute: update particles each frame
  const computeUpdate = Fn(() => {
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);

    velocity.addAssign(vec3(0.0, gravity, 0.0));
    position.addAssign(velocity);
    velocity.mulAssign(friction);

    // Floor bounce
    If(position.y.lessThan(0), () => {
      position.y = 0;
      velocity.y = velocity.y.negate().mul(bounce);
      velocity.x = velocity.x.mul(0.9);
      velocity.z = velocity.z.mul(0.9);
    });
  });

  const computeParticles = computeUpdate().compute(particleCount);

  // Compute: hit (mouse interaction)
  const computeHit = Fn(() => {
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);

    const dist = position.distance(clickPosition);
    const direction = position.sub(clickPosition).normalize();
    const distArea = float(3).sub(dist).max(0);
    const power = distArea.mul(0.01);
    const relativePower = power.mul(hash(instanceIndex).mul(1.5).add(0.5));

    velocity.assign(velocity.add(direction.mul(relativePower)));
  })().compute(particleCount);

  // Initialize particles on GPU
  renderer.compute(computeInit);

  // Sprite material with per-particle color
  const material = new THREE.SpriteNodeMaterial();
  material.colorNode = uv().mul(colors.element(instanceIndex));
  material.positionNode = positions.toAttribute();
  material.scaleNode = size;
  material.opacityNode = shapeCircle();
  material.alphaToCoverage = true;
  material.transparent = true;

  const particles = new THREE.Sprite(material);
  (particles as any).count = particleCount;
  particles.frustumCulled = false;
  scene.add(particles);

  // Grid helper
  const helper = new THREE.GridHelper(90, 45, 0x303030, 0x303030);
  scene.add(helper);

  // Invisible plane for raycasting
  const planeGeom = new THREE.PlaneGeometry(200, 200);
  planeGeom.rotateX(-Math.PI / 2);
  const plane = new THREE.Mesh(
    planeGeom,
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  scene.add(plane);

  // Raycaster for mouse interaction
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let isOrbitActive = false;

  canvas.addEventListener("pointermove", (event) => {
    if (isOrbitActive) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(plane, false);
    if (intersects.length > 0) {
      clickPosition.value.copy(intersects[0].point);
      clickPosition.value.y = -1;
      renderer.compute(computeHit);
    }
  });

  // Orbit controls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 5;
  controls.maxDistance = 200;
  controls.target.set(0, -8, 0);
  controls.update();

  controls.addEventListener("start", () => {
    isOrbitActive = true;
  });
  controls.addEventListener("end", () => {
    isOrbitActive = false;
  });

  // Animation loop
  let animating = true;
  let frameCount = 0;
  let lastFpsTime = performance.now();

  function animate() {
    if (!animating) return;
    requestAnimationFrame(animate);

    controls.update();
    renderer.compute(computeParticles);
    renderer.render(scene, camera);

    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      fpsEl.textContent = `${frameCount} fps`;
      frameCount = 0;
      lastFpsTime = now;
    }
  }

  animate();

  // Resize
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  window.addEventListener("resize", resize);
  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas);
  }

  // Pause/resume
  document.getElementById("toggleAnimBtn")?.addEventListener("click", () => {
    animating = !animating;
    if (animating) animate();
    document.getElementById("toggleAnimBtn")!.textContent = animating
      ? "Pause"
      : "Resume";
  });
});
