require('dotenv').config({ path: process.argv[2] || '.env' });
const { Wallet, JsonRpcProvider, Contract } = require('ethers');

const API = 'https://onchainhoodcats.xyz/api';
const CONTRACT = '0x50B3Ae2aA3BD9c7BD1a5a82F1d01121D83a09d0a';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const ABI = [
  'function freeMint((address minter,uint256 nonce,uint256 deadline),bytes)',
  'function freeMinted(address) view returns(bool)',
  'function totalSupply() view returns(uint256)'
];
const POLL_MS = Number(process.env.POLL_MS || 500);
const HEADERS = {
  'content-type': 'application/json',
  'accept': 'application/json',
  'referer': 'https://onchainhoodcats.xyz/',
  'origin': 'https://onchainhoodcats.xyz',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
};

const provider = new JsonRpcProvider(RPC, 4663, { staticNetwork: true });
const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
const AGENT = wallet.address;
const contract = new Contract(CONTRACT, ABI, wallet);

async function slot() {
  const r = await fetch(API + '/slot', { headers: HEADERS });
  return r.json();
}
async function challenge() {
  const r = await fetch(API + '/challenge', {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ wallet: AGENT })
  });
  if (!r.ok) throw new Error('challenge ' + r.status);
  return r.json();
}
async function claim(nonce, signature) {
  const r = await fetch(API + '/claim', {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ wallet: AGENT, nonce, signature })
  });
  return { status: r.status, ok: r.ok, body: await r.text() };
}

async function attempt() {
  const t0 = Date.now();
  try {
    const ch = await challenge();
    const t1 = Date.now();
    const sig = await wallet.signMessage(ch.message);
    const t2 = Date.now();
    const res = await claim(ch.nonce, sig);
    const t3 = Date.now();
    if (!res.ok) {
      console.log('\n[' + new Date().toISOString() + '] ticket L' + res.status + ' (c:' + (t1-t0) + 'ms s:' + (t2-t1) + 'ms cl:' + (t3-t2) + 'ms)');
      console.log('  body:', res.body.slice(0, 200));
      return false;
    }
    const won = JSON.parse(res.body);
    console.log('\n[' + new Date().toISOString() + '] TICKET WON slot=' + won.slot + ' deadline=' + won.ticket.deadline + ' (c:' + (t1-t0) + 'ms s:' + (t2-t1) + 'ms cl:' + (t3-t2) + 'ms)');
    // Now submit the on-chain tx
    const tx = await contract.freeMint(
      [won.ticket.minter, won.ticket.nonce, won.ticket.deadline],
      won.signature
    );
    console.log('  submitted:', tx.hash);
    console.log('  ' + EXPLORER + '/tx/' + tx.hash);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      console.log('\n=== MINT CONFIRMED block=' + receipt.blockNumber + ' ===');
      return true;
    }
    console.log('  tx reverted, status:', receipt.status);
    return false;
  } catch (e) {
    console.log('\n[' + new Date().toISOString() + '] err:', e.shortMessage || e.message);
    return false;
  }
}

(async () => {
  console.log('Wallet :', AGENT);
  // Check if already minted
  const already = await contract.freeMinted(AGENT);
  if (already) {
    console.log('This wallet has already free-minted a cat. Exiting.');
    process.exit(0);
  }
  console.log('Free mint available. Polling every', POLL_MS, 'ms.\n');

  let lastSlot = -1, lastOccupied = null;
  while (true) {
    let s;
    try { s = await slot(); }
    catch { await new Promise(r=>setTimeout(r,POLL_MS)); continue; }

    if (s.slot !== lastSlot || s.occupied !== lastOccupied) {
      process.stdout.write('\r  slot ' + s.slot + ' occupied=' + s.occupied + ' nextIn=' + s.remainingMs + 'ms   ');
      lastSlot = s.slot; lastOccupied = s.occupied;
    }

    if (!s.occupied) {
      const won = await attempt();
      if (won) { console.log('DONE.'); process.exit(0); }
      await new Promise(r => setTimeout(r, 500));
    } else {
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
