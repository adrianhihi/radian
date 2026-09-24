// The Learn page's copy, English and Chinese. Every fee, share, length and
// duration the copy states is a {placeholder} filled from lib/protocol.ts by
// learnDoc(lang) below, so a number is typed once; addresses come from the
// network. {q} is the one runtime placeholder (the search box, filled by the page).
import type { Lang } from "../i18n";
import { PROTOCOL } from "../protocol";

export type LearnTag = "launch" | "trade" | "fees" | "templates" | "pound" | "trust";

export interface DetailItem {
  kicker: string;
  title: string;
  tag: LearnTag;
  body: string[];
  /** only on networks that run The Pound ("pound") or the older recipient ("legacy") */
  when?: "pound" | "legacy";
  link?: { href: string; label: string };
}

export interface LearnDoc {
  eyebrow: string;
  title: [string, string];
  sub: string;
  ctas: [string, string, string];
  toc: string;
  tocItems: [string, string][];
  how: { eyebrow: string; title: [string, string] };
  launch: { eyebrow: string; title: [string, string]; body: string; cards: [string, string][]; cta: string };
  detail: { eyebrow: string; title: string; body: string; search: string; tags: Record<LearnTag | "all", string>; items: DetailItem[]; noMatch: string };
  qa: { eyebrow: string; title: string; body: string; groups: { name: string; items: { q: string; a: string }[] }[] };
  contracts: { title: string; body: string; verify: string };
  footer: [string, string][];
}

const en: LearnDoc = {
  eyebrow: "LEARN",
  title: ["How Radian", "works"],
  sub: "A token starts on a bonding curve priced in a dollar or a stock, graduates into a locked Uniswap V4 pool, and every fee it earns is split by a contract. This page is the whole rulebook.",
  ctas: ["Explore launches", "Launch a token", "The Pound"],
  toc: "ON THIS PAGE",
  tocItems: [
    ["how", "The four steps"],
    ["launching", "Launching"],
    ["detail", "The details"],
    ["qa", "Questions"],
    ["contracts", "Contracts"],
  ],
  how: { eyebrow: "THE LOOP", title: ["Launch, trade,", "graduate, feed the Pack"] },
  launch: {
    eyebrow: "LAUNCHING",
    title: ["One transaction.", "Three decisions."],
    body: "The wizard asks for a name, a market and a fee template, then sends one transaction. What it fixes on chain cannot be changed afterwards — not by you, not by us.",
    cards: [
      ["Fixed supply, no allocation", "{supply} tokens are minted to the curve and nowhere else. The only way to hold some is to buy them; the creator can make the first buy inside the launch transaction, before anyone else sees the curve."],
      ["A market you choose", "The curve is priced in the asset you pick: the gas coin, a dollar stand-in, or a tokenized stock. Graduation seeds a locked Uniswap V4 pool paired with that asset."],
      ["A fee template", "Standard sends the creator share to you (or into a buyback lock). The Wall turns it into a treasury of the paired stock that defends a floor. Proof-of-Fee turns it into buybacks paid to the traders who earned them."],
    ],
    cta: "Open the wizard",
  },
  detail: {
    eyebrow: "THE DETAILS",
    title: "Everything the contracts do",
    body: "Search or filter. Each entry describes what the code enforces, not what we hope.",
    search: "Search the details",
    tags: { all: "ALL", launch: "LAUNCH", trade: "TRADE", fees: "FEES", templates: "TEMPLATES", pound: "THE POUND", trust: "TRUST" },
    noMatch: "Nothing matches “{q}”.",
    items: [
      {
        kicker: "ARCHITECTURE",
        title: "Seven contracts, one launch",
        tag: "trust",
        body: [
          "LaunchFactory deploys the token and its curve in one transaction and snapshots the fee terms. LaunchToken is a fixed {supplyShort}-supply ERC-20 minted entirely to its curve — no owner, no mint. BondingCurve is a constant-product curve in the launch's quote asset; buy and sell enforce an on-chain minimum-received bound and there is no deadline parameter.",
          "MemeHook is the Uniswap V4 hook on graduated pools; it keeps charging the fee. LaunchLocker holds the graduated V4 position forever — no withdrawal path exists. BuybackVault holds fee-funded buybacks on a linear vest over {vest} (locked, never burned). FeeEscrow is the claimable ledger for creator and protocol fee balances.",
          "The trading engine is a source-identical port of Pons V2, diffable byte for byte against the verified upstream.",
        ],
      },
      {
        kicker: "LAUNCH FLOW",
        title: "What the launch transaction does",
        tag: "launch",
        body: [
          "One transaction deploys the token and the curve and mints the full supply to the curve. The launch fee is paid in the gas coin, plus gas.",
          "Add a first buy and it rides the same transaction: the launch router deploys the curve and fills your buy in the launch block, before any other wallet can see it. As the creator you are snipe-tax-exempt, so it settles untaxed and sets the opening price.",
          "From then on anyone buys and sells on the curve. Price rises as supply is bought — fair discovery, no presale. When the real quote reserve crosses the threshold, the curve drains into a full-range Uniswap V4 position that is locked forever.",
        ],
        link: { href: "/create", label: "Open the wizard" },
      },
      {
        kicker: "INPUTS",
        title: "What a launch needs",
        tag: "launch",
        body: [
          "A name and a ticker (up to {symbolMax} letters or digits). Optionally an image (uploaded and linked in the token's on-chain logo field), a description and links, written into the token's metadata.",
          "The paired market, the template, and for a Standard launch the fee mode with an optional creator tax (up to the factory's maximum) and a fee recipient. Optionally a first buy in the quote asset.",
        ],
      },
      {
        kicker: "FEE MODES",
        title: "What the creator share does",
        tag: "fees",
        body: [
          "Chosen at launch and snapshotted on chain. Creator fees: your whole share goes to the wallet you chose, plus the creator tax if you set one. Buyback & lock: half of your share buys the token on its own curve when the platform sweeps fees and locks it in the vault, vesting over {vest}; the other half is yours.",
          "Holder rewards and fee sharing across several wallets are planned and need a contract upgrade; the wizard does not offer them.",
        ],
      },
      {
        kicker: "TEMPLATES",
        title: "The Wall and Proof-of-Fee",
        tag: "templates",
        body: [
          "A template decides what the creator-fee share of every trade does. The launch router writes it on chain at launch: creator-fee mode with a per-launch contract as the only recipient. No wallet can be substituted later, and the fee mode does not apply.",
          "The Wall needs a stock as the paired market. Creator fees are claimed (by anyone) into a treasury that holds the stock and never sells it. A configured share of each claim streams to stakers of the token over {wallStream}, paid in the stock. The rest is a standing bid under book value: while the token is on its curve, a keeper may buy and burn when spot trades under book value × (1 + margin), within a daily budget. Book value = pile ÷ circulating supply, both read on chain.",
          "Proof-of-Fee: creator fees buy the token back on its own curve. Each round ({pofRoundMin} to {pofRoundMax}) the buyback is paid to the traders whose fees funded it, by share of quote spent through the official PoF router (“Work”). Direct curve buys and all sells earn no Work. Under-subscribed rounds pay out pro-rata and the rest rolls forward. Nothing is minted.",
        ],
      },
      {
        kicker: "PROMISES",
        title: "What is and is not promised",
        tag: "templates",
        body: [
          "The Wall is a bid funded by fees, not a guarantee: it can only spend what fees have put in the pile, at most the daily budget, and only while the token is on its curve. Book value is not a price floor.",
          "Proof-of-Fee rewards can never exceed what fees actually bought back; a round with no fees pays nothing. Staking rewards are fees actually collected; the rate changes with every claim and is not an APY. On testnet the stock assets are stand-ins with no redemption. Everything on a token page is read from that launch's own contracts, and a dash means unknown, never zero.",
        ],
      },
      {
        kicker: "AUTO-BUY",
        title: "Scheduled buys through the executor",
        tag: "trade",
        body: [
          "Any curve token's page can schedule buys through the RadianExecutor. You deposit the quote asset (and the gas coin for gas when the quote is an ERC-20), then sign one EIP-712 message that caps the amount per buy, the interval, the number of buys, the maximum gas price, a price floor and an expiry. A keeper run by the indexer executes the buys on that schedule; tokens always land in your wallet.",
          "The fee is {execFee} of the quote actually spent (a contract constant) plus a gas stipend per buy, both taken from your deposit. Withdrawing your deposit and cancelling every schedule are plain transactions that need nobody's cooperation. The keeper cannot exceed the caps you signed and cannot move funds anywhere but into a buy of the token you named.",
        ],
      },
      {
        kicker: "ANTI-SNIPE",
        title: "The opening seconds",
        tag: "trade",
        body: ["For the first seconds after launch a decaying tax applies to non-exempt buyers on the quote leg, so a launch cannot be sniped in its opening block. The creator and their declared wallets are exempt; the tax lifts automatically. The trade form shows the current rate and includes it in the estimate."],
      },
      {
        kicker: "TRADING",
        title: "Buying and selling on the curve",
        tag: "trade",
        body: [
          "A buy pays the fee, the creator tax and any snipe tax off the quote leg, then swaps on the constant product; it is clamped to the sellable allocation. A sell swaps first and pays the fee and creator tax off the gross quote. The minimum received you see is handed to the contract, which reverts the trade instead of filling below it.",
          "Where The Pound runs, trades go through the Radian router, which forwards to the curve at the same price and tags the referrer who brought you. Proof-of-Fee buys go through the PoF router so they count as Work.",
        ],
        link: { href: "/swap", label: "Open the swap console" },
      },
      {
        kicker: "FEES",
        title: "Where every fee goes",
        tag: "pound",
        when: "pound",
        body: [
          "The trade fee is {fee} of every swap, on the quote-asset leg, before and after graduation. Half of it is the creator's: to the fee escrow, claimable any time (a quarter when Buyback & lock is on, the other quarter into the vault). A creator tax, if set, is paid entirely to the creator on top.",
          "The other half is the protocol share, swept into the PoundVault, which settles it in this order: {ref} of the fee to whoever referred the buyer and {launcherRef} to whoever referred the token's creator (referral tags travel with router trades; self-referrals are dropped); then {burn} of what remains buys the next Pack coin and sends it to a dead address, at most once every {burnInterval}, within {burnSlippage} of spot; the remainder goes to the treasury.",
          "Launches from before The Pound keep the fee policy they were created with and carry no referral tags. The live split, the Pack and every settlement are on The Pound page; the roles behind it are on Factory.",
        ],
        link: { href: "/earn", label: "The Pound" },
      },
      {
        kicker: "FEES",
        title: "Where every fee goes",
        tag: "fees",
        when: "legacy",
        body: [
          "The trade fee is {fee} of every swap, on the quote-asset leg, before and after graduation. The protocol share goes to the protocol recipient via the escrow; the rest is the creator's, claimable any time (half of it buys the token back and locks it when Buyback & lock is on). A creator tax, if set, is paid entirely to the creator on top.",
        ],
      },
      {
        kicker: "REFERRALS",
        title: "Earning on trades you did not make",
        tag: "pound",
        when: "pound",
        body: [
          "Your referral link is your address. It stores a tag in the visitor's browser for {refTtl}; every router trade and launch then carries it, and the vault credits you {ref} of the fee. Refer a creator and you earn the same on every trade of their token for its life.",
          "Accruals become claimable after the vault's next settlement (the keeper settles hourly). Claim on The Pound page or in your portfolio, in the token's quote asset.",
        ],
        link: { href: "/earn", label: "Get your link" },
      },
      {
        kicker: "GRADUATION",
        title: "From the curve to Uniswap V4",
        tag: "trade",
        body: ["When the curve's real reserve reaches the graduation threshold for its quote asset, the reserve and the remaining tokens seed a full-range Uniswap V4 position held by the locker forever. Curve trading closes; trading continues on the pool, where the hook keeps charging the same fee with the same split."],
      },
      {
        kicker: "TRUST",
        title: "What the site checks before you sign",
        tag: "trust",
        body: [
          "Each platform contract's runtime code hash was recorded at deploy. Before the site lets you launch or trade, it re-hashes the live code and compares; a proven mismatch disables both. An RPC failure only shows as unverified.",
          "Your wallet signs every transaction; Radian never holds your funds and cannot reverse anything. A transaction whose receipt a tab loses is resolved from chain and never resent.",
        ],
        link: { href: "/verify", label: "Verify the contracts" },
      },
    ],
  },
  qa: {
    eyebrow: "QUESTIONS",
    title: "Straight answers",
    body: "The short version. Not advice, and not a promise.",
    groups: [
      {
        name: "LAUNCHING",
        items: [
          { q: "How much does a launch cost?", a: "The factory's launch fee in the gas coin, plus gas. The wizard reads the current fee from the contract and shows it on the button." },
          { q: "Can I change the fee or the template later?", a: "No. Supply, curve, fee mode, creator tax, recipient and template are snapshotted at launch. Neither you nor Radian can edit them." },
          { q: "Do I get any tokens?", a: "Only what you buy. A first buy in the launch transaction is untaxed and sets the opening price; nothing is allocated." },
        ],
      },
      {
        name: "TRADING",
        items: [
          { q: "Why is there a snipe tax?", a: "So the opening block cannot be bought out by bots. It starts high and decays to zero over the first seconds; the creator and their declared wallets are exempt." },
          { q: "What does slippage tolerance do?", a: "It sets the minimum you accept. The contract enforces it: if the fill would be lower, the transaction reverts and you keep your funds." },
          { q: "Can I trade after graduation?", a: "Yes, on the Uniswap V4 pool. The curve closes; the site's trade form says so and links to the token on the explorer." },
        ],
      },
      {
        name: "FEES",
        items: [
          { q: "Who gets the {fee}?", a: "Half the creator (or their template), half the protocol. Where The Pound runs, the protocol half pays referrers first, then buys and burns the Pack, then funds the treasury." },
          { q: "Is there a platform token?", a: "Not where The Pound runs. Fees buy and burn other people's coins — the Pack — instead of minting one." },
          { q: "When can I claim?", a: "Creator fees once the keeper sweeps them off the curve (about hourly). Referral earnings after the vault's next settlement. Both from your portfolio." },
        ],
      },
      {
        name: "TRUST",
        items: [
          { q: "Is the code audited?", a: "The trading engine is a source-identical port of a verified upstream. The Radian-specific contracts have been reviewed internally, not by an external firm. Do not put in money you cannot afford to lose." },
          { q: "What can the multisig change?", a: "The launch fee, the launch configs, the approved quote assets, the fee split for future launches, and the Pack's coins. Never an existing launch's terms, and never your funds. Every role is listed on Factory." },
        ],
      },
    ],
  },
  contracts: { title: "Contracts", body: "Addresses for the active network. Runtime code hashes are pinned and re-checked on every visit. Verification proves source = bytecode; it is not an audit.", verify: "Hashes and how to reproduce them" },
  footer: [
    ["/create", "Launch a token"],
    ["/creators", "For creators"],
    ["/builders", "For builders"],
    ["/verify", "Verify"],
    ["/terms", "Terms & risks"],
  ],
};

const zh: LearnDoc = {
  eyebrow: "学习",
  title: ["Radian", "怎么运作"],
  sub: "一个币从一条按美元或股票定价的联合曲线开始，毕业进入永久锁定的 Uniswap V4 池，它赚到的每一笔费用都由合约来分。这一页就是全部规则。",
  ctas: ["浏览发射", "发射一个币", "The Pound"],
  toc: "本页目录",
  tocItems: [
    ["how", "四个步骤"],
    ["launching", "发射"],
    ["detail", "细节"],
    ["qa", "问答"],
    ["contracts", "合约"],
  ],
  how: { eyebrow: "循环", title: ["发射、交易、", "毕业、喂 Pack"] },
  launch: {
    eyebrow: "发射",
    title: ["一笔交易。", "三个决定。"],
    body: "向导只问一个名字、一个市场和一个费用模板，然后发一笔交易。它固定在链上的东西之后都改不了——你不能，我们也不能。",
    cards: [
      ["固定供给，没有份额", "{supply}个币铸到曲线上，别处一个也没有。想持有只能买；创作者可以在发射交易里完成首买，在任何人看到曲线之前。"],
      ["你选的市场", "曲线按你选的资产定价：燃气币、美元替身，或代币化股票。毕业时以该资产为配对建立锁定的 Uniswap V4 池。"],
      ["一个费用模板", "标准把创作者那一份给你（或锁进回购）。The Wall 把它变成配对股票的国库并守住地板。Proof-of-Fee 把它变成付给赚到它的交易者的回购。"],
    ],
    cta: "打开向导",
  },
  detail: {
    eyebrow: "细节",
    title: "合约做的每一件事",
    body: "搜索或筛选。每一条写的是代码强制的规则，不是我们的希望。",
    search: "搜索细节",
    tags: { all: "全部", launch: "发射", trade: "交易", fees: "费用", templates: "模板", pound: "THE POUND", trust: "信任" },
    noMatch: "没有匹配「{q}」的条目。",
    items: [
      {
        kicker: "架构",
        title: "七个合约，一次发射",
        tag: "trust",
        body: [
          "LaunchFactory 在一笔交易里部署代币和曲线，并快照费用条款。LaunchToken 是固定 {supplyShort}供给的 ERC-20，全部铸给曲线——没有 owner，不能增发。BondingCurve 是以发射计价资产计的常数乘积曲线；买卖在链上强制最少收到，没有 deadline 参数。",
          "MemeHook 是毕业后池子上的 Uniswap V4 hook，继续收取手续费。LaunchLocker 永久持有毕业后的 V4 仓位——不存在提取路径。BuybackVault 持有费用资助的回购，{vest}线性释放（锁定，不燃烧）。FeeEscrow 是创作者与协议费用余额的可领账本。",
          "交易引擎是 Pons V2 的源码级移植，可与已验证的上游逐字节比对。",
        ],
      },
      {
        kicker: "发射流程",
        title: "发射交易做了什么",
        tag: "launch",
        body: [
          "一笔交易部署代币和曲线，把全部供给铸给曲线。发射费以燃气币支付，另加 gas。",
          "加一笔首买，它就搭同一笔交易：发射路由部署曲线并在发射区块里成交你的买入，任何钱包都还没看到。作为创作者你免狙击税，所以它免税成交并定下开盘价。",
          "从此任何人都能在曲线上买卖。价格随买入上涨——公平发现，没有预售。真实报价储备越过阈值时，曲线注入永久锁定的全区间 Uniswap V4 仓位。",
        ],
        link: { href: "/create", label: "打开向导" },
      },
      {
        kicker: "输入",
        title: "发射需要什么",
        tag: "launch",
        body: [
          "一个名字和一个代号（最多 {symbolMax} 个字母或数字）。可选：图片（上传后链接写进代币链上 logo 字段）、简介和链接，写进代币元数据。",
          "计价市场、模板；标准发射还有费用模式，可选创作者税（最高到工厂的上限）和收款地址。可选一笔以计价资产计的首买。",
        ],
      },
      {
        kicker: "费用模式",
        title: "创作者那一份怎么用",
        tag: "fees",
        body: [
          "发射时选定并在链上快照。创作者费用：你那一份全部打到你选的钱包，外加你设定的创作者税。回购并锁定：平台清扫费用时，你那一份的一半在曲线上回购代币并锁进金库（{vest}线性释放）；另一半归你。",
          "持有人奖励和多钱包分账在计划中，需要合约升级；向导不提供。",
        ],
      },
      {
        kicker: "模板",
        title: "The Wall 与 Proof-of-Fee",
        tag: "templates",
        body: [
          "模板决定每笔交易里创作者那一份费用怎么用。发射路由在发射时把它写进链上：创作者费用模式，唯一收款方是一个按发射部署的合约。之后没有钱包能替换，费用模式也不再适用。",
          "The Wall 需要以股票作为计价市场。创作者费用（任何人都可触发）领进一个持有股票且永不卖出的国库。每次领取的一个设定比例 {wallStream}内流向代币的质押者，以股票支付。其余是账面价值之下的常驻买单：代币仍在曲线上时，keeper 可以在现价低于账面价值 ×（1 + 边际）时买入并燃烧，受每日预算限制。账面价值 = 堆 ÷ 流通供给，两者都从链上读。",
          "Proof-of-Fee：创作者费用在曲线上回购代币。每一轮（{pofRoundMin}到 {pofRoundMax}）的回购按经官方 PoF 路由花掉的报价占比（「Work」）付给撑起它的交易者。直接对曲线买入和所有卖出不计 Work。认购不足的回合按比例派发，其余滚入下一轮。不增发。",
        ],
      },
      {
        kicker: "承诺",
        title: "承诺了什么，没承诺什么",
        tag: "templates",
        body: [
          "The Wall 是费用资助的买单，不是保证：它只能花费用堆进来的，最多每日预算，且只在代币仍在曲线上时。账面价值不是价格地板。",
          "Proof-of-Fee 的奖励永远不会超过费用实际回购到的数量；没有费用的回合什么也不付。质押奖励是实际收到的费用；费率每次领取都会变，不是 APY。测试网上的股票资产是替身，不能赎回。代币页上的一切都从那次发射自己的合约读取，破折号表示未知，绝不是零。",
        ],
      },
      {
        kicker: "自动买入",
        title: "经执行器的定时买入",
        tag: "trade",
        body: [
          "任何曲线代币的页面都能经 RadianExecutor 安排定时买入。你把计价资产（计价资产是 ERC-20 时再加燃气币付 gas）存进执行器，签一条 EIP-712 消息，限定每笔金额、间隔、次数、最高 gas 价、价格上限和有效期。索引器运行的 keeper 按计划执行；代币永远落进你的钱包。",
          "费用是实际花掉的报价的 {execFee}（合约常数）加每笔的 gas 补贴，都从你的存款扣。提取存款和取消所有计划都是普通交易，不需要任何人配合。keeper 不能超过你签的上限，也不能把资金挪到你指定代币的买入之外。",
        ],
      },
      {
        kicker: "反狙击",
        title: "开盘那几秒",
        tag: "trade",
        body: ["发射后的前几秒，非豁免买家在报价一侧付一笔逐渐衰减的税，所以发射不会在开盘区块被狙击。创作者和其声明的钱包豁免；税自动解除。交易表单显示当前税率并算进估算。"],
      },
      {
        kicker: "交易",
        title: "在曲线上买卖",
        tag: "trade",
        body: [
          "买入先从报价一侧扣手续费、创作者税和狙击税（如有），再按常数乘积兑换；受可售配额限制。卖出先兑换，再从毛报价里扣手续费和创作者税。你看到的最少收到会交给合约，成交低于它时交易回滚而不是成交。",
          "在 The Pound 运行的网络上，交易经 Radian 路由，它以同样的价格转给曲线并标记带你来的推荐人。Proof-of-Fee 的买入经 PoF 路由，计入 Work。",
        ],
        link: { href: "/swap", label: "打开兑换台" },
      },
      {
        kicker: "费用",
        title: "每一笔费用去哪",
        tag: "pound",
        when: "pound",
        body: [
          "手续费是每笔兑换的 {fee}，在计价资产一侧，毕业前后都一样。一半归创作者：进费用托管，随时可领（开启回购并锁定时四分之一给你、四分之一进金库）。创作者税（如设）全部另付给创作者。",
          "另一半是协议份额，清扫进 PoundVault，按这个顺序结算：手续费的 {ref} 给带来买家的推荐人，{launcherRef} 给带来创作者的推荐人（推荐标记随路由交易传递；自我推荐作废）；然后余下的 {burn} 买入 Pack 里的下一个币并送进死地址，每 {burnInterval}最多一次，在现价 {burnSlippage} 之内；剩余进国库。",
          "早于 The Pound 的发射保留它们创建时的费用政策，不带推荐标记。实时分成、Pack 和每次结算都在 The Pound 页；背后的角色在工厂页。",
        ],
        link: { href: "/earn", label: "The Pound" },
      },
      {
        kicker: "费用",
        title: "每一笔费用去哪",
        tag: "fees",
        when: "legacy",
        body: ["手续费是每笔兑换的 {fee}，在计价资产一侧，毕业前后都一样。协议份额经托管付给协议收款方；其余归创作者，随时可领（开启回购并锁定时其中一半回购代币并锁定）。创作者税（如设）全部另付给创作者。"],
      },
      {
        kicker: "推荐",
        title: "从不是你做的交易里赚",
        tag: "pound",
        when: "pound",
        body: [
          "你的推荐链接就是你的地址。它在访客的浏览器里存一个标记 {refTtl}；之后每笔经路由的交易和发射都带着它，金库记给你手续费的 {ref}。推荐一位创作者，你在他们代币的每笔交易上都赚同样的比例，伴随代币一生。",
          "累计在金库下一次结算后可领（keeper 每小时结算）。在 The Pound 页或你的组合里领取，以该币的计价资产支付。",
        ],
        link: { href: "/earn", label: "获取你的链接" },
      },
      {
        kicker: "毕业",
        title: "从曲线到 Uniswap V4",
        tag: "trade",
        body: ["曲线的真实储备达到其计价资产的毕业阈值时，储备和剩余代币注入一个由锁定器永久持有的全区间 Uniswap V4 仓位。曲线交易关闭；交易在池子里继续，hook 继续以同样的分成收取同样的费用。"],
      },
      {
        kicker: "信任",
        title: "签名前网站核对什么",
        tag: "trust",
        body: [
          "每个平台合约的运行时代码哈希在部署时记录。在允许你发射或交易之前，网站重新哈希链上代码并比对；证实不一致就禁用两者。RPC 失败只显示为未核验。",
          "你的钱包签每一笔交易；Radian 从不经手你的资金，也不能撤销任何东西。标签页丢失回执的交易从链上解析，绝不重发。",
        ],
        link: { href: "/verify", label: "核验合约" },
      },
    ],
  },
  qa: {
    eyebrow: "问答",
    title: "直接的回答",
    body: "短版本。不是建议，也不是承诺。",
    groups: [
      {
        name: "发射",
        items: [
          { q: "发射要多少钱？", a: "工厂的发射费，以燃气币计，另加 gas。向导从合约读取当前费用并显示在按钮上。" },
          { q: "之后能改费用或模板吗？", a: "不能。供给、曲线、费用模式、创作者税、收款地址和模板在发射时快照。你和 Radian 都改不了。" },
          { q: "我能拿到币吗？", a: "只有你买的。发射交易里的首买免税并定下开盘价；没有任何分配。" },
        ],
      },
      {
        name: "交易",
        items: [
          { q: "为什么有狙击税？", a: "让开盘区块不会被机器人买空。它从高开始，在前几秒内衰减到零；创作者和其声明的钱包豁免。" },
          { q: "滑点容忍是什么？", a: "它设定你接受的最少数量。合约强制执行：成交会更低时，交易回滚，你的资金原封不动。" },
          { q: "毕业后还能交易吗？", a: "能，在 Uniswap V4 池里。曲线关闭；网站的交易表单会说明并链接到浏览器上的代币。" },
        ],
      },
      {
        name: "费用",
        items: [
          { q: "{fee} 归谁？", a: "一半给创作者（或其模板），一半给协议。在 The Pound 运行的网络上，协议这一半先付推荐人，再买入并燃烧 Pack，再进国库。" },
          { q: "有平台币吗？", a: "The Pound 运行的地方没有。费用买入并燃烧别人的币——Pack——而不是增发一个。" },
          { q: "什么时候能领？", a: "创作者费用要等 keeper 从曲线上清扫（约每小时）。推荐收益要等金库下一次结算。都在你的组合页领。" },
        ],
      },
      {
        name: "信任",
        items: [
          { q: "代码审计过吗？", a: "交易引擎是已验证上游的源码级移植。Radian 自己的合约经过内部审阅，未经外部机构审计。不要投入你输不起的钱。" },
          { q: "多签能改什么？", a: "发射费、发射配置、批准的计价资产、未来发射的费用分成，以及 Pack 里的币。改不了任何已有发射的条款，也碰不到你的资金。每个角色都列在工厂页。" },
        ],
      },
    ],
  },
  contracts: { title: "合约", body: "当前网络的地址。运行时代码哈希已钉住，每次访问重新核对。验证只证明源码 = 字节码，不是审计。", verify: "哈希与复现方法" },
  footer: [
    ["/create", "发射一个币"],
    ["/creators", "给创作者"],
    ["/builders", "给开发者"],
    ["/verify", "核验"],
    ["/terms", "条款与风险"],
  ],
};

/** The raw copy, placeholders included; pages render learnDoc(lang) instead. */
export const LEARN = { en, zh } as const;

/** Every placeholder the Learn copy (this module and the learn.* dictionary keys) may use. */
export type LearnVar =
  | "supply" | "supplyShort" | "fee" | "execFee" | "ref" | "launcherRef" | "burn" | "burnInterval" | "burnSlippage"
  | "vest" | "wallStream" | "pofRoundMin" | "pofRoundMax" | "refTtl" | "symbolMax";

const UNITS: [secs: number, en: string, zh: string][] = [
  [365 * 86400, "year", "年"],
  [86400, "day", "天"],
  [3600, "hour", "小时"],
  [60, "minute", "分钟"],
  [1, "second", "秒"],
];

/** The one formatter for protocol numbers in prose: percentages, whole-token counts and durations. */
export const fmt = {
  /** basis points → "1%", "0.5%", "5.55%", "70%" */
  pct: (bps: number): string => `${+(bps / 100).toFixed(2)}%`,
  /** whole tokens → "1,000,000,000" / "10 亿" */
  count: (n: number, lang: Lang): string => (lang === "zh" ? fmt.compact(n, lang) : n.toLocaleString("en-US")),
  /** whole tokens → "1B" / "10 亿" (billions or millions; the supply is a round number) */
  compact: (n: number, lang: Lang): string => (lang === "zh" ? `${n / 1e8} 亿` : n % 1e9 === 0 ? `${n / 1e9}B` : `${n / 1e6}M`),
  /** seconds → the largest unit that divides evenly ("7 days", "5 years"); hours stay hours below two days ("24 hours") */
  duration: (secs: number, lang: Lang): string => {
    const [u, en, zh] = UNITS.find(([u]) => secs % u === 0 && !(u === 86400 && secs < 2 * 86400)) ?? UNITS[UNITS.length - 1];
    const n = secs / u;
    return lang === "zh" ? `${n} ${zh}` : `${n} ${en}${n === 1 ? "" : "s"}`;
  },
};

/** The fill map: each placeholder's value, formatted for the language. Also the vars for t("learn.step…"). */
export function learnVars(lang: Lang): Record<LearnVar, string> {
  const P = PROTOCOL;
  return {
    supply: fmt.count(P.supply, lang),
    supplyShort: fmt.compact(P.supply, lang),
    fee: fmt.pct(P.tradeFeeBps),
    execFee: fmt.pct(P.executorFeeBps),
    ref: fmt.pct(P.referralBps),
    launcherRef: fmt.pct(P.launcherBps),
    burn: fmt.pct(P.burnShareBps),
    burnInterval: fmt.duration(P.burnMinIntervalSecs, lang),
    burnSlippage: fmt.pct(P.burnMaxSlippageBps),
    vest: fmt.duration(P.buybackVestSecs, lang),
    wallStream: fmt.duration(P.wallStreamSecs, lang),
    pofRoundMin: fmt.duration(P.pofRoundMinSecs, lang),
    pofRoundMax: fmt.duration(P.pofRoundMaxSecs, lang),
    refTtl: fmt.duration(P.referralTagTtlSecs, lang),
    symbolMax: String(P.symbolMax),
  };
}

/** Replace every known {placeholder} in a string; unknown ones (the runtime {q}) stay. Same rule as the dictionary's t(). */
export function fillText(s: string, vars: Record<string, string>): string {
  for (const k in vars) s = s.split(`{${k}}`).join(vars[k]);
  return s;
}

function deepFill<T>(v: T, vars: Record<string, string>): T {
  if (typeof v === "string") return fillText(v, vars) as T;
  if (Array.isArray(v)) return v.map((x) => deepFill(x, vars)) as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = deepFill(x, vars);
    return o as T;
  }
  return v;
}

/** The Learn copy for a language with its numbers filled in — what the page renders. */
export function learnDoc(lang: Lang): LearnDoc {
  return deepFill(LEARN[lang] ?? LEARN.en, learnVars(lang));
}
