/**
 * Cup shake — roulette-style whole-object motion on #cupStereo.
 * Visual cup+white dice come from the plate image (cup-screen-hero),
 * clipped to an ellipse so the outer red cloth stays put under the feed.
 * No foggy Three.js dice overlay (that was the garbage stack).
 */
const SHAKE_MS = 4800;
const SETTLE_MS = 200;

function setCupStereoTransform(el, txPct, tyPct) {
  if (!el) return;
  el.style.transform = `scale(1.12) translate3d(${txPct}%, ${tyPct}%, 0)`;
}

function boot() {
  window.CupShake3D = window.CupShake3D || { ready: false, play: async () => {}, hide() {} };
  const stereo = document.getElementById('cupStereo');
  if (stereo) {
    stereo.classList.add('is-on');
    setCupStereoTransform(stereo, 0, 0);
  }
  let shaking = false;

  async function play(_faces) {
    if (shaking) return;
    shaking = true;
    if (stereo) stereo.classList.add('is-shaking');
    const t0 = performance.now();
    await new Promise((resolve) => {
      function step(now) {
        const u = Math.min(1, (now - t0) / SHAKE_MS);
        const env = u < 0.75 ? 1 : Math.sin(((1 - (u - 0.75) / 0.25) * Math.PI) / 2);
        const hz = 16.5 - u * 5.5;
        const phase = u * hz * Math.PI * 2;
        const txPct = Math.sin(phase * 1.25) * 1.15 * env;
        const tyPct = -Math.abs(Math.sin(phase)) * 7.2 * env;
        setCupStereoTransform(stereo, txPct, tyPct);
        if (u < 1) requestAnimationFrame(step);
        else {
          setCupStereoTransform(stereo, 0, 0);
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    if (stereo) stereo.classList.remove('is-shaking');
    setCupStereoTransform(stereo, 0, 0);
    shaking = false;
  }

  window.CupShake3D = {
    ready: true,
    play,
    hide() {
      if (stereo) {
        stereo.classList.add('is-on');
        setCupStereoTransform(stereo, 0, 0);
      }
    },
    resize() {},
  };
  try {
    window.dispatchEvent(new CustomEvent('cup3d-ready'));
  } catch (_) {}
  console.log('[CupShake3D] ready plate-clip shake (no WebGL dice overlay)');
}

boot();
