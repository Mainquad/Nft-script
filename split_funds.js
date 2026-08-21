require('dotenv').config({ path: '.env' });
const { Wallet, JsonRpcProvider, formatEther, parseEther } = require('ethers');
const fs = require('fs');
const readline = require('readline');
const CHAINS = require('./lib/chains');

const chainName = process.argv[2];
const reserveEth = process.argv[3] || '0.0001'; // ETH to leave on source

if (!chainName || !CHAINS[chainName]) {
  console.error('Usage: node split_funds.js <chain> [reserveEth]');
  console.error('  chains:', Object.keys(CHAINS).join(', '));
  console.error('  reserveEth defaults to 0.0001 (leaves this much on wallet #1)');
  process.exit(1);
}
const chain = CHAINS[chainName];

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, a => { rl.close(); r(a); }));
}

// Load destination addresses from .env.hoodcats
function loadDests() {
  if (!fs.existsSync('.env.hoodcats')) {
    console.error('.env.hoodcats not found. Run gen_hoodcats_wallets.js first.');
    process.exit(1);
  }
  const txt = fs.readFileSync('.env.hoodcats', 'utf8');
  const addrs = [];
  for (let i = 1; ; i++) {
    const m = txt.match(new RegExp('ADDRESS_' + i + '\\s*=\\s*(0x[0-9a-fA-F]{40})'));
    if (!m) break;
    addrs.push(m[1]);
  }
  return addrs;
}

(async () => {
  const provider = new JsonRpcProvider(chain.rpc);
  const src = new Wallet(process.env.PRIVATE_KEY, provider);
  const dests = loadDests();

  console.log('Chain     :', chainName, '(id ' + chain.chainId + ')');
  console.log('Source    :', src.address);
  console.log('Reserve   :', reserveEth, 'ETH');
  console.log('Dests     :', dests.length);
  dests.forEach((a, i) => console.log('  #' + (i+1), a));

  const net = await provider.getNetwork();
  if (Number(net.chainId) !== chain.chainId) { console.error('wrong chain'); process.exit(1); }

  const bal = await provider.getBalance(src.address);
  const reserve = parseEther(reserveEth);
  const feeData = await provider.getFeeData();
  const gasPerTx = 21000n * feeData.maxFeePerGas;
  const totalGas = gasPerTx * BigInt(dests.length);

  if (bal <= reserve + totalGas) {
    console.error('Insufficient balance.');
    console.error('  have    :', formatEther(bal));
    console.error('  reserve :', formatEther(reserve));
    console.error('  gas est :', formatEther(totalGas));
    console.error('  needed  :', formatEther(reserve + totalGas + parseEther('0.0001')));
    process.exit(1);
  }

  const distributable = bal - reserve - totalGas;
  const perWallet = distributable / BigInt(dests.length);

  console.log('\nBalance     :', formatEther(bal), chain.currency);
  console.log('Gas for', dests.length, 'txs:', formatEther(totalGas));
  console.log('Distributable:', formatEther(distributable));
  console.log('Per wallet   :', formatEther(perWallet), chain.currency);

  const ans = await ask('\nSend? (y/N): ');
  if (ans.trim().toLowerCase() !== 'y') { console.log('Cancelled.'); process.exit(0); }

  let nonce = await provider.getTransactionCount(src.address);
  for (let i = 0; i < dests.length; i++) {
    const to = dests[i];
    try {
      const tx = await src.sendTransaction({
        to, value: perWallet, nonce,
        gasLimit: 21000n,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
      });
      console.log('  #' + (i+1), to, '<-', formatEther(perWallet), 'tx:', tx.hash);
      await tx.wait();
      nonce++;
    } catch (e) {
      console.error('  #' + (i+1), to, 'FAILED:', e.shortMessage || e.message);
      break;
    }
  }
  console.log('\nDone.');
})().catch(e => { console.error('ERROR:', e.shortMessage || e.message); process.exit(1); });
