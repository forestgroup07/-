'use strict';

/**
 * Live WS smoke: auth → bet → cancel_round → expect refund balance.
 * Requires server on :3050 with USE_MEMORY_DB and short betting window.
 */
const WebSocket = require('ws');

const ws = new WebSocket('ws://127.0.0.1:3050');
let balance0 = null;
let betDone = false;

ws.on('message', (buf) => {
  const m = JSON.parse(String(buf));
  if (m.type === 'hello') {
    ws.send(JSON.stringify({ type: 'auth', token: 'demo-godot-token' }));
  }
  if (m.type === 'auth_result' && m.ok) {
    balance0 = m.balance;
    console.log('balance0', balance0);
  }
  if (m.type === 'state' && m.phase === 'betting' && balance0 != null && !betDone) {
    betDone = true;
    ws.send(JSON.stringify({ type: 'bet', betType: 'big', amount: 100 }));
  }
  if (m.type === 'bet_result') {
    console.log('bet', m.ok, m.balance, m.error || '');
    if (!m.ok) {
      console.error('bet failed');
      process.exit(1);
    }
    ws.send(
      JSON.stringify({
        type: 'cancel_round',
        cancelToken: 'sicbo-cancel-token',
        reason: 'network',
      })
    );
  }
  if (m.type === 'round_cancelled') {
    console.log('cancelled', m.reason, 'refunds', m.refunds);
    const bal = m.refunds[0] && m.refunds[0].balance;
    if (bal !== balance0) {
      console.error('refund mismatch', bal, 'vs', balance0);
      process.exit(1);
    }
    console.log('test-cancel: OK');
    ws.close();
    process.exit(0);
  }
  if (m.type === 'cancel_result' && m.ok === false) {
    console.error('cancel_result', m);
    process.exit(1);
  }
});

setTimeout(() => {
  console.error('timeout');
  process.exit(1);
}, 20000);
