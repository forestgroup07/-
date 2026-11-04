/**
 * Transparent cup + user's die-face-1..6 textures for game.html
 * window.CupShake3D = { ready, play([d1,d2,d3]) }
 *
 * LOCKED v1.1.5 — 用户确认：黑底座离红底边有缝、整座露全（CUP_SCALE=2.55）
 * 备份：js/cup-shake-3d.LOCKED-1.1.5.js ；对照 assets/LOCKED-cup-1.1.5.jpg ；绝不可覆盖
 */
import * as THREE from 'three';

const FACE_VER = 'v1.1.5';
const SHAKE_MS = 4800;
const SETTLE_MS = 900;
// LOCKED 1.1.5：略小于满框，底座完整露出
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
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), glassMat);
  cupRoot.add(glass);
  // 独立半球顶：轮廓更圆，避免看起来像平切横线
  const domeMat = glassMat.clone();
  domeMat.opacity = 0.32;
  const domeCap = new THREE.Mesh(
    new THREE.SphereGeometry(R, 64, 48, 0, Math.PI * 2, 0, Math.PI / 2),
    domeMat
  );
  domeCap.position.y = rimY + H;
  cupRoot.add(domeCap);

  // 底口嵌在铬座上的银环（顶上不加细环线）
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(R, 0.011, 10, 64),
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
          loader.load(`${assetBase}/die-face-${i}.png?v=${FACE_VER}`, (t) => res(t), undefined, rej)
        )
    )
  );
  const faceTex = rawTex.map(punchBlackToAlpha);

  const DIE = 0.168; // 略大，全貌更清楚
  // 实心骰贴在罩内落地板上（底面碰 FLOOR_TOP）
  const DIE_REST_Y = FLOOR_TOP + DIE * 0.5 + 0.001;
  function makeDie() {
    const g = new THREE.Group();
    // 实心红块本体
    g.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(DIE, DIE, DIE),
        new THREE.MeshStandardMaterial({ color: 0xc81018, roughness: 0.38, metalness: 0.04 })
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
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(DIE * 0.92, DIE * 0.92),
        new THREE.MeshStandardMaterial({
          map: faceTex[s.f - 1],
          transparent: true,
          alphaTest: 0.15,
          roughness: 0.32,
          metalness: 0.02,
        })
      );
      plane.position.copy(s.n).multiplyScalar(DIE * 0.5 + 0.001);
      plane.lookAt(plane.position.clone().add(s.n));
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
    const rnd = (a, b) => a + Math.random() * (b - a);
    const rndSign = () => (Math.random() < 0.5 ? -1 : 1);
    // 每局转速/弹跳参数重抽
    const spins = [0, 1, 2].map(() => new THREE.Vector3(
      rnd(10, 22) * rndSign(),
      rnd(10, 22) * rndSign(),
      rnd(8, 20) * rndSign()
    ));
    // 上下跳动要够高（实心骰撞实心底）
    const dieJump = [0, 1, 2].map(() => ({
      ax: rnd(0.045, 0.08) * rndSign(),
      ay: rnd(0.95, 1.35),
      az: rnd(0.04, 0.075) * rndSign(),
      fx: rnd(0.9, 1.45),
      fy: rnd(1.25, 1.75),
      fz: rnd(0.85, 1.4),
      ph: rnd(0, Math.PI * 2),
    }));
    const cupBase = new THREE.Vector3(0, CUP_REST_Y, 0);
    const t0 = performance.now();

    // 中心 y 不低于 DIE_REST_Y（贴底座高度）
    function bounceY(restY, phase, fy, ay, env) {
      return restY + Math.abs(Math.sin(phase * fy)) * ay * env;
    }

    await new Promise((resolve) => {
      function step(now) {
        const u = Math.min(1, (now - t0) / SHAKE_MS);
        const env = u < 0.8 ? 1 : 0.5 + 0.5 * Math.cos(((u - 0.8) / 0.2) * Math.PI);
        const hz = 11 - u * 4;
        const phase = u * hz * Math.PI * 2;
        cupRoot.rotation.set(CUP_TILT_X, 0, 0);
        cupRoot.position.set(
          Math.sin(phase * 1.25) * 0.04 * env,
          CUP_REST_Y + Math.abs(Math.sin(phase)) * 0.28 * env,
          Math.cos(phase * 0.95) * 0.03 * env
        );
        dice.forEach((d, i) => {
          const m = dieJump[i];
          const p = phase + m.ph;
          d.rotation.x += spins[i].x * 0.016 * env;
          d.rotation.y += spins[i].y * 0.016 * env;
          d.rotation.z += spins[i].z * 0.016 * env;
          d.position.set(
            spots[i].x + Math.sin(p * m.fx) * m.ax * env,
            bounceY(DIE_REST_Y, p, m.fy, m.ay, env),
            spots[i].z + Math.cos(p * m.fz) * m.az * env
          );
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

    /*
     * ========== 落定铁律（写死）==========
     * 实心骰 → 实心落地板：
     * 1) 未轮到：高位悬停，可慢转；禁止弹跳抽筋
     * 2) 开始下落瞬间定死结果面（空中定面）
     * 3) 下落只动位置：重力加速砸地；全程禁止再改朝向
     * 4) 贴地即冻死：禁止落地后再调整、再翻面
     * =====================================
     */
    function easeInQuad(e) {
      return e * e;
    }
    const toQuat = f.map((n, i) => quatFaceUp(n, (i - 1) * 0.18));
    const FALL_MS = 420;
    const GAP_MS = 130;
    const slot = FALL_MS + GAP_MS;
    const totalMs = slot * 2 + FALL_MS;
    const settled = [false, false, false];
    const started = [false, false, false];
    const fallFrom = [null, null, null];
    const hoverY = dice.map((d) => Math.max(d.position.y, DIE_REST_Y + 0.22));
    const s0 = performance.now();
    await new Promise((resolve) => {
      function step(now) {
        const t = now - s0;
        dice.forEach((d, i) => {
          if (settled[i]) {
            d.position.copy(spots[i]);
            d.quaternion.copy(toQuat[i]);
            return;
          }
          const startMs = i * slot;
          const doneMs = startMs + FALL_MS;
          if (t < startMs) {
            // 未轮到：高位悬停 + 慢转（像还在空中），不弹跳
            const sink = Math.min(0.03, (t / Math.max(1, startMs)) * 0.03);
            d.position.set(spots[i].x, hoverY[i] - sink, spots[i].z);
            d.rotation.x += spins[i].x * 0.003;
            d.rotation.y += spins[i].y * 0.003;
            d.rotation.z += spins[i].z * 0.003;
            return;
          }
          if (!started[i]) {
            started[i] = true;
            // 空中定面：下落全程与落地后都不再改朝向
            d.quaternion.copy(toQuat[i]);
            fallFrom[i] = d.position.clone();
            fallFrom[i].x = spots[i].x;
            fallFrom[i].z = spots[i].z;
            fallFrom[i].y = Math.max(fallFrom[i].y, DIE_REST_Y + 0.28);
            d.position.copy(fallFrom[i]);
          }
          if (t < doneMs) {
            const e = (t - startMs) / FALL_MS;
            const g = easeInQuad(e); // 自由落体砸向落地板
            d.position.lerpVectors(fallFrom[i], spots[i], g);
            d.position.y = Math.max(d.position.y, DIE_REST_Y);
            d.quaternion.copy(toQuat[i]); // 死锁朝向
            return;
          }
          // 贴地冻死：位置+朝向，禁止再抖再翻
          settled[i] = true;
          d.position.copy(spots[i]);
          d.quaternion.copy(toQuat[i]);
        });
        renderer.render(scene, camera);
        if (t < totalMs) requestAnimationFrame(step);
        else {
          dice.forEach((d, i) => {
            settled[i] = true;
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
  try {
    // measure against video-well even while hidden
    if (layer) {
      layer.style.visibility = 'hidden';
      layer.style.opacity = '0';
      layer.style.display = 'block';
    }
    const api = await mountCupShake3D(canvas);
    window.CupShake3D = {
      ready: true,
      async play(faces) {
        if (layer) {
          layer.classList.add('is-on');
          layer.style.visibility = '';
          layer.style.opacity = '';
          layer.setAttribute('aria-hidden', 'false');
        }
        api.resize();
        await api.play(faces);
      },
      hide() {
        // 摇完仍留在桌上，盖住概念图旧盅
        if (layer) {
          layer.classList.add('is-on');
          layer.style.visibility = '';
          layer.style.opacity = '';
        }
      },
      resize: api.resize,
    };
    // 进桌就显示你的盅（不再等停注才闪一下）
    if (layer) {
      layer.classList.add('is-on');
      layer.style.visibility = '';
      layer.style.opacity = '';
      layer.setAttribute('aria-hidden', 'false');
      api.resize();
    }
    // 抽样：画布是否真有像素（排查全透明）
    try {
      const u = canvas.toDataURL('image/png');
      console.log('[CupShake3D] ready', { dataUrlLen: u.length });
    } catch (e) {
      console.log('[CupShake3D] ready');
    }
  } catch (e) {
    console.error('[CupShake3D] failed', e);
    window.CupShake3D = { ready: false, play: async () => {}, hide() {}, error: String(e) };
  }
}

boot();
