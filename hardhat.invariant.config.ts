import base from "./hardhat.config.js";

// Dedicated, offline campaign. Hardhat does not use foundry.toml invariant limits.
export default {...base,test:{solidity:{
  invariant:{runs:Number(process.env.STAX_INVARIANT_RUNS??512),depth:Number(process.env.STAX_INVARIANT_DEPTH??1000),failOnRevert:true},
  fuzz:{seed:"0x53544158"},
}}};
