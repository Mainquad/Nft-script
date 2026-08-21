require('dotenv').config({ path: process.argv[3] || '.env' });
const { Wallet, WebSocketProvider, Interface, formatEther, parseEther, getAddress } = require('ethers');
const path = require('path');
const CHAINS = require('./lib/chains');

const cfg = require(path.resolve(process.argv[2]));
const chain = CHAINS[cfg.chain];
const KEY = process.env.ALCHEMY_KEY;
if (!KEY) { console.error('ALCHEMY_KEY missing from env'); process.exit(1); }

const WSS_URL = `wss://robinhood-mainnet.g.alchemy.com/v2/${KEY}`;
const GAS_LIMIT = BigInt(process.env.GAS_LIMIT || 300000);
const TIP_MULT = BigInt(process.env.TIP_MULT || 2);

(async () => {
  const provider = new WebSocketProvider(WSS_URL, chain.chainId);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  const AGENT = getAddress(wallet.address);
  const iface = new Interface([`function ${cfg.fn}`]);
  const fnName = cfg.fn.split('(')[0];
  const data = iface.encodeFunctionData(fnName, cfg.args);
  const value = parseEther(String(cfg.priceEth)) * BigInt(cfg.qty ?? 1);

  const feeData = await provider.getFeeData();
  let nonce = await provider.getTransactionCount(AGENT);

  console.log('Wallet   :', AGENT);
  console.log('Contract :', cfg.contract);
  console.log('Nonce    :', nonce);
  console.log('MaxFee   :', formatEther(feeData.maxFeePerGas), 'per gas');
  console.log('Tip mult :', TIP_MULT.toString() + 'x');
  console.log('Listening for new blocks via WSS. Ctrl+C to stop.\n');

  let inFlight = false;
  let attempts = 0;
  let submitted = false;

  provider.on('block', async (blockNum) => {
    if (submitted || inFlight) return;
    inFlight = true;
    attempts++;
    const t0 = Date.now();
    try {
      await provider.call({ to: cfg.contract, from: AGENT, data, value });
      console.log(`\n[block ${blockNum}] READY after ${attempts} attempts, submitting...`);
      submitted = true;
      const tx = await wallet.sendTransaction({
        to: cfg.contract, data, value,
        gasLimit: GAS_LIMIT,
        maxFeePerGas: feeData.maxFeePerGas * TIP_MULT,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas * TIP_MULT,
        nonce
      });
      console.log(`[+${Date.now() - t0}ms] Submitted:`, tx.hash);
      console.log('  ' + chain.explorer + '/tx/' + tx.hash);
      const receipt = await tx.wait();
      console.log('Status:', receipt.status, 'Block:', receipt.blockNumber, 'Gas used:', receipt.gasUsed.toString());
      if (receipt.status !== 1) {
        console.error('REVERTED post-submit — lost the race in-block. Rerun.');
        process.exit(1);
      }
      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const zeroTopic = '0x' + '00'.repeat(32);
      const agentTopic = '0x000000000000000000000000' + AGENT.slice(2).toLowerCase();
      const mints = receipt.logs.filter(l => l.topics[0] === transferTopic && l.topics[1] === zeroTopic && l.topics[2].toLowerCase() === agentTopic);
      for (const l of mints) {
        const tokenId = BigInt(l.topics[3]).toString();
        console.log('Minted #' + tokenId, '->', chain.explorer + '/token/' + l.address + '?a=' + tokenId);
      }
      process.exit(0);
    } catch (e) {
      const rev = e.data || e.info?.error?.data || '';
      const label = rev === '0x5273678a' ? 'DripNotReady' : (rev.slice(0, 10) || 'err');
      if (attempts % 10 === 0) process.stdout.write(`\r  attempts: ${attempts}, latest block ${blockNum}: ${label}     `);
    } finally {
      inFlight = false;
    }
  });

  provider.websocket.onclose = () => {
    console.error('\nWebSocket closed. Exiting.');
    process.exit(1);
  };
})().catch(e => { console.error('\nERROR:', e.shortMessage || e.message); process.exit(1); });
