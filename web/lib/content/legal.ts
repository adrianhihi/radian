// Terms and risk disclosure, English and Chinese. Facts only; nothing here is a promise.

export interface LegalDoc {
  title: string;
  intro: string;
  sections: { h: string; p: string[] }[];
}

const en: LegalDoc = {
  title: "Terms & risks",
  intro: "Read this before you trade. Radian is a website that lets you interact with smart contracts on public blockchains. Your wallet signs every transaction; Radian never holds your funds and cannot reverse anything.",
  sections: [
    {
      h: "What Radian is",
      p: [
        "A token factory, bonding curves, Uniswap V4 pools and a few optional add-on contracts (launch templates, delegated buys, The Pound's vault and burner), plus this site as a window onto them. Every action works directly against the contracts, with or without us.",
        "The contracts are listed with their addresses and pinned code hashes on the Verify and Factory pages. The site refuses to launch or trade if the live code does not match those hashes.",
      ],
    },
    {
      h: "Not audited",
      p: ["The trading engine is a source-identical port of a verified upstream launchpad. The Radian-specific contracts have been reviewed internally but have not been audited by an external firm. Bugs can exist. Do not put in money you cannot afford to lose."],
    },
    {
      h: "Risks you take",
      p: [
        "Tokens launched here can lose all their value. Most will. Nothing on this site is a recommendation to buy or sell anything.",
        "A token's quote asset is another on-chain asset (a stablecoin, the gas coin, or a tokenized stock). If that asset's issuer pauses, upgrades or restricts it, curves priced in it can stop working until the issuer acts. Tokenized stocks are subject to their issuer's own rules and regional restrictions; you are responsible for being allowed to hold them where you live.",
        "Prices on a bonding curve move with every trade. Early buys pay a snipe tax that decays over seconds. Graduation into a Uniswap V4 pool changes how price is set. A creator can add a fee on trades; it is shown before you trade.",
        "The Wall is a bid funded by fees, not a guarantee; Proof-of-Fee pays only what fees actually bought back; referral earnings exist only when fees are paid. None of these is a yield.",
        "Wallet security is yours. Radian cannot recover a lost key or a signed transaction.",
      ],
    },
    {
      h: "Fees",
      p: ["A fixed launch fee and a percentage fee on every curve trade are charged by the contracts and shown on the Factory page for the current network. Part of the trade fee goes to the protocol, the rest to the token's creator or to the template the creator chose. Where The Pound runs, the protocol share pays referrers, buys and burns the Pack, and funds the treasury, in that order."],
    },
    {
      h: "No warranty, your responsibility",
      p: [
        "The site and contracts are provided as they are, without warranties of any kind. You use them at your own risk and you are responsible for complying with the laws that apply to you, including tax and securities rules. If you are not allowed to use a service like this where you live, do not use it.",
        "Radian is not affiliated with Circle, Robinhood, Uniswap or Pons-Labs. Their trademarks belong to them.",
      ],
    },
  ],
};

const zh: LegalDoc = {
  title: "条款与风险",
  intro: "交易之前先读这个。Radian 是一个让你与公链上智能合约交互的网站。你的钱包签每一笔交易；Radian 从不经手你的资金，也不能撤销任何东西。",
  sections: [
    {
      h: "Radian 是什么",
      p: [
        "一个代币工厂、若干联合曲线、Uniswap V4 池和几个可选的附加合约（发射模板、委托买入、The Pound 的金库与燃烧器），加上这个作为窗口的网站。每个动作都直接对合约执行，有没有我们都一样。",
        "合约的地址和钉住的代码哈希列在核验页与工厂页。链上代码与这些哈希不一致时，网站拒绝发射和交易。",
      ],
    },
    {
      h: "未经审计",
      p: ["交易引擎是已验证上游发射台的源码级移植。Radian 自己的合约经过内部审阅，未经外部机构审计。可能存在 bug。不要投入你输不起的钱。"],
    },
    {
      h: "你承担的风险",
      p: [
        "这里发射的代币可能归零。大多数会。本站没有任何内容是买卖建议。",
        "代币的计价资产是另一个链上资产（稳定币、燃气币或代币化股票）。如果该资产的发行方暂停、升级或限制它，以它计价的曲线可能停摆，直到发行方处理。代币化股票受其发行方规则和地域限制约束；你要自行确认所在地允许持有。",
        "联合曲线上的价格随每笔交易变化。早期买入付一笔几秒内衰减的狙击税。毕业进 Uniswap V4 池后定价方式改变。创作者可以在交易上加税；交易前会显示。",
        "The Wall 是费用资助的买单，不是保证；Proof-of-Fee 只付费用实际回购到的；推荐收益只在有费用支付时存在。这些都不是收益率。",
        "钱包安全由你负责。Radian 无法找回丢失的私钥或已签名的交易。",
      ],
    },
    {
      h: "费用",
      p: ["固定的发射费和每笔曲线交易的百分比手续费由合约收取，当前网络的数值显示在工厂页。手续费的一部分归协议，其余归代币创作者或创作者选择的模板。在 The Pound 运行的网络上，协议份额依次付给推荐人、买入并燃烧 Pack、注入国库。"],
    },
    {
      h: "无担保，责任自负",
      p: [
        "网站与合约按现状提供，不作任何担保。你自担风险使用，并自行遵守适用于你的法律，包括税务与证券规则。如果你所在地不允许使用此类服务，请不要使用。",
        "Radian 与 Circle、Robinhood、Uniswap、Pons-Labs 无关联。它们的商标归各自所有。",
      ],
    },
  ],
};

export const TERMS = { en, zh } as const;

// ---- Privacy ----

const privacyEn: LegalDoc = {
  title: "Privacy",
  intro: "What this site keeps, what it reads, and who sees what. There are no accounts, no cookies set by Radian and no analytics.",
  sections: [
    {
      h: "No accounts",
      p: ["There is nothing to sign up for. Your wallet address is your identity on Radian; a name, bio or X handle exists only if you sign one on your profile page, and it is public."],
    },
    {
      h: "Wallet connection",
      p: [
        "Sign-in and embedded wallets are provided by Privy. If you sign in with an email or Google account, Privy processes that login and holds the embedded wallet's key material in its own infrastructure under its own privacy policy; Radian never sees a key. Injected wallets (MetaMask and the like) talk to the site directly.",
      ],
    },
    {
      h: "What is public by nature",
      p: [
        "Everything on a public blockchain: your address, balances, trades and launches.",
        "Everything you sign for the indexer: wall lines, profile fields, logos. The indexer serves them to anyone who asks.",
      ],
    },
    {
      h: "What stays in your browser",
      p: [
        "Language and theme (radian.lang, radian.theme), the chosen network (radian.network), the slippage setting (radian.slippageBps), the launch draft (radian.draft.v1), the transactions this browser sent (radian.txlog.v1), a transaction still waiting for its receipt (radian.pending.<network>), the referral tag from a link you followed (kept 30 days) and the launches this browser made (a local registry).",
        "Clearing site data removes them. None of it reaches Radian's servers.",
      ],
    },
    {
      h: "What the app reads, and from whom",
      p: [
        "The RPC node of the network you chose: your IP address reaches that node operator with every read. The Radian indexer, hosted on Railway: launch lists, trades, walls, profiles and logos. logo.dev for stock logos: your IP address reaches it with the image request. Stock reference prices come from Yahoo Finance through our own server, not from your browser. The site itself is served by Vercel.",
      ],
    },
    {
      h: "Cookies and analytics",
      p: ["Radian sets none. Privy may keep its own storage for your session."],
    },
    {
      h: "We do not sell data",
      p: ["Radian has no user database beyond the signed profiles. Nothing is sold or shared for advertising."],
    },
  ],
};

const privacyZh: LegalDoc = {
  title: "隐私",
  intro: "这个网站保存什么、读取什么、谁能看到什么。没有账号，Radian 不设 cookie，也没有分析统计。",
  sections: [
    { h: "没有账号", p: ["没有任何需要注册的东西。你的钱包地址就是你在 Radian 的身份；名字、简介、X 账号只有在你于资料页签名设置后才存在，并且是公开的。"] },
    {
      h: "钱包连接",
      p: ["登录和内嵌钱包由 Privy 提供。用邮箱或 Google 登录时，由 Privy 处理登录并在其自己的基础设施中、按其隐私政策保管内嵌钱包的密钥材料；Radian 永远看不到密钥。注入式钱包（MetaMask 等）直接与本站对话。"],
    },
    { h: "本来就公开的东西", p: ["公链上的一切：你的地址、余额、交易和发射。", "你为索引器签名的一切：留言墙、资料字段、logo。索引器把它们提供给任何请求者。"] },
    {
      h: "留在你浏览器里的东西",
      p: [
        "语言和主题（radian.lang、radian.theme）、所选网络（radian.network）、滑点设置（radian.slippageBps）、发射草稿（radian.draft.v1）、本浏览器发出过的交易（radian.txlog.v1）、仍在等回执的交易（radian.pending.<network>）、你点过的推荐链接的标记（保留 30 天）、以及本浏览器发起过的发射（本地登记）。",
        "清除站点数据即可删除。它们都不会到达 Radian 的服务器。",
      ],
    },
    {
      h: "应用读取什么、从谁那里读",
      p: ["你所选网络的 RPC 节点：每次读取，你的 IP 地址都会到达该节点运营方。托管在 Railway 上的 Radian 索引器：发射列表、交易、留言墙、资料和 logo。logo.dev 提供股票 logo：请求图片时你的 IP 会到达它。股票参考价来自 Yahoo Finance，经由我们自己的服务器获取，不经你的浏览器。网站本身由 Vercel 提供服务。"],
    },
    { h: "Cookie 与统计", p: ["Radian 不设任何 cookie。Privy 可能为你的会话保留它自己的存储。"] },
    { h: "我们不出售数据", p: ["除签名资料外 Radian 没有用户数据库。没有任何东西被出售或用于广告分享。"] },
  ],
};

export const PRIVACY = { en: privacyEn, zh: privacyZh } as const;

// ---- Risk disclosure ----

const riskEn: LegalDoc = {
  title: "Risk disclosure",
  intro: "Plain statements of what can go wrong. Read them as facts about the mechanics, not as reassurance.",
  sections: [
    { h: "You can lose money", p: ["Tokens launched here can lose all of their value, and most do. Nothing on this site is a recommendation to buy or sell anything."] },
    {
      h: "Where things stand today",
      p: [
        "The trading engine is a source-identical port of a verified upstream launchpad. The Radian-specific contracts (launch templates, delegated buys, The Pound) have been reviewed internally and have not been audited by an external firm. Bugs can exist.",
        "Testnets use stand-in dollars and stocks with unlimited minters: a demo of the mechanic, not an asset. A live network trades real assets.",
      ],
    },
    {
      h: "Smart-contract and transaction risk",
      p: ["A transaction can revert and still cost gas; a receipt can be delayed; a contract can have a bug. Your wallet signs exactly what the page shows, with the minimum output written into the transaction, so a worse price reverts instead of filling."],
    },
    {
      h: "The curve, the snipe tax and graduation",
      p: ["Prices move with every trade. Buys in the first seconds after a launch pay a snipe tax that decays to zero; the form shows it. At graduation the quote and the remaining tokens move into a Uniswap V4 pool held by the locker forever, and price discovery follows the pool from then on."],
    },
    {
      h: "Creator settings",
      p: ["A creator can set a tax on trades, shown before you trade, and chooses where their fee share goes. Fee policy is fixed at launch; only the fee recipient can change, and only by the creator."],
    },
    {
      h: "The Wall and Proof-of-Fee",
      p: ["The Wall is a bid funded by fees under a book value read on chain; it can run out of budget and it never sells. Proof-of-Fee pays out only what fees actually bought back. Neither is a yield or a floor guarantee."],
    },
    {
      h: "The Pound and referrals",
      p: [
        "Referral shares exist only when fees are paid through the router with a tag; direct curve trades credit nobody. The Pack burn happens at most once per interval, within a slippage bound, on the pool's live price.",
        "The keeper that settles the vault and burns is run by Radian and can be late or down. While it is, accruals wait in the vault; nothing is lost and nothing is paid early.",
      ],
    },
    {
      h: "Quote assets and issuers",
      p: ["A launch is priced in another on-chain asset. If that asset's issuer pauses, upgrades or restricts it, curves priced in it can stop working until the issuer acts. Tokenized stocks follow their issuer's rules and regional restrictions; you are responsible for being allowed to hold them where you live."],
    },
    {
      h: "Verify the contract, not the site",
      p: ["Anyone can copy a front end. The addresses this site talks to, with their code hashes and three-word fingerprints, are on the Verify page; check them before you sign."],
    },
    { h: "Wallet security", p: ["Radian cannot recover a key, undo a signature or reverse a transaction."] },
  ],
};

const riskZh: LegalDoc = {
  title: "风险披露",
  intro: "直白地说清楚可能出什么问题。请把它们当作机制的事实，而不是安慰。",
  sections: [
    { h: "你可能亏钱", p: ["在这里发射的代币可能归零，大多数确实会。本站没有任何内容是买卖建议。"] },
    {
      h: "现在的状态",
      p: ["交易引擎是一个已验证上游发射台的源码级移植。Radian 自己的合约（发射模板、委托买入、The Pound）经过内部审阅，尚未经外部机构审计。可能存在漏洞。", "测试网使用带无限增发的美元和股票替身：是机制演示，不是资产。主网交易的是真实资产。"],
    },
    { h: "合约与交易风险", p: ["交易可能回滚但仍花 gas；回执可能延迟；合约可能有漏洞。你的钱包签的正是页面显示的内容，最低产出写进交易里，价格更差时会回滚而不是成交。"] },
    { h: "曲线、狙击税与毕业", p: ["价格随每笔交易变动。发射后最初几秒的买入要付一笔逐渐衰减到零的狙击税；表单会显示。毕业时计价资产和剩余代币进入由锁定合约永久持有的 Uniswap V4 池，此后价格由池子决定。"] },
    { h: "创作者设置", p: ["创作者可以对交易设税，交易前会显示；并决定自己的费用份额去向。费用政策在发射时固定；只有收款地址能改，且只能由创作者改。"] },
    { h: "The Wall 与 Proof-of-Fee", p: ["The Wall 是费用资助的、位于链上读取的账面价值之下的买单；预算可能用尽，且它从不卖出。Proof-of-Fee 只分发费用实际回购到的部分。两者都不是收益率，也不是价格下限保证。"] },
    {
      h: "The Pound 与推荐",
      p: ["推荐分成只在经路由、带标记付费的交易上存在；直接在曲线上的交易不记给任何人。Pack 燃烧每个间隔最多一次，在滑点范围内按池子的实时价格执行。", "结算金库和执行燃烧的 keeper 由 Radian 运行，可能延迟或停机。停机期间累计额留在金库里；不会丢失，也不会提前支付。"],
    },
    { h: "计价资产与发行方", p: ["发射以另一种链上资产计价。如果该资产的发行方暂停、升级或限制它，以它计价的曲线可能停摆，直到发行方处理。代币化股票遵循其发行方的规则和地区限制；你所在地是否允许持有，由你自己负责。"] },
    { h: "核验合约，而不是网站", p: ["任何人都能复制一个前端。本站实际调用的地址、它们的代码哈希和三词指纹都在核验页；签名前先核对。"] },
    { h: "钱包安全", p: ["Radian 无法找回密钥、撤销签名或回退交易。"] },
  ],
};

export const RISK = { en: riskEn, zh: riskZh } as const;
