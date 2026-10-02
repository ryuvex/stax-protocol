// Merkle tree matching StaxRewardsDistributor / Uniswap MerkleDistributor:
// leaf = keccak256(abi.encodePacked(index, account, amount)); parents hash sorted pairs (OpenZeppelin MerkleProof).
import {keccak256, solidityPacked, concat} from "ethers";

export const leafHash = (index, account, amount) => keccak256(solidityPacked(["uint256", "address", "uint256"], [index, account, amount]));
const pair = (a, b) => (a.toLowerCase() < b.toLowerCase() ? keccak256(concat([a, b])) : keccak256(concat([b, a])));

/** leaves: [{index, account, amount}] with index = position. Returns {root, proofs[]} */
export function buildTree(leaves) {
  if (!leaves.length) throw new Error("no leaves");
  const layers = [leaves.map((l) => leafHash(l.index, l.account, l.amount))];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1], next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? pair(prev[i], prev[i + 1]) : prev[i]);
    layers.push(next);
  }
  const proofs = leaves.map((_, idx) => {
    const out = []; let i = idx;
    for (let d = 0; d < layers.length - 1; d++) { const sib = i ^ 1; if (sib < layers[d].length) out.push(layers[d][sib]); i >>= 1; }
    return out;
  });
  return { root: layers[layers.length - 1][0], proofs };
}

export function verify(proof, root, index, account, amount) {
  let h = leafHash(index, account, amount);
  for (const p of proof) h = pair(h, p);
  return h === root;
}
