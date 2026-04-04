import { baseSepolia } from "viem/chains";

export const CHAIN = baseSepolia;
export const CHAIN_ID = 84532;

// --- Contract Addresses (Base Sepolia) ---
export const JUSTAN_ACCOUNT_IMPL = "0xbb4f7d5418Cd8DADB61bb95561179e517572cBCd" as const;
export const FACTORY_ADDRESS = "0x5803c076563C85799989d42Fc00292A8aE52fa9E" as const;
export const ENTRY_POINT_ADDRESS = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108" as const;
export const PERMISSIONS_MANAGER = "0xf1b40E3D5701C04d86F7828f0EB367B9C90901D8" as const;

// --- Bundler / RPC ---
// JAW proxy (original)
const JAW_BASE_URL = "https://api.justaname.id";
const JAW_PROXY_URL = `${JAW_BASE_URL}/proxy/v1`;
const JAW_API_KEY = process.env.NEXT_PUBLIC_JAW_API_KEY;
if (!JAW_API_KEY) {
  throw new Error("NEXT_PUBLIC_JAW_API_KEY is not set");
}
const JAW_BUNDLER_URL = `${JAW_PROXY_URL}/rpc?chainId=${CHAIN_ID}&api-key=${JAW_API_KEY}`;

// Switch this to test different bundlers
export const BUNDLER_URL = JAW_BUNDLER_URL;

// --- Derivation Path ---
export const ETH_PATH = "44'/60'/0'/0/6";

// --- EIP-7702 Stub Signature (for gas estimation) ---
export const STUB_SIGNATURE =
  "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c" as const;
