// The protocol numbers the copy quotes, typed once. Each value mirrors a line in the
// Solidity sources (repo root src/) or a browser-side rule in lib/, and says whether
// the chain can change it. Pages that show a LIVE policy value (/factory, /earn)
// still read the chain; this module is what the copy says the protocol does.
// Framework-free so content modules and tests can import it.
export const PROTOCOL = {
  /** LaunchToken.sol TOTAL_SUPPLY, in whole tokens; immutable */
  supply: 1_000_000_000,
  /** the launch configs' curveFeeBps and MemeHook hookFeeBps: 1% per trade, snapshotted per launch */
  tradeFeeBps: 100,
  /** radian/RadianExecutor.sol FEE_BPS; a constant */
  executorFeeBps: 50,
  /** pound/PoundVault.sol REFERRAL_BPS (of the fee, to whoever brought the buyer); a constant */
  referralBps: 555,
  /** pound/PoundVault.sol LAUNCHER_BPS (of the fee, to whoever brought the creator); a constant */
  launcherBps: 555,
  /** pound/PoundVault.sol burnShareBps (of the post-referral remainder); deployed value, owner-settable */
  burnShareBps: 7000,
  /** pound/PackBurner.sol minInterval between burns; deployed value, owner-settable */
  burnMinIntervalSecs: 86400,
  /** pound/PackBurner.sol maxSlippageBps against spot; deployed value, owner-settable */
  burnMaxSlippageBps: 500,
  /** v2/PonsV2BuybackVault.sol VESTING_DURATION; a constant */
  buybackVestSecs: 5 * 365 * 86400,
  /** radian/wall/WallStaking.sol DURATION of each reward stream; a constant */
  wallStreamSecs: 7 * 86400,
  /** radian/pof/PoFVault.sol round bounds (mirrored in lib/templates.ts POF_BOUNDS) */
  pofRoundMinSecs: 60,
  pofRoundMaxSecs: 86400,
  /** lib/referral.ts TTL_MS: how long a referral tag lives in the visitor's browser (not on chain) */
  referralTagTtlSecs: 30 * 86400,
  /** lib/draft.ts SYMBOL_MAX: ticker length the wizard accepts */
  symbolMax: 10,
} as const;
