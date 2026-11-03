'use strict';

const { WebSocketServer } = require('ws');
const db = require('./db');
const { effectivePlayLimits } = require('./limits');

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function createWsHub({ port, engine, demoToken, cancelToken }) {
  const wss = new WebSocketServer({ port });
  const clients = new Set();

  function broadcast(msg) {
    const raw = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(raw);
    }
  }

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.user = null;

    send(ws, {
      type: 'hello',
      protocol: 1,
      auth: 'send {"type":"auth","token":"..."}',
      demoTokenHint: demoToken,
    });
    send(ws, engine.snapshot());

    ws.on('message', async (buf) => {
      let msg;
      try {
        msg = JSON.parse(String(buf));
      } catch {
        send(ws, { type: 'error', error: 'invalid_json' });
        return;
      }

      try {
        await handleMessage(ws, msg, { engine, broadcast, cancelToken });
      } catch (err) {
        console.error('[ws]', err);
        send(ws, { type: 'error', error: 'server_error', detail: String(err.message || err) });
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  return { wss, broadcast, clients };
}

async function handleMessage(ws, msg, { engine, cancelToken }) {
  const type = msg.type;

  if (type === 'ping') {
    send(ws, { type: 'pong', t: Date.now() });
    return;
  }

  if (type === 'auth') {
    const user = await db.findUserByToken(String(msg.token || ''));
    if (!user) {
      send(ws, { type: 'auth_result', ok: false, error: 'invalid_token' });
      return;
    }
    ws.user = user;
    await engine.ensureTable();
    const playLimits = effectivePlayLimits(user, engine.table);
    send(ws, {
      type: 'auth_result',
      ok: true,
      userId: user.id,
      username: user.username,
      balance: Number(user.balance),
      betMin: Number(user.bet_min),
      betMax: Number(user.bet_max),
      playLimits,
    });
    send(ws, engine.snapshot(user));
    return;
  }

  if (type === 'get_state') {
    send(ws, engine.snapshot(ws.user));
    return;
  }

  if (type === 'bet') {
    if (!ws.user) {
      send(ws, { type: 'bet_result', ok: false, error: 'unauthorized' });
      return;
    }
    // refresh balance from DB
    const fresh = await db.findUserByToken(ws.user.token);
    if (!fresh) {
      send(ws, { type: 'bet_result', ok: false, error: 'user_missing' });
      return;
    }
    ws.user = fresh;
    const result = await engine.placeBet(ws.user, {
      betType: msg.betType,
      amount: msg.amount,
    });
    send(ws, { type: 'bet_result', ...result });
    return;
  }

  // D4: 运维/故障取消整局（需 cancelToken）
  if (type === 'cancel_round') {
    const token = String(msg.cancelToken || msg.token || '');
    if (!cancelToken || token !== cancelToken) {
      send(ws, { type: 'cancel_result', ok: false, error: 'forbidden' });
      return;
    }
    const result = await engine.cancelRound(msg.reason || 'network');
    send(ws, { type: 'cancel_result', ...result });
    return;
  }

  // D5: 实况贴边/重叠 → 重摇（需 cancelToken；不退注）
  if (type === 'reshake' || type === 'invalid_dice') {
    const token = String(msg.cancelToken || msg.token || '');
    if (!cancelToken || token !== cancelToken) {
      send(ws, { type: 'reshake_result', ok: false, error: 'forbidden' });
      return;
    }
    const result = engine.requestReshake(msg.reason || 'edge');
    send(ws, { type: 'reshake_result', ...result });
    return;
  }

  send(ws, { type: 'error', error: 'unknown_type', got: type });
}

module.exports = { createWsHub };
