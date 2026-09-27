// Read-only: which main vault does the user-basket factory point to, and can it be repointed?
import {Contract,JsonRpcProvider,Interface,keccak256,toUtf8Bytes} from "ethers";
const provider=new JsonRpcProvider(process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com",4663,{staticNetwork:true});
const FACTORY="0x164D9dFBe901421B560D054aA61D1fe1E9d6D078";
const V1="0x13045D3Dab253fDB15181C16f135D612fa8546E6",V2="0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33";
const getters=["mainVault","vault","staxVault","implementation","usdg","treasury","owner","creationFee","maxLegs"];
for(const g of getters){
  const iface=new Interface([`function ${g}() view returns(address)`]);
  try{const r=await provider.call({to:FACTORY,data:iface.encodeFunctionData(g,[])});
    if(r&&r!=="0x"){const v=iface.decodeFunctionResult(g,r)[0];console.log(g,"=",v,v.toLowerCase()===V1.toLowerCase()?"(V1 vault)":v.toLowerCase()===V2.toLowerCase()?"(V2 vault)":"");}}
  catch{}
}
const code=await provider.getCode(FACTORY);
console.log("code bytes",(code.length-2)/2,"| contains V1 addr:",code.toLowerCase().includes(V1.slice(2).toLowerCase()),"| contains V2 addr:",code.toLowerCase().includes(V2.slice(2).toLowerCase()));
for(const sig of ["setMainVault(address)","setVault(address)","setImplementation(address)","transferOwnership(address)"]){
  const sel=keccak256(toUtf8Bytes(sig)).slice(2,10);
  console.log(sig,"selector present in bytecode:",code.toLowerCase().includes(sel));
}
provider.destroy();
// Second pass: the implementation (clone template) is where the main-vault reference usually lives.
{
const p2=new JsonRpcProvider(process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com",4663,{staticNetwork:true});
const IMPL="0xED218DE9d5EEE138D6640b33B84DC009C10be445";
const code=await p2.getCode(IMPL);
console.log("\nimplementation code bytes",(code.length-2)/2,"| contains V1 addr:",code.toLowerCase().includes(V1.slice(2).toLowerCase()),"| contains V2 addr:",code.toLowerCase().includes(V2.slice(2).toLowerCase()));
for(const g of ["mainVault","vault","staxVault","router","universalRouter","usdg"]){
  const iface=new Interface([`function ${g}() view returns(address)`]);
  try{const r=await p2.call({to:IMPL,data:iface.encodeFunctionData(g,[])});if(r&&r!=="0x"){const v=iface.decodeFunctionResult(g,r)[0];console.log("impl."+g,"=",v,v.toLowerCase()===V1.toLowerCase()?"(V1 vault)":v.toLowerCase()===V2.toLowerCase()?"(V2 vault)":"");}}catch{}
}
p2.destroy();
}
