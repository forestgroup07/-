/**
 * Photo-matched white solid dice (Three.js) — dice ONLY, no CGI glass cup.
 * Background = empty cup photo (#videoFeed). Opposite faces: 1↔6, 2↔5, 3↔4.
 * window.CupShake3D = { ready, play([d1,d2,d3]), showIdle, hide }
 *
 * v1.4.8 定版：改滚感（断电滚冲 + 低摩擦长滑转 + 晚收面）+ 停止下注 3s + 倒计时弧端随环色。
 * ?cupDebug=1 仍显示校准圈。
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const FACE_VER = '1.4.8';
/** 可见振盘像素振幅（相对世界 amp） */
const VIS_PLATE_Y_PX = 11;
const VIS_PLATE_X_PX = 4.5;
/* 猛振 → 衰减断电 → 贴地长滚转 → 陆续停死 */
const SHAKE_MS = 7200;
const FIERCE_S = 1.5;
const SETTLE_S = 3.0;
const ROLL_DEADLINE_S = 6.4;
const BALL_EASE_P = 2.55;
const FLOOR_SLIDE_FRIC = 0.95;
const FLOOR_SPIN_FRIC = 0.72;

/*
 * 校准常量（对照 assets/eu-concept/cup-screen-empty-nodice.jpg 1280×720）：
 * - 绿垫中心 UV ≈ (0.501, 0.639)
 * - 绿垫半径 ≈ 0.096×画面宽
 * - 世界：垫半径 PAD_R=0.72 → 投影对齐上述 UV；DIE=0.36 ≈ 垫直径的 1/4
 */
const PAD_R = 0.72;
const DIE = 0.36;
const DIE_RADIUS = DIE * 0.26;
const DIE_SEG = 6;
/* 球近似互撞半径；贴地时改用盒距 LAND_MIN，才像实心方骰 */
const DIE_COL_R = DIE * 0.58;
const LAND_MIN = DIE * 1.28;
const WALL_R = Math.max(0.12, PAD_R - DIE_COL_R);
const CEIL_H = 1.85; /* 允许抛到罩中上部（对真机视频） */
const GRAVITY = 16.5;
const FLOOR_REST = 0.34;
const WALL_REST = 0.62;
const PLATE_KICK = 1.65; /* 猛振阶段把骰踢到罩中上 */
const DIE_TIP_X = (3 * Math.PI) / 180;

const CAM_POS = [0, 5.1, 6.75];
const CAM_LOOK = [0, 0.7, 0];
const CAM_FOV = 28;

function ballProgress(u) {
  const t = Math.max(0, Math.min(1, u));
  return 1 - Math.pow(1 - t, BALL_EASE_P);
}
function rnd(a, b) {
  return a + Math.random() * (b - a);
}

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

function wantDebug() {
  try {
    return new URLSearchParams(location.search).get('cupDebug') === '1';
  } catch (_) {
    return false;
  }
}

async function mountCupShake3D(canvas, opts = {}) {
  const lite = !!opts.lite;
  const debug = wantDebug();

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
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.05, 80);
  camera.position.set(CAM_POS[0], CAM_POS[1], CAM_POS[2]);
  camera.lookAt(CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2]);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.55);
  sun.position.set(0.6, 4.2, 1.2);
  scene.add(sun);
  const fill = new THREE.PointLight(0xffffff, 0.35, 20);
  fill.position.set(-1.6, 1.2, 1.4);
  scene.add(fill);

  /* 校准后：杯坐标系 = 世界，底面 y=0，无额外 tilt/scale 错位 */
  const cupRoot = new THREE.Group();
  scene.add(cupRoot);

  const FLOOR_TOP = 0;
  const DIE_REST_Y = FLOOR_TOP + DIE * 0.5 + 0.001;
  const backZ = 0;

  if (debug) {
    const mkRing = (radius, color, y) => {
      const g = new THREE.RingGeometry(radius * 0.985, radius, 96);
      const m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.renderOrder = 9;
      return mesh;
    };
    cupRoot.add(mkRing(PAD_R, 0x22ff66, 0.002)); /* 绿垫外缘 */
    cupRoot.add(mkRing(WALL_R, 0xffee22, 0.004)); /* 骰心可到半径 */
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(PAD_R, PAD_R, CEIL_H, 64, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x44ccff,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    wall.position.y = CEIL_H * 0.5;
    wall.renderOrder = 8;
    cupRoot.add(wall);
    console.log('[CupShake3D] CALIB', {
      PAD_R,
      WALL_R,
      CEIL_H,
      DIE,
      CAM_POS,
      CAM_LOOK,
      padUV: '(0.501, 0.639)',
    });
  }

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
    /* 不要脚下黑圆影（照片绿垫上会显得脏） */
    return g;
  }

  /* 闲置散开三角：中心距 DIE×1.28，落在校准绿垫内 */
  const idleGap = DIE * 1.28;
  const idleR = Math.min(WALL_R * 0.92, idleGap / Math.sqrt(3));
  const spots = [0, 1, 2].map((i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    return new THREE.Vector3(
      Math.cos(a) * idleR,
      DIE_REST_Y,
      Math.sin(a) * idleR + backZ
    );
  });

  function clampInCup(p, v) {
    if (p.y < DIE_REST_Y) {
      p.y = DIE_REST_Y;
      if (v.y < 0) v.y *= -FLOOR_REST * (0.55 + Math.random() * 0.35);
      v.x *= 0.88;
      v.z *= 0.88;
    }
    const ceil = DIE_REST_Y + CEIL_H;
    if (p.y > ceil) {
      p.y = ceil;
      if (v.y > 0) v.y *= -0.35;
    }
    const h01 = Math.max(0, Math.min(1, (p.y - DIE_REST_Y) / CEIL_H));
    const maxR = WALL_R * (1 - h01 * h01 * 0.28);
    const rr = Math.hypot(p.x, p.z);
    if (rr > maxR && rr > 1e-6) {
      const nx = p.x / rr;
      const nz = p.z / rr;
      p.x = nx * maxR;
      p.z = nz * maxR;
      const dot = v.x * nx + v.z * nz;
      if (dot > 0) {
        v.x -= (1 + WALL_REST) * dot * nx;
        v.z -= (1 + WALL_REST) * dot * nz;
      }
      v.x *= 0.9;
      v.z *= 0.9;
      v.y += rnd(0.05, 0.25);
    }
  }

  function collidePair(pa, va, pb, vb, frozenA = false, frozenB = false) {
    if (frozenA && frozenB) return;
    const dx = pa.x - pb.x;
    const dy = pa.y - pb.y;
    const dz = pa.z - pb.z;
    const dist = Math.hypot(dx, dy, dz) || 1e-6;
    /* 两颗都近地：按方骰边长推开（XZ），空中仍用球近似 */
    const bothLow = pa.y <= DIE_REST_Y + DIE * 0.65 && pb.y <= DIE_REST_Y + DIE * 0.65;
    const minD = bothLow ? LAND_MIN : DIE_COL_R * 2;
    if (bothLow) {
      let hx = dx;
      let hz = dz;
      let hDist = Math.hypot(hx, hz);
      if (hDist < 1e-5) {
        const ang = Math.random() * Math.PI * 2;
        hx = Math.cos(ang);
        hz = Math.sin(ang);
        hDist = 1e-5;
      }
      if (hDist >= LAND_MIN) return;
      const nx = hx / hDist;
      const nz = hz / hDist;
      const overlap = LAND_MIN - hDist;
      if (frozenA) {
        pb.x -= nx * overlap;
        pb.z -= nz * overlap;
      } else if (frozenB) {
        pa.x += nx * overlap;
        pa.z += nz * overlap;
      } else {
        pa.x += nx * overlap * 0.5;
        pa.z += nz * overlap * 0.5;
        pb.x -= nx * overlap * 0.5;
        pb.z -= nz * overlap * 0.5;
      }
      const rv = frozenA
        ? -(vb.x * nx + vb.z * nz)
        : frozenB
          ? va.x * nx + va.z * nz
          : (va.x - vb.x) * nx + (va.z - vb.z) * nz;
      if (rv < 0) {
        const j = rv * 0.9;
        if (!frozenA) {
          va.x -= j * nx;
          va.z -= j * nz;
        }
        if (!frozenB) {
          vb.x += j * nx;
          vb.z += j * nz;
        }
      }
      return;
    }
    if (dist >= minD) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    const overlap = minD - dist;
    if (frozenA) {
      pb.x -= nx * overlap;
      pb.y -= ny * overlap;
      pb.z -= nz * overlap;
    } else if (frozenB) {
      pa.x += nx * overlap;
      pa.y += ny * overlap;
      pa.z += nz * overlap;
    } else {
      const h = overlap * 0.5;
      pa.x += nx * h;
      pa.y += ny * h;
      pa.z += nz * h;
      pb.x -= nx * h;
      pb.y -= ny * h;
      pb.z -= nz * h;
    }
    const rvx = frozenA ? -vb.x : frozenB ? va.x : va.x - vb.x;
    const rvy = frozenA ? -vb.y : frozenB ? va.y : va.y - vb.y;
    const rvz = frozenA ? -vb.z : frozenB ? va.z : va.z - vb.z;
    const rv = rvx * nx + rvy * ny + rvz * nz;
    if (rv >= 0) return;
    const j = rv * 0.82;
    if (!frozenA) {
      va.x -= j * nx;
      va.y -= j * ny;
      va.z -= j * nz;
    }
    if (!frozenB) {
      vb.x += j * nx;
      vb.y += j * ny;
      vb.z += j * nz;
    }
  }

  /** 水平一枪分离（不动画挪开）：落定前保证不叠模 */
  function separateLandXZ(positions, canMove) {
    for (let pass = 0; pass < 6; pass++) {
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 3; b++) {
          let dx = positions[a].x - positions[b].x;
          let dz = positions[a].z - positions[b].z;
          let dist = Math.hypot(dx, dz);
          if (dist < 1e-5) {
            const ang = (a * 2.1 + b * 1.7 + pass) * 1.7;
            dx = Math.cos(ang);
            dz = Math.sin(ang);
            dist = 1e-5;
          }
          if (dist >= LAND_MIN) continue;
          const nx = dx / dist;
          const nz = dz / dist;
          const push = LAND_MIN - dist;
          const ma = canMove[a];
          const mb = canMove[b];
          if (ma && mb) {
            positions[a].x += nx * push * 0.5;
            positions[a].z += nz * push * 0.5;
            positions[b].x -= nx * push * 0.5;
            positions[b].z -= nz * push * 0.5;
          } else if (ma) {
            positions[a].x += nx * push;
            positions[a].z += nz * push;
          } else if (mb) {
            positions[b].x -= nx * push;
            positions[b].z -= nz * push;
          }
        }
      }
      for (let i = 0; i < 3; i++) {
        if (!canMove[i]) continue;
        const dummy = { x: 0, y: 0, z: 0 };
        positions[i].y = DIE_REST_Y;
        clampInCup(positions[i], dummy);
        positions[i].y = DIE_REST_Y;
      }
    }
  }

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

  function applyVisPlate(px, py) {
    const tr = `scale(1.12) translate(${px.toFixed(2)}px, ${py.toFixed(2)}px)`;
    const feed = document.getElementById('videoFeed');
    const stereo = document.getElementById('cupStereo');
    if (feed) feed.style.transform = tr;
    if (stereo) stereo.style.transform = tr;
  }
  function resetVisPlate() {
    const tr = 'scale(1.12)';
    const feed = document.getElementById('videoFeed');
    const stereo = document.getElementById('cupStereo');
    if (feed) feed.style.transform = tr;
    if (stereo) stereo.style.transform = tr;
  }

  function setIdleFaces(faces) {
    const f = (faces || idleFaces).map((n) => Math.max(1, Math.min(6, n | 0)));
    dice.forEach((d, i) => {
      d.position.copy(spots[i]);
      d.quaternion.copy(quatFaceUp(f[i] || 1, idleYaw[i]));
    });
    renderer.render(scene, camera);
  }

  const frozenMark = [false, false, false];
  function freezeDie(i, pos, vel, spin, toQuat) {
    frozenMark[i] = true;
    pos[i].y = DIE_REST_Y;
    vel[i].set(0, 0, 0);
    spin[i].set(0, 0, 0);
    dice[i].position.copy(pos[i]);
    dice[i].quaternion.copy(toQuat[i]);
  }

  async function play(faces) {
    if (shaking) return;
    shaking = true;
    resize();
    const f = (faces || [1, 2, 3]).map((n) => Math.max(1, Math.min(6, n | 0)));
    /* 结果面开局锁死；落地只贴姿态，禁止再翻 */
    const toQuat = f.map((n) => quatFaceUp(n, rnd(-0.7, 0.7)));

    /* 底板公共参数 + 每骰独立相位/踢向（禁止三颗齐跳） */
    const platePhase0 = rnd(0, Math.PI * 2);
    const hz0 = rnd(14.5, 19.0);
    const hz1 = rnd(3.5, 5.5);
    const ampY0 = rnd(0.48, 0.62);
    const ampL0 = ampY0 * rnd(0.14, 0.22);
    const diePhase = [0, 1, 2].map((i) => platePhase0 + (i * 2 * Math.PI) / 3 + rnd(-0.55, 0.55));
    const dieLatAng = [0, 1, 2].map((i) => rnd(0, Math.PI * 2) + i * 2.1);
    const dieKick = [0, 1, 2].map(() => rnd(0.72, 1.28));
    const dieHzMul = [0, 1, 2].map(() => rnd(0.88, 1.14));
    const diePhaseAcc = diePhase.slice();
    /* 可见振盘用公共相位（整机在抖）；骰子仍各自相位互不同步 */
    let plateVisPhase = platePhase0;
    const plateVisLat = rnd(0, Math.PI * 2);
    resetVisPlate();

    const pos = dice.map((_, i) => {
      const a = (-Math.PI / 2 + (i * 2 * Math.PI) / 3) + rnd(-0.45, 0.45);
      const r = rnd(WALL_R * 0.12, WALL_R * 0.52);
      return new THREE.Vector3(
        Math.cos(a) * r,
        DIE_REST_Y + rnd(0.02, 0.55) + i * 0.12,
        Math.sin(a) * r
      );
    });
    /* 初速方向错开约 120°，竖直也错开，开局就不齐跳 */
    const vel = dice.map((_, i) => {
      const a = (-Math.PI / 2 + (i * 2 * Math.PI) / 3) + rnd(-0.8, 0.8);
      const s = rnd(0.9, 2.6);
      const vyBands = [
        [1.2, 3.0],
        [3.5, 5.5],
        [5.8, 7.5],
      ];
      const [lo, hi] = vyBands[i % 3];
      return new THREE.Vector3(Math.cos(a) * s, rnd(lo, hi), Math.sin(a) * s);
    });
    const spin = dice.map(
      () => new THREE.Vector3(rnd(-22, 22), rnd(-22, 22), rnd(-22, 22))
    );
    const ang = dice.map((d) => new THREE.Euler().setFromQuaternion(d.quaternion, 'YXZ'));
    frozenMark[0] = frozenMark[1] = frozenMark[2] = false;
    const stillMs = [0, 0, 0];
    const rollBoosted = [false, false, false];
    /* 停稳门槛更高更错开：先滚一阵再陆续停 */
    const stillNeedMs = [0, 1, 2].map((i) => 520 + i * 280 + rnd(0, 140));

    const t0 = performance.now();
    let lastT = t0;

    function hardFreeze(i) {
      const movable = [!frozenMark[0], !frozenMark[1], !frozenMark[2]];
      movable[i] = true;
      separateLandXZ(pos, movable);
      freezeDie(i, pos, vel, spin, toQuat);
      dice.forEach((d, k) => {
        if (frozenMark[k] || k === i) {
          d.position.copy(pos[k]);
          d.quaternion.copy(toQuat[k]);
        }
      });
    }

    await new Promise((resolve) => {
      function step(now) {
        const u = Math.min(1, (now - t0) / SHAKE_MS);
        const tSec = (now - t0) / 1000;
        const dt = Math.min(0.028, Math.max(0.008, (now - lastT) / 1000));
        lastT = now;
        /* 视频时间线：满振 → 衰减 → 断电后进入滚落 */
        let drive;
        if (tSec < FIERCE_S) drive = 1;
        else if (tSec < SETTLE_S) drive = Math.pow(1 - (tSec - FIERCE_S) / (SETTLE_S - FIERCE_S), 1.35);
        else drive = 0;
        const hzBase = hz0 + (hz1 - hz0) * Math.min(1, tSec / SETTLE_S);
        const ampY = ampY0 * drive;
        const ampL = ampL0 * drive;
        /* 衰减段少刮水平速，留给断电后滚 */
        const airDamp = 1 - (0.08 + 0.28 * (1 - drive)) * dt;

        plateVisPhase += hzBase * Math.PI * 2 * dt;
        const visY = Math.sin(plateVisPhase) * ampY0 * drive * VIS_PLATE_Y_PX;
        const visX =
          Math.cos(plateVisPhase * 1.13 + plateVisLat) * ampL0 * drive * VIS_PLATE_X_PX * 8;
        applyVisPlate(visX, visY);

        for (let i = 0; i < dice.length; i++) {
          if (frozenMark[i]) {
            dice[i].position.copy(pos[i]);
            dice[i].quaternion.copy(toQuat[i]);
            continue;
          }

          const hz = hzBase * dieHzMul[i];
          diePhaseAcc[i] += hz * Math.PI * 2 * dt;
          const sPh = Math.sin(diePhaseAcc[i]);
          const cPh = Math.cos(diePhaseAcc[i]);
          const omega = hz * Math.PI * 2;
          const plateVy = ampY * omega * cPh * dieKick[i];
          const plateVx = Math.cos(dieLatAng[i]) * ampL * omega * cPh * dieKick[i];
          const plateVz = Math.sin(dieLatAng[i]) * ampL * omega * cPh * dieKick[i];
          const floorY = DIE_REST_Y + ampY * sPh * dieKick[i];

          /* 振盘刚断电：补一次滚冲动量，保证看得见贴地滚/转 */
          if (drive < 0.02 && !rollBoosted[i] && tSec >= SETTLE_S) {
            rollBoosted[i] = true;
            const a = dieLatAng[i] + rnd(-0.9, 0.9);
            const boost = rnd(1.6, 2.9) * (0.85 + i * 0.12);
            vel[i].x += Math.cos(a) * boost;
            vel[i].z += Math.sin(a) * boost;
            vel[i].y += rnd(0.15, 0.55);
            spin[i].x += rnd(-18, 18);
            spin[i].y += rnd(-14, 14);
            spin[i].z += rnd(-18, 18);
          }

          vel[i].y -= GRAVITY * dt;
          vel[i].x *= airDamp;
          vel[i].z *= airDamp;
          pos[i].x += vel[i].x * dt;
          pos[i].y += vel[i].y * dt;
          pos[i].z += vel[i].z * dt;

          if (pos[i].y <= floorY) {
            pos[i].y = Math.max(DIE_REST_Y, floorY);
            const relY = vel[i].y - plateVy;
            if (drive > 0 && relY < 0) {
              vel[i].y = -relY * FLOOR_REST + plateVy * PLATE_KICK * (0.65 + 0.55 * drive);
              vel[i].x += plateVx * 0.65 + rnd(-0.35, 0.35) * drive;
              vel[i].z += plateVz * 0.65 + rnd(-0.35, 0.35) * drive;
              spin[i].x += (rnd(-12, 12) + plateVz * 2.5) * drive;
              spin[i].y += rnd(-10, 10) * drive;
              spin[i].z += (rnd(-12, 12) - plateVx * 2.5) * drive;
            } else {
              /* 贴地长滚：低摩擦 + 强滚动耦合 */
              pos[i].y = DIE_REST_Y;
              if (vel[i].y < 0) {
                vel[i].y *= -FLOOR_REST * 0.22;
                if (Math.abs(vel[i].y) < 0.28) vel[i].y = 0;
              }
              const slide = Math.max(0.92, 1 - FLOOR_SLIDE_FRIC * dt);
              vel[i].x *= slide;
              vel[i].z *= slide;
              spin[i].x += -vel[i].z * 9.5 * dt;
              spin[i].z += vel[i].x * 9.5 * dt;
              spin[i].y *= Math.max(0.94, 1 - FLOOR_SPIN_FRIC * 0.55 * dt);
              spin[i].x *= Math.max(0.94, 1 - FLOOR_SPIN_FRIC * dt);
              spin[i].z *= Math.max(0.94, 1 - FLOOR_SPIN_FRIC * dt);
            }
          }

          if (!frozenMark[i]) {
            const spinGain = drive > 0 ? 0.055 * (0.25 + drive) : 0.095;
            ang[i].x += spin[i].x * dt * spinGain;
            ang[i].y += spin[i].y * dt * spinGain;
            ang[i].z += spin[i].z * dt * spinGain;
            if (drive > 0) spin[i].multiplyScalar(0.99 - 0.008 * (1 - drive));
            clampInCup(pos[i], vel[i]);
          }
        }

        collidePair(pos[0], vel[0], pos[1], vel[1], frozenMark[0], frozenMark[1]);
        collidePair(pos[0], vel[0], pos[2], vel[2], frozenMark[0], frozenMark[2]);
        collidePair(pos[1], vel[1], pos[2], vel[2], frozenMark[1], frozenMark[2]);
        for (let i = 0; i < 3; i++) {
          if (!frozenMark[i]) clampInCup(pos[i], vel[i]);
        }

        for (let i = 0; i < dice.length; i++) {
          if (frozenMark[i]) continue;
          const speed = Math.hypot(vel[i].x, vel[i].y, vel[i].z);
          const spinMag = Math.hypot(spin[i].x, spin[i].y, spin[i].z);
          const onFloor = pos[i].y <= DIE_REST_Y + 0.04;

          /* 滚的时候以自旋为主；只在很慢时才慢慢收到结果面 */
          dice[i].rotation.copy(ang[i]);
          if (drive < 0.05 && onFloor && speed < 0.45 && spinMag < 3.8) {
            const blend = 0.05 + (1 - Math.min(1, speed / 0.45)) * 0.16;
            dice[i].quaternion.slerp(toQuat[i], blend);
            ang[i].setFromQuaternion(dice[i].quaternion, 'YXZ');
          }
          dice[i].position.copy(pos[i]);

          if (drive < 0.02 && onFloor && speed < 0.16 && spinMag < 1.15) {
            stillMs[i] += dt * 1000;
          } else if (drive < 0.02 && onFloor && speed < 0.32 && spinMag < 2.4) {
            stillMs[i] += dt * 380;
          } else {
            stillMs[i] = Math.max(0, stillMs[i] - dt * 650);
          }

          if (stillMs[i] >= stillNeedMs[i]) {
            hardFreeze(i);
            continue;
          }
          if (tSec >= ROLL_DEADLINE_S && onFloor && speed < 0.55) {
            hardFreeze(i);
          }
        }

        renderer.render(scene, camera);
        if (frozenMark.every(Boolean)) {
          separateLandXZ(pos, [true, true, true]);
          for (let i = 0; i < 3; i++) {
            pos[i].y = DIE_REST_Y;
            dice[i].position.copy(pos[i]);
            dice[i].quaternion.copy(toQuat[i]);
          }
          resetVisPlate();
          renderer.render(scene, camera);
          resolve();
          return;
        }
        if (u < 1 || frozenMark.some((x) => !x)) {
          if (tSec < ROLL_DEADLINE_S + 0.8) {
            requestAnimationFrame(step);
            return;
          }
        }
        for (let i = 0; i < 3; i++) {
          if (!frozenMark[i]) hardFreeze(i);
        }
        separateLandXZ(pos, [true, true, true]);
        for (let i = 0; i < 3; i++) {
          pos[i].y = DIE_REST_Y;
          dice[i].position.copy(pos[i]);
          dice[i].quaternion.copy(toQuat[i]);
        }
        resetVisPlate();
        renderer.render(scene, camera);
        resolve();
      }
      requestAnimationFrame(step);
    });

    resetVisPlate();
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
    const PLATE = 'assets/eu-concept/cup-screen-empty-nodice.jpg?v=1.4.8';

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
        feed.src = PLATE;
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
        /* 停死在落点：禁止 setIdleFaces 拽回三角位 */
      },
      hide() {
        hideLayer();
      },
      resize: api.resize,
    };

    showLayer();
    requestAnimationFrame(() => {
      showLayer();
      setTimeout(showLayer, 120);
      setTimeout(showLayer, 600);
    });
    try {
      window.dispatchEvent(new CustomEvent('cup3d-ready'));
    } catch (_) {}
    console.log('[CupShake3D] ready roll-feel v1.4.8');
  } catch (e) {
    console.error('[CupShake3D] failed', e);
    window.CupShake3D = { ready: false, play: async () => {}, hide() {}, error: String(e) };
    try {
      window.dispatchEvent(new CustomEvent('cup3d-failed'));
    } catch (_) {}
  }
}

boot();
