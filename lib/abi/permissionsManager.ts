// Permission struct type used across all functions
const permissionComponents = [
  { name: "account", type: "address" },
  { name: "spender", type: "address" },
  { name: "start", type: "uint48" },
  { name: "end", type: "uint48" },
  { name: "salt", type: "uint256" },
  {
    name: "calls",
    type: "tuple[]",
    components: [
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
      { name: "checker", type: "address" },
    ],
  },
  {
    name: "spends",
    type: "tuple[]",
    components: [
      { name: "token", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "unit", type: "uint8" },
      { name: "multiplier", type: "uint16" },
    ],
  },
] as const;

const callComponents = [
  { name: "target", type: "address" },
  { name: "value", type: "uint256" },
  { name: "data", type: "bytes" },
] as const;

export const permissionsManagerAbi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "permission", type: "tuple", components: permissionComponents },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revoke",
    inputs: [
      { name: "permission", type: "tuple", components: permissionComponents },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeBatch",
    inputs: [
      { name: "permission", type: "tuple", components: permissionComponents },
      {
        name: "calls",
        type: "tuple[]",
        components: callComponents,
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
