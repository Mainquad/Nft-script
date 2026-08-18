// Copy this file, rename, edit. Then: node mint.js mints/YOUR_FILE.js .env
module.exports = {
  chain: 'base',                                              // ethereum | base | arbitrum | optimism | robinhood | robinhood-testnet
  contract: '0x0000000000000000000000000000000000000000',    // the mint contract
  fn: 'mint(uint256)',                                        // exact solidity signature
  args: [1],                                                  // args matching fn — strings for uint256, arrays for arrays
  priceEth: '0',                                              // per-unit price as string ("0" for free, e.g. "0.001")
  qty: 1                                                      // multiplies priceEth for value calc
};