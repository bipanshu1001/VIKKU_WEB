import * as THREE from 'three';

/*
  How it works
  ------------
  1. Each <section> in index.html is a "stop". STOPS below gives each stop a place in space.
  2. Two smooth curves go through the stops: one for where the camera is, one for what it looks at.
  3. Scroll position -> a number t from 0 to 1 -> a point on both curves.
  So scrolling flies the camera from planet to planet, and the HTML stays normal, readable content.
*/

const sections = [...document.querySelectorAll('main section')];
const navLinks = [...document.querySelectorAll('.nav nav a')];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.getElementById('year').textContent = new Date().getFullYear();

// side: -1 = panel on the left, so the planet is framed on the right. +1 = the opposite. Keep in sync with style.css.
const STOPS = [
  { id: 'home',     pos: [0, 0, 0],       dist: 58, elev: 20, side: -1 },                                           // the galaxy core
  { id: 'about',    pos: [34, 6, -45],    r: 5,   side: 1,  colors: ['#2b6cff', '#9ad7ff'] },
  { id: 'projects', pos: [-30, -4, -95],  r: 7,   side: -1, colors: ['#c2553a', '#ffc38a'], ring: true },
  { id: 'skills',   pos: [26, 10, -145],  r: 5,   side: 1,  colors: ['#1f8f78', '#a6ffe6'] },
  { id: 'contact',  pos: [-14, -6, -190], r: 6,   side: -1, colors: ['#6b3fd1', '#f0a6ff'] },
];

// ---------- renderer, scene, camera ----------
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (err) {
  console.warn('WebGL unavailable, showing the plain page.', err);
}

if (renderer) start();

function start() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x02030a);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);

  scene.add(new THREE.AmbientLight(0x6677aa, 0.9));
  const sunLight = new THREE.DirectionalLight(0xfff1dd, 2.6);
  sunLight.position.set(0.6, 0.7, 1);
  scene.add(sunLight);

  scene.add(makeStars());
  const galaxy = makeGalaxy();
  scene.add(galaxy);
  scene.add(makeCoreGlow());

  // Planets (every stop except home)
  const planets = [];
  STOPS.forEach((stop, index) => {
    if (!stop.r) return;
    const planet = makePlanet(stop);
    planet.position.fromArray(stop.pos);
    planet.userData.index = index;
    scene.add(planet);
    planets.push(planet);
  });
  const clickable = planets.map(p => p.children[0]);

  // ---------- flight path ----------
  let camPath, lookPath;
  function buildPath() {
    const aspect = innerWidth / innerHeight;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const portrait = aspect < 0.9;
    const camPts = [], lookPts = [];

    for (const stop of STOPS) {
      const p = new THREE.Vector3().fromArray(stop.pos);
      const dist = stop.dist ?? 12 + stop.r * 2.6;
      const elev = stop.elev ?? stop.r * 0.6;
      camPts.push(p.clone().add(new THREE.Vector3(0, elev, dist)));

      // Aim beside the planet so it lands opposite the text panel.
      // Landscape: shift sideways. Portrait: shift down, so the planet sits above the bottom panel.
      const look = p.clone();
      if (portrait) look.y -= dist * tanHalf * 0.45;
      else look.x += stop.side * dist * tanHalf * aspect * 0.42;
      lookPts.push(look);
    }
    camPath = new THREE.CatmullRomCurve3(camPts, false, 'centripetal');
    lookPath = new THREE.CatmullRomCurve3(lookPts, false, 'centripetal');
  }
  buildPath();

  // ---------- scroll -> t ----------
  // getPoint(i / (n-1)) lands exactly on stop i, so t = (section index + fraction) / (n-1).
  let targetT = 0, smoothT = 0, activeIndex = -1;
  const bar = document.querySelector('.progress');

  function readScroll() {
    const y = scrollY;
    let i = 0;
    while (i < sections.length - 1 && sections[i + 1].offsetTop <= y) i++;
    const frac = i < sections.length - 1
      ? (y - sections[i].offsetTop) / (sections[i + 1].offsetTop - sections[i].offsetTop)
      : 0;
    targetT = THREE.MathUtils.clamp((i + frac) / (sections.length - 1), 0, 1);
    bar.style.setProperty('--p', targetT);
    setActive(Math.round(i + frac));
  }

  function setActive(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    sections.forEach((s, i) => s.classList.toggle('is-active', i === index));
    navLinks.forEach((a, i) => a.setAttribute('aria-current', i === index ? 'true' : 'false'));
  }

  addEventListener('scroll', readScroll, { passive: true });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    buildPath();
    readScroll();
  });

  // ---------- mouse: parallax + click a planet to fly to it ----------
  const mouse = new THREE.Vector2(), parallax = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let hovered = null;

  addEventListener('pointermove', e => {
    mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    hovered = null;
    if (e.target === canvas) {
      raycaster.setFromCamera(mouse, camera);
      hovered = raycaster.intersectObjects(clickable)[0]?.object.parent ?? null;
    }
    canvas.style.cursor = hovered ? 'pointer' : '';
  });
  canvas.addEventListener('click', () => {
    if (hovered) sections[hovered.userData.index].scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });

  // ---------- window transition to/from the desk (../index.html) ----------
  // `warp` pushes the camera far back: 1 = just came through the window, 0 = normal.
  const root = document.documentElement;
  let warp = location.hash === '#from-desk' && !reduced ? 1 : 0, warpTarget = 0;
  if (location.hash === '#from-desk') history.replaceState(null, '', location.pathname);

  document.querySelectorAll('a[href="../#from-space"]').forEach(a => a.addEventListener('click', e => {
    if (reduced) return;
    e.preventDefault();
    warpTarget = 1;          // fly back out...
    root.classList.add('fade'); // ...and fade, then load the desk, which flies out of its window
    setTimeout(() => { location.href = a.href; }, 650);
  }));
  addEventListener('pageshow', e => { // restored from the browser's back/forward cache
    if (e.persisted) { root.classList.remove('fade'); warpTarget = 0; }
  });

  // ---------- render loop ----------
  const clock = new THREE.Clock();
  const camPos = new THREE.Vector3(), lookPos = new THREE.Vector3();

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    warp += (warpTarget - warp) * (1 - Math.exp(-dt * (warpTarget ? 4 : 1.6)));
    // Frame-rate independent easing toward the scroll target.
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 3.5);
    smoothT += (targetT - smoothT) * ease;
    if (!reduced) parallax.lerp(mouse, 1 - Math.exp(-dt * 2));

    camPath.getPoint(smoothT, camPos);
    lookPath.getPoint(smoothT, lookPos);
    camera.position.set(camPos.x + parallax.x * 2, camPos.y + parallax.y * 1.2 + warp * 25, camPos.z + warp * 110);
    camera.lookAt(lookPos);

    if (!reduced) {
      galaxy.rotation.y += dt * 0.02;
      for (const p of planets) {
        p.children[0].rotation.y += dt * 0.08;
        const target = p === hovered ? 1.08 : 1;
        p.scale.setScalar(THREE.MathUtils.lerp(p.scale.x, target, 1 - Math.exp(-dt * 8)));
      }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  readScroll();
  smoothT = targetT; // start where the page actually is (e.g. after a reload mid-page)
  document.documentElement.classList.add('three-ready');
  requestAnimationFrame(frame);
  requestAnimationFrame(() => root.classList.remove('fade')); // scene is ready: fade in from black
}

// ---------- builders ----------

function makeStars() {
  const count = 6000;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 900;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 600;
    pos[i * 3 + 2] = 150 - Math.random() * 600;
    c.setHSL(0.55 + Math.random() * 0.15, 0.6, 0.7 + Math.random() * 0.3);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    size: 1.6, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false,
    map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.3)'), blending: THREE.AdditiveBlending, // round, soft stars instead of squares
  }));
}

// Classic spiral galaxy: points spread along a few arms, twisting more the further out they are.
function makeGalaxy() {
  const count = 50000, arms = 4, radius = 80, spin = 4.5;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const inner = new THREE.Color('#ffb46b'), outer = new THREE.Color('#4f63ff'), c = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const r = Math.pow(Math.random(), 1.4) * radius;
    const angle = (i % arms) / arms * Math.PI * 2 + (r / radius) * spin;
    const jitter = () => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 0.35 * r;
    pos[i * 3]     = Math.cos(angle) * r + jitter();
    pos[i * 3 + 1] = jitter() * 0.35;
    pos[i * 3 + 2] = Math.sin(angle) * r + jitter();
    c.copy(inner).lerp(outer, r / radius);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.3, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.3)'),
  }));
  const group = new THREE.Group();
  group.add(points);
  group.rotation.set(0.35, 0, 0.12);
  return group;
}

function makeCoreGlow() {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('rgba(255,210,150,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  sprite.scale.setScalar(36);
  return sprite;
}

function makePlanet({ r, colors, ring }) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(r, 64, 64),
    new THREE.MeshStandardMaterial({ map: planetTexture(colors[0], colors[1]), roughness: 0.85, metalness: 0 }),
  );
  body.rotation.z = 0.3;
  group.add(body);

  // Fresnel "atmosphere": brightest at the edge where you look through the most air.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(r * 1.18, 48, 48),
    new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(colors[1]) } },
      vertexShader: `
        varying vec3 vNormal; varying vec3 vView;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 color; varying vec3 vNormal; varying vec3 vView;
        void main() {
          float f = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.5);
          gl_FragColor = vec4(color, f * 0.9);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  group.add(atmosphere);

  if (ring) {
    const ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(r * 1.45, r * 2.3, 128),
      new THREE.MeshBasicMaterial({ color: colors[1], transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    ringMesh.rotation.set(Math.PI / 2.4, 0.2, 0);
    group.add(ringMesh);
  }
  return group;
}

// Procedural surface: horizontal bands + soft blobs drawn on a canvas. No image files needed.
function planetTexture(base, accent) {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 512;
  const g = cv.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = 0.06 + Math.random() * 0.18;
    g.fillStyle = Math.random() < 0.5 ? accent : '#000';
    g.fillRect(0, Math.random() * cv.height, cv.width, 3 + Math.random() * 28);
  }
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * cv.width, y = Math.random() * cv.height, rad = 6 + Math.random() * 60;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.1;
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function radialTexture(color, mid = 'rgba(255,170,90,0.45)') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, color);
  grad.addColorStop(0.2, mid);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
