import { Wallet } from 'ethers';
import { writeFile } from 'node:fs/promises';
const password = process.env.STAX_NEW_WALLET_PASSWORD;
if (!password) throw Error('Protected wallet setup must provide encryption password');
const wallet = Wallet.createRandom();
const json = await wallet.encrypt(password);
await writeFile('.deployment-wallet/deployer.json', json, {flag:'wx'});
await writeFile('.deployment-wallet/public-address.txt', wallet.address+'\n', {flag:'wx'});
console.log(wallet.address);
