'use strict';

require('dotenv').config();

const db = require('./db');
const { GameEngine } = require('./engine');
const { createWsHub } = require('./wsHub');

const PORT = Number(process.env.PORT || 3050);
const DEMO_TOKEN = process.env.DEMO_TOKEN || 'demo-godot-token';
const CANCEL_TOKEN = process.env.CANCEL_TOKEN || 'sicbo-cancel-token';

async function boot() {
  console.log('[sicbo] ping MySQL...');
  await db.ping();
  console.log('[sicbo] MySQL ok');

  const bridge = { broadcast: () => {} };

  const engine = new GameEngine((msg) => bridge.broadcast(msg), {
    bettingSeconds: process.env.BETTING_SECONDS,
    rollingSeconds: process.env.ROLLING_SECONDS,
    settleSeconds: process.env.SETTLE_SECONDS,
  });

  const hub = createWsHub({
    port: PORT,
    engine,
    demoToken: DEMO_TOKEN,
    cancelToken: CANCEL_TOKEN,
  });
  bridge.broadcast = hub.broadcast;

  engine.start();
  console.log(`[sicbo] WebSocket listening on ws://127.0.0.1:${PORT}`);
  console.log(`[sicbo] demo token: ${DEMO_TOKEN}`);
  console.log('[sicbo] cancel: {"type":"cancel_round","cancelToken":"...","reason":"network"}');
}

boot().catch((err) => {
  console.error('[sicbo] failed to start:', err.message || err);
  console.error('Hint: copy .env.example → .env, create MySQL user/db, run: npm run init-db');
  process.exit(1);
});
