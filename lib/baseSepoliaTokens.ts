/**
 * Base Sepolia token & router addresses — safe to import from CLI scripts
 * (no env reads). Re-exported from lib/config for the Next.js app.
 */

export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;

export const NATIVE_ETH_ERC7528 =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
export const WETH_BASE_SEPOLIA =
  "0x4200000000000000000000000000000000000006" as const;
export const USDC_BASE_SEPOLIA =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
/** Uniswap V3 SwapRouter02 */
export const UNISWAP_V3_SWAP_ROUTER =
  "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4" as const;
