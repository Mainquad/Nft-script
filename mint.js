require('dotenv').config({ path: process.argv[3] || '.env' });
const { Wallet, JsonRpcProvider, Interface, formatEther, parseEther, getAddress } = require('ethers');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const CHAINS = require('./lib/chains');

async function getEthPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const j = await res.json();
    return j.ethereum?.usd || null;
  } catch { return null; }
}

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node mint.js <config.js> [envfile]');
  console.error('  e.g. node mint.js mints/thisdrop.js .env');
  process.exit(1);
}
const cfg = require(path.resolve(configPath));

function bail(msg) { console.error('CONFIG ERROR:', msg); process.exit(1); }
if (!cfg.chain) bail('missing chain');
if (!cfg.contract) bail('missing contract');
if (!cfg.fn) bail('missing fn (e.g. "mint(uint256)")');
if (!Array.isArray(cfg.args)) bail('args must be an array');
if (cfg.priceEth === undefined) bail('missing priceEth (use "0" for free)');
const qty = cfg.qty ?? 1;
const chain = CHAINS[cfg.chain];
if (!chain) bail(`unknown chain: ${cfg.chain}. Known: ${Object.keys(CHAINS).join(', ')}`);

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, a => { rl.close(); r(a); }));
}

(async () => {
  const provider = new JsonRpcProvider(chain.rpc);
  const pk = process.env.PRIVATE_KEY;
  if (!pk) bail('PRIVATE_KEY missing from env file');
  const wallet = new Wallet(pk, provider);
  const AGENT = getAddress(wallet.address);

  console.log('================================================');
  console.log('  Chain     :', cfg.chain, `(id ${chain.chainId})`);
  console.log('  Contract  :', cfg.contract);
  console.log('  Function  :', cfg.fn);
  console.log('  Args      :', JSON.stringify(cfg.args));
  console.log('  Qty       :', qty);
  console.log('  Price     :', cfg.priceEth, chain.currency, 'per unit');
  console.log('  Wallet    :', AGENT);
  console.log('================================================\n');

  const net = await provider.getNetwork();
  if (Number(net.chainId) !== chain.chainId) bail(`RPC returned chain ${net.chainId}, expected ${chain.chainId}`);

  const ethUsd = await getEthPrice();
  const usd = (wei) => ethUsd ? `(~$${(Number(formatEther(wei)) * ethUsd).toFixed(4)})` : '(price unavailable)';
  console.log('ETH price:', ethUsd ? `$${ethUsd}` : 'unavailable (Coingecko down)');

  const bal = await provider.getBalance(AGENT);
  const totalPrice = parseEther(String(cfg.priceEth)) * BigInt(qty);
  console.log('Balance  :', formatEther(bal), chain.currency, usd(bal));
  console.log('Value    :', formatEther(totalPrice), chain.currency, usd(totalPrice));

  const code = await provider.getCode(cfg.contract);
  if (code === '0x') bail('No bytecode at contract address — wrong address or wrong chain?');
  console.log('Contract bytecode: ok (' + (code.length / 2 - 1) + ' bytes)');

  const iface = new Interface([`function ${cfg.fn}`]);
  const fnName = cfg.fn.split('(')[0];
  const data = iface.encodeFunctionData(fnName, cfg.args);

  console.log('\nSimulating call...');
  try {
    await provider.call({ to: cfg.contract, from: AGENT, data, value: totalPrice });
    console.log('Simulation ok.');
  } catch (e) {
    console.error('SIMULATION REVERT:', e.shortMessage || e.message);
    if (e.data) console.error('  revert data:', e.data);
    if (e.info?.error?.data) console.error('  nested data:', e.info.error.data);
    console.error('\nBailing — tx would revert on-chain.');
    process.exit(1);
  }

  const gasEst = await provider.estimateGas({ to: cfg.contract, from: AGENT, data, value: totalPrice });
  const feeData = await provider.getFeeData();
  const gasCost = gasEst * feeData.maxFeePerGas;
  const totalCost = totalPrice + gasCost;

  console.log('\nGas estimate :', gasEst.toString());
  console.log('Gas cost     :', formatEther(gasCost), chain.currency, usd(gasCost));
  console.log('Total cost   :', formatEther(totalCost), chain.currency, usd(totalCost));

  if (bal < totalCost) bail(`Insufficient balance. Need ${formatEther(totalCost)}, have ${formatEther(bal)}`);

  const ans = await ask('\nSend transaction? (y/N): ');
  if (ans.trim().toLowerCase() !== 'y') { console.log('Cancelled.'); process.exit(0); }

  const tx = await wallet.sendTransaction({
    to: cfg.contract, data, value: totalPrice,
    gasLimit: gasEst * 12n / 10n,
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
  });
  console.log('\nSubmitted:', tx.hash);
  console.log('  ' + chain.explorer + '/tx/' + tx.hash);

  const receipt = await tx.wait();
  if (receipt.status !== 1) bail('Transaction reverted after submission');
  console.log('\nConfirmed in block', receipt.blockNumber);
  console.log('Gas used:', receipt.gasUsed.toString());

  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const zeroTopic = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const agentTopic = '0x000000000000000000000000' + AGENT.slice(2).toLowerCase();
  const mints = receipt.logs.filter(l =>
    l.topics[0] === transferTopic &&
    l.topics[1] === zeroTopic &&
    l.topics[2].toLowerCase() === agentTopic
  );

  if (mints.length) {
    console.log(`\nMinted ${mints.length} token(s):`);
    for (const l of mints) {
      const tokenId = BigInt(l.topics[3]).toString();
      console.log(`  #${tokenId}  (contract ${l.address})`);
      console.log(`  ${chain.explorer}/token/${l.address}?a=${tokenId}`);
    }
  } else {
    console.log('\nNo ERC-721 Transfer(0x0 -> agent) events found. (Might be ERC-1155 or non-standard.)');
  }

  fs.mkdirSync('receipts', { recursive: true });
  const rname = `receipts/${Date.now()}_${cfg.chain}_${tx.hash.slice(0, 10)}.json`;
  fs.writeFileSync(rname, JSON.stringify({
    config: cfg,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
    wallet: AGENT
  }, null, 2));
  console.log(`\nReceipt saved: ${rname}`);
})().catch(e => { console.error('\nERROR:', e.shortMessage || e.message); process.exit(1); });