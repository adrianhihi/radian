// The builders page's copy, English and Chinese. Addresses and URLs are filled
// in from the network config at render time.

export interface IntegrateDoc {
  eyebrow: string;
  title: [string, string];
  sub: string;
  steps: string;
  learn: string;
  stats: [string, string, string][];
  stepsTitle: string;
  stepsSub: string;
  step: { h: string; body: string; label: string }[];
  plansTitle: string;
  plans: { h: string; body: string; label: string }[];
  shipTitle: string;
  ship: [string, string][];
  addrTitle: string;
  addrNote: string;
  addrRows: { key: "factory" | "router" | "pofRouter" | "executor" | "vault" | "burner" | "indexer"; label: string; note: string }[];
  live: string;
  notHere: string;
  riskTitle: string;
  risk: string[];
  verifyTitle: string;
  verifyBody: string;
  verifyCta: string;
}

const en: IntegrateDoc = {
  eyebrow: "FOR BUILDERS, AGENTS AND BOTS",
  title: ["Route the curve.", "Keep the fee."],
  sub: "Every launch is a plain bonding curve behind one router. Discover it from the indexer, quote it with one call, fill it through the router with your referral tag — and 5.55% of every fee those trades pay is yours, forever.",
  steps: "Three steps",
  learn: "How Radian works",
  stats: [
    ["5.55%", "OF EVERY FEE", "credited to the referrer a router trade carries — an app, an agent, a wallet, forever"],
    ["1 call", "TO QUOTE", "the agent API simulates the real curve with an exact eth_call and says how each price was produced"],
    ["0 keys", "TO INTEGRATE", "plans come back unsigned; your user signs and broadcasts, nothing is custodied"],
  ],
  stepsTitle: "Discover, quote, fill",
  stepsSub: "THE SAME PATH THIS SITE USES",
  step: [
    { h: "Discover", body: "The indexer lists every launch on the network with its curve, pair token, template and 24h facts. Keyless, no rate limit for polite polling. The factory itself is an append-only registry if you prefer the chain.", label: "GET /launches" },
    { h: "Quote", body: "One call returns the tokens out for a buy or the quote out for a sell, the fee, the minimum after your slippage, and an unsigned transaction plan aimed at the right contract (the router, or the PoF router for Proof-of-Fee launches). Native buys are simulated exactly; other paths are computed from reserves and labelled as such.", label: "GET /v1/quote" },
    { h: "Fill", body: "Send the plan, or call the router yourself. The last argument is the referrer: put your address there and every fee that trade pays credits you in the vault. The curve enforces the minimum you pass; nothing fills below it.", label: "router.buy / sell" },
  ],
  plansTitle: "Launch and schedule, unsigned",
  plans: [
    { h: "Launch plan", body: "Post the token's params, the pair token, the template and its config; get back the router calldata, the value to send (launch fee plus a native first buy) and the predicted template contracts. Sign it with the creator's key.", label: "POST /v1/launch-plan" },
    { h: "Delegated buys", body: "A signed EIP-712 BuyAuth caps amount, interval, count, gas price, price floor and expiry; the keeper executes it on schedule and tokens land in the user's wallet. Deposits and cancels are the user's own transactions.", label: "POST /v1/auth" },
  ],
  shipTitle: "Before you ship",
  ship: [
    ["Pass the referrer on every trade", "The router's buy and sell take a referrer address; a zero address forfeits the share. Self-referrals are dropped on chain."],
    ["Respect the minimum", "Compute minOut from the quote and your slippage; the curve reverts instead of filling below it. Never pass zero on a user's behalf."],
    ["Proof-of-Fee goes through the PoF router", "Direct curve buys earn no Work. The quote plan already picks the right contract; if you build calldata yourself, check the launch's template."],
    ["Read the snipe tax", "In the first seconds after a launch, buys pay a decaying tax. The curve endpoint and the quote both include it; show it to your user."],
  ],
  addrTitle: "Addresses",
  addrNote: "For the active network. Runtime code hashes of the platform contracts are pinned and re-checked on every visit; the Verify page shows the check.",
  addrRows: [
    { key: "factory", label: "LaunchFactory", note: "the registry: every token and its curve" },
    { key: "router", label: "LaunchRouter", note: "launch + first buy, templates, buy / sell with a referrer" },
    { key: "pofRouter", label: "PoFRouter", note: "buys that count as Work on Proof-of-Fee launches" },
    { key: "executor", label: "RadianExecutor", note: "delegated buys from signed authorizations" },
    { key: "vault", label: "PoundVault", note: "the fee waterfall: referrals, the Pack, the treasury" },
    { key: "burner", label: "PackBurner", note: "buys and burns the Pack in rotation" },
    { key: "indexer", label: "Indexer / agent API", note: "launches, trades, quotes, plans, the Pound ledger" },
  ],
  live: "Live",
  notHere: "Not on this network",
  riskTitle: "For your risk team",
  risk: [
    "Every action is a transaction the user signs; the API never holds keys or funds.",
    "Prices marked method=reserves are computed, not simulated; treat them as estimates.",
    "The curve enforces minimum-received; there is no deadline parameter, so pass a fresh quote.",
    "Fee policy is snapshotted per launch; a launch from before The Pound carries no referral tags.",
    "Payments: the API is shaped for x402 but every service is free until a facilitator settles; no endpoint charges before then.",
  ],
  verifyTitle: "Verify before you trust",
  verifyBody: "Every contract this site talks to is listed with its address and pinned code hash. Compare against what your integration is wired to.",
  verifyCta: "Verify the contracts",
};

const zh: IntegrateDoc = {
  eyebrow: "给开发者、代理与机器人",
  title: ["路由这条曲线。", "留下这份费用。"],
  sub: "每次发射都是一条普通的联合曲线，前面只有一个路由。从索引器发现它，一次调用报价，带上你的推荐标记经路由成交——那些交易付的每笔手续费里，5.55% 永久归你。",
  steps: "三步",
  learn: "Radian 怎么运作",
  stats: [
    ["5.55%", "每笔手续费", "记给路由交易携带的推荐人——一个应用、一个代理、一个钱包，永久"],
    ["1 次调用", "拿到报价", "代理 API 用一次精确的 eth_call 模拟真实曲线，并说明每个价格是怎么算出来的"],
    ["0 把密钥", "完成接入", "计划以未签名形式返回；你的用户签名并广播，没有任何托管"],
  ],
  stepsTitle: "发现、报价、成交",
  stepsSub: "与本站相同的路径",
  step: [
    { h: "发现", body: "索引器列出网络上的每一次发射，附曲线、配对代币、模板和 24 小时数据。无需密钥，礼貌轮询不限速。更愿意读链的话，工厂本身就是只增不减的注册表。", label: "GET /launches" },
    { h: "报价", body: "一次调用返回买入能得到的代币或卖出能得到的报价、手续费、按你滑点算的最少收到，以及一个指向正确合约（路由，或 Proof-of-Fee 发射的 PoF 路由）的未签名交易计划。原生币买入精确模拟；其它路径由储备计算并如实标注。", label: "GET /v1/quote" },
    { h: "成交", body: "发送计划，或自己调路由。最后一个参数是推荐人：填你的地址，那笔交易付的每笔手续费都在金库里记给你。曲线强制你传入的最少收到；低于它不会成交。", label: "router.buy / sell" },
  ],
  plansTitle: "发射与定时，未签名",
  plans: [
    { h: "发射计划", body: "提交代币参数、配对代币、模板和它的配置；拿回路由的 calldata、要发送的 value（发射费加原生币首买）和预测的模板合约地址。用创作者的密钥签名。", label: "POST /v1/launch-plan" },
    { h: "委托买入", body: "一条签好的 EIP-712 BuyAuth 限定金额、间隔、次数、gas 价、价格上限和有效期；keeper 按计划执行，代币落进用户钱包。存款和取消都是用户自己的交易。", label: "POST /v1/auth" },
  ],
  shipTitle: "上线前必读",
  ship: [
    ["每笔交易都传推荐人", "路由的 buy 和 sell 接收一个推荐人地址；零地址等于放弃这一份。自我推荐在链上作废。"],
    ["尊重最少收到", "用报价和你的滑点算出 minOut；曲线低于它会回滚而不是成交。永远不要替用户传零。"],
    ["Proof-of-Fee 走 PoF 路由", "直接对曲线买入不计 Work。报价计划已经选好了正确的合约；自己构造 calldata 时请检查发射的模板。"],
    ["读取狙击税", "发射后的前几秒，买入付一笔逐渐衰减的税。曲线端点和报价都包含它；把它展示给你的用户。"],
  ],
  addrTitle: "地址",
  addrNote: "当前网络。平台合约的运行时代码哈希已钉住并在每次访问时重新核对；核验页展示这个核对。",
  addrRows: [
    { key: "factory", label: "LaunchFactory", note: "注册表：每个代币和它的曲线" },
    { key: "router", label: "LaunchRouter", note: "发射 + 首买、模板、带推荐人的买卖" },
    { key: "pofRouter", label: "PoFRouter", note: "在 Proof-of-Fee 发射上计入 Work 的买入" },
    { key: "executor", label: "RadianExecutor", note: "由签名授权驱动的委托买入" },
    { key: "vault", label: "PoundVault", note: "费用瀑布：推荐、Pack、国库" },
    { key: "burner", label: "PackBurner", note: "轮换买入并燃烧 Pack" },
    { key: "indexer", label: "索引器 / 代理 API", note: "发射、成交、报价、计划、Pound 账本" },
  ],
  live: "已上线",
  notHere: "本网络没有",
  riskTitle: "给风控团队",
  risk: [
    "每个动作都是用户签名的交易；API 从不持有密钥或资金。",
    "标注 method=reserves 的价格是计算值，不是模拟值；当作估计。",
    "曲线强制最少收到；没有 deadline 参数，所以要传新鲜的报价。",
    "费用政策按发射快照；早于 The Pound 的发射不带推荐标记。",
    "付费：API 按 x402 的形状设计，但在有 facilitator 结算之前所有服务免费；在此之前没有端点会收费。",
  ],
  verifyTitle: "先核验，再信任",
  verifyBody: "本站打交道的每一个合约都列出了地址和钉住的代码哈希。对照一下你的集成连的是不是它们。",
  verifyCta: "核验合约",
};

export const INTEGRATE = { en, zh } as const;
