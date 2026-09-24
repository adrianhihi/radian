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
