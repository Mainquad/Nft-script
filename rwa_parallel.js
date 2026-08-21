const { Wallet, WebSocketProvider, Interface, formatEther, parseEther, getAddress } = require('ethers');
const fs = require('fs');

const CONTRACT = '0xfce5f08d3167863ad8d85735bbe8ec973dc32bcc';
const FN = 'mintFree()';
const CHAIN_ID = 4663;
const ALCHEMY_KEY = process.env.ALCHEMY_KEY || fs.readFileSync('.env','utf8').match(/ALCHEMY_KEY\s*=\s*(\S+)/)?.[1];
if (!ALCHEMY_KEY) { console.error('ALCHEMY_KEY missing'); process.exit(1); }
const WSS_URL = `wss://robinhood-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
const EXPLORER = 'https://robinhoodchain.blockscout.com';

const GAS_LIMIT = 500000n;
const TIP_MULT = BigInt(process.env.TIP_MULT || 2);

// Load all wallet PKs
const pks = [];
try {
  const env2 = fs.readFileSync('.env2', 'utf8');
  const m = env2.match(/PRIVATE_KEY\s*=\s*(0x[0-9a-fA-F]{64})/);
  if (m) pks.push({ label: 'W2', pk: m[1] });
} catch {}
try {
  const envh = fs.readFileSync('.env.hoodcats', 'utf8');
  for (let i = 1; i <= 10; i++) {
    const m = envh.match(new RegExp('PRIVATE_KEY_' + i + '\\s*=\\s*(0x[0-9a-fA-F]{64})'));
    if (m) pks.push({ label: 'W' + i + 'h', pk: m[1] });
  }
} catch {}
if (!pks.length) { console.error('No wallets found'); process.exit(1); }

const iface = new Interface([`function ${FN}`]);
const data = iface.encodeFunctionData(FN.split('(')[0], []);

async function runWallet({ label, pk }) {
  const provider = new WebSocketProvider(WSS_URL, CHAIN_ID);
  const wallet = new Wallet(pk, provider);
  const addr = getAddress(wallet.address);
  const feeData = await provider.getFeeData();
  let nonce = await provider.getTransactionCount(addr);

  console.log(`${label} ${addr} started (nonce=${nonce})`);

  let inFlight = false;
  let submitted = false;
  let attempts = 0;

  provider.on('block', async (blockNum) => {
    if (submitted || inFlight) return;
    inFlight = true;
    attempts++;
    try {
      await provider.call({ to: CONTRACT, from: addr, data, value: 0n });
      console.log(`\n[${label} block ${blockNum}] READY after ${attempts} attempts, submitting...`);
      submitted = true;
      const tx = await wallet.sendTransaction({
        to: CONTRACT, data, value: 0n,
        gasLimit: GAS_LIMIT,
        maxFeePerGas: feeData.maxFeePerGas * TIP_MULT,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas * TIP_MULT,
        nonce
      });
      console.log(`[${label}] SUBMITTED ${tx.hash}`);
      console.log(`  ${EXPLORER}/tx/${tx.hash}`);
      const r = await tx.wait();
      if (r.status === 1) {
        // Decode Transfer(from=0x0, to=addr)
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const zeroTopic = '0x' + '00'.repeat(32);
        const addrTopic = '0x000000000000000000000000' + addr.slice(2).toLowerCase();
        const mints = r.logs.filter(l => l.topics[0] === transferTopic && l.topics[1] === zeroTopic && l.topics[2].toLowerCase() === addrTopic);
        for (const l of mints) {
          const id = BigInt(l.topics[3]).toString();
          console.log(`\n=== ${label} WON #${id} ===\n  ${EXPLORER}/token/${l.address}?a=${id}\n`);
        }
        if (!mints.length) console.log(`[${label}] confirmed but no Transfer event decoded`);
      } else {
        console.log(`[${label}] post-submit REVERT — lost in-block, resetting to try again`);
        submitted = false;
        nonce = await provider.getTransactionCount(addr);
      }
    } catch (e) {
      const rev = e.data || e.info?.error?.data || '';
      const label2 = rev === '0x5273678a' ? 'DripNotReady' : rev === '0x0cf12681' ? 'CapReached' : (rev.slice(0,10) || 'err');
      if (attempts % 20 === 0) process.stdout.write(`\r${label}:${attempts}(${label2})    `);
      if (label2 === 'CapReached') {
        console.log(`\n[${label}] AllocationCapReached — global cap hit, stopping this wallet.`);
        provider.destroy();
        process.exit(2);
      }
    } finally {
      inFlight = false;
    }
  });

  provider.websocket.onclose = () => console.error(`${label} WSS closed`);
}

(async () => {
  console.log(`Starting ${pks.length} parallel RWA sniper wallets on Robinhood.\n`);
  for (let i = 0; i < pks.length; i++) {
    setTimeout(() => runWallet(pks[i]).catch(e => console.error(pks[i].label, e.message)), i * 200);
  }
})();
