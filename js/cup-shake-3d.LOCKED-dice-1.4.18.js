/**
 * Photo-matched white solid dice (Three.js) — dice ONLY, no CGI glass cup.
 * Background = empty cup photo (#videoFeed). Opposite faces: 1↔6, 2↔5, 3↔4.
 * window.CupShake3D = { ready, play([d1,d2,d3]), showIdle, hide }
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const FACE_VER = '1.4.18';
const SHAKE_MS = 4800;
const SETTLE_MS = 1600;
const LAND_STAGGER_MS = [0, 220, 480];
/* 红布预览：一体凹点（无贴纸）；方圆形；实心沉感 */
const CUP_SCALE = 1;
const CUP_TILT_X = (16 * Math.PI) / 180;
const CUP_REST_Y = -0.28;
const DIE_TIP_X = (3 * Math.PI) / 180;
const DIE = 0.32;
const DIE_RADIUS = DIE * 0.26;
const DIE_SEG = 6;
const PAD_R = 0.55;
const PIP_RED = 0xb41c20;
const PIP_BLACK = 0x161616;
const PIP_UV = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};

async function mountCupShake3D(canvas, opts = {}) {
  const lite = !!opts.lite;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !lite,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  camera.position.set(0, 2.2, 3.1);
  camera.lookAt(0, 0, 0.15);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.55);
  sun.position.set(0.6, 4.2, 1.2);
  scene.add(sun);
  const fill = new THREE.PointLight(0xffffff, 0.35, 12);
  fill.position.set(-1.6, 1.2, 1.4);
  scene.add(fill);

  const cupRoot = new THREE.Group();
  cupRoot.scale.setScalar(CUP_SCALE);
  cupRoot.rotation.set(CUP_TILT_X, 0, 0);
  cupRoot.position.set(0, CUP_REST_Y, 0);
  scene.add(cupRoot);

  const FLOOR_TOP = 0;
  const DIE_REST_Y = FLOOR_TOP + DIE * 0.5 + 0.001;

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xf5f5f5,
    roughness: 0.4,
    metalness: 0.0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.32,
  });
  const redPipMat = new THREE.MeshStandardMaterial({
    color: PIP_RED,
    roughness: 0.55,
    metalness: 0.0,
  });
  const blackPipMat = new THREE.MeshStandardMaterial({
    color: PIP_BLACK,
    roughness: 0.55,
    metalness: 0.0,
  });

  /** 一体凹点：圆柱沉进白面，顶面几乎齐平可见（无贴纸） */
  function addRecessedPips(group, faceNum, normal) {
    const mat = faceNum === 1 || faceNum === 4 ? redPipMat : blackPipMat;
    const span = DIE * 0.62;
    const pipR = faceNum === 1 ? DIE * 0.125 : DIE * 0.085;
    const depth = DIE * 0.055;
    const half = DIE * 0.5;
    const n = normal.clone().normalize();
    const tmp = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const uAxis = new THREE.Vector3().crossVectors(tmp, n).normalize();
    const vAxis = new THREE.Vector3().crossVectors(n, uAxis).normalize();

    for (const [uu, vv] of PIP_UV[faceNum]) {
      const pip = new THREE.Mesh(
        new THREE.CylinderGeometry(pipR, pipR * 0.9, depth, 22),
        mat
      );
      pip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      const u = (uu - 0.5) * span;
      const v = (vv - 0.5) * span;
      /* 顶面齐平表面，柱身沉进内部形成凹点 */
      pip.position
        .copy(n)
        .multiplyScalar(half - depth * 0.48)
        .addScaledVector(uAxis, u)
        .addScaledVector(vAxis, v);
      group.add(pip);
    }
  }

  function makeDie() {
    const g = new THREE.Group();
    g.add(
      new THREE.Mesh(
        new RoundedBoxGeometry(DIE, DIE, DIE, DIE_SEG, DIE_RADIUS),
        bodyMat
      )
    );
    const faces = [
      { f: 1, n: new THREE.Vector3(0, 1, 0) },
      { f: 6, n: new THREE.Vector3(0, -1, 0) },
      { f: 2, n: new THREE.Vector3(0, 0, 1) },
      { f: 5, n: new THREE.Vector3(0, 0, -1) },
      { f: 3, n: new THREE.Vector3(1, 0, 0) },
      { f: 4, n: new THREE.Vector3(-1, 0, 0) },
    ];
    for (const s of faces) addRecessedPips(g, s.f, s.n);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(DIE * 0.55, 32),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -DIE * 0.5 + 0.002;
    shadow.renderOrder = 0;
    g.add(shadow);
    return g;
  }

  /* 三颗落点：红布正中，略挤一点更有重量感 */
  const spots = [
    new THREE.Vector3(-0.34, DIE_REST_Y, 0.1),
    new THREE.Vector3(0.0, DIE_REST_Y, 0.16),
    new THREE.Vector3(0.34, DIE_REST_Y, 0.1),
  ];
  const dieTipQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    DIE_TIP_X
  );

  function quatFaceUp(face, yawRad = 0) {
    const map = {
      1: new THREE.Vector3(0, 1, 0),
      6: new THREE.Vector3(0, -1, 0),
      2: new THREE.Vector3(0, 0, 1),
      5: new THREE.Vector3(0, 0, -1),
      3: new THREE.Vector3(1, 0, 0),
      4: new THREE.Vector3(-1, 0, 0),
    };
    const q = new THREE.Quaternion().setFromUnitVectors(
      map[face].clone(),
      new THREE.Vector3(0, 1, 0)
    );
    const yaw = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      yawRad
    );
    return dieTipQ.clone().multiply(yaw.multiply(q));
  }

  const idleFaces = [1, 5, 6];
  const idleYaw = [-0.45, 0.2, 0.55];
  const dice = spots.map((s, i) => {
    const d = makeDie();
    d.position.copy(s);
    d.quaternion.copy(quatFaceUp(idleFaces[i], idleYaw[i]));
    cupRoot.add(d);
    return d;
  });

  function resize() {
    const w = Math.max(2, canvas.clientWidth || canvas.parentElement?.clientWidth || 256);
    const h = Math.max(2, canvas.clientHeight || canvas.parentElement?.clientHeight || 256);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  let shaking = false;
  let looping = true;
  function loop() {
    if (!looping) return;
    requestAnimationFrame(loop);
    if (!shaking) renderer.render(scene, camera);
  }
  loop();

  function setIdleFaces(faces) {
    const f = (faces || idleFaces).map((n) => Math.max(1, Math.min(6, n | 0)));
    dice.forEach((d, i) => {
      d.position.copy(spots[i]);
      d.quaternion.copy(quatFaceUp(f[i] || 1, idleYaw[i]));
    });
    renderer.render(scene, camera);
  }

  async function play(faces) {
    if (shaking) return;
    shaking = true;
    resize();
    const f = (faces || [1, 2, 3]).map((n) => Math.max(1, Math.min(6, n | 0)));

    const maxR = PAD_R * 0.72;
    const spins = dice.map(
      () =>
        new THREE.Vector3(
          (Math.random() - 0.5) * 28,
          (Math.random() - 0.5) * 28,
          (Math.random() - 0.5) * 28
        )
    );
    const vel = dice.map(() => {
      const a = Math.random() * Math.PI * 2;
      const s = 0.55 + Math.random() * 0.55;
      return new THREE.Vector3(Math.cos(a) * s, 0.8 + Math.random() * 0.6, Math.sin(a) * s);
    });
    const pos = dice.map((d) => d.position.clone().setY(DIE_REST_Y + 0.05));
    const toQuat = f.map((n) => quatFaceUp(n, (Math.random() - 0.5) * Math.PI * 0.35));
    const t0 = performance.now();

    await new Promise((resolve) => {
      function step(now) {
        const u = Math.min(1, (now - t0) / SHAKE_MS);
        const env = u < 0.7 ? 1 : Math.sin(((1 - (u - 0.7) / 0.3) * Math.PI) / 2);
        const dt = 0.016;
        /* 盅壳不晃 — 只滚骰 */
        cupRoot.rotation.set(CUP_TILT_X, 0, 0);
        cupRoot.position.set(0, CUP_REST_Y, 0);

        dice.forEach((d, i) => {
          if (u >= 0.9) {
            d.quaternion.copy(toQuat[i]);
            d.position.lerp(spots[i], 0.18);
            return;
          }
          d.rotation.x += spins[i].x * 0.018 * env;
          d.rotation.y += spins[i].y * 0.018 * env;
          d.rotation.z += spins[i].z * 0.018 * env;
          vel[i].y -= 2.8 * dt;
          pos[i].x += vel[i].x * dt * env;
          pos[i].z += vel[i].z * dt * env;
          pos[i].y += vel[i].y * dt;
          if (pos[i].y < DIE_REST_Y) {
            pos[i].y = DIE_REST_Y;
            vel[i].y *= -0.55;
            if (Math.abs(vel[i].y) < 0.12) vel[i].y = (0.35 + Math.random() * 0.45) * env;
          }
          const rr = Math.hypot(pos[i].x, pos[i].z);
          if (rr > maxR) {
            const s = maxR / rr;
            pos[i].x *= s;
            pos[i].z *= s;
            const nx = pos[i].x / maxR;
            const nz = pos[i].z / maxR;
            const dot = vel[i].x * nx + vel[i].z * nz;
            vel[i].x -= 2 * dot * nx;
            vel[i].z -= 2 * dot * nz;
            vel[i].x *= 0.85;
            vel[i].z *= 0.85;
          }
          for (let j = 0; j < dice.length; j++) {
            if (j === i) continue;
            const dx = pos[i].x - pos[j].x;
            const dz = pos[i].z - pos[j].z;
            const dist = Math.hypot(dx, dz) || 0.001;
            const minD = DIE * 0.95;
            if (dist < minD) {
              const push = ((minD - dist) / dist) * 0.5;
              pos[i].x += dx * push;
              pos[i].z += dz * push;
            }
          }
          d.position.copy(pos[i]);
        });
        renderer.render(scene, camera);
        if (u < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });

    dice.forEach((d, i) => d.quaternion.copy(toQuat[i]));
    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
    const delays = order.map((_, rank) => LAND_STAGGER_MS[rank] + (Math.random() * 70 - 20));
    const fromPos = dice.map((d, i) => {
      const p = d.position.clone();
      p.y = Math.max(p.y, DIE_REST_Y) + 0.1 + order.indexOf(i) * 0.03;
      return p;
    });
    const fallDur = SETTLE_MS - Math.max(...delays) - 80;
    const s0 = performance.now();
    await new Promise((resolve) => {
      function step(now) {
        const elapsed = now - s0;
        dice.forEach((d, i) => {
          d.quaternion.copy(toQuat[i]);
          const local = Math.min(1, Math.max(0, (elapsed - delays[i]) / fallDur));
          const e = 1 - Math.pow(1 - local, 5);
          d.position.lerpVectors(fromPos[i], spots[i], e);
          if (local > 0 && local < 1) {
            const bounce =
              Math.sin(local * Math.PI * 2.2) * 0.055 * Math.pow(1 - local, 1.6);
            d.position.y =
              spots[i].y + Math.max(0, bounce) + (fromPos[i].y - spots[i].y) * (1 - e);
          } else if (local >= 1) {
            d.position.copy(spots[i]);
          }
        });
        renderer.render(scene, camera);
        if (elapsed < SETTLE_MS) requestAnimationFrame(step);
        else {
          dice.forEach((d, i) => {
            d.position.copy(spots[i]);
            d.quaternion.copy(toQuat[i]);
          });
          renderer.render(scene, camera);
          resolve();
        }
      }
      requestAnimationFrame(step);
    });

    shaking = false;
  }

  return { play, resize, setIdleFaces, dispose: () => { looping = false; } };
}

async function boot() {
  window.CupShake3D = window.CupShake3D || { ready: false, play: async () => {}, hide() {} };
  const canvas = document.getElementById('cup3dCanvas');
  const layer = document.getElementById('cup3dLayer');
  if (!canvas) return;
  const lite = canvas.dataset.lite === '1';
  try {
    if (layer) {
      layer.style.visibility = 'hidden';
      layer.style.opacity = '0';
      layer.style.display = 'block';
    }
    const api = await mountCupShake3D(canvas, { lite });
    const feed = document.getElementById('videoFeed');
    const stereo = document.getElementById('cupStereo');
    const PLATE = 'assets/eu-concept/cup-screen-empty-nodice.jpg?v=1.4.18';
    const RED_CLOTH = 'assets/eu-concept/red-felt-plain.jpg?v=1.4.18';

    function showLayer() {
      if (stereo) {
        stereo.classList.add('is-on');
        stereo.classList.remove('is-shaking');
        stereo.setAttribute('aria-hidden', 'false');
      }
      if (layer) {
        layer.classList.add('is-on');
        layer.style.display = 'block';
        layer.style.visibility = 'visible';
        layer.style.opacity = '1';
        layer.setAttribute('aria-hidden', 'false');
      }
      if (canvas) {
        canvas.style.background = 'transparent';
        canvas.style.opacity = '1';
      }
      if (feed) {
        feed.src = RED_CLOTH;
        feed.style.opacity = '1';
        feed.style.visibility = 'visible';
      }
      api.resize();
      api.setIdleFaces();
    }
    function hideLayer() {
      if (layer) {
        layer.classList.remove('is-on');
        layer.style.visibility = 'hidden';
        layer.style.opacity = '0';
        layer.setAttribute('aria-hidden', 'true');
      }
      if (stereo) {
        stereo.classList.remove('is-on', 'is-shaking');
        stereo.setAttribute('aria-hidden', 'true');
      }
    }

    window.CupShake3D = {
      ready: true,
      showIdle() {
        showLayer();
      },
      async play(faces) {
        showLayer();
        if (stereo) stereo.classList.add('is-shaking');
        api.resize();
        await api.play(faces);
        if (stereo) stereo.classList.remove('is-shaking');
        /* 滚完仍显示落定骰在空盅上 */
        api.setIdleFaces(faces);
      },
      hide() {
        hideLayer();
      },
      resize: api.resize,
    };

    /* 强制亮红布+三骰；再补两帧防首屏白板 */
    showLayer();
    requestAnimationFrame(() => {
      showLayer();
      setTimeout(showLayer, 120);
      setTimeout(showLayer, 600);
    });
    try {
      window.dispatchEvent(new CustomEvent('cup3d-ready'));
    } catch (_) {}
    console.log('[CupShake3D] ready recessed-pip dice on red cloth');
  } catch (e) {
    console.error('[CupShake3D] failed', e);
    window.CupShake3D = { ready: false, play: async () => {}, hide() {}, error: String(e) };
    try {
      window.dispatchEvent(new CustomEvent('cup3d-failed'));
    } catch (_) {}
  }
}

boot();
