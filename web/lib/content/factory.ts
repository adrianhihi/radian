// The factory page's copy, English and Chinese. Every number on that page is
// read from the chain; this file only holds the words around them.

export interface FactoryDoc {
  eyebrow: string;
  title: string;
  intro: string;
  factoryLabel: string;
  notLive: string;
  readError: string;
  reading: string;
  cells: { launches: string; open: string; closed: string; launchFee: string; tradeFee: string; protocolShare: string };
  rules: { title: string; sub: string; head: [string, string, string]; rows: Record<"launchFee" | "tradeFee" | "protocolShare" | "buybackShare" | "referral" | "launcherReferral" | "packBurn" | "maxTax" | "snipe" | "impact", [string, string]>; snipeValue: string; packBurnMin: string };
  configs: { title: string; sub: string; head: string[]; none: string; note: string; yes: string; no: string; hookFee: string };
  quotes: { title: string; sub: string; head: string[]; kinds: { gas: string; standIn: string; stock: string; stable: string }; native: string };
  templates: { title: string; sub: string; items: Record<"standard" | "wall" | "pof", [string, string]>; launches: string; cta: string };
  registry: { title: string; sub: string; head: string[]; none: string; graduated: string; toGrad: string };
  roles: { title: string; sub: string; head: [string, string, string]; asExpected: string; notExpected: string; items: Record<"factoryOwner" | "hookOwner" | "recipientPound" | "recipient" | "burner" | "forwarder" | "sweep" | "routerKeeper" | "treasuryKeeper", [string, string]>; expectVault: string; expectRouter: string };
  contracts: { title: string; checkRunning: string; checkOk: string; checkBad: string; link: string; none: string; head: [string, string, string]; match: string; mismatch: string; unverified: string };
  others: { title: string; sub: string; head: [string, string, string]; switch: string };
}

const en: FactoryDoc = {
  eyebrow: "FACTORY",
  title: "One factory. Every launch.",
  intro: "Every Radian token on {chain} (chain {id}) comes out of one factory contract. This page reads the factory's live settings, lists what it has produced, and names who holds which role. It is what the chain says, not what we say.",
  factoryLabel: "Factory",
  notLive: "This network is not live yet. Nothing to read.",
  readError: "Could not read the factory: {err}",
  reading: "Reading the factory…",
  cells: { launches: "Launches", open: "Open", closed: "Closed", launchFee: "Launch fee", tradeFee: "Trade fee on every curve", protocolShare: "Protocol share of the fee" },
  rules: {
    title: "Launch rules",
    sub: "Applied by the factory and the hook to every token, whatever template it uses.",
    head: ["Rule", "Value", "What it means"],
    rows: {
      launchFee: ["Launch fee", "paid once, at launch, to the protocol"],
      tradeFee: ["Trade fee", "taken on every buy and sell on the curve"],
      protocolShare: ["Protocol share", "of each trade fee; the rest is the creator slice"],
      buybackShare: ["Buyback share", "of the creator slice locked for buybacks when the creator enables buyback"],
      referral: ["Referral share", "of each trade fee, to whoever referred the buyer — carved out of the protocol share by the PoundVault"],
      launcherReferral: ["Launcher-referral share", "of each trade fee, to whoever referred the token's creator"],
      packBurn: ["Pack burn share", "of what remains of the protocol share, spent buying and burning Pack coins; the rest funds the treasury"],
      maxTax: ["Max creator tax", "the most a creator can add on top of the trade fee"],
      snipe: ["Snipe tax", "on buys in the first seconds after launch, so bots cannot front-run the creator"],
      impact: ["Price impact cap", "the most one internal buyback may move the price"],
    },
    snipeValue: "{start} falling to 0 over {s}s",
    packBurnMin: "≥ 50%",
  },
  configs: {
    title: "Launch configs",
    sub: "A launch picks one config by id. Supply is fixed. The curve graduates into a Uniswap V4 pool with the tick spacing shown; the pool's own LP fee must be zero because the hook charges the trade fee.",
    head: ["Id", "Supply", "Curve fee", "Graduates at", "Phantom quote", "V4 LP fee", "Tick spacing", "Enabled"],
    none: "No configs readable.",
    note: "Graduation and phantom amounts above are for the {gas} quote. Each other quote asset carries its own pair below.",
    yes: "yes",
    no: "no",
    hookFee: "0 (the hook charges the fee)",
  },
  quotes: {
    title: "Quote assets",
    sub: "What a curve can be priced in. Only assets the factory owner approved can be paired; the site cannot add one.",
    head: ["Asset", "Kind", "Approved", "Graduates at", "Phantom quote", "Launches", "Address"],
    kinds: { gas: "gas coin", standIn: "stock stand-in (testnet)", stock: "tokenized stock", stable: "stablecoin" },
    native: "native",
  },
  templates: {
    title: "Templates",
    sub: "Every template uses the same factory and curve. A template only decides where the creator slice of fees goes. Per-launch contracts are clones of the implementations listed here.",
    items: {
      standard: ["Standard", "Fees go to the creator, or to a locked buyback if the creator chose that."],
      wall: ["The Wall", "Fees fund a treasury that buys the token back on the curve below book value, then runs a bid ladder on Uniswap V4 after graduation. Stakers earn a stream."],
      pof: ["Proof-of-Fee", "Fees fund buybacks whose proceeds go, each round, to the traders who paid the most fees through the router."],
    },
    launches: "{name} launches",
    cta: "Launch with a template",
  },
  registry: {
    title: "Registry",
    sub: "{total} launches, {graduated} graduated. The newest {n} are listed; Explore has all of them.",
    head: ["Token", "Template", "Quote", "Status", "Creator", "Curve"],
    none: "No launches indexed yet.",
    graduated: "graduated",
    toGrad: "{p}% to graduation",
  },
  roles: {
    title: "Roles",
    sub: "Who can change what. The keeper is a bot that only calls functions anyone may call; it holds no user funds.",
    head: ["Role", "Address", "What it can do"],
    asExpected: "as expected",
    notExpected: "not {what} — an owner change is pending",
    items: {
      factoryOwner: ["Factory owner", "sets the launch fee, launch configs, approved quote assets and the launch forwarder"],
      hookOwner: ["Hook owner", "sets the trade fee split and the price-impact cap for every curve"],
      recipientPound: ["Protocol fee recipient", "the PoundVault: settles the protocol share into referral accruals, the Pack burn pool and the treasury"],
      recipient: ["Protocol fee recipient", "receives the protocol share of trade fees"],
      burner: ["Pack burner", "spends the burn pool, in rotation, on the Pack (Safe-curated coins with a V4 pool here) and sends what it buys to 0x…dEaD"],
      forwarder: ["Launch forwarder", "the only contract allowed to launch on someone's behalf; this site launches through it"],
      sweep: ["Fee sweep operator", "the keeper: moves earned fees off every curve about once an hour"],
      routerKeeper: ["Router keeper", "the keeper: Wall defends and ladders, Proof-of-Fee buybacks, delegated buys, stuck graduations"],
      treasuryKeeper: ["$RADIAN treasury keeper", "the keeper: buys back $RADIAN with protocol fees and pays stakers"],
    },
    expectVault: "the PoundVault",
    expectRouter: "this site's router",
  },
  contracts: {
    title: "Contracts on {chain}",
    checkRunning: "Live identity check: running.",
    checkOk: "Live identity check: every pinned contract matches its recorded code hash.",
    checkBad: "Live identity check: a pinned contract does NOT match.",
    link: "Hashes and how to reproduce them",
    none: "Nothing pinned on this network.",
    head: ["Contract", "Address", "Live"],
    match: "match",
    mismatch: "MISMATCH",
    unverified: "unverified",
  },
  others: { title: "Other networks", sub: "The same factory design runs on each chain below, with its own addresses and its own indexer.", head: ["Network", "Chain", "Factory"], switch: "Switch" },
};

const zh: FactoryDoc = {
  eyebrow: "工厂",
  title: "一个工厂，每一次发射。",
  intro: "{chain}（链 {id}）上的每一个 Radian 代币都出自同一个工厂合约。本页读取工厂的实时设置，列出它生产过的东西，并点名谁持有哪个角色。这是链说的，不是我们说的。",
  factoryLabel: "工厂",
  notLive: "这个网络还没上线。没有可读的内容。",
  readError: "读不到工厂：{err}",
  reading: "读取工厂…",
  cells: { launches: "发射", open: "开放", closed: "关闭", launchFee: "发射费", tradeFee: "每条曲线的手续费", protocolShare: "协议占手续费的份额" },
  rules: {
    title: "发射规则",
    sub: "由工厂和 hook 施加于每个代币，无论用什么模板。",
    head: ["规则", "值", "含义"],
    rows: {
      launchFee: ["发射费", "发射时一次性付给协议"],
      tradeFee: ["手续费", "曲线上每笔买卖都收"],
      protocolShare: ["协议份额", "占每笔手续费；其余是创作者那一份"],
      buybackShare: ["回购份额", "创作者开启回购时，创作者那一份里锁进回购的比例"],
      referral: ["推荐份额", "占每笔手续费，给带来买家的推荐人——由 PoundVault 从协议份额里划出"],
      launcherReferral: ["发射推荐份额", "占每笔手续费，给带来代币创作者的推荐人"],
      packBurn: ["Pack 燃烧份额", "占协议份额扣除推荐后的余额，用于买入并燃烧 Pack 里的币；其余进国库"],
      maxTax: ["创作者税上限", "创作者能在手续费之上加的最高比例"],
      snipe: ["狙击税", "发射后前几秒的买入要付，防止机器人抢在创作者前面"],
      impact: ["价格冲击上限", "一次内部回购最多能推动价格的幅度"],
    },
    snipeValue: "{start}，{s} 秒内降到 0",
    packBurnMin: "≥ 50%",
  },
  configs: {
    title: "发射配置",
    sub: "每次发射按 id 选一个配置。供给固定。曲线毕业进入 Uniswap V4 池，tick 间距如表；池子自己的 LP 费率必须为零，因为手续费由 hook 收取。",
    head: ["Id", "供给", "曲线费率", "毕业于", "虚拟报价", "V4 LP 费率", "Tick 间距", "启用"],
    none: "读不到配置。",
    note: "上表的毕业与虚拟金额按 {gas} 计价。其它计价资产各有自己的一对，见下表。",
    yes: "是",
    no: "否",
    hookFee: "0（手续费由 hook 收取）",
  },
  quotes: {
    title: "计价资产",
    sub: "曲线可以用什么定价。只有工厂 owner 批准的资产能配对；网站不能自行添加。",
    head: ["资产", "类型", "已批准", "毕业于", "虚拟报价", "发射数", "地址"],
    kinds: { gas: "燃气币", standIn: "股票替身（测试网）", stock: "代币化股票", stable: "稳定币" },
    native: "原生",
  },
  templates: {
    title: "模板",
    sub: "每个模板都用同一个工厂和曲线。模板只决定创作者那一份费用去哪。按发射部署的合约是这里所列实现的克隆。",
    items: {
      standard: ["标准", "费用归创作者，或按创作者的选择锁进回购。"],
      wall: ["The Wall", "费用注入一个国库，在曲线上以低于账面价值回购代币，毕业后在 Uniswap V4 上跑买单阶梯。质押者赚取流。"],
      pof: ["Proof-of-Fee", "费用资助回购，每一轮的所得归经路由付费最多的交易者。"],
    },
    launches: "{name} 发射",
    cta: "用模板发射",
  },
  registry: {
    title: "注册表",
    sub: "{total} 次发射，{graduated} 次毕业。列出最新的 {n} 个；探索页有全部。",
    head: ["代币", "模板", "计价", "状态", "创作者", "曲线"],
    none: "还没有索引到发射。",
    graduated: "已毕业",
    toGrad: "距毕业 {p}%",
  },
  roles: {
    title: "角色",
    sub: "谁能改什么。keeper 是一个只调用任何人都能调用的函数的机器人；它不持有用户资金。",
    head: ["角色", "地址", "能做什么"],
    asExpected: "符合预期",
    notExpected: "不是{what}——有一个 owner 变更待处理",
    items: {
      factoryOwner: ["工厂 owner", "设置发射费、发射配置、批准的计价资产和发射转发器"],
      hookOwner: ["Hook owner", "设置每条曲线的手续费分成和价格冲击上限"],
      recipientPound: ["协议费用收款方", "PoundVault：把协议份额结算成推荐累计、Pack 燃烧池和国库"],
      recipient: ["协议费用收款方", "接收手续费的协议份额"],
      burner: ["Pack 燃烧器", "轮换地把燃烧池花在 Pack（Safe 挑选的、在本链有 V4 池的币）上，买到的送进 0x…dEaD"],
      forwarder: ["发射转发器", "唯一允许代人发射的合约；本站经它发射"],
      sweep: ["费用清扫操作员", "keeper：大约每小时把赚到的费用从每条曲线移走"],
      routerKeeper: ["路由 keeper", "keeper：Wall 的防守与阶梯、Proof-of-Fee 回购、委托买入、卡住的毕业"],
      treasuryKeeper: ["$RADIAN 国库 keeper", "keeper：用协议费用回购 $RADIAN 并支付质押者"],
    },
    expectVault: "PoundVault",
    expectRouter: "本站的路由",
  },
  contracts: {
    title: "{chain} 上的合约",
    checkRunning: "实时身份核对：进行中。",
    checkOk: "实时身份核对：每个钉住的合约都与记录的代码哈希一致。",
    checkBad: "实时身份核对：有钉住的合约不一致。",
    link: "哈希与复现方法",
    none: "本网络没有钉住的合约。",
    head: ["合约", "地址", "实时"],
    match: "一致",
    mismatch: "不一致",
    unverified: "未核验",
  },
  others: { title: "其它网络", sub: "同样的工厂设计运行在下面每条链上，各有自己的地址和索引器。", head: ["网络", "链", "工厂"], switch: "切换" },
};

export const FACTORY = { en, zh } as const;
export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
