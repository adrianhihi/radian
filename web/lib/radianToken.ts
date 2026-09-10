import { parseAbi } from "viem";
import { activeNetwork } from "./radian";

export const RADIAN_ADDR = activeNetwork.radian;

export const stakingAbi = parseAbi([
  "function stake(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function getReward()",
  "function exit()",
  "function stakedOf(address) view returns (uint256)",
  "function earned(address) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
]);

export const radianErc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export type FlywheelStats = {
  token: string;
  curve: string;
  staking: string;
  treasury: string;
  totalStaked: number;
  radianPrice: number;
  stakedValueUsdc: number;
  apr: number;
  distributedToStakers: number;
  buybackBurned: number;
  radianSupply: number;
  buybackBps: number;
  treasuryBalance: number;
};
