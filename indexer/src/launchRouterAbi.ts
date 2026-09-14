import { parseAbi } from "viem";

const TP =
  "(string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt) params";

export const launchRouterAbi = parseAbi([
  `function launchAndBuy(${TP}, uint256 launchConfigId, address pairToken, uint256 buyAmount, uint256 minTokensOut, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)`,
  `function launchWall(${TP}, uint256 launchConfigId, address pairToken, uint256 buyAmount, uint256 minTokensOut, address[] snipeTaxExemptions, (uint16 marginBps, uint16 epochBudgetBps, uint16 streamBps, uint16 maxSlippageBps, uint32 minInterval, uint128 keeperBounty) cfg) payable returns (address token, address curve, address treasury, address staking)`,
  `function launchPoF(${TP}, uint256 launchConfigId, address pairToken, uint256 buyAmount, uint256 minTokensOut, address[] snipeTaxExemptions, (uint128 targetWork, uint32 roundSeconds, uint32 minInterval, uint16 maxBuybackReserveBps) cfg) payable returns (address token, address curve, address vault)`,
  "function predictWall(address creator, bytes32 salt) view returns (address treasury, address staking)",
  "function predictPoF(address creator, bytes32 salt) view returns (address vault)",
]);
