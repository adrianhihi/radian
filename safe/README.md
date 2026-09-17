# Safe batches

`robinhood-mainnet-accept-ownership.json`: upload in the Safe web app (Apps → Transaction Builder →
"Load a batch" / drag the file) from the deployed Safe `0x6db9a7fF776c7091C0A3c9847bD8a43eBA6892D8` on Robinhood Chain, AFTER
`script/TransferOwnership.s.sol` has been broadcast. It calls `acceptOwnership()` on the factory,
hook, buyback vault, locker, $RADIAN staking and $RADIAN treasury (Ownable2Step), completing the
handover in one Safe transaction. Verify afterwards with `script/VerifyOwnership.s.sol`.

`robinhood-mainnet-open-launches.json`: one call, `setLaunchEnabled(true)` on the mainnet factory. Upload it the
same way when the go-live checklist in MAINNET_RUNBOOK.md 5f is done; the web default network flips to
Robinhood Chain in the same release.
