/**
 * Clean roulette-style shake: welded plate PNG on #diceSpin, CSS transform only.
 * No cutout dice overlay (that produced ghost/blur garbage).
 *
 * Idle: videoFeed = cup-screen-hero, #cupStereo hidden.
 * Shake: feed → static red; #diceSpin shows same plate and bounces (cup+dice together).
 */
const SHAKE_MS = 4800;
const SETTLE_MS = 280;
const PLATE_SRC = 'assets/eu-concept/cup-screen-hero.jpg?v=1.4.8';
const RED_SRC = 'assets/eu-concept/cup-well-red.jpg?v=1.4.8';

function setDiceSpinTransform(spinEl, txPct, tyPct, rotDeg) {
  if (!spinEl) return;
  spinEl.style.transition = 'none';
  spinEl.style.transform =
    'translate3d(' + txPct + '%, ' + tyPct + '%, 0) rotate(' + (rotDeg || 0) + 'deg)';
}

function boot() {
  window.CupShake3D = window.CupShake3D || { ready: false, play: async () => {}, hide() {} };
  const stereo = document.getElementById('cupStereo');
  const diceSpin = document.getElementById('diceSpin');
  const disc = document.getElementById('diceDisc') || document.getElementById('cupDisc');
  const layer = document.getElementById('cup3dLayer');
  const feed = document.getElementById('videoFeed');

  if (layer) {
    layer.classList.remove('is-on');
    layer.style.display = 'none';
    layer.setAttribute('aria-hidden', 'true');
  }
  if (stereo) {
    stereo.classList.remove('is-on', 'is-shaking');
    stereo.setAttribute('aria-hidden', 'true');
  }
  if (diceSpin) setDiceSpinTransform(diceSpin, 0, 0, 0);
  if (disc) {
    disc.className = 'cup-3d-disc';
    disc.src = PLATE_SRC;
  }
  if (feed) feed.src = PLATE_SRC;

  let shaking = false;

  async function play(_faces) {
    if (shaking) return;
    shaking = true;

    const feedPrev = feed ? feed.getAttribute('src') : '';
    if (feed) feed.src = RED_SRC;
    if (disc) disc.src = PLATE_SRC;
    if (stereo) {
      stereo.classList.add('is-on', 'is-shaking');
      stereo.setAttribute('aria-hidden', 'false');
    }
    if (diceSpin) {
      setDiceSpinTransform(diceSpin, 0, 0, 0);
      void diceSpin.offsetWidth;
    }

    const t0 = performance.now();
    await new Promise((resolve) => {
      function step(now) {
        const u = Math.min(1, (now - t0) / SHAKE_MS);
        const env = u < 0.72 ? 1 : Math.sin(((1 - (u - 0.72) / 0.28) * Math.PI) / 2);
        const hz = 17 - u * 6.5;
        const phase = u * hz * Math.PI * 2;
        const txPct = Math.sin(phase * 1.3) * 1.5 * env;
        const tyPct = -Math.abs(Math.sin(phase)) * 10.5 * env;
        const rot = Math.sin(phase * 0.85) * 2.2 * env;
        setDiceSpinTransform(diceSpin, txPct, tyPct, rot);
        if (u < 1) requestAnimationFrame(step);
        else {
          setDiceSpinTransform(diceSpin, 0, 0, 0);
          resolve();
        }
      }
      requestAnimationFrame(step);
    });

    if (diceSpin) {
      diceSpin.style.transition =
        'transform ' + SETTLE_MS + 'ms cubic-bezier(0.15, 0.75, 0.25, 1)';
      diceSpin.style.transform = 'translate3d(0,0,0) rotate(0deg)';
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS + 40));
    if (diceSpin) {
      diceSpin.style.transition = 'none';
      setDiceSpinTransform(diceSpin, 0, 0, 0);
    }

    if (stereo) {
      stereo.classList.remove('is-on', 'is-shaking');
      stereo.setAttribute('aria-hidden', 'true');
    }
    if (feed) feed.src = feedPrev && feedPrev.indexOf('cup-screen-hero') >= 0 ? feedPrev : PLATE_SRC;
    shaking = false;
  }

  window.CupShake3D = {
    ready: true,
    play,
    hide() {
      if (layer) {
        layer.classList.remove('is-on');
        layer.style.display = 'none';
      }
      if (stereo) {
        stereo.classList.remove('is-on', 'is-shaking');
        stereo.setAttribute('aria-hidden', 'true');
      }
      if (diceSpin) setDiceSpinTransform(diceSpin, 0, 0, 0);
      if (feed && String(feed.src || '').indexOf('cup-well-red') >= 0) {
        feed.src = PLATE_SRC;
      }
    },
    resize() {},
  };
  try {
    window.dispatchEvent(new CustomEvent('cup3d-ready'));
  } catch (_) {}
  console.log('[CupShake3D] ready clean plate bounce (no cutout dice)');
}

boot();
