const { Wallet } = require('ethers');
const fs = require('fs');

if (fs.existsSync('.env.hoodcats')) {
  console.error('.env.hoodcats already exists. Delete it first if you really want new wallets.');
  process.exit(1);
}

const N = 3;
const lines = [];
console.log('Generated', N, 'wallets:\n');
for (let i = 1; i <= N; i++) {
  const w = Wallet.createRandom();
  lines.push('PRIVATE_KEY_' + i + '=' + w.privateKey);
  lines.push('ADDRESS_' + i + '=' + w.address);
  console.log('#' + i + ':');
  console.log('  address :', w.address);
  console.log('  mnemonic:', w.mnemonic.phrase);
  console.log('');
}
fs.writeFileSync('.env.hoodcats', lines.join('\n') + '\n');
fs.appendFileSync('.gitignore', '\n.env.hoodcats\n');
console.log('Saved to .env.hoodcats');
console.log('\nBACK UP MNEMONICS to your notes/password manager if you plan to keep any NFTs won.');
