/**
 * Forest 统一钱包同步：骰宝 PC/手机、轮盘共用 api/sicbo-account.php 的 balance。
 *
 * 硬规则：
 * 1) 水合完成前，禁止把「开页时的旧本机余额」POST 上去（防电脑旧缓存盖手机赢款）
 * 2) 水合拉取期间若本机已因下注改过余额，禁止服务器旧值盖回来，改为把本机新余额推上去
 * 3) 服务器已有记录且本机未脏写时，以服务器余额为准
 * 4) 关页 / 切后台 keepalive 刷出；回前台重拉服务器余额
 */
(function (root) {
  'use strict';

  var API = 'api/sicbo-account.php';

  function balKeyFor(user) {
    return 'fg_sicbo_bal::' + String(user || 'asdg').trim().toLowerCase();
  }

  function create(opts) {
    opts = opts || {};
    var api = opts.api || API;
    var bagKey = opts.bagKey || '__fgWalletPatch';
    var user = String(opts.user || 'asdg').trim() || 'asdg';
    var ready = false;
    var hydrated = false;
    var timer = 0;
    var writeGen = 0; /* writeLocal 代数：水合中途下注可侦测 */
    var START_BAL = opts.startBal != null ? opts.startBal : 2000;
    var lastServerUpdatedAt = 0;

    function bag() {
      if (!root[bagKey]) root[bagKey] = {};
      return root[bagKey];
    }

    function setUser(u) {
      user = String(u || 'asdg').trim() || 'asdg';
    }

    function readLocal() {
      try {
        var raw = localStorage.getItem(balKeyFor(user));
        if (raw == null || raw === '') raw = localStorage.getItem('fg_sicbo_balance');
        if (raw == null || raw === '') return null;
        var n = Math.round(Number(raw));
        return Number.isFinite(n) && n >= 0 ? n : null;
      } catch (_) {
        return null;
      }
    }

    function writeLocal(n) {
      var v = Math.max(0, Math.round(Number(n) || 0));
      try {
        localStorage.setItem(balKeyFor(user), String(v));
        localStorage.setItem('fg_sicbo_balance', String(v));
        localStorage.setItem('fg_sicbo_last_user', user);
      } catch (_) {}
      writeGen += 1;
      return v;
    }

    function post(partial, keepalive) {
      var bodyObj = Object.assign({ user: user }, partial || {});
      var body = JSON.stringify(bodyObj);
      return fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        cache: 'no-store',
        keepalive: !!keepalive,
      }).then(function (r) {
        if (!r.ok) return null;
        return r.json().then(function (j) {
          if (j && j.ok && j.data && (j.data.updatedAt | 0) > 0) {
            lastServerUpdatedAt = j.data.updatedAt | 0;
          }
          return j && j.ok ? j.data : null;
        }).catch(function () { return null; });
      }).catch(function () { return null; });
    }

    function schedule(partial) {
      var p = Object.assign({}, partial || {});
      /* 水合前丢掉 balance，绝不用本机旧值去盖服务器 */
      if (!hydrated && Object.prototype.hasOwnProperty.call(p, 'balance')) {
        delete p.balance;
      }
      var keys = Object.keys(p);
      if (!keys.length) return;
      Object.assign(bag(), p);
      if (!ready) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = 0;
        flush(false);
      }, 280);
    }

    function flush(keepalive) {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      var patch = bag();
      if (!hydrated && Object.prototype.hasOwnProperty.call(patch, 'balance')) {
        delete patch.balance;
      }
      var keys = Object.keys(patch);
      if (!keys.length) {
        root[bagKey] = {};
        return Promise.resolve(null);
      }
      root[bagKey] = {};
      return post(patch, keepalive);
    }

    function dropPendingBalance() {
      var b = bag();
      if (b && Object.prototype.hasOwnProperty.call(b, 'balance')) delete b.balance;
    }

    function setReady(on) {
      ready = !!on;
      if (ready) flush(false);
    }

    function isReady() {
      return ready;
    }

    function isHydrated() {
      return hydrated;
    }

    function markHydrated() {
      hydrated = true;
    }

    /** 拉取服务器账户；有服务器记录时强制用服务器余额（水合中途本机已改除外） */
    function hydrate() {
      var genAtStart = writeGen;
      return fetch(api + '?user=' + encodeURIComponent(user), { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('http');
          return r.json();
        })
        .then(function (j) {
          if (!j || !j.ok || !j.data) throw new Error('bad');
          var d = j.data;
          var hasServer = (d.updatedAt | 0) > 0
            || (d.balance != null && Number(d.balance) !== START_BAL)
            || (Array.isArray(d.betlog) && d.betlog.length)
            || (Array.isArray(d.roadhist) && d.roadhist.length);
          var localBal = readLocal();
          var balance = localBal != null ? localBal : START_BAL;
          var fromServer = false;
          var dirtyDuringFetch = writeGen !== genAtStart;
          if (!hasServer) {
            /* 真正的首次：把本机余额建档；建档完成才算水合 */
            return post({ balance: balance }).then(function () {
              writeLocal(balance);
              dropPendingBalance();
              hydrated = true;
              setReady(true);
              return { balance: balance, doc: d, fromServer: false };
            });
          }
          /* 水合等待期间手机已下注改余额：推本机，禁止服务器旧值盖掉输赢 */
          if (dirtyDuringFetch && localBal != null) {
            balance = localBal;
            writeLocal(balance);
            if ((d.updatedAt | 0) > 0) lastServerUpdatedAt = d.updatedAt | 0;
            dropPendingBalance();
            hydrated = true;
            setReady(true);
            return post({ balance: balance }, true).then(function () {
              return { balance: balance, doc: d, fromServer: false, pushedLocal: true };
            });
          }
          if (d.balance != null) {
            balance = Math.max(0, Math.round(Number(d.balance)) || 0);
            writeLocal(balance);
            fromServer = true;
          }
          if ((d.updatedAt | 0) > 0) lastServerUpdatedAt = d.updatedAt | 0;
          dropPendingBalance();
          hydrated = true;
          setReady(true);
          return { balance: balance, doc: d, fromServer: fromServer };
        })
        .catch(function () {
          /* 离线：允许用本机继续玩并在恢复后上传 */
          hydrated = true;
          setReady(true);
          var localBal = readLocal();
          return {
            balance: localBal != null ? localBal : START_BAL,
            doc: null,
            fromServer: false,
          };
        });
    }

    /** 仅刷新余额（切回前台用） */
    function pullBalance() {
      return fetch(api + '?user=' + encodeURIComponent(user), { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('http');
          return r.json();
        })
        .then(function (j) {
          if (!j || !j.ok || !j.data || j.data.balance == null) return null;
          if ((j.data.updatedAt | 0) > 0) lastServerUpdatedAt = j.data.updatedAt | 0;
          var n = Math.max(0, Math.round(Number(j.data.balance)) || 0);
          writeLocal(n);
          return n;
        })
        .catch(function () { return null; });
    }

    function bindLifecycle(handlers) {
      handlers = handlers || {};
      var hiding = false;
      function onHide() {
        if (hiding) return;
        hiding = true;
        try { if (handlers.onHide) handlers.onHide(); } catch (_) {}
        try { flush(true); } catch (_) {}
        setTimeout(function () { hiding = false; }, 0);
      }
      function onShow() {
        try { if (handlers.onShow) handlers.onShow(); } catch (_) {}
      }
      root.addEventListener('pagehide', onHide, true);
      root.addEventListener('beforeunload', onHide, true);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') onHide();
        else onShow();
      });
    }

    return {
      api: api,
      setUser: setUser,
      balKeyFor: balKeyFor,
      readLocal: readLocal,
      writeLocal: writeLocal,
      post: post,
      schedule: schedule,
      flush: flush,
      dropPendingBalance: dropPendingBalance,
      setReady: setReady,
      isReady: isReady,
      isHydrated: isHydrated,
      markHydrated: markHydrated,
      hydrate: hydrate,
      pullBalance: pullBalance,
      bindLifecycle: bindLifecycle,
      getLastServerUpdatedAt: function () { return lastServerUpdatedAt; },
    };
  }

  root.FgWallet = {
    API: API,
    balKeyFor: balKeyFor,
    create: create,
  };
})(window);
