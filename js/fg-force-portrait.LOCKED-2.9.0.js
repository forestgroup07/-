/* 骰宝/轮盘/百家乐：横屏限制
   - 横屏：半透明遮罩「请竖屏游玩」+ 禁点
   - 回竖屏：遮罩自动消失
   - 不旋转页面；不用于大厅 / 麻将 / 登录页 */
(function (global) {
  'use strict';
  var MASK_ID = 'fg-portrait-mask';
  var STYLE_ID = 'fg-force-portrait-css';

  function pageEnabled() {
    try {
      var p = String(location.pathname || '');
      var href = String(location.href || '');
      return /(?:^|\/)(game-m|roulette-m-boot|roulette-m|baccarat-m)\.html(?:\?|#|$)/.test(p) ||
        /(?:^|\/|%2F)(game-m|roulette-m-boot|roulette-m|baccarat-m)\.html/i.test(href);
    } catch (_) {
      return false;
    }
  }

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + MASK_ID + '{',
      'position:fixed;inset:0;z-index:2147483646;',
      'display:none;align-items:center;justify-content:center;',
      'flex-direction:column;gap:18px;',
      'background:rgba(0,0,0,.82);',
      'color:#f2f2f2;text-align:center;',
      'font:600 17px/1.45 "PingFang SC","Noto Sans SC",sans-serif;',
      'letter-spacing:.06em;user-select:none;',
      '-webkit-tap-highlight-color:transparent;',
      'touch-action:none;cursor:default;',
      '}',
      '#' + MASK_ID + '.is-on{display:flex;}',
      '#' + MASK_ID + ' .fg-phone{',
      'width:52px;height:88px;border:3px solid #f2f2f2;border-radius:10px;',
      'position:relative;box-sizing:border-box;',
      'animation:fg-phone-tilt 1.25s ease-in-out infinite;',
      '}',
      '#' + MASK_ID + ' .fg-phone::after{',
      'content:"";position:absolute;left:50%;bottom:8px;',
      'width:18px;height:3px;margin-left:-9px;border-radius:2px;background:#f2f2f2;',
      '}',
      '#' + MASK_ID + ' .fg-tip{padding:0 24px;}',
      '@keyframes fg-phone-tilt{',
      '0%,100%{transform:rotate(0deg);}',
      '35%{transform:rotate(90deg);}',
      '65%{transform:rotate(90deg);}',
      '}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  function ensureMask() {
    var el = document.getElementById(MASK_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = MASK_ID;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="fg-phone" aria-hidden="true"></div><div class="fg-tip">请竖屏游玩</div>';
    function block(e) {
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      return false;
    }
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(function (t) {
      el.addEventListener(t, block, true);
    });
    el.addEventListener('touchstart', block, { capture: true, passive: false });
    el.addEventListener('touchmove', block, { capture: true, passive: false });
    el.addEventListener('touchend', block, { capture: true, passive: false });
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function clearOrientStyles() {
    try {
      var root = document.getElementById('app') || document.getElementById('boot') ||
        document.querySelector('.fg-orient-root');
      if (root) {
        root.style.cssText = '';
        root.classList.remove('fg-orient-forced', 'fg-orient-root');
      }
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    } catch (_) {}
  }

  function isLandscape() {
    var w = Math.round(document.documentElement.clientWidth || global.innerWidth || 0);
    var h = Math.round(document.documentElement.clientHeight || global.innerHeight || 0);
    if (w < 1 || h < 1) {
      var vv = global.visualViewport;
      w = Math.round((vv && vv.width) || 0);
      h = Math.round((vv && vv.height) || 0);
    }
    if (w < 1 || h < 1) return false;
    return w > h;
  }

  function apply() {
    if (!pageEnabled()) return;
    clearOrientStyles();
    injectCss();
    var mask = ensureMask();
    if (isLandscape()) {
      mask.classList.add('is-on');
      mask.setAttribute('aria-hidden', 'false');
    } else {
      mask.classList.remove('is-on');
      mask.setAttribute('aria-hidden', 'true');
    }
  }

  function bind() {
    if (!pageEnabled()) return;
    apply();
    global.addEventListener('resize', apply);
    global.addEventListener('orientationchange', function () {
      setTimeout(apply, 50);
      setTimeout(apply, 220);
    });
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', apply);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})(window);
