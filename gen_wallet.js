const { Wallet } = require('ethers');
const fs = require('fs');

if (fs.existsSync('.env')) {
  console.log('⚠️  .env already exists. Delete it first if you really want a new wallet.');
  process.exit(1);
}

const w = Wallet.createRandom();
fs.writeFileSync('.env', `PRIVATE_KEY=${w.privateKey}\nADDRESS=${w.address}\n`);
fs.appendFileSync('.gitignore', '\n.env\n');

console.log('=================================================');
console.log('  NEW AGENT WALLET GENERATED');
console.log('=================================================');
console.log('Address:  ', w.address);
console.log('Mnemonic: ', w.mnemonic.phrase);
console.log('=================================================');
console.log('BACKUP THE MNEMONIC NOW to your notes/password manager.');
console.log('If the Codespace dies, only the mnemonic can recover the key.');
console.log('=================================================');