/**
 * 麻将专用：两颗立体骰（自骰宝只读复制外形/物理骨架，另调桌面轻滚）。
 * 透明底、无骰盅；不改骰宝任何文件。
 * window.MahjongDice3D = { ready, play([d1,d2]), showIdle, hide, resize }
 * Opposite faces: 1↔6, 2↔5, 3↔4.
 * ?mjDiceDebug=1 显示校准圈。
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const FACE_VER = 'mj-forward-roll-0.4.8';
/** 学 Lottie：连续翻滚，几乎不抖层 */
const VIS_PLATE_Y_PX = 0;
const VIS_PLATE_X_PX = 0;
/* 更快、单一方向向前贴桌连翻；点数开局锁死 */
const SHAKE_MS = 3200;
const SETTLE_U0 = 0.78;
const BALL_EASE_P = 2.0;
const FLOOR_SLIDE_FRIC = 0.72;
const FLOOR_SPIN_FRIC = 0.85;

/*
 * 世界尺度沿用骰宝骰子大小；桌面无盅，贴地滚动。
 */
const PAD_R = 0.78;
const DIE = 0.36;
const DIE_RADIUS = DIE * 0.26;
const DIE_SEG = 6;
/* 球近似互撞半径；贴地时改用盒距 LAND_MIN，才像实心方骰 */
const DIE_COL_R = DIE * 0.58;
const LAND_MIN = DIE * 1.28;
const WALL_R = Math.max(0.12, PAD_R - DIE_COL_R);
const CEIL_H = 0.28; /* 几乎不离桌 */
const GRAVITY = 16;
const FLOOR_REST = 0.12;
const WALL_REST = 0.55;
const PLATE_KICK = 0.08; /* 几乎不踢飞 */
const DIE_TIP_X = (3 * Math.PI) / 180;

/* 更俯视，看起来像在麻将桌上滚 */
const CAM_POS = [0, 6.4, 4.0];
const CAM_LOOK = [0, 0.12, 0];
const CAM_FOV = 34;

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
    return new URLSearchParams(location.search).get('mjDiceDebug') === '1';
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
    console.log('[MahjongDice3D] CALIB', {
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

  /* 两骰并排闲置（麻将无盅） */
  const idleGap = DIE * 1.35;
  const spots = [
    new THREE.Vector3(-idleGap * 0.5, DIE_REST_Y, backZ),
    new THREE.Vector3(idleGap * 0.5, DIE_REST_Y, backZ),
  ];

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
      for (let a = 0; a < 2; a++) {
        for (let b = a + 1; b < 2; b++) {
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
      for (let i = 0; i < 2; i++) {
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

  const idleFaces = [1, 5];
  const idleYaw = [-0.35, 0.4];
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
    /* 必须保留居中，禁止盖掉 translate(-50%,-50%) */
    const tr = `translate(-50%, -50%) translate(${px.toFixed(2)}px, ${py.toFixed(2)}px)`;
    const layer = document.getElementById('mjDice3dLayer');
    if (layer) layer.style.transform = tr;
  }
  function resetVisPlate() {
    const layer = document.getElementById('mjDice3dLayer');
    if (layer) layer.style.transform = 'translate(-50%, -50%)';
  }

  function setIdleFaces(faces) {
    const f = (faces || idleFaces).map((n) => Math.max(1, Math.min(6, n | 0)));
    dice.forEach((d, i) => {
      d.position.copy(spots[i]);
      d.quaternion.copy(quatFaceUp(f[i] || 1, idleYaw[i]));
    });
    renderer.render(scene, camera);
  }

  const frozenMark = [false, false];
  function freezeDie(i, pos, vel, spin, toQuat) {
    frozenMark[i] = true;
    pos[i].y = DIE_REST_Y;
    vel[i].set(0, 0, 0);
    spin[i].set(0, 0, 0);
    dice[i].position.copy(pos[i]);
    dice[i].quaternion.copy(toQuat[i]);
  }

  /**
   * 学用户 Lottie「Rolling Dice Loop」：贴桌连续翻滚数秒，全程同一白骰；
   * 结果面开局锁死，末段收面，不换模型。
   */
  async function play(faces) {
    if (shaking) return;
    shaking = true;
    resize();
    resetVisPlate();
    const f = (faces || [1, 2]).map((n) => Math.max(1, Math.min(6, n | 0)));
    const toQuat = f.map((n) => quatFaceUp(n, rnd(-0.55, 0.55)));

    const half = DIE * 0.5;
    /* 统一向前：朝摄像机方向（+Z）直线翻滚 */
    const FORWARD = Math.PI / 2;
    const states = [0, 1].map((i) => {
      const side = i === 0 ? -1 : 1;
      const q0 = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rnd(0, Math.PI), rnd(0, Math.PI), rnd(0, Math.PI))
      );
      return {
        pos: new THREE.Vector3(side * 0.28, DIE_REST_Y, -0.52 + rnd(-0.04, 0.04)),
        quat: q0,
        heading: FORWARD,
        speed0: rnd(2.35, 2.85),
        tipPhase: rnd(0, Math.PI),
      };
    });

    for (let i = 0; i < 2; i++) {
      dice[i].position.copy(states[i].pos);
      dice[i].quaternion.copy(states[i].quat);
    }
    renderer.render(scene, camera);

    const axis = new THREE.Vector3();
    const dq = new THREE.Quaternion();

    await new Promise((resolve) => {
      const t0 = performance.now();
      let lastT = t0;
      function step(now) {
        const u = Math.min(1, (now - t0) / SHAKE_MS);
        const dt = Math.min(0.033, Math.max(0.008, (now - lastT) / 1000));
        lastT = now;

        const settleU = u <= SETTLE_U0 ? 0 : (u - SETTLE_U0) / (1 - SETTLE_U0);
        const settleEase = ballProgress(settleU);
        const moveScale = 1 - settleEase;

        for (let i = 0; i < 2; i++) {
          const st = states[i];
          /* 固定朝向，只向前，不转弯 */
          st.heading = FORWARD;
          const speed = st.speed0 * Math.max(0.05, moveScale);
          const vx = Math.cos(st.heading) * speed;
          const vz = Math.sin(st.heading) * speed;
          st.pos.x += vx * dt;
          st.pos.z += vz * dt;
          /* 保持并排，不左右晃 */
          st.pos.x = (i === 0 ? -1 : 1) * 0.28;

          /* 连续向前翻滚 */
          axis.set(-vz, 0, vx);
          if (axis.lengthSq() > 1e-8) {
            axis.normalize();
            const rollAng = (speed / half) * dt * 1.35;
            dq.setFromAxisAngle(axis, rollAng);
            st.quat.premultiply(dq);
            st.quat.normalize();
          }

          st.tipPhase += (speed / DIE) * Math.PI * dt;
          const hop = Math.abs(Math.sin(st.tipPhase)) * DIE * 0.14 * moveScale;
          st.pos.y = DIE_REST_Y + hop;

          /* 前方到顶就贴边停进，不反向乱弹 */
          const maxZ = WALL_R * 0.88;
          if (st.pos.z > maxZ) st.pos.z = maxZ;

          if (settleEase > 0) {
            st.quat.slerp(toQuat[i], 0.08 + settleEase * 0.32);
            st.pos.y = DIE_REST_Y + hop * (1 - settleEase);
          }

          dice[i].position.copy(st.pos);
          dice[i].quaternion.copy(st.quat);
        }

        /* 轻微分开，避免叠模 */
        const dx = states[0].pos.x - states[1].pos.x;
        const dz = states[0].pos.z - states[1].pos.z;
        const dist = Math.hypot(dx, dz) || 1e-5;
        if (dist < LAND_MIN) {
          const push = (LAND_MIN - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          states[0].pos.x += nx * push;
          states[0].pos.z += nz * push;
          states[1].pos.x -= nx * push;
          states[1].pos.z -= nz * push;
          dice[0].position.copy(states[0].pos);
          dice[1].position.copy(states[1].pos);
        }

        renderer.render(scene, camera);
        if (u >= 1) {
          const positions = states.map((s) => s.pos.clone());
          for (let i = 0; i < 2; i++) {
            positions[i].y = DIE_REST_Y;
          }
          separateLandXZ(positions, [true, true]);
          for (let i = 0; i < 2; i++) {
            positions[i].y = DIE_REST_Y;
            dice[i].position.copy(positions[i]);
            dice[i].quaternion.copy(toQuat[i]);
          }
          resetVisPlate();
          renderer.render(scene, camera);
          resolve();
          return;
        }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });

    shaking = false;
  }

  return { play, resize, setIdleFaces, dispose: () => { looping = false; } };
}

async function boot() {
  window.MahjongDice3D = window.MahjongDice3D || { ready: false, play: async () => {}, hide() {} };
  const canvas = document.getElementById('mjDice3dCanvas');
  const layer = document.getElementById('mjDice3dLayer');
  if (!canvas) return;
  const lite = canvas.dataset.lite === '1';
  try {
    if (layer) {
      layer.style.visibility = 'hidden';
      layer.style.opacity = '0';
      layer.style.display = 'block';
    }
    const api = await mountCupShake3D(canvas, { lite });

    function showLayer() {
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
    }

    window.MahjongDice3D = {
      ready: true,
      showIdle() {
        showLayer();
      },
      async play(faces) {
        showLayer();
        if (layer) layer.classList.add('is-shaking');
        api.resize();
        await api.play(faces);
        if (layer) layer.classList.remove('is-shaking');
        /* 停死在落点，不拽回闲置位 */
      },
      hide() {
        hideLayer();
      },
      resize: api.resize,
    };

    try {
      window.dispatchEvent(new CustomEvent('mj-dice3d-ready'));
    } catch (_) {}
    console.log('[MahjongDice3D] ready (Lottie-mimic tumble, 2 dice, random faces, no cup)');
  } catch (e) {
    console.error('[MahjongDice3D] failed', e);
    window.MahjongDice3D = { ready: false, play: async () => {}, hide() {}, error: String(e) };
    try {
      window.dispatchEvent(new CustomEvent('mj-dice3d-failed'));
    } catch (_) {}
  }
}

boot();
