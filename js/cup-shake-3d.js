/**
 * Solid 3D dice rolling inside glass cup (Three.js).
 * window.CupShake3D = { ready, play([d1,d2,d3]) }
 *
 * Idle: photo plate only (#cup3dLayer hidden) — no milky overlay.
 * Shake: red well feed + solid rounded dice tumble/roll in cup, then settle to result faces.
 * Base mesh/CUP_SCALE from locked 1.2.2 lineage; motion upgraded to in-cup roll.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const FACE_VER = 'v1.2.2';
const SHAKE_MS = 4800;
/* 落地总窗：含先后错峰；单颗由快到慢带衰减弹跳 */
const SETTLE_MS = 1600;
const LAND_STAGGER_MS = [0, 220, 480];
// LOCKED 1.2.2：盅尺寸/定位继承 1.1.5；骰子为圆角方骰
const CUP_SCALE = 2.55;
const CUP_TILT_X = (10 * Math.PI) / 180;
const CUP_REST_Y = -0.55;
const DIE_TIP_X = (5 * Math.PI) / 180;

function punchBlackToAlpha(tex) {
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i] < 28 && p[i + 1] < 28 && p[i + 2] < 28) p[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.colorSpace = THREE.SRGBColorSpace;
  out.needsUpdate = true;
  return out;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

async function mountCupShake3D(canvas, opts = {}) {
  const assetBase = opts.assetBase || 'assets/dice';
  const lite = !!opts.lite;
  const faceTpl = opts.faceTpl || 'die-face-{n}.png';
  const faceVer = opts.faceVer || FACE_VER;
  const latheSeg = lite ? 48 : 96;
  const sphereW = lite ? 32 : 64;
  const sphereH = lite ? 24 : 48;
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
  // 略俯视；罩子放大后仍整盅入镜（顶弧完整）
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  camera.position.set(0, 3.4, 5.4);
  camera.lookAt(0, CUP_REST_Y + 0.7, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(1.8, 2.8, 2.0);
  scene.add(sun);
  const fill = new THREE.PointLight(0xffffff, 0.6, 12);
  fill.position.set(-1.0, 1.4, 1.8);
  scene.add(fill);
  const spark = new THREE.PointLight(0xffffff, 0.7, 6);
  spark.position.set(0.5, 1.6, 1.2);
  scene.add(spark);

  const cupRoot = new THREE.Group();
  cupRoot.scale.setScalar(CUP_SCALE);
  // 底座+玻璃+骰子同一父节点，一起朝观众倾 15°；整体压低贴红布
  cupRoot.rotation.set(CUP_TILT_X, 0, 0);
  cupRoot.position.set(0, CUP_REST_Y, 0);
  scene.add(cupRoot);

  // —— 实拍密封钟形罩：铬座 + 平底封口 + 竖直筒壁 + 半球顶（外形锁定，勿改比例）——
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd0d4d8,
    metalness: 0.98,
    roughness: 0.1,
  });
  const R = 0.36;
  const H = 0.58; // 玻璃罩更高更大，对应用户截图比例
  const rimY = 0.05;
  // 底座薄一点，别显得“垫得太高”（1.1.5 外形）
  const baseDisk = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.09, R + 0.11, 0.035, 64),
    chromeMat
  );
  baseDisk.position.y = 0.012;
  cupRoot.add(baseDisk);
  const baseRing = new THREE.Mesh(
    new THREE.TorusGeometry(R + 0.06, 0.018, 12, 64),
    chromeMat
  );
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = rimY;
  cupRoot.add(baseRing);

  /*
   * 罩内立体（外轮廓/铬座尺寸一律不动）：
   * - 实心落地板：骰子撞这里
   * - BackSide 内壁：玻璃厚度感
   */
  const R_IN = R - 0.02;
  const FLOOR_TOP = rimY + 0.01;
  const innerFloor = new THREE.Mesh(
    new THREE.CylinderGeometry(R_IN, R_IN, 0.022, 64),
    new THREE.MeshStandardMaterial({
      color: 0x6e757c,
      metalness: 0.92,
      roughness: 0.28,
      depthWrite: true,
    })
  );
  innerFloor.position.y = FLOOR_TOP - 0.011;
  cupRoot.add(innerFloor);
  const innerWall = new THREE.Mesh(
    new THREE.CylinderGeometry(R_IN, R_IN, H * 0.92, 64, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xb0c0d0,
      transparent: true,
      opacity: 0.14,
      roughness: 0.08,
      metalness: 0.08,
      depthWrite: false,
      side: THREE.BackSide,
    })
  );
  innerWall.position.y = FLOOR_TOP + H * 0.46;
  cupRoot.add(innerWall);
  const innerFoot = new THREE.Mesh(
    new THREE.TorusGeometry(R_IN - 0.004, 0.008, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.9, roughness: 0.22 })
  );
  innerFoot.rotation.x = Math.PI / 2;
  innerFoot.position.y = FLOOR_TOP + 0.002;
  cupRoot.add(innerFoot);

  // 玻璃材质：略深半透明，顶半球轮廓要看得见（实拍密封罩）
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xa8b8c8,
    transparent: true,
    opacity: 0.26,
    roughness: 0.05,
    metalness: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // 一体 Lathe 轮廓：底封口 → 竖直壁 → 半球密封顶（不是开口盅）
  const profile = [];
  // 底盘封口（圆心 → 外沿）
  profile.push(new THREE.Vector2(0.001, rimY));
  profile.push(new THREE.Vector2(R, rimY));
  // 竖直筒壁
  const wallSeg = 16;
  for (let i = 1; i <= wallSeg; i++) {
    profile.push(new THREE.Vector2(R, rimY + (H * i) / wallSeg));
  }
  // 半球顶盖（密封半圆）
  const domeSeg = 32;
  for (let i = 1; i <= domeSeg; i++) {
    const a = (i / domeSeg) * (Math.PI / 2);
    profile.push(
      new THREE.Vector2(R * Math.cos(a), rimY + H + R * Math.sin(a))
    );
  }
  // 顶点合到轴心，真正封口成自然半圆弧
  profile.push(new THREE.Vector2(0.001, rimY + H + R));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile, latheSeg), glassMat);
  cupRoot.add(glass);
  // 独立半球顶：轮廓更圆，避免看起来像平切横线
  const domeMat = glassMat.clone();
  domeMat.opacity = 0.32;
  const domeCap = new THREE.Mesh(
    new THREE.SphereGeometry(R, sphereW, sphereH, 0, Math.PI * 2, 0, Math.PI / 2),
    domeMat
  );
  domeCap.position.y = rimY + H;
  cupRoot.add(domeCap);

  // 底口嵌在铬座上的银环（顶上不加细环线）
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(R, 0.011, 10, lite ? 32 : 64),
    chromeMat
  );
  mouth.rotation.x = Math.PI / 2;
  mouth.position.y = rimY + 0.001;
  cupRoot.add(mouth);

  const loader = new THREE.TextureLoader();
  const rawTex = await Promise.all(
    [1, 2, 3, 4, 5, 6].map(
      (i) =>
        new Promise((res, rej) =>
          loader.load(
            `${assetBase}/${faceTpl.replace('{n}', String(i))}?v=${faceVer}`,
            (t) => res(t),
            undefined,
            rej
          )
        )
    )
  );
  const faceTex = rawTex.map(punchBlackToAlpha);

  const DIE = 0.168; // 略大，全貌更清楚
  // 对标视频：圆角方骰（方圆形），四棱/八角倒圆
  const DIE_RADIUS = DIE * 0.22;
  const DIE_SEG = 4;
  // 实心骰贴在罩内落地板上（底面碰 FLOOR_TOP）
  const DIE_REST_Y = FLOOR_TOP + DIE * 0.5 + 0.001;
  function makeDie() {
    const g = new THREE.Group();
    // 圆角红骰本体（视频同款方圆轮廓）
    g.add(
      new THREE.Mesh(
        new RoundedBoxGeometry(DIE, DIE, DIE, DIE_SEG, DIE_RADIUS),
        new THREE.MeshStandardMaterial({
          color: 0xc81018,
          roughness: 0.28,
          metalness: 0.06,
        })
      )
    );
    const specs = [
      { f: 1, n: new THREE.Vector3(0, 1, 0) },
      { f: 6, n: new THREE.Vector3(0, -1, 0) },
      { f: 2, n: new THREE.Vector3(0, 0, 1) },
      { f: 5, n: new THREE.Vector3(0, 0, -1) },
      { f: 3, n: new THREE.Vector3(1, 0, 0) },
      { f: 4, n: new THREE.Vector3(-1, 0, 0) },
    ];
    for (const s of specs) {
      // 贴面贴在圆角面中心外侧，避免埋进实体导致白点消失
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(DIE * 0.72, DIE * 0.72),
        new THREE.MeshStandardMaterial({
          map: faceTex[s.f - 1],
          transparent: true,
          alphaTest: 0.08,
          depthWrite: false,
          roughness: 0.28,
          metalness: 0.02,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      );
      plane.position.copy(s.n).multiplyScalar(DIE * 0.5 + 0.003);
      plane.lookAt(plane.position.clone().add(s.n));
      plane.renderOrder = 2;
      g.add(plane);
    }
    return g;
  }

  const spots = [
    new THREE.Vector3(-0.1, DIE_REST_Y, -0.05),
    new THREE.Vector3(0.1, DIE_REST_Y, -0.02),
    new THREE.Vector3(0.0, DIE_REST_Y, 0.1),
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
    const q = new THREE.Quaternion().setFromUnitVectors(map[face].clone(), new THREE.Vector3(0, 1, 0));
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
    // 先摆正结果面朝上，再整体前倾；yaw 必须由调用方固定传入，禁止落地时 random 重算（会像翻面）
    return dieTipQ.clone().multiply(yaw.multiply(q));
  }

  const dice = spots.map((s) => {
    const d = makeDie();
    d.position.copy(s);
    d.quaternion.copy(quatFaceUp(1));
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

  async function play(faces) {
    if (shaking) return;
    shaking = true;
    resize();
    const f = (faces || [1, 2, 3]).map((n) => Math.max(1, Math.min(6, n | 0)));

    /* 盅内实心骰：各自斜向轨迹 + 翻滚，撞壁回弹，由快到慢 */
    const maxR = R_IN * 0.52;
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
    const pos = dice.map((d, i) => d.position.clone().setY(DIE_REST_Y + 0.05));
    /* 结果面一开始就算死；落地只贴地，禁止 slerp 翻面 */
    const toQuat = f.map((n) => quatFaceUp(n, (Math.random() - 0.5) * Math.PI * 0.35));
    const cupBase = new THREE.Vector3(0, CUP_REST_Y, 0);
    const t0 = performance.now();

    await new Promise((resolve) => {
      function step(now) {
        const u = Math.min(1, (now - t0) / SHAKE_MS);
        /* 前 70% 满幅翻滚，后 30% 收束 */
        const env = u < 0.7 ? 1 : Math.sin(((1 - (u - 0.7) / 0.3) * Math.PI) / 2);
        const hz = 18 - u * 7;
        const phase = u * hz * Math.PI * 2;
        const dt = 0.016;
        cupRoot.rotation.set(CUP_TILT_X, 0, Math.sin(phase * 0.7) * 0.04 * env);
        /* 盅壳跟着抖，幅度略小于骰 */
        cupRoot.position.set(
          Math.sin(phase * 1.1) * 0.05 * env,
          CUP_REST_Y + Math.abs(Math.sin(phase)) * 0.32 * env,
          Math.cos(phase * 0.9) * 0.04 * env
        );
        dice.forEach((d, i) => {
          if (u >= 0.9) {
            d.quaternion.copy(toQuat[i]);
            d.position.lerp(spots[i], 0.18);
            return;
          }
          /* 翻滚 */
          d.rotation.x += spins[i].x * 0.018 * env;
          d.rotation.y += spins[i].y * 0.018 * env;
          d.rotation.z += spins[i].z * 0.018 * env;
          /* 水平滚动 + 弹跳 */
          vel[i].y -= 2.8 * dt;
          pos[i].x += vel[i].x * dt * env;
          pos[i].z += vel[i].z * dt * env;
          pos[i].y += vel[i].y * dt;
          if (pos[i].y < DIE_REST_Y) {
            pos[i].y = DIE_REST_Y;
            vel[i].y *= -0.55;
            if (Math.abs(vel[i].y) < 0.12) vel[i].y = (0.35 + Math.random() * 0.45) * env;
          }
          /* 撞玻璃内壁 */
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
          /* 互相推开一点，避免叠成一团 */
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
        else {
          cupRoot.position.copy(cupBase);
          cupRoot.rotation.set(CUP_TILT_X, 0, 0);
          resolve();
        }
      }
      requestAnimationFrame(step);
    });

    /* 落定：实心骰按惯性由快到慢，分先后陆续着地（姿态锁死不翻面） */
    dice.forEach((d, i) => d.quaternion.copy(toQuat[i]));
    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
    const delays = order.map((_, rank) => LAND_STAGGER_MS[rank] + (Math.random() * 70 - 20));
    const fromPos = dice.map((d, i) => {
      const p = d.position.clone();
      /* 悬空起点略错开，落地才有先后惯性感 */
      p.y = Math.max(p.y, DIE_REST_Y) + 0.10 + order.indexOf(i) * 0.03;
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
          /* easeOutQuint：先快后慢的物理惯性 */
          const e = 1 - Math.pow(1 - local, 5);
          d.position.lerpVectors(fromPos[i], spots[i], e);
          /* 衰减弹跳：陆续触地后各抖一两下 */
          if (local > 0 && local < 1) {
            const bounce =
              Math.sin(local * Math.PI * 2.2) * 0.055 * Math.pow(1 - local, 1.6);
            d.position.y = spots[i].y + Math.max(0, bounce) + (fromPos[i].y - spots[i].y) * (1 - e);
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

  return { play, resize, dispose: () => { looping = false; } };
}

/** Auto-boot when canvas#cup3dCanvas exists */
async function boot() {
  window.CupShake3D = window.CupShake3D || { ready: false, play: async () => {}, hide() {} };
  const canvas = document.getElementById('cup3dCanvas');
  const layer = document.getElementById('cup3dLayer');
  if (!canvas) return;
  const lite = canvas.dataset.lite === '1';
  const mountOpts = {
    lite,
    faceTpl: canvas.dataset.faceTpl || undefined,
    faceVer: canvas.dataset.faceVer || undefined,
    assetBase: canvas.dataset.assetBase || undefined,
  };
  try {
    // measure against video-well even while hidden
    if (layer) {
      layer.style.visibility = 'hidden';
      layer.style.opacity = '0';
      layer.style.display = 'block';
    }
    const api = await mountCupShake3D(canvas, mountOpts);
    const feed = document.getElementById('videoFeed');
    const stereo = document.getElementById('cupStereo');
    const PLATE = 'assets/eu-concept/cup-screen-empty-nodice.jpg?v=1.4.4';
    const RED = 'assets/eu-concept/cup-well-red.jpg?v=1.4.4';
    let feedPrev = '';

    function showLayer() {
      if (stereo) {
        stereo.classList.add('is-on', 'is-shaking');
        stereo.setAttribute('aria-hidden', 'false');
      }
      if (layer) {
        layer.classList.add('is-on');
        layer.style.display = 'block';
        layer.style.visibility = '';
        layer.style.opacity = '';
        layer.setAttribute('aria-hidden', 'false');
      }
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
      async play(faces) {
        feedPrev = feed ? feed.getAttribute('src') || '' : '';
        if (feed) feed.src = RED; // 红布静底，去掉焊死白骰图
        showLayer();
        api.resize();
        await api.play(faces);
        hideLayer();
        if (feed) {
          feed.src =
            feedPrev && feedPrev.indexOf('cup-screen-empty-nodice') >= 0
              ? feedPrev
              : PLATE;
        }
      },
      hide() {
        hideLayer();
        if (feed && String(feed.src || '').indexOf('cup-well-red') >= 0) {
          feed.src = PLATE;
        }
      },
      resize: api.resize,
    };
    // 默认不盖住视频屏盅图；仅 play() 摇盅时亮起
    if (layer) {
      layer.classList.remove('is-on');
      layer.style.visibility = 'hidden';
      layer.style.opacity = '0';
      layer.setAttribute('aria-hidden', 'true');
      api.resize();
    }
    try {
      window.dispatchEvent(new CustomEvent('cup3d-ready'));
    } catch (_) {}
    // 抽样：画布是否真有像素（排查全透明）
    try {
      const u = canvas.toDataURL('image/png');
      console.log('[CupShake3D] ready', { dataUrlLen: u.length, lite });
    } catch (e) {
      console.log('[CupShake3D] ready', { lite });
    }
  } catch (e) {
    console.error('[CupShake3D] failed', e);
    window.CupShake3D = { ready: false, play: async () => {}, hide() {}, error: String(e) };
    try {
      window.dispatchEvent(new CustomEvent('cup3d-failed'));
    } catch (_) {}
  }
}

boot();
