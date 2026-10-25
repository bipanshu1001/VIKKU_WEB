import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loadMotion, loadCinematics, NEUTRAL_RIG } from './cinematics.js';

/*
  How it works
  ------------
  - The whole room is built from simple shapes (boxes, cylinders) plus canvas-drawn textures, so there are no model files.
  - Each clickable object has a `key` (projects, skills, ...). Clicking it flies the camera to VIEWS[key]
    and shows the matching <section data-key="..."> in the side panel.
  - Units are roughly metres: desk top at y = 0.75, back wall at z = -0.45.
*/

const VIEWS = {
  overview: { cam: [0, 1.45, 2.3],       target: [-0.05, 1.18, -0.2] },
  projects: { cam: [-0.15, 1.20, 0.40],  target: [-0.1, 0.88, -0.138], anchor: [-0.1, 1.02, -0.15], label: 'Projects', left: true },
  skills:   { cam: [0.62, 1.56, 0.85],  target: [0.62, 1.56, -0.35],  anchor: [0.62, 1.98, -0.36], label: 'Skills' },
  timeline: { cam: [-1.15, 1.5, 0.55],  target: [-1.15, 1.5, -0.45],  anchor: [-1.15, 1.8, -0.44], label: 'Timeline' },
  certs:    { cam: [0.62, 1.1, 0.42],    target: [0.62, 1.1, -0.45],   anchor: [0.62, 1.24, -0.43], label: 'Certificates' },
  about:    { cam: [0.16, 0.95, 0.22],   target: [0.16, 0.85, -0.3],   anchor: [0.16, 0.98, -0.3],  label: 'About me' },
  contact:  { cam: [0.5, 1.13, 0.44],    target: [0.5, 0.755, 0.12],   anchor: [0.5, 0.79, 0.12],   label: 'Contact' },
  lamp:     { anchor: [-0.4, 1.17, -0.25], label: 'Lamp' }, // toggles the light instead of opening a panel
  // The window is a portal: the camera flies up to the glass, the screen fades, and space/ loads.
  space:    { portal: [-0.45, 1.6, -0.13], target: [-0.45, 1.6, -0.45], anchor: [-0.45, 1.98, -0.44], label: 'Explore space ✦' },
};

const MONO = 'ui-monospace, Consolas, "Courier New", monospace'; // fonts for canvas-drawn textures
const SANS = '"Segoe UI", system-ui, sans-serif';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BASE_FOV = 45; // framing maths uses this; Theatre shots may widen/narrow the real fov on top
// Optional extras (cinematics.js). Each resolves to null if its CDN is slow or down; the site works without them.
const [fx, cine] = await Promise.all([reduced ? null : loadMotion(), reduced ? null : loadCinematics()]);
const body = document.body;
const panel = document.getElementById('panel');
const contents = [...document.querySelectorAll('#panel .content')];
const navButtons = [...document.querySelectorAll('.top nav [data-go]')];
const plainBtn = document.getElementById('plain-toggle');
document.getElementById('year').textContent = new Date().getFullYear();

// ---------- plain view: works even if WebGL never starts ----------
function setPlain(on) {
  body.classList.toggle('plain', on);
  plainBtn.textContent = on ? '3D view' : 'Plain view';
  plainBtn.setAttribute('aria-pressed', String(on));
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: true });
} catch (err) {
  console.warn('WebGL unavailable, staying in plain view.', err);
}

try {
  if (!renderer) throw new Error('no WebGL');
  start();
} catch (err) {
  // Any failure in the 3D setup falls back to the readable plain page instead of a blank screen.
  console.error(err);
  document.documentElement.classList.remove('fade');
  setPlain(true);
  plainBtn.hidden = true;
  navButtons.forEach(b => b.addEventListener('click', () => (b.dataset.go === 'space' ? goToSpace() : scrollToSection(b.dataset.go))));
}

function goToSpace() {
  location.href = 'space/#from-desk';
}

function scrollToSection(key) {
  document.getElementById('sec-' + key)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
}

function start() {
  plainBtn.addEventListener('click', () => {
    const goingPlain = !body.classList.contains('plain');
    if (goingPlain) toOverview(true);
    setPlain(goingPlain);
    scrollTo(0, 0);
  });

  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1e30');
  const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.02, 50);

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0x9aa6d6, 0x3a2818, 0.7);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xc8d2ff, 0.5);
  fill.position.set(1.2, 3, 2.5);
  scene.add(fill);

  const { interactive, lamp, screenTex } = buildRoom(scene);

  // ---------- camera state + fly-to tween ----------
  const view = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  let tween = null;
  let current = null; // null = overview

  // Turns a VIEWS entry into an actual camera position for this screen shape:
  // pull back on narrow screens, and slide sideways/up so the object isn't hidden behind the panel.
  function resolve(key) {
    const v = VIEWS[key];
    const pos = new THREE.Vector3(...v.cam), target = new THREE.Vector3(...v.target);
    const aspect = innerWidth / innerHeight;
    const portrait = aspect < 1;

    if (key === 'overview') {
      const k = THREE.MathUtils.clamp(1.6 / aspect, 1, 2.6);
      pos.sub(target).multiplyScalar(k).add(target);
      if (!portrait) {
        // Slide the desk right so the intro card (bottom-left) doesn't cover it.
        const intro = document.querySelector('.intro');
        const halfW = pos.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * aspect;
        const s = -(intro.offsetWidth / innerWidth) * halfW * 0.55;
        pos.x += s; target.x += s;
      }
      return { pos, target };
    }

    if (portrait) {
      const k = THREE.MathUtils.clamp(0.75 / aspect, 1, 2);
      pos.sub(target).multiplyScalar(k).add(target);
    }
    const dir = target.clone().sub(pos);
    const dist = dir.length();
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir);
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));

    // Moving the camera by f * halfWidth shifts the object by f in screen units (NDC).
    const shift = portrait
      ? up.multiplyScalar(-(panel.offsetHeight / innerHeight) * halfH)
      : right.multiplyScalar((panel.offsetWidth / innerWidth) * halfH * aspect);
    pos.add(shift);
    target.add(shift);
    return { pos, target };
  }

  function flyTo({ pos, target }, instant = reduced) {
    if (instant) {
      view.pos.copy(pos); view.target.copy(target); tween = null;
      return;
    }
    tween = { fromP: view.pos.clone(), fromT: view.target.clone(), toP: pos, toT: target, t: 0 };
  }

  function focus(key, instant) {
    current = key;
    body.classList.add('focused');
    contents.forEach(c => c.classList.toggle('active', c.dataset.key === key));
    navButtons.forEach(b => b.setAttribute('aria-current', String(b.dataset.go === key)));
    panel.scrollTop = 0;
    history.replaceState(null, '', '#' + key);
    flyTo(resolve(key), instant);
    panel.querySelector('.close').focus({ preventScroll: true });
    if (!instant) revealPanel(contents.find(c => c.dataset.key === key));
  }

  // ---------- Theatre.js shots: an authored rig layered on top of the current view ----------
  let shot = null; // the shot whose rig is applied; null = neutral
  function playShot(name, direction = 'normal') {
    if (!cine) return Promise.resolve(false);
    const s = shot = cine.shots[name];
    s.sheet.sequence.position = direction === 'reverse' ? s.length() : 0;
    return s.sheet.sequence.play({ direction });
  }
  // In studio mode, whichever shot you scrub in the editor is the one you see.
  if (cine?.studioMode) Object.values(cine.shots).forEach(s => s.rig.onValuesChange(() => (shot = s)));

  // ---------- Motion: HTML reveals ----------
  const smooth = [0.2, 0.8, 0.2, 1];
  function revealPanel(section) {
    if (!fx || !section) return;
    const items = section.querySelectorAll(':scope > :not(ol, .skill-groups), .timeline li, .skill-groups > div');
    fx.animate(items, { opacity: [0, 1], y: [14, 0] },
      { duration: 0.5, ease: smooth, delay: fx.stagger(Math.min(0.05, 0.5 / items.length), { startDelay: 0.15 }) });
  }
  function revealUI() {
    body.classList.remove('cinematic');
    if (!fx) return;
    fx.animate('.intro > *', { opacity: [0, 1], y: [18, 0] }, { duration: 0.6, ease: smooth, delay: fx.stagger(0.07) });
    fx.animate('.hotspot .dot', { scale: [0, 1] }, { type: fx.spring, stiffness: 380, damping: 16, delay: fx.stagger(0.06, { startDelay: 0.3 }) });
    fx.animate('.hotspot .label', { opacity: [0, 1], x: [-6, 0] }, { duration: 0.4, delay: fx.stagger(0.06, { startDelay: 0.4 }) });
  }

  function toOverview(instant) {
    current = null;
    body.classList.remove('focused');
    navButtons.forEach(b => b.setAttribute('aria-current', 'false'));
    history.replaceState(null, '', location.pathname + location.search); // keep ?studio
    flyTo(resolve('overview'), instant);
  }

  const portalView = () => ({ pos: new THREE.Vector3(...VIEWS.space.portal), target: new THREE.Vector3(...VIEWS.space.target) });

  function enterSpace() {
    if (body.classList.contains('plain') || reduced) return goToSpace();
    current = 'space';
    body.classList.remove('focused');
    body.classList.add('leaving');
    flyTo(portalView());
    playShot('portal'); // Theatre: hold, then push through the glass while the fov blows wide
    if (cine?.studioMode) return console.info('Studio mode: previewing the dive without leaving. Press Esc to come back.');
    setTimeout(() => document.documentElement.classList.add('fade'), 900);
    setTimeout(goToSpace, 1350);
  }

  // Coming back with the browser's Back button restores this page from cache, still faded to black.
  addEventListener('pageshow', e => {
    if (!e.persisted) return;
    body.classList.remove('leaving');
    document.documentElement.classList.remove('fade');
    playShot('portal', 'reverse');
    toOverview();
  });

  function activate(key) {
    if (key === 'lamp') return lamp.toggle();
    if (key === 'space') return enterSpace();
    if (body.classList.contains('plain')) return scrollToSection(key);
    focus(key);
  }

  panel.querySelector('.close').addEventListener('click', () => toOverview());
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => activate(b.dataset.go)));
  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !current) return;
    if (current === 'space') { body.classList.remove('leaving'); shot = null; } // only reachable in studio mode
    toOverview();
  });

  // ---------- hotspots: HTML buttons that follow their 3D object ----------
  const hotspots = Object.entries(VIEWS).filter(([, v]) => v.anchor).map(([key, v]) => {
    const el = document.createElement('button');
    el.className = v.left ? 'hotspot left' : 'hotspot';
    el.innerHTML = `<span class="dot"></span><span class="label">${v.label}</span>`;
    el.addEventListener('click', () => activate(key));
    if (key === 'lamp') { el.setAttribute('aria-pressed', 'true'); lamp.button = el; }
    document.getElementById('hotspots').appendChild(el);
    return { el, anchor: new THREE.Vector3(...v.anchor), left: !!v.left };
  });
  const projected = new THREE.Vector3();
  function placeHotspots() {
    for (const h of hotspots) {
      projected.copy(h.anchor).project(camera);
      h.el.style.visibility = projected.z < 1 ? '' : 'hidden';
      // Left-labelled hotspots shift back by their width so the dot (not the label) sits on the anchor.
      h.el.style.transform = `translate(${(projected.x + 1) / 2 * innerWidth}px, ${(1 - projected.y) / 2 * innerHeight}px)`
        + (h.left ? ' translateX(calc(-100% + 22px))' : '');
    }
  }

  // ---------- pointer: hover highlight, click to focus ----------
  const canvas = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(), parallax = new THREE.Vector2();
  let hovered = null;

  function pick(e) {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    let obj = raycaster.intersectObjects(interactive, true)[0]?.object;
    while (obj && !obj.userData.key) obj = obj.parent;
    return obj ?? null;
  }

  canvas.addEventListener('pointermove', e => {
    const hit = pick(e);
    if (hit !== hovered) {
      setHighlight(hovered, false);
      setHighlight(hit, true);
      hovered = hit;
      canvas.style.cursor = hit ? 'pointer' : '';
    }
  });
  canvas.addEventListener('pointerleave', () => { setHighlight(hovered, false); hovered = null; });
  canvas.addEventListener('click', e => {
    const hit = pick(e);
    if (hit) activate(hit.userData.key);
    else if (current) toOverview();
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    flyTo(resolve(current ?? 'overview'), true);
  });

  // Blinking cursor on the laptop: redraw its canvas twice a second.
  let cursorOn = true;
  setInterval(() => {
    cursorOn = !cursorOn;
    drawTerminal(screenTex.userData.g, 1024, 640, cursorOn);
    screenTex.needsUpdate = true;
  }, 530);

  // ---------- render loop ----------
  const clock = new THREE.Clock();
  let parallaxWeight = 1;
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const offset = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  function frame() {
    requestAnimationFrame(frame);
    if (body.classList.contains('plain')) return;
    const dt = Math.min(clock.getDelta(), 0.05);

    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 1.1);
      const k = ease(tween.t);
      view.pos.lerpVectors(tween.fromP, tween.toP, k);
      view.target.lerpVectors(tween.fromT, tween.toT, k);
      if (tween.t === 1) tween = null;
    }

    // Theatre rig on top of the view: swing around the target, rise, push in/out, then roll and zoom the lens.
    const rig = shot ? shot.rig.value : NEUTRAL_RIG;
    offset.subVectors(view.pos, view.target).applyAxisAngle(UP, rig.orbit).multiplyScalar(rig.dolly);
    offset.y += rig.lift;

    // Gentle mouse parallax, only in the overview.
    parallaxWeight += ((current || reduced ? 0 : 1) - parallaxWeight) * (1 - Math.exp(-dt * 4));
    parallax.lerp(pointer, 1 - Math.exp(-dt * 3));
    camera.position.copy(view.target).add(offset);
    camera.position.x += parallax.x * 0.12 * parallaxWeight;
    camera.position.y += parallax.y * 0.06 * parallaxWeight;
    camera.lookAt(view.target);
    if (rig.roll) camera.rotateZ(rig.roll);
    if (camera.fov !== rig.fov) { camera.fov = rig.fov; camera.updateProjectionMatrix(); }

    placeHotspots();
    renderer.render(scene, camera);
  }

  setPlain(false); // only now that the scene built successfully
  // Deep links like /#projects open straight onto that object.
  // /#from-space = returning from the space site: start at the window and fly back out into the room.
  const startKey = location.hash.slice(1);
  if (startKey === 'from-space' && !reduced) {
    flyTo(portalView(), true); // the page is already black (inline script in index.html)
    playShot('portal', 'reverse'); // the dive, played backwards: out of the glass and into the room
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('fade')));
    setTimeout(() => toOverview(), 200);
  } else if (!startKey && cine) {
    // Fresh visit: Theatre intro shot (the page starts black, see index.html), then Motion brings in the UI.
    body.classList.add('cinematic');
    toOverview(true);
    playShot('intro');
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('fade')));
    setTimeout(revealUI, 1700);
  } else {
    document.documentElement.classList.remove('fade');
    if (VIEWS[startKey]?.cam && startKey !== 'overview') focus(startKey, true);
    else toOverview(true);
  }
  requestAnimationFrame(frame);
}

// =====================================================================
// Room building
// =====================================================================

function buildRoom(scene) {
  const interactive = [];

  // Marks a group as clickable. Materials are cloned so the hover glow doesn't leak onto other objects.
  function clickable(obj, key) {
    obj.userData.key = key;
    obj.traverse(m => {
      if (!m.isMesh || m.userData.noHighlight) return;
      m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone();
    });
    interactive.push(obj);
    return obj;
  }

  // ---- floor & walls ----
  const floorTex = canvasTexture(512, 512, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#5b3e2c' : '#664633';
      g.fillRect(0, i * h / 8, w, h / 8);
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.fillRect(0, i * h / 8, w, 2);
      g.fillRect(((i * 197) % w), i * h / 8, 2, h / 8); // plank joint
    }
    grain(g, w, h, 'rgba(0,0,0,.08)', 220);
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(4, 4);
  const floor = add(scene, new THREE.PlaneGeometry(8, 8), std('#ffffff', { map: floorTex, roughness: 0.8 }), 0, 0, 1.5);
  floor.rotation.x = -Math.PI / 2;

  const wallMat = std('#3b405e', { roughness: 0.95 });
  add(scene, new THREE.PlaneGeometry(8, 4), wallMat, 0, 2, -0.45);
  const leftWall = add(scene, new THREE.PlaneGeometry(6, 4), wallMat, -1.6, 2, 1.5);
  leftWall.rotation.y = Math.PI / 2;
  add(scene, new THREE.BoxGeometry(8, 0.08, 0.02), std('#2a2e46'), 0, 0.04, -0.44); // skirting board

  // ---- desk ----
  const woodTex = canvasTexture(1024, 256, (g, w, h) => {
    g.fillStyle = '#93603f'; g.fillRect(0, 0, w, h);
    grain(g, w, h, 'rgba(60,30,10,.18)', 160);
  });
  add(scene, rbox(1.7, 0.04, 0.75, 0.01), std('#ffffff', { map: woodTex, roughness: 0.55 }), 0, 0.73, -0.06);
  const legMat = std('#26272f', { roughness: 0.45, metalness: 0.5 });
  for (const x of [-0.8, 0.8]) for (const z of [-0.38, 0.26]) add(scene, new THREE.BoxGeometry(0.04, 0.71, 0.04), legMat, x, 0.355, z);

  // ---- laptop (projects) ----
  const laptop = group(scene, -0.1, 0.75, 0);
  const alu = std('#babdc8', { roughness: 0.35, metalness: 0.6 });
  add(laptop, rbox(0.34, 0.016, 0.23, 0.004), alu, 0, 0.008, 0);
  const keysTex = canvasTexture(512, 340, (g, w, h) => {
    g.fillStyle = '#a9acb6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#23252c';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 14; c++) roundRect(g, 18 + c * 34, 14 + r * 34, 28, 28, 4);
    g.fillStyle = 'rgba(0,0,0,.12)';
    roundRect(g, 176, 196, 160, 120, 10); // trackpad
  });
  const deck = add(laptop, new THREE.PlaneGeometry(0.32, 0.21), std('#ffffff', { map: keysTex, roughness: 0.5 }), 0, 0.0165, 0.005);
  deck.rotation.x = -Math.PI / 2;
  const hinge = group(laptop, 0, 0.016, -0.112);
  hinge.rotation.x = -0.22;
  add(hinge, rbox(0.34, 0.23, 0.01, 0.004), alu, 0, 0.115, 0);
  const screenTex = canvasTexture(1024, 640, (g, w, h) => drawTerminal(g, w, h, true));
  const screen = add(hinge, new THREE.PlaneGeometry(0.32, 0.2), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }), 0, 0.118, 0.0052);
  screen.castShadow = false;
  const glow = new THREE.PointLight(0x6aa8ff, 0.25, 0.8);
  glow.position.set(0, 0.12, 0.12);
  hinge.add(glow);
  clickable(laptop, 'projects');

  // ---- phone (contact) ----
  const phone = group(scene, 0.5, 0.75, 0.12);
  phone.rotation.y = -0.35;
  add(phone, rbox(0.075, 0.009, 0.15, 0.003), std('#15161c', { roughness: 0.3, metalness: 0.5 }), 0, 0.0045, 0);
  const phoneTex = canvasTexture(320, 640, drawPhone);
  const phoneScreen = add(phone, new THREE.PlaneGeometry(0.068, 0.14), new THREE.MeshBasicMaterial({ map: phoneTex, toneMapped: false }), 0, 0.0092, 0);
  phoneScreen.rotation.x = -Math.PI / 2;
  clickable(phone, 'contact');

  // ---- photo frame (about) ----
  const frame = group(scene, 0.16, 0.75, -0.3);
  frame.rotation.set(-0.12, 0.15, 0);
  const frameMat = std('#2b2118', { roughness: 0.5 });
  add(frame, rbox(0.15, 0.19, 0.014, 0.004), frameMat, 0, 0.095, 0);
  add(frame, new THREE.PlaneGeometry(0.125, 0.165), std('#ffffff', { map: canvasTexture(300, 400, drawAvatar), roughness: 0.4 }), 0, 0.095, 0.0075);
  add(frame, new THREE.BoxGeometry(0.02, 0.15, 0.006), frameMat, 0, 0.07, -0.04).rotation.x = 0.45;
  clickable(frame, 'about');

  // ---- mug (decoration) ----
  const mug = group(scene, 0.36, 0.75, -0.16);
  const mugMat = std('#ece6dc', { roughness: 0.4 });
  add(mug, new THREE.CylinderGeometry(0.038, 0.034, 0.095, 32), mugMat, 0, 0.0475, 0);
  add(mug, new THREE.CircleGeometry(0.033, 32), std('#3b2416', { roughness: 0.15 }), 0, 0.0955, 0).rotation.x = -Math.PI / 2;
  add(mug, new THREE.TorusGeometry(0.022, 0.006, 12, 24, Math.PI), mugMat, 0.038, 0.05, 0).rotation.z = -Math.PI / 2;

  // ---- notebook + pen (decoration) ----
  const notebook = group(scene, -0.5, 0.75, 0.12);
  notebook.rotation.y = 0.25;
  add(notebook, new THREE.BoxGeometry(0.16, 0.012, 0.22), std('#3d5a80', { roughness: 0.7 }), 0, 0.006, 0);
  add(notebook, new THREE.BoxGeometry(0.152, 0.008, 0.212), std('#f1ede4'), 0.004, 0.006, 0);
  add(notebook, new THREE.CylinderGeometry(0.004, 0.004, 0.14, 12), std('#c0442f', { roughness: 0.3 }), 0.11, 0.006, 0).rotation.x = Math.PI / 2;

  // ---- plant (decoration) ----
  const plant = group(scene, -0.77, 0.75, -0.3);
  add(plant, new THREE.CylinderGeometry(0.055, 0.042, 0.1, 24), std('#c46a4a', { roughness: 0.8 }), 0, 0.05, 0);
  const leafMat = std('#3f8f4f', { roughness: 0.6 });
  for (let i = 0; i < 9; i++) {
    const pivot = group(plant, 0, 0.1, 0);
    pivot.rotation.y = (i / 9) * Math.PI * 2;
    const leaf = add(pivot, new THREE.SphereGeometry(1, 12, 8), leafMat, 0.03, 0.06 + (i % 3) * 0.015, 0);
    leaf.scale.set(0.022, 0.075, 0.01);
    leaf.rotation.z = -0.5 - (i % 2) * 0.25;
  }

  // ---- lamp (toggle) ----
  const lampGroup = group(scene, -0.6, 0.75, -0.25);
  const brass = std('#d9a441', { roughness: 0.35, metalness: 0.6 });
  add(lampGroup, new THREE.CylinderGeometry(0.07, 0.08, 0.02, 32), brass, 0, 0.01, 0);
  add(lampGroup, new THREE.CylinderGeometry(0.008, 0.008, 0.38, 12), brass, 0, 0.2, 0);
  add(lampGroup, new THREE.CylinderGeometry(0.008, 0.008, 0.2, 12), brass, 0.1, 0.39, 0).rotation.z = Math.PI / 2;
  const shade = add(lampGroup, new THREE.ConeGeometry(0.06, 0.09, 32, 1, true), std('#d9a441', { side: THREE.DoubleSide, roughness: 0.4, metalness: 0.5 }), 0.2, 0.36, 0);
  shade.castShadow = false; // the light sits inside the shade
  const bulb = add(lampGroup, new THREE.SphereGeometry(0.02, 16, 12), std('#fff2d6', { emissive: '#ffd59a', emissiveIntensity: 2.5 }), 0.2, 0.33, 0);
  bulb.castShadow = false;
  bulb.userData.noHighlight = true;

  const spot = new THREE.SpotLight(0xffc98a, 1.6, 3, 0.95, 0.6, 2);
  spot.position.set(0.2, 0.33, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 0.05;
  spot.shadow.camera.far = 3;
  spot.shadow.bias = -0.0004;
  spot.shadow.normalBias = 0.01;
  lampGroup.add(spot);
  spot.target.position.set(-0.15, 0.75, 0.0);
  scene.add(spot.target);
  clickable(lampGroup, 'lamp');

  const hemi = scene.children.find(o => o.isHemisphereLight);
  const fill = scene.children.find(o => o.isDirectionalLight);
  const lamp = {
    on: true,
    button: null,
    toggle() {
      this.on = !this.on;
      spot.intensity = this.on ? 1.6 : 0;
      bulb.material.emissiveIntensity = this.on ? 2.5 : 0;
      hemi.intensity = this.on ? 0.7 : 0.2;
      fill.intensity = this.on ? 0.5 : 0.12;
      this.button?.setAttribute('aria-pressed', String(this.on));
    },
  };

  // ---- window with a night sky (a nod to the space portfolio) ----
  const win = group(scene, -0.45, 1.6, -0.445);
  add(win, new THREE.PlaneGeometry(0.78, 0.6), new THREE.MeshBasicMaterial({ map: canvasTexture(780, 600, drawSky), toneMapped: false }), 0, 0, 0.002).castShadow = false;
  const sash = std('#e8e2d6', { roughness: 0.6 });
  for (const [w, h, x, y] of [[0.84, 0.03, 0, 0.315], [0.84, 0.03, 0, -0.315], [0.03, 0.66, -0.405, 0], [0.03, 0.66, 0.405, 0], [0.02, 0.6, 0, 0], [0.78, 0.02, 0, 0]]) {
    add(win, new THREE.BoxGeometry(w, h, 0.03), sash, x, y, 0.015);
  }
  add(win, new THREE.BoxGeometry(0.9, 0.025, 0.08), sash, 0, -0.34, 0.04); // sill
  clickable(win, 'space');

  // ---- wall calendar (timeline) ----
  const calendar = group(scene, -1.15, 1.5, -0.445);
  add(calendar, new THREE.PlaneGeometry(0.38, 0.5), std('#ffffff', { map: canvasTexture(512, 672, drawCalendar), roughness: 0.9 }), 0, 0, 0.003).castShadow = false;
  add(calendar, new THREE.BoxGeometry(0.4, 0.02, 0.012), std('#30323c', { metalness: 0.5, roughness: 0.4 }), 0, 0.25, 0.008);
  clickable(calendar, 'timeline');

  // ---- bookshelf (skills): one book per skill ----
  const shelf = group(scene, 0, 0, 0);
  const boardMat = std('#6d4730', { roughness: 0.6 });
  const bracketMat = std('#26272f', { metalness: 0.5, roughness: 0.4 });
  const SHELVES = [
    { y: 1.38, books: [['Python', '#3b6ea5'], ['C++', '#5c4d9e'], ['C', '#3f7f6e'], ['JavaScript', '#b8921f'], ['TensorFlow', '#d4682b'], ['Keras', '#b23a48'], ['OpenCV', '#2f8f5b'], ['scikit-learn', '#c97a1f'], ['Pandas', '#4b4f9e']] },
    { y: 1.74, books: [['Node.js', '#4f8a3c'], ['Express', '#555b66'], ['Flask', '#2d3a4a'], ['SQLite', '#2f6f9f'], ['AWS', '#d9822b'], ['DSA', '#8c3b5e'], ['Graphs', '#2c7a7b'], ['Git', '#c0442f'], ['OOP', '#6b5b95']] },
  ];
  for (const { y, books } of SHELVES) {
    add(shelf, rbox(0.82, 0.022, 0.2, 0.005), boardMat, 0.62, y, -0.35);
    for (const bx of [0.3, 0.94]) add(shelf, new THREE.BoxGeometry(0.015, 0.07, 0.015), bracketMat, bx, y - 0.045, -0.44);
    let x = 0.25;
    books.forEach(([name, color], i) => {
      const w = 0.034 + Math.min(name.length, 10) * 0.0016;
      const h = 0.17 + ((i * 37) % 7) * 0.009;
      const plain = std(color, { roughness: 0.7 });
      const spine = std('#ffffff', { map: canvasTexture(96, 512, (g, cw, ch) => drawSpine(g, cw, ch, name, color)), roughness: 0.7 });
      // BoxGeometry face order: +x, -x, +y, -y, +z (spine, facing the room), -z
      add(shelf, new THREE.BoxGeometry(w, h, 0.15), [plain, plain, plain, plain, spine, plain], x + w / 2, y + 0.011 + h / 2, -0.36);
      x += w + 0.004;
    });
    // a leaning book at the end of each row, so the shelf doesn't look too tidy
    const lean = add(shelf, new THREE.BoxGeometry(0.03, 0.2, 0.15), std('#7a6a58'), x + 0.07, y + 0.011 + 0.096, -0.36);
    lean.rotation.z = 0.35;
  }
  clickable(shelf, 'skills');

  // ---- certificate frames (certs) ----
  const certs = group(scene, 0, 0, 0);
  const CERTS = [['The Machine Learning', 'Pipeline on AWS', 'Oct 2025'], ['Developing Generative', 'AI Solutions', 'Dec 2025']];
  CERTS.forEach(([l1, l2, date], i) => {
    const x = 0.44 + i * 0.36;
    add(certs, rbox(0.3, 0.22, 0.015, 0.004), std('#1f1a16', { roughness: 0.5 }), x, 1.1, -0.44);
    add(certs, new THREE.PlaneGeometry(0.27, 0.19), std('#ffffff', { map: canvasTexture(540, 380, (g, w, h) => drawCert(g, w, h, l1, l2, date)), roughness: 0.8 }), x, 1.1, -0.431).castShadow = false;
  });
  clickable(certs, 'certs');

  // ---- desk chair ----
  const chairMat = std('#1d212c', { roughness: 0.65 });
  const chairMetal = std('#13151b', { roughness: 0.35, metalness: 0.7 });
  const chairX = -0.1, chairZ = 0.44;

  // Chair
  const chair = group(scene, chairX, 0, chairZ);
  // 5 caster wheel legs radiating on the floor
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    const leg = add(chair, new THREE.BoxGeometry(0.024, 0.02, 0.2), chairMetal, Math.sin(ang) * 0.1, 0.035, Math.cos(ang) * 0.1);
    leg.rotation.y = ang;
    add(chair, new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12), chairMetal, Math.sin(ang) * 0.19, 0.02, Math.cos(ang) * 0.19);
  }
  // Hydraulic center column
  add(chair, new THREE.CylinderGeometry(0.022, 0.025, 0.38, 16), chairMetal, 0, 0.22, 0);
  // Seat cushion
  add(chair, rbox(0.38, 0.06, 0.38, 0.02), chairMat, 0, 0.44, 0);
  // Backrest support column behind the seat
  add(chair, new THREE.BoxGeometry(0.04, 0.32, 0.02), chairMetal, 0, 0.58, 0.18).rotation.x = -0.12;
  // Ergonomic curved backrest cushion
  const backrest = add(chair, rbox(0.34, 0.38, 0.035, 0.02), chairMat, 0, 0.68, 0.19);
  backrest.rotation.x = -0.12;
  // Armrests
  for (const sx of [-0.2, 0.2]) {
    add(chair, new THREE.CylinderGeometry(0.012, 0.012, 0.18, 12), chairMetal, sx, 0.52, 0.02);
    add(chair, rbox(0.05, 0.018, 0.18, 0.008), chairMat, sx, 0.61, 0.02);
  }

  return { interactive, lamp, screenTex };
}

// =====================================================================
// Small helpers
// =====================================================================

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts });
}
function rbox(w, h, d, r) {
  return new RoundedBoxGeometry(w, h, d, 3, r);
}
function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
function group(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function setHighlight(root, on) {
  root?.traverse(m => {
    if (!m.isMesh || m.userData.noHighlight) return;
    for (const mat of [].concat(m.material)) mat.emissive?.setHex(on ? 0x3b2a12 : 0x000000);
  });
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.g = g;
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

function grain(g, w, h, color, n) {
  g.strokeStyle = color;
  for (let i = 0; i < n; i++) {
    const y = Math.random() * h;
    g.lineWidth = 0.5 + Math.random() * 1.5;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 12, w * 0.7, y + (Math.random() - 0.5) * 12, w, y);
    g.stroke();
  }
}

function drawTerminal(g, w, h, cursor) {
  g.fillStyle = '#0d1117'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#161b22'; g.fillRect(0, 0, w, 46);
  ['#ff5f56', '#ffbd2e', '#27c93f'].forEach((c, i) => {
    g.fillStyle = c; g.beginPath(); g.arc(26 + i * 26, 23, 8, 0, Math.PI * 2); g.fill();
  });
  g.font = `500 22px ${MONO}`;
  g.fillStyle = '#8b949e';
  g.fillText('bipanshu@desk: ~/projects', 120, 31);

  const lines = [
    ['#7ee787', '$ ls projects/'],
    ['#e6edf3', 'adoc-rocksdb/'],
    ['#8b949e', '    C++17 · AIMD tuner · 0 s write stalls'],
    ['#e6edf3', 'emotion-detection/'],
    ['#8b949e', '    CNN · OpenCV · 90%+ accuracy'],
    ['#e6edf3', 'friend-recommender/'],
    ['#8b949e', '    C++ graph Top-K · Node.js · WebSockets'],
    ['#e6edf3', 'gamehub/'],
    ['#8b949e', '    Python · plugin architecture'],
    ['#7ee787', '$ open --details'],
  ];
  g.font = `30px ${MONO}`;
  lines.forEach(([c, t], i) => { g.fillStyle = c; g.fillText(t, 40, 100 + i * 50); });
  if (cursor) {
    g.fillStyle = '#e6edf3';
    g.fillRect(40 + g.measureText('$ open --details').width + 10, 100 + 9 * 50 - 26, 16, 32);
  }
}

function drawPhone(g, w, h) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1d2550'); grad.addColorStop(1, '#3a1d4f');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f3efe6'; g.textAlign = 'center';
  g.font = `600 44px ${SANS}`; g.fillText('Contact', w / 2, 120);
  g.font = `22px ${SANS}`; g.fillStyle = 'rgba(243,239,230,.7)'; g.fillText('Let’s talk internships', w / 2, 160);
  ['Email', 'GitHub', 'LinkedIn'].forEach((label, i) => {
    g.fillStyle = i === 0 ? '#ffb35c' : 'rgba(255,255,255,.12)';
    roundRect(g, 40, 230 + i * 100, w - 80, 70, 35);
    g.fillStyle = i === 0 ? '#2a1600' : '#f3efe6';
    g.font = `600 28px ${SANS}`;
    g.fillText(label, w / 2, 275 + i * 100);
  });
}

// Portrait for the "About me" photo frame.
function drawAvatar(g, w, h) {
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#ffb35c'); grad.addColorStop(1, '#c2553a');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.beginPath(); g.arc(w / 2, 165, 95, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7a3a1f'; g.textAlign = 'center';
  g.font = `700 80px ${SANS}`; g.fillText('BK', w / 2, 192);
  g.fillStyle = '#fff'; g.font = `600 34px ${SANS}`; g.fillText('About me', w / 2, 330);
}

function drawSky(g, w, h) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#070b24'); grad.addColorStop(1, '#22295a');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`;
    g.fillRect(Math.random() * w, Math.random() * h, Math.random() < 0.9 ? 1.5 : 3, Math.random() < 0.9 ? 1.5 : 3);
  }
  // a small spiral galaxy
  for (let i = 0; i < 1500; i++) {
    const r = Math.random() * 80, arm = (i % 3) / 3 * Math.PI * 2, a = arm + r * 0.06 + (Math.random() - 0.5) * 0.5;
    g.fillStyle = `rgba(${200 + Math.random() * 55},${170 + Math.random() * 60},255,${0.5 * (1 - r / 90)})`;
    g.fillRect(230 + Math.cos(a) * r, 230 + Math.sin(a) * r * 0.45, 1.6, 1.6);
  }
  const moon = g.createRadialGradient(600, 140, 0, 600, 140, 90);
  moon.addColorStop(0, 'rgba(255,248,225,1)'); moon.addColorStop(0.35, 'rgba(255,248,225,1)'); moon.addColorStop(0.38, 'rgba(255,240,200,.25)'); moon.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = moon; g.fillRect(500, 40, 200, 200);

  // The planets from the space portfolio (same colours as STOPS in space/main.js): a hint of where the window leads.
  planet(g, 380, 118, 20, '#2b6cff', '#9ad7ff');
  planet(g, 140, 470, 34, '#c2553a', '#ffc38a', true);
  planet(g, 690, 345, 15, '#1f8f78', '#a6ffe6');
  planet(g, 540, 470, 26, '#6b3fd1', '#f0a6ff');
}

function planet(g, x, y, r, base, light, ring = false) {
  const halo = g.createRadialGradient(x, y, r * 0.8, x, y, r * 1.8);
  halo.addColorStop(0, light + '66'); halo.addColorStop(1, light + '00');
  g.fillStyle = halo; g.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
  if (ring) drawRing(g, x, y, r, light, true);
  const sphere = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  sphere.addColorStop(0, light); sphere.addColorStop(0.55, base); sphere.addColorStop(1, '#05060f');
  g.fillStyle = sphere;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  if (ring) drawRing(g, x, y, r, light, false);
}

// Ring drawn in two halves so the back half goes behind the planet and the front half in front.
function drawRing(g, x, y, r, color, back) {
  g.save();
  g.strokeStyle = color + 'aa'; g.lineWidth = r * 0.22;
  g.beginPath();
  g.ellipse(x, y, r * 1.9, r * 0.5, -0.25, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI);
  g.stroke();
  g.restore();
}

function drawCalendar(g, w, h) {
  g.fillStyle = '#f7f3ea'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#c0442f'; g.fillRect(0, 0, w, 110);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = `700 44px ${SANS}`; g.fillText('TIMELINE', w / 2, 62);
  g.font = `24px ${SANS}`; g.fillText('2021 → next', w / 2, 96);
  const rows = [['2021', 'Class X · 98%'], ['2023', 'Class XII · 89.4%'], ['2024', 'B.Tech CSE · GEU'], ['2024', 'Train Reservation'], ['2025', 'GameHub · AWS courses'], ['2026', 'Friend Recommender'], ['2026', 'Emotion Detection'], ['2026', 'Freelance Web Dev'], ['2026', 'ADOC · RocksDB tuner'], ['Next', 'SWE / ML internship']];
  const step = 55;
  g.textAlign = 'left';
  g.strokeStyle = '#d6cfc0'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(118, 150); g.lineTo(118, 150 + (rows.length - 1) * step); g.stroke();
  rows.forEach(([year, text], i) => {
    const y = 150 + i * step;
    const last = i === rows.length - 1;
    g.fillStyle = last ? '#ff9a2e' : '#3d5a80';
    g.beginPath(); g.arc(118, y, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6b6457'; g.font = `600 22px ${SANS}`; g.fillText(year, 30, y + 8);
    g.fillStyle = '#2a2620'; g.font = `${last ? 700 : 500} 25px ${SANS}`; g.fillText(text, 142, y + 9);
  });
}

function drawSpine(g, w, h, name, color) {
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 26, w, 6); g.fillRect(0, h - 32, w, 6);
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(-Math.PI / 2);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 46;
  g.font = `700 ${size}px ${SANS}`;
  while (g.measureText(name).width > h - 90 && size > 20) { size -= 2; g.font = `700 ${size}px ${SANS}`; }
  g.fillText(name, 0, 2);
  g.restore();
}

function drawCert(g, w, h, line1, line2, date) {
  g.fillStyle = '#fbf7ee'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c9a24a'; g.lineWidth = 6; g.strokeRect(16, 16, w - 32, h - 32);
  g.lineWidth = 1.5; g.strokeRect(28, 28, w - 56, h - 56);
  g.textAlign = 'center'; g.fillStyle = '#7a6a4a';
  g.font = `600 20px ${SANS}`; g.fillText('TRAINING COMPLETED', w / 2, 80);
  g.fillStyle = '#2a2620'; g.font = `700 34px Georgia, serif`;
  g.fillText(line1, w / 2, 150); g.fillText(line2, w / 2, 192);
  g.fillStyle = '#6b6457'; g.font = `22px ${SANS}`;
  g.fillText('Bipanshu Kashyap', w / 2, 262);
  g.fillText(date, w / 2, 300);
}
