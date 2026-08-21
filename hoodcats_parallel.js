require('dotenv').config({ path: '.env.hoodcats' });
const { Wallet } = require('ethers');
const fs = require('fs');

const API = 'https://onchainhoodcats.xyz/api';
const POLL_MS = Number(process.env.POLL_MS || 500);
const HEADERS = {
  'content-type': 'application/json',
  'accept': 'application/json',
  'referer': 'https://onchainhoodcats.xyz/',
  'origin': 'https://onchainhoodcats.xyz',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
};

const wallets = [];
for (let i = 1; ; i++) {
  const pk = process.env['PRIVATE_KEY_' + i];
  if (!pk) break;
  wallets.push(new Wallet(pk));
}
try {
  const env2 = fs.readFileSync('.env2', 'utf8');
  const m = env2.match(/PRIVATE_KEY\s*=\s*(0x[0-9a-fA-F]{64})/);
  if (m) wallets.push(new Wallet(m[1]));
} catch {}

if (!wallets.length) { console.error('No wallets loaded.'); process.exit(1); }

async function slot() {
  const r = await fetch(API + '/slot', { headers: HEADERS });
  return r.json();
}
async function challenge(addr) {
  const r = await fetch(API + '/challenge', {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ wallet: addr })
  });
  if (!r.ok) throw new Error('challenge ' + r.status);
  return r.json();
}
async function claim(addr, nonce, sig) {
  const r = await fetch(API + '/claim', {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ wallet: addr, nonce, signature: sig })
  });
  return { status: r.status, ok: r.ok, body: await r.text() };
}
async function attempt(w, idx, slotNum) {
  const t0 = Date.now();
  try {
    const ch = await challenge(w.address);
    const sig = await w.signMessage(ch.message);
    const res = await claim(w.address, ch.nonce, sig);
    const dt = Date.now() - t0;
    const tag = res.ok ? 'WIN' : ('L' + res.status);
    console.log('[' + new Date().toISOString() + '] W' + idx + ' slot=' + slotNum + ' ' + dt + 'ms ' + tag);
    if (!res.ok) console.log('   body:', res.body.slice(0, 200));
    if (res.ok) console.log('   SUCCESS wallet=', w.address, 'body:', res.body.slice(0, 300));
    return res.ok;
  } catch (e) {
    console.log('[' + new Date().toISOString() + '] W' + idx + ' slot=' + slotNum + ' err: ' + e.message);
    return false;
  }
}
async function walletLoop(w, idx) {
  console.log('W' + idx + ':', w.address);
  const wonSlots = new Set();
  while (true) {
    let s;
    try { s = await slot(); }
    catch { await new Promise(r=>setTimeout(r,POLL_MS)); continue; }
    if (!s.occupied && !wonSlots.has(s.slot)) {
      wonSlots.add(s.slot);
      const success = await attempt(w, idx, s.slot);
      if (success) { console.log('\n=== W' + idx + ' WON ===\n'); return; }
      await new Promise(r => setTimeout(r, 300));
    } else {
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }
}
(async () => {
  console.log('Starting', wallets.length, 'parallel wallet loops. Ctrl+C to stop.\n');
  const stagger = 150;
  const runs = wallets.map((w, i) => new Promise(r => setTimeout(() => r(walletLoop(w, i+1)), i * stagger)));
  await Promise.allSettled(runs);
  console.log('All wallets finished.');
})();
