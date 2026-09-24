// The dictionary. English is the source; every key must exist in zh too — a
// missing entry is a compile error (`zh: Record<TKey, string>`), not a bare key
// on screen. Copy here is reviewed product copy: change it deliberately.
//
// Only the shell and shared chrome live here during phase 0; each page brings
// its own namespace when it is rebuilt on the design system.

export const en = {
  // ---- navigation ----
  "nav.portfolio": "Portfolio",
  "nav.explore": "Explore",
  "nav.launch": "Launch",
  "nav.learn": "Learn",
  "nav.more": "More",
  "nav.earn": "The Pound",
  "nav.builders": "Builders",
  "nav.factory": "Factory",
  "nav.verify": "Verify",
  "nav.live": "Live",
  "nav.stats": "Stats",
  "nav.terms": "Terms & risks",

  // ---- crumbs (route name → "Section / Page") ----
  "crumb.explore": "Explore / Launches",
  "crumb.portfolio": "Portfolio / My holdings",
  "crumb.launch": "Launch / New token",
  "crumb.learn": "Learn / How it works",
  "crumb.token": "Explore / Token",
  "crumb.tokenWith": "Explore / {name}",
  "crumb.earn": "More / The Pound",
  "crumb.builders": "More / Builders",
  "crumb.factory": "More / Factory",
  "crumb.verify": "More / Verify",
  "crumb.live": "Explore / Live",
  "crumb.stats": "Explore / Stats",
  "crumb.terms": "More / Terms & risks",
  "crumb.more": "More",
  "crumb.r": "Explore / Referral",

  // ---- shell ----
  "shell.brandAria": "Radian, back to home",
  "shell.navAria": "Main navigation",
  "shell.tabbarAria": "Main navigation",
  "shell.langAria": "Language",
  "shell.netAria": "Network",
  "shell.themeAria": "Toggle light / dark theme",
  "shell.chainLive": "{chain} · LIVE",
  "shell.chainTest": "{chain} · TESTNET",
  "shell.netSoon": "soon",
  "shell.netChain": "chain {id}",

  // ---- wallet pill ----
  "wallet.loading": "Loading wallet…",
  "wallet.connect": "Sign in",
  "wallet.copy": "Copy address",
  "wallet.copied": "Copied",
  "wallet.explorer": "View on explorer",
  "wallet.disconnect": "Sign out",

  // ---- footer ----
  "footer.navAria": "Footer",
  "footer.brand": "Radian · a fair-launch platform",
  "footer.noteTest": "Testnet preview, no real money. Not investment advice. Not affiliated with Circle, Robinhood, or Pons-Labs.",
  "footer.noteLive": "Early software, not externally audited. Tokens can lose all their value. Not investment advice. Not affiliated with Circle, Robinhood, or Pons-Labs.",
  "footer.logos": "Logos by Logo.dev",

  // ---- /more ----
  "more.title": "More",
  "more.sub": "Everything that is not in the main navigation.",
  "more.earnDesc": "Referral links, claims, the Pack and the burn ledger.",
  "more.buildersDesc": "The agent API and the router ABI for integrators.",
  "more.factoryDesc": "The factory's live rules, splits, roles and the registry.",
  "more.verifyDesc": "Check the deployed contracts against their pinned code hashes.",
  "more.liveDesc": "Every launch and trade as it happens.",
  "more.statsDesc": "Protocol numbers over 24h and all time.",
  "more.termsDesc": "What you are agreeing to and the risks you take.",

  // ---- 404 ----
  "nf.title": "This page does not exist",
  "nf.body": "Nothing lives at this path. Every Radian page is reachable from the top navigation.",
  "nf.cta": "Back to Explore",
} as const;

export type TKey = keyof typeof en;

export const zh: Record<TKey, string> = {
  "nav.portfolio": "组合",
  "nav.explore": "探索",
  "nav.launch": "发射",
  "nav.learn": "学习",
  "nav.more": "更多",
  "nav.earn": "The Pound",
  "nav.builders": "开发者",
  "nav.factory": "工厂",
  "nav.verify": "核验",
  "nav.live": "实时",
  "nav.stats": "统计",
  "nav.terms": "条款与风险",

  "crumb.explore": "探索 / 发射列表",
  "crumb.portfolio": "组合 / 我的持仓",
  "crumb.launch": "发射 / 新代币",
  "crumb.learn": "学习 / 怎么运作",
  "crumb.token": "探索 / 代币",
  "crumb.tokenWith": "探索 / {name}",
  "crumb.earn": "更多 / The Pound",
  "crumb.builders": "更多 / 开发者",
  "crumb.factory": "更多 / 工厂",
  "crumb.verify": "更多 / 核验",
  "crumb.live": "探索 / 实时",
  "crumb.stats": "探索 / 统计",
  "crumb.terms": "更多 / 条款与风险",
  "crumb.more": "更多",
  "crumb.r": "探索 / 推荐",

  "shell.brandAria": "Radian，回到首页",
  "shell.navAria": "主导航",
  "shell.tabbarAria": "主导航",
  "shell.langAria": "语言",
  "shell.netAria": "网络",
  "shell.themeAria": "切换明暗主题",
  "shell.chainLive": "{chain} · 主网",
  "shell.chainTest": "{chain} · 测试网",
  "shell.netSoon": "即将",
  "shell.netChain": "链 {id}",

  "wallet.loading": "读取钱包…",
  "wallet.connect": "登录",
  "wallet.copy": "复制地址",
  "wallet.copied": "已复制",
  "wallet.explorer": "在浏览器查看",
  "wallet.disconnect": "退出",

  "footer.navAria": "页脚",
  "footer.brand": "Radian · 公平发射平台",
  "footer.noteTest": "测试网预览，不涉及真钱。不构成投资建议。与 Circle、Robinhood、Pons-Labs 无关联。",
  "footer.noteLive": "早期软件，未经外部审计。代币可能归零。不构成投资建议。与 Circle、Robinhood、Pons-Labs 无关联。",
  "footer.logos": "标志来自 Logo.dev",

  "more.title": "更多",
  "more.sub": "主导航之外的所有入口。",
  "more.earnDesc": "推荐链接、领取、Pack 与燃烧账本。",
  "more.buildersDesc": "面向集成方的代理 API 与 router ABI。",
  "more.factoryDesc": "工厂的实时规则、分成、角色与注册表。",
  "more.verifyDesc": "把已部署合约和钉住的代码哈希对一遍。",
  "more.liveDesc": "每一次发射与成交，实时滚动。",
  "more.statsDesc": "24 小时与全期的协议数据。",
  "more.termsDesc": "你在同意什么，以及你承担的风险。",

  "nf.title": "这个页面不存在",
  "nf.body": "这个路径下没有内容。Radian 的每一页都能从顶部导航进入。",
  "nf.cta": "回到探索",
};

export const DICT = { en, zh } as const;
