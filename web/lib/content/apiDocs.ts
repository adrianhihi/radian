// The developer docs (/api-docs), as data. Structure follows baskvia's content/docs.ts:
// numbered sections of p / note / code / table blocks. Unlike baskvia's, the copy is
// bilingual: every prose string is an { en, zh } pair, so the two languages cannot drift in
// structure, and the API table is generated from ENDPOINTS so the table cannot drift from
// the prose that quotes the same paths, cache seconds and limits.
//
// Facts only, taken from the code they describe: indexer/src/{server,meta,agentApi}.ts
// (routes, Cache-Control, limits), web/lib/{wall,profile}.ts (message formats),
// web/lib/networks.ts (base URLs, addresses, quote assets). Base URL and addresses are
// filled in for the active network at render time.
import type { Lang } from "@/lib/i18n";
import { NETWORKS, type NetworkConfig, type NetworkKey } from "@/lib/networks";
import { fingerprint } from "@/lib/ui/fingerprint";

export type DocBlock =
  | { kind: "p"; text: string }
  | { kind: "note"; text: string }
  | { kind: "code"; code: string; label: string }
  | { kind: "table"; head: string[]; rows: string[][] };

export interface DocSection {
  id: string;
  title: string;
  blocks: DocBlock[];
}

type Text = { en: string; zh: string };
const pick = (lang: Lang, x: Text | string) => (typeof x === "string" ? x : x[lang] ?? x.en);

// ---- the endpoint table: one typed array, quoted by the prose and rendered as the API table ----

export type CachePolicy = { kind: "public"; seconds: number } | { kind: "no-store" } | { kind: "immutable" } | { kind: "none" };
export interface Endpoint {
  method: "GET" | "POST";
  path: string;
  returns: Text;
  cache: CachePolicy;
  limits: Text;
}

const PUB5: CachePolicy = { kind: "public", seconds: 5 };
const PUB10: CachePolicy = { kind: "public", seconds: 10 };
const NO_STORE: CachePolicy = { kind: "no-store" };
const NONE: CachePolicy = { kind: "none" };
const IMMUTABLE: CachePolicy = { kind: "immutable" };
const DASH: Text = { en: "—", zh: "—" };

export const ENDPOINTS: readonly Endpoint[] = [
  // ---- reads (server.ts) ----
  {
    method: "GET",
    path: "/health",
    cache: NO_STORE,
    returns: {
      en: "Liveness: the live cursor (checkpoint), through, backfillDone, counts of launches, trades and ledger rows, and the indexer's own code-hash check (identity).",
      zh: "存活检查：实时游标（checkpoint）、through、backfillDone、发射 / 成交 / 账本行数，以及索引器自己的代码哈希核对结果（identity）。",
    },
    limits: DASH,
  },
  {
    method: "GET",
    path: "/launches",
    cache: PUB5,
    returns: {
      en: "Every live launch (retired and hidden ones left out) with curve, pair token, template, holders, spark, last price, 24h change / volume / trades, creator name and logo; plus through and backfillDone.",
      zh: "每一个在列的发射（已退役与隐藏的除外），附曲线、配对代币、模板、持有人数、火花线、最新价、24 小时涨跌 / 成交量 / 笔数、创作者名字和 logo；另有 through 与 backfillDone。",
    },
    limits: { en: "Launch rows are rebuilt at most once every 4 s.", zh: "发射行最多每 4 秒重建一次。" },
  },
  {
    method: "GET",
    path: "/token/:addr",
    cache: PUB5,
    returns: {
      en: "The launch row (a retired one too, with its sunset) and its newest trades, each carrying quoteDecimals and quoteSymbol.",
      zh: "该发射的行（退役的也能查到，带 sunset 字段）和它最新的成交，每条带 quoteDecimals 与 quoteSymbol。",
    },
    limits: { en: "100 trades; 400 on a bad address; 404 when unknown.", zh: "100 条成交；地址不合法 400；未知代币 404。" },
  },
  {
    method: "GET",
    path: "/activity?limit=",
    cache: PUB5,
    returns: {
      en: "The newest trades across every live launch, with name, symbol, quoteSymbol and quoteDecimals.",
      zh: "所有在列发射的最新成交，附 name、symbol、quoteSymbol、quoteDecimals。",
    },
    limits: { en: "limit 1–200, default 50.", zh: "limit 1–200，默认 50。" },
  },
  {
    method: "GET",
    path: "/address/:addr/activity",
    cache: NO_STORE,
    returns: {
      en: "One wallet's buys, sells, launches and referral claims, newest first, with indexed, through and backfillDone.",
      zh: "一个钱包的买入、卖出、发射和推荐领取，最新在前，附 indexed、through、backfillDone。",
    },
    limits: { en: "200 events.", zh: "200 条事件。" },
  },
  {
    method: "GET",
    path: "/tx/:hash",
    cache: { kind: "public", seconds: 30 },
    returns: {
      en: "One transaction's status (pending / success / reverted / unknown), block and confirmations, the decoded events (launch, buy, sell, claim, flush, settle, burn) and, for a launch, the new token's address.",
      zh: "一笔交易的状态（pending / success / reverted / unknown）、区块与确认数、解码后的事件（launch、buy、sell、claim、flush、settle、burn），发射交易还带新代币地址。",
    },
    limits: { en: "no-store while pending or unknown; 400 on a malformed hash; 502 when the node cannot be reached.", zh: "pending / unknown 时 no-store；哈希不合法 400；节点不可达 502。" },
  },
  {
    method: "GET",
    path: "/reconcile",
    cache: { kind: "public", seconds: 60 },
    returns: {
      en: "The index re-derived from the chain at its checkpoint block: registry, supply, reserve, Pound attributed / claimed / settled, flywheel flushed — each check with expected, actual and the first mismatch; allOk and the block.",
      zh: "索引在自己的检查点区块上与链重新对账：注册表、供应量、储备、Pound 归因 / 领取 / 结算、飞轮 flush——每项带 expected、actual 与第一处不符；另有 allOk 与区块号。",
    },
    limits: { en: "Computed at most once a minute; concurrent requests share one computation; a failed RPC read is a failed check, never a pass.", zh: "每分钟最多计算一次；并发请求共用一次计算；RPC 读取失败记为检查失败，从不算通过。" },
  },
  {
    method: "GET",
    path: "/stats?window=24h|all",
    cache: PUB10,
    returns: {
      en: "Launch and graduation counts, curve TVL, buyback locked, trade counts and volumes by side, average trade, 24 hourly volume buckets and a per-token ranked table.",
      zh: "发射与毕业数、曲线 TVL、锁定回购、按方向的成交笔数与量、平均单笔、24 个小时桶的成交量，以及按代币排名的表。",
    },
    limits: { en: "Bounded by the retained trade log (10 000 trades).", zh: "受保留的成交日志（10 000 条）限制。" },
  },
  {
    method: "GET",
    path: "/radian",
    cache: NONE,
    returns: {
      en: "The $RADIAN flywheel where it runs: staked, APR, buyback burned, revenue distributed, the treasury ledger. 404 on chains without it.",
      zh: "运行 $RADIAN 飞轮的链上：质押量、APR、回购燃烧、已分配收入、国库账本。没有飞轮的链返回 404。",
    },
    limits: { en: "50 ledger rows.", zh: "50 条账本。" },
  },
  {
    method: "GET",
    path: "/pound",
    cache: NONE,
    returns: {
      en: "The Pound: vault and burner parameters, per-asset totals, the Pack, the referrer leaderboard and the ledger. 404 on chains without it.",
      zh: "The Pound：金库与燃烧器参数、按资产的总额、Pack、推荐人榜和账本。没有 Pound 的链返回 404。",
    },
    limits: { en: "50 referrers; 100 ledger rows.", zh: "50 位推荐人；100 条账本。" },
  },
  {
    method: "GET",
    path: "/pound/referral/:addr",
    cache: NONE,
    returns: {
      en: "One referrer: claimable and accrued per quote asset (read live from the vault), indexed trade counts and recent events.",
      zh: "一位推荐人：按计价资产的可领取与累计（从金库实时读取）、已索引的成交笔数和最近事件。",
    },
    limits: { en: "50 recent events.", zh: "50 条最近事件。" },
  },
  {
    method: "GET",
    path: "/pound/feed.rss",
    cache: { kind: "public", seconds: 60 },
    returns: {
      en: "The burn feed: the newest Pack burns as RSS 2.0, one item per Burned event with the transaction link as the item link; /pound/feed.json is the same list as a JSON Feed (raw amounts under _radian). Point any RSS-to-X, Zapier or IFTTT automation at it and every burn posts itself. 404 on chains without The Pound.",
      zh: "燃烧 feed：最新的 Pack 燃烧，RSS 2.0，每个 Burned 事件一条、以交易链接为条目链接；/pound/feed.json 是同一列表的 JSON Feed（原始数额在 _radian 下）。把任何 RSS 转 X、Zapier 或 IFTTT 自动化指向它，每次燃烧就会自己发出去。没有 Pound 的链返回 404。",
    },
    limits: { en: "50 burns; a coin is named from our launches or one cached symbol() read, else by its address.", zh: "50 次燃烧；币名来自我们的发射或一次缓存的 symbol() 读取，否则显示地址。" },
  },
  // ---- signed metadata (meta.ts) ----
  {
    method: "GET",
    path: "/token/:addr/wall",
    cache: NO_STORE,
    returns: {
      en: "The visible wall lines, newest first, each with the poster's profile name and balance at posting, and the moderator list.",
      zh: "可见的留言墙行，最新在前，每条附发帖人的资料名和发帖时的余额，以及版主列表。",
    },
    limits: { en: "50 lines served (200 kept per token).", zh: "返回 50 条（每个代币保留 200 条）。" },
  },
  {
    method: "POST",
    path: "/token/:addr/wall",
    cache: NO_STORE,
    returns: {
      en: "{ ok } after verifying the signature and that the poster holds the token right now. One line per wallet; a new line replaces it.",
      zh: "核验签名并确认发帖人此刻持有该代币后返回 { ok }。每个钱包一条；新的一条替换旧的。",
    },
    limits: {
      en: "280 code points; time within ±10 min; 30 signed posts per IP per hour; JSON body ≤ 512 kB.",
      zh: "280 个码点；时间与服务器相差 ±10 分钟以内；每 IP 每小时 30 次签名提交；JSON 体 ≤ 512 kB。",
    },
  },
  {
    method: "POST",
    path: "/token/:addr/wall/hide",
    cache: NO_STORE,
    returns: { en: "{ ok }: a moderator hides one wallet's line (the line, not the wallet).", zh: "{ ok }：版主隐藏一个钱包的一条留言（隐藏的是这条，不是这个钱包）。" },
    limits: { en: "Signer must be the factory owner (read live) or a configured moderator; same time and rate rules.", zh: "签名者必须是工厂 owner（实时读取）或配置的版主；时间与频率规则相同。" },
  },
  {
    method: "POST",
    path: "/token/:addr/logo",
    cache: NO_STORE,
    returns: { en: "{ ok, url }: the creator's image replaces the on-chain logo in what this indexer serves.", zh: "{ ok, url }：创作者的图片在索引器的输出里替换链上的 logo。" },
    limits: {
      en: "png / webp / jpeg, ≤ 200 kB decoded (data URL ≤ 300 000 chars); signer must be the launch's deployer; same time and rate rules.",
      zh: "png / webp / jpeg，解码后 ≤ 200 kB（data URL ≤ 300 000 字符）；签名者必须是发射的部署者；时间与频率规则相同。",
    },
  },
  {
    method: "GET",
    path: "/profile/:addr",
    cache: NO_STORE,
    returns: { en: "{ profile }: address, name, bio, x, updatedAt — or null.", zh: "{ profile }：address、name、bio、x、updatedAt——没有则为 null。" },
    limits: DASH,
  },
  {
    method: "POST",
    path: "/profile/:addr",
    cache: NO_STORE,
    returns: { en: "{ ok, profile } after verifying the wallet's own signature.", zh: "核验钱包自己的签名后返回 { ok, profile }。" },
    limits: {
      en: "name ≤ 32, bio ≤ 160, x ≤ 15 of [A-Za-z0-9_]; no angle brackets or control characters; same time and rate rules.",
      zh: "name ≤ 32、bio ≤ 160、x ≤ 15 且只含 [A-Za-z0-9_]；不含尖括号和控制字符；时间与频率规则相同。",
    },
  },
  // ---- media (server.ts) ----
  {
    method: "POST",
    path: "/upload",
    cache: NONE,
    returns: {
      en: "{ url } for a raw image body (Content-Type image/png, jpeg, webp or gif); the URL goes into the token's on-chain logo field at launch.",
      zh: "对原始图片体（Content-Type 为 image/png、jpeg、webp 或 gif）返回 { url }；这个 URL 在发射时写进代币链上的 logo 字段。",
    },
    limits: { en: "2 MB; 20 uploads per IP per hour; the type is sniffed from the bytes; 500 MB shared quota.", zh: "2 MB；每 IP 每小时 20 次；类型按字节嗅探；共享配额 500 MB。" },
  },
  {
    method: "GET",
    path: "/img/:file",
    cache: IMMUTABLE,
    returns: { en: "An uploaded image.", zh: "一张已上传的图片。" },
    limits: { en: "Only names this server wrote: 24 hex characters plus png, jpg, webp or gif.", zh: "只接受这台服务器写过的文件名：24 个十六进制字符加 png、jpg、webp 或 gif。" },
  },
  // ---- agent API (agentApi.ts) ----
  {
    method: "GET",
    path: "/v1/manifest",
    cache: NONE,
    returns: {
      en: "What the API knows about itself: network, contracts, the keeper, identity, payments (x402, disabled), the service list and the rules.",
      zh: "API 对自己的描述：网络、合约、keeper、identity、付费（x402，未启用）、服务列表和规则。",
    },
    limits: DASH,
  },
  {
    method: "GET",
    path: "/v1/curve/:token",
    cache: NONE,
    returns: {
      en: "A block-consistent snapshot of one launch: reserves, spot per 1e18, tracked quote, threshold, progress, fees, launch time and template, with the block it was read at.",
      zh: "一个发射在同一区块下的快照：储备、每 1e18 的现价、已计入的报价、阈值、进度、费用、发射时间和模板，附读取时的区块。",
    },
    limits: { en: "Every read at one block, the block hash re-read after; one retry, then 503.", zh: "所有读取在同一区块，之后重读区块哈希；重试一次，仍变则 503。" },
  },
  {
    method: "GET",
    path: "/v1/quote?token=&side=&amount=&recipient=&slippageBps=",
    cache: NONE,
    returns: {
      en: "Expected and minimum output, the fee parts (feeBps, creatorTaxBps, snipeTaxBps), the price method (simulation | reserves) and an unsigned plan { to, data, value, approve? } aimed at the curve or the PoF router.",
      zh: "预期与最少产出、费用组成（feeBps、creatorTaxBps、snipeTaxBps）、价格方法（simulation | reserves），以及指向曲线或 PoF 路由的未签名计划 { to, data, value, approve? }。",
    },
    limits: { en: "amount: a positive integer in raw units; slippageBps 0–5000, default 100; 409 once graduated.", zh: "amount：原始单位的正整数；slippageBps 0–5000，默认 100；已毕业返回 409。" },
  },
  {
    method: "POST",
    path: "/v1/launch-plan",
    cache: NONE,
    returns: {
      en: "Unsigned router calldata for a standard, Wall or Proof-of-Fee launch: to, data, value (launch fee plus a native first buy), launchFee, approve? and the predicted template addresses.",
      zh: "标准、Wall 或 Proof-of-Fee 发射的未签名路由 calldata：to、data、value（发射费加原生币首买）、launchFee、approve? 和预测的模板合约地址。",
    },
    limits: { en: "JSON body ≤ 32 kB; params.name, params.symbol, a bytes32 salt and a creator address are required.", zh: "JSON 体 ≤ 32 kB；必须给出 params.name、params.symbol、bytes32 的 salt 和 creator 地址。" },
  },
  {
    method: "POST",
    path: "/v1/auth",
    cache: NONE,
    returns: {
      en: "{ ok, authId } after recovering the EIP-712 signer and checking the on-chain nonce; the platform keeper then runs the schedule.",
      zh: "恢复 EIP-712 签名者并核对链上 nonce 后返回 { ok, authId }；随后由平台 keeper 按计划执行。",
    },
    limits: {
      en: "JSON body ≤ 32 kB; a 65-byte signature; deadline in the future; 409 on a nonce mismatch; executor v2 also needs asset, minPerBuy and minTokensPerQuote.",
      zh: "JSON 体 ≤ 32 kB；65 字节签名；deadline 须在未来；nonce 不符返回 409；executor v2 还需要 asset、minPerBuy、minTokensPerQuote。",
    },
  },
  {
    method: "GET",
    path: "/v1/auth/:user",
    cache: NONE,
    returns: { en: "The user's authorizations, newest first, each with count, lastAt and status (active | done | expired | cancelled).", zh: "该用户的授权，最新在前，每条带 count、lastAt 和 status（active | done | expired | cancelled）。" },
    limits: DASH,
  },
];

/** The cache column, in words. */
export function cacheLabel(c: CachePolicy, lang: Lang): string {
  switch (c.kind) {
    case "public":
      return lang === "zh" ? `公开 ${c.seconds} 秒（CDN ${c.seconds * 3} 秒）` : `public ${c.seconds} s (CDN ${c.seconds * 3} s)`;
    case "no-store":
      return "no-store";
    case "immutable":
      return lang === "zh" ? "一年，immutable" : "1 year, immutable";
    default:
      return lang === "zh" ? "未设置" : "none set";
  }
}

const byPath = (path: string): Endpoint => {
  const e = ENDPOINTS.find((x) => x.path === path);
  if (!e) throw new Error(`apiDocs: no endpoint ${path}`);
  return e;
};
const secs = (path: string): number => {
  const c = byPath(path).cache;
  return c.kind === "public" ? c.seconds : 0;
};

// ---- addresses ----

const ZERO = "0x0000000000000000000000000000000000000000";
const VISIBLE_NETWORKS: NetworkKey[] = (Object.keys(NETWORKS) as NetworkKey[]).filter((k) => !NETWORKS[k].hidden);

type AddrRow = { label: string; address?: string };
function addressRows(net: NetworkConfig): AddrRow[] {
  const c = net.contracts;
  const r = net.radian;
  const rows: AddrRow[] = [
    { label: "LaunchFactory", address: c.factory },
    { label: "LaunchRouter", address: c.router },
    { label: "PoFRouter", address: c.pofRouter },
    { label: "RadianExecutor", address: c.executor },
    { label: "FeeEscrow", address: c.escrow },
    { label: "BuybackVault", address: c.vault },
    { label: "LaunchLocker", address: c.locker },
    { label: "MemeHook (Uniswap V4)", address: c.hook },
    { label: "PoolManager (Uniswap V4)", address: c.poolManager },
    { label: "WallTreasury (clone impl)", address: c.wallTreasuryImpl },
    { label: "WallStaking (clone impl)", address: c.wallStakingImpl },
    { label: "WallLadder (clone impl)", address: c.wallLadderImpl },
    { label: "PoFVault (clone impl)", address: c.pofVaultImpl },
    { label: "PoundVault", address: net.pound?.vault },
    { label: "PackBurner", address: net.pound?.burner },
    { label: "$RADIAN token", address: r.token },
    { label: "$RADIAN curve", address: r.curve },
    { label: "RadianStaking", address: r.staking },
    { label: "RadianTreasury", address: r.treasury },
  ];
  return rows;
}

// ---- the sections ----

type BlockDef =
  | { kind: "p"; text: Text }
  | { kind: "note"; text: Text }
  | { kind: "code"; code: string; label: string }
  | { kind: "table"; head: Text[]; rows: (Text | string)[][] };
type SectionDef = { id: string; title: Text; blocks: BlockDef[] };

function defs(net: NetworkConfig, lang: Lang): SectionDef[] {
  const base = net.indexerUrl || "https://<indexer>";
  const notHere: Text = { en: "not deployed here", zh: "本网络未部署" };
  const gas = net.nativeSymbol ?? "USDC";

  const networkRows = VISIBLE_NETWORKS.map((k) => {
    const n = NETWORKS[k];
    return [n.label, String(n.chainId), n.indexerUrl || pick(lang, notHere), n.explorer];
  });

  const addrTable = addressRows(net).map((r) => {
    const live = !!r.address && r.address !== ZERO;
    return [r.label, live ? (r.address as string) : pick(lang, notHere), live ? fingerprint(r.address as string) : "—"];
  });
  const quoteTable = net.quoteAssets.map((q) => [
    q.symbol,
    q.native ? `${ZERO} (${lang === "zh" ? "原生币" : "native"})` : q.address,
    String(q.decimals),
    q.stock ? (q.stock.standIn ? (lang === "zh" ? "股票替身（测试网）" : "stock stand-in (testnet)") : lang === "zh" ? "代币化股票" : "tokenized stock") : q.blurb,
  ]);

  return [
    {
      id: "overview",
      title: { en: "The indexer", zh: "索引器" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "The indexer is a small service (indexer/ in the repository) that scans the chain a few blocks behind the tip and keeps what the site needs in one snapshot: launches, trades, holder balances, The Pound's ledger and the signed metadata people post. It answers over plain JSON with CORS open and no keys. Everything it says is derived from contract events and reads, so anything that matters can be checked against the chain directly.",
            zh: "索引器是一个小服务（仓库里的 indexer/），在链尖后几个区块处扫描，把网站需要的东西存在一个快照里：发射、成交、持有人余额、The Pound 的账本，以及人们签名提交的元数据。它以纯 JSON 应答，CORS 开放，不需要密钥。它说的一切都来自合约事件和读取，所以要紧的东西都能直接对着链核验。",
          },
        },
        {
          kind: "table",
          head: [
            { en: "Network", zh: "网络" },
            { en: "Chain id", zh: "链 id" },
            { en: "Base URL", zh: "基址" },
            { en: "Explorer", zh: "浏览器" },
          ],
          rows: networkRows,
        },
        {
          kind: "p",
          text: {
            en: "The base URL comes from the network config (NEXT_PUBLIC_*_INDEXER_URL overrides it per network). Each network has its own indexer with its own snapshot; a token address is only meaningful on the network it was launched on.",
            zh: "基址来自网络配置（每个网络可用 NEXT_PUBLIC_*_INDEXER_URL 覆盖）。每个网络有自己的索引器和快照；代币地址只在它发射的那个网络上有意义。",
          },
        },
        {
          kind: "code",
          label: "GET /health",
          code: `curl ${base}/health
{ "ok": true, "checkpoint": "70311204", "through": "70311204", "backfillDone": true,
  "launches": 12, "trades": 3410, "ledger": 88,
  "identity": { "checked": true, "ok": true, "mismatches": [] } }`,
        },
        {
          kind: "note",
          text: {
            en: `Public reads carry Cache-Control: public, max-age=${secs("/launches")}, s-maxage=${secs("/launches") * 3} (/stats: ${secs("/stats?window=24h|all")} s and ${secs("/stats?window=24h|all") * 3} s). Per-wallet and signed data are no-store. Launch rows are rebuilt from the trade log at most once every 4 s, so two polls inside that window return the same bytes.`,
            zh: `公开读取带 Cache-Control: public, max-age=${secs("/launches")}, s-maxage=${secs("/launches") * 3}（/stats 为 ${secs("/stats?window=24h|all")} 秒与 ${secs("/stats?window=24h|all") * 3} 秒）。按钱包的和签名的数据是 no-store。发射行最多每 4 秒从成交日志重建一次，这个窗口内的两次轮询拿到同样的字节。`,
          },
        },
      ],
    },
    {
      id: "reads",
      title: { en: "Launches and trades", zh: "发射与成交" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "/launches lists every live launch on the network with its curve, pair token, template, holder count and the 24h facts computed from the trade log. Retired launches leave the list but still resolve at /token/:addr with a sunset field naming the successor; hidden ones are left out.",
            zh: "/launches 列出网络上每一个在列的发射，附曲线、配对代币、模板、持有人数和从成交日志算出的 24 小时数据。退役的发射离开列表，但仍能在 /token/:addr 查到，带一个指向后继者的 sunset 字段；隐藏的不出现。",
          },
        },
        {
          kind: "code",
          label: "GET /launches",
          code: `curl ${base}/launches
{ "launches": [ {
    "token": "0x…", "curve": "0x…", "deployer": "0x…", "name": "…", "symbol": "…",
    "logo": "https://…", "description": "…",
    "pairToken": "0x0000000000000000000000000000000000000000",   // zero = the gas coin (${gas} here)
    "quoteSymbol": "${gas}", "quoteDecimals": 18,
    "quoteReserve": "…", "trackedQuote": "…", "graduationThreshold": "…",   // raw integer strings
    "progress": 0.31, "graduated": false, "buybackLocked": "0",
    "template": null | { "kind": "wall", "treasury", "staking", "ladder"? } | { "kind": "pof", "vault", "pofRouter" },
    "spark": [[ts, price], …], "lastPrice": 0.0021 | null, "change24h": 4.2 | null,
    "volume24h": 120.5, "trades24h": 17, "holders": 42 | null, "createdAt": 1758700000000,
    "creatorName": "", "sunset": null
  } ],
  "through": "70311204", "backfillDone": true }`,
        },
        {
          kind: "p",
          text: {
            en: "/token/:addr returns the same row plus its newest 100 trades. /activity?limit= is the newest trades across every launch (1–200, default 50). /address/:addr/activity is one wallet's own buys, sells, launches and referral claims, up to 200, uncached, with through so a client can say how far the index reaches.",
            zh: "/token/:addr 返回同样的行加它最新的 100 条成交。/activity?limit= 是所有发射的最新成交（1–200，默认 50）。/address/:addr/activity 是一个钱包自己的买入、卖出、发射和推荐领取，最多 200 条，不缓存，附 through 以便客户端说明索引到了哪里。",
          },
        },
        {
          kind: "code",
          label: "a trade row",
          code: `{ "txHash": "0x…", "ts": 1758700123456, "block": "70311100",
  "token": "0x…", "side": "buy" | "sell", "trader": "0x…",
  "quote": "2500000",          // raw, in quoteDecimals of the pair asset
  "tokens": "1234000000000000000000",   // raw, 18 decimals
  "quoteSymbol": "USDG", "quoteDecimals": 6 }`,
        },
        {
          kind: "p",
          text: {
            en: "Amounts are raw integer strings. Launch tokens always have 18 decimals; the quote leg is in the pair asset's own decimals (18 for a gas coin, 6 for EURC, USDGx and USDG), and every row says which. lastPrice and spark are already quote-per-token floats.",
            zh: "金额是原始整数字符串。发射代币总是 18 位小数；报价一侧用配对资产自己的小数位（燃气币 18 位，EURC、USDGx、USDG 6 位），每行都会注明。lastPrice 和 spark 已经是「每个代币多少报价资产」的浮点数。",
          },
        },
        {
          kind: "p",
          text: {
            en: "/stats?window=24h|all aggregates the trade log: counts, TVL on curves, buyback locked, volumes by side, 24 hourly buckets and a per-token ranking. /pound is the whole waterfall for the network (vault and burner parameters, per-asset totals, the Pack, the referrer leaderboard, the ledger); /pound/referral/:addr reads one referrer's claimable and accrued live from the vault. /radian serves the older $RADIAN flywheel where it still runs.",
            zh: "/stats?window=24h|all 汇总成交日志：笔数、曲线上的 TVL、锁定的回购、按方向的成交量、24 个小时桶和按代币的排名。/pound 是这个网络的整条瀑布（金库与燃烧器参数、按资产的总额、Pack、推荐人榜、账本）；/pound/referral/:addr 从金库实时读取一位推荐人的可领取与累计。/radian 在仍运行旧 $RADIAN 飞轮的链上提供其状态。",
          },
        },
      ],
    },
    {
      id: "signed",
      title: { en: "Signed messages: wall, logo, profile", zh: "签名消息：留言墙、logo、资料" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "The holder wall, the creator's logo and wallet profiles cost no gas: the wallet signs a plain-text message (personal_sign; EOA and ERC-1271 signatures both verify) and the indexer checks it against the chain before storing anything. A wall line must come from a wallet that holds the token at the moment of posting; a logo from the wallet that launched it; a profile from the wallet itself; a hide from a moderator (the factory owner, read live, plus any configured moderators).",
            zh: "持有人留言墙、创作者 logo 和钱包资料不花 gas：钱包对一段纯文本签名（personal_sign；EOA 与 ERC-1271 签名都能核验），索引器先对着链核对再存储。留言必须来自发帖那一刻持有该代币的钱包；logo 来自发射它的钱包；资料来自钱包自己；隐藏来自版主（实时读取的工厂 owner，加上配置的版主）。",
          },
        },
        {
          kind: "code",
          label: "message formats (web/lib/wall.ts, web/lib/profile.ts)",
          code: `// token and addresses lower-cased; time = Date.now() in milliseconds
"Radian wall\\ntoken: <token>\\ntime: <time>\\n\\n<text>"
"Radian logo\\ntoken: <token>\\nsha256: <hex of the image bytes>\\ntime: <time>"
"Radian moderation: hide wall message\\ntoken: <token>\\naddress: <target>\\ntime: <time>"
"Radian profile\\naddress: <address>\\nname: <name>\\nbio: <bio>\\nx: <handle>\\ntime: <time>"`,
        },
        {
          kind: "code",
          label: "request bodies",
          code: `POST ${base}/token/<token>/wall        { "address", "text", "time", "signature" }
POST ${base}/token/<token>/wall/hide   { "address": <target>, "by": <moderator>, "time", "signature" }
POST ${base}/token/<token>/logo        { "address", "image": "data:image/png;base64,…", "time", "signature" }
POST ${base}/profile/<address>         { "name", "bio", "x", "time", "signature" }
// success: { "ok": true } (+ "url" for a logo, "profile" for a profile); failure: { "ok": false, "error": "<code>" }`,
        },
        {
          kind: "table",
          head: [
            { en: "Rule", zh: "规则" },
            { en: "Value", zh: "值" },
          ],
          rows: [
            [{ en: "Clock skew", zh: "时间偏差" }, { en: "time within ±10 minutes of the indexer's clock, else stale", zh: "time 与索引器时钟相差 ±10 分钟以内，否则 stale" }],
            [{ en: "Rate", zh: "频率" }, { en: "30 signed posts per IP per hour, else rate (429)", zh: "每 IP 每小时 30 次签名提交，超出为 rate（429）" }],
            [{ en: "Wall line", zh: "留言" }, { en: "≤ 280 code points; tab and line breaks allowed, other control characters refused; one line per wallet, a new one replaces it; 200 kept per token, the newest 50 served", zh: "≤ 280 个码点；允许制表符和换行，其它控制字符拒绝；每个钱包一条，新的替换旧的；每个代币保留 200 条，返回最新 50 条" }],
            [{ en: "Hide", zh: "隐藏" }, { en: "hides one line, not the wallet: the next line from that wallet shows again", zh: "隐藏的是一条留言而不是钱包：该钱包的下一条会再次显示" }],
            [{ en: "Logo", zh: "Logo" }, { en: "png, webp or jpeg; ≤ 200 kB decoded; the data URL ≤ 300 000 characters; the sha256 in the message is of the decoded bytes", zh: "png、webp 或 jpeg；解码后 ≤ 200 kB；data URL ≤ 300 000 字符；消息里的 sha256 是解码后字节的哈希" }],
            [{ en: "Profile", zh: "资料" }, { en: "name ≤ 32, bio ≤ 160, x ≤ 15 of [A-Za-z0-9_] (a leading @ is stripped); no angle brackets or control characters", zh: "name ≤ 32、bio ≤ 160、x ≤ 15 且只含 [A-Za-z0-9_]（开头的 @ 会被去掉）；不含尖括号和控制字符" }],
            [{ en: "Body", zh: "请求体" }, { en: "JSON ≤ 512 kB; over the limit is a plain too-large (413)", zh: "JSON ≤ 512 kB；超出返回简单的 too-large（413）" }],
          ],
        },
        {
          kind: "p",
          text: {
            en: "Error codes are short strings: bad-input, empty, stale, signature, rate, holding (the poster holds none of the token), creator (not the deployer), not-moderator, not-found, too-large, storage, network (the balance read failed), unknown token.",
            zh: "错误码是短字符串：bad-input、empty、stale、signature、rate、holding（发帖人不持有该代币）、creator（不是部署者）、not-moderator、not-found、too-large、storage、network（余额读取失败）、unknown token。",
          },
        },
      ],
    },
    {
      id: "agent",
      title: { en: "The agent API", zh: "代理 API" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "Under /v1 the indexer plans transactions for agents and bots without ever holding a key: every plan comes back unsigned as { to, data, value, approve? } for the caller to sign and broadcast, and every price says how it was produced. simulation is an exact eth_call of the real curve; reserves is computed from the curve's reserves and fee policy and should be treated as an estimate.",
            zh: "在 /v1 下，索引器替代理和机器人规划交易，但从不持有密钥：每个计划都以未签名的 { to, data, value, approve? } 返回，由调用方签名并广播；每个价格都说明它是怎么算出来的。simulation 是对真实曲线的一次精确 eth_call；reserves 是由曲线的储备和费用政策计算的，应当作估计。",
          },
        },
        {
          kind: "code",
          label: "GET /v1/manifest",
          code: `curl ${base}/v1/manifest
{ "name": "Radian", "version": "1",
  "network": { "chainId": ${net.chainId}, "name": "${net.chainName}", "rpc": "…" },
  "contracts": { "factory", "launchRouter", "pofRouter", "executor", "keeper" },
  "identity": { "checked": true, "ok": true, "mismatches": [] },
  "payments": { "protocol": "x402", "enabled": false, "note": "…" },
  "services": [ { "id", "method", "path", "price": null, "note" }, … ],
  "rules": [ "Plans are unsigned; the caller signs and broadcasts.", … ] }`,
        },
        {
          kind: "code",
          label: "GET /v1/curve/:token",
          code: `curl ${base}/v1/curve/<token>
{ "block": { "number": "70311204", "hash": "0x…", "timestamp": 1758700000 },
  "token", "curve", "pairToken", "quoteSymbol", "quoteDecimals",
  "quoteReserve": "…", "tokenReserve": "…", "spotPer1e18": "…" | null,
  "trackedQuote": "…", "graduationThreshold": "…", "progress": 0.31 | null,
  "graduated": false, "feeBps": 100, "creatorTaxBps": 0, "launchedAt": 1758690000,
  "template": null | { … } }
// every read at one block; the block hash is re-read afterwards and the snapshot retried once if it changed`,
        },
        {
          kind: "code",
          label: "GET /v1/quote",
          code: `curl "${base}/v1/quote?token=<token>&side=buy&amount=10000000&recipient=<you>&slippageBps=100"
{ "side": "buy", "amountIn": "10000000", "expectedOut": "…", "minOut": "…",
  "method": "simulation" | "reserves", "exact": true | false,
  "fees": { "feeBps": 100, "creatorTaxBps": 0, "snipeTaxBps": 0 },
  "plan": { "to": "<curve or PoF router>", "data": "0x…", "value": "10000000" | "0",
            "approve": null | { "token", "spender", "amount" } } }
// side=sell: amount is tokens (18 decimals); approve names the token and the curve`,
        },
        {
          kind: "p",
          text: {
            en: "A buy on a Proof-of-Fee launch is routed through the PoF router so it counts as Work; the plan already picks it. A native buy with a recipient is simulated exactly; ERC-20 buys and every sell are computed from reserves. Once a launch has graduated the quote answers 409: trade on the Uniswap V4 pool instead.",
            zh: "Proof-of-Fee 发射上的买入经 PoF 路由，以便计入 Work；计划已经选好。带 recipient 的原生币买入精确模拟；ERC-20 买入和所有卖出由储备计算。发射毕业后报价返回 409：改在 Uniswap V4 池上交易。",
          },
        },
        {
          kind: "code",
          label: "POST /v1/launch-plan · POST /v1/auth",
          code: `POST ${base}/v1/launch-plan
{ "template": "standard" | "wall" | "pof", "creator": "<addr>", "pairToken": "<quote or 0x0>",
  "buyAmount": "<raw>", "minTokensOut": "0", "launchConfigId": "0",
  "params": { "name", "symbol", "logo", "description", "socials": {…}, "salt": "<bytes32>",
              "creatorFeeRecipient"?, "creatorTaxBps"?, "buybackEnabled"? },
  "cfg"?: { …wall or pof settings } }
// → { to, data, value, launchFee, approve?, predicted: { treasury, staking } | { vault } | null }

POST ${base}/v1/auth      // a signed EIP-712 BuyAuth for RadianExecutor (domain "RadianExecutor", version 1 | 2)
{ "auth": { user, token, perBuyMax, maxGasPrice, totalCount, minInterval, deadline, nonce,
            asset?, minPerBuy?, minTokensPerQuote? },   // the last three on executor v2
  "signature": "0x…" }
// → { ok, authId }; GET ${base}/v1/auth/<user> lists them with count, lastAt, status`,
        },
        {
          kind: "note",
          text: {
            en: "Payments: the API is shaped for x402 (the manifest has a price per service) but every service is free until a facilitator settles on this chain; no endpoint charges before then. JSON bodies on /v1 are capped at 32 kB. slippageBps is clamped to 0–5000 and defaults to 100.",
            zh: "付费：API 按 x402 的形状设计（manifest 里每个服务有价格字段），但在这条链上有 facilitator 结算之前所有服务免费；在此之前没有端点会收费。/v1 的 JSON 体上限 32 kB。slippageBps 被限制在 0–5000，默认 100。",
          },
        },
      ],
    },
    {
      id: "api",
      title: { en: "Every endpoint", zh: "全部端点" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "All paths are relative to the base URL above. Every response is JSON except /img. A chain read that fails answers 503 with a reason, never an empty result, because empty is a real answer.",
            zh: "所有路径相对于上面的基址。除 /img 外每个响应都是 JSON。链上读取失败返回 503 并附原因，从不返回空结果，因为空是一个真实的答案。",
          },
        },
        {
          kind: "table",
          head: [
            { en: "Method", zh: "方法" },
            { en: "Path", zh: "路径" },
            { en: "Returns", zh: "返回" },
            { en: "Cache", zh: "缓存" },
            { en: "Limits", zh: "限制" },
          ],
          rows: ENDPOINTS.map((e) => [e.method, e.path, e.returns, cacheLabel(e.cache, lang), e.limits]),
        },
      ],
    },
    {
      id: "addresses",
      title: { en: "Addresses", zh: "地址" },
      blocks: [
        {
          kind: "p",
          text: {
            en: `For ${net.chainName} (chain ${net.chainId}); switch networks in the top bar for another. The third column is the address's three-word fingerprint: every byte feeds each word, so a look-alike address that differs anywhere reads differently. The same phrase appears on the Verify page and in the token's contracts panel.`,
            zh: `${net.chainName}（链 ${net.chainId}）的地址；换网络请用顶栏。第三列是地址的三词指纹：每个字节都参与每个词，所以任何一处不同的相似地址读起来都不一样。同样的短语出现在核验页和代币的合约面板里。`,
          },
        },
        {
          kind: "table",
          head: [
            { en: "Contract", zh: "合约" },
            { en: "Address", zh: "地址" },
            { en: "Fingerprint", zh: "指纹" },
          ],
          rows: addrTable,
        },
        {
          kind: "p",
          text: {
            en: "Quote assets a launch can be paired against on this network. The zero address means the gas coin; the launch's pairToken field uses the same convention.",
            zh: "这个网络上发射可以配对的计价资产。零地址表示燃气币；发射的 pairToken 字段用同样的约定。",
          },
        },
        {
          kind: "table",
          head: [
            { en: "Asset", zh: "资产" },
            { en: "Address", zh: "地址" },
            { en: "Decimals", zh: "小数位" },
            { en: "Note", zh: "说明" },
          ],
          rows: quoteTable,
        },
        {
          kind: "p",
          text: {
            en: "The runtime code hash of each platform contract is pinned in the network config and re-hashed on every visit; the site refuses to launch or trade on a proven mismatch, and the indexer reports its own check as identity. The Verify page shows both.",
            zh: "每个平台合约的运行时代码哈希钉在网络配置里，每次访问都重新计算；一旦证实不符，网站拒绝发射和交易，索引器也在 identity 里报告它自己的核对。核验页两者都显示。",
          },
        },
      ],
    },
    {
      id: "gotchas",
      title: { en: "Gotchas", zh: "坑" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "Confirmation lag. The scanner stays two blocks behind the tip so a reorg never leaves phantom rows, then polls; a receipt in your wallet precedes the index by a few blocks plus the poll. The site keeps its own record of what this browser sent and shows it as indexing… until the index has it. Do the same rather than reporting a landed trade as missing.",
            zh: "确认延迟。扫描器停在链尖后两个区块，这样重组永远不会留下幻影行；之后再轮询。你钱包里的回执会比索引早几个区块加一次轮询。网站自己记着本浏览器发出过什么，并显示为「索引中…」直到索引有了它。请照做，而不是把已上链的交易报告为不存在。",
          },
        },
        {
          kind: "p",
          text: {
            en: "Indexed through block N. /launches and /address/:addr/activity carry through (the last block scanned) and backfillDone. A cold index says still indexing, not nothing launched; show the block, not a zero.",
            zh: "索引至区块 N。/launches 与 /address/:addr/activity 带 through（最后扫描的区块）和 backfillDone。冷启动的索引说的是「还在索引」，不是「没有发射」；显示区块号，而不是显示零。",
          },
        },
        {
          kind: "p",
          text: {
            en: "A failed read is not zero. holders: null means no Transfer has been seen yet (unknown, not 0); change24h: null means fewer than two trades; lastPrice: null means no trade; spotPer1e18: null means an empty token reserve; a 503 from /v1 means the chain read failed. The site lists a balance it could not read with that does not mean zero and a retry.",
            zh: "读取失败不等于零。holders: null 表示还没见到任何 Transfer（未知，不是 0）；change24h: null 表示成交不足两笔；lastPrice: null 表示没有成交；spotPer1e18: null 表示代币储备为空；/v1 的 503 表示链上读取失败。网站把读不到的余额列出来，标「这不等于零」并提供重试。",
          },
        },
        {
          kind: "p",
          text: {
            en: "Quote assets are never summed. Each launch is priced in its pair asset with that asset's decimals; a value in ETH and a value in USDG are not comparable, so the site groups holdings by pairToken and never adds across groups. The totals in /stats add every trade's quote leg after decimal scaling whatever the asset: read them as activity, not as a dollar figure.",
            zh: "计价资产从不相加。每个发射按它的配对资产计价，用那个资产的小数位；以 ETH 计的价值和以 USDG 计的价值不可比，所以网站按 pairToken 分组持仓，从不跨组相加。/stats 里的总量把每笔成交的报价一侧按小数位换算后不分资产相加：把它当活跃度看，不要当美元数。",
          },
        },
        {
          kind: "p",
          text: {
            en: `Native versus ERC-20 quote. pairToken zero means the gas coin (${gas} on this network) and a buy carries value; any other pairToken is an ERC-20 and needs an approve to the curve (or the PoF router) first. An ERC-20 you have no config for: read its symbol and decimals from the chain and never treat it as native, or your msg.value goes to an ERC-20 curve.`,
            zh: `原生币与 ERC-20 计价。pairToken 为零表示燃气币（本网络是 ${gas}），买入带 value；其它 pairToken 都是 ERC-20，需要先向曲线（或 PoF 路由）approve。遇到没有配置的 ERC-20：从链上读它的 symbol 和 decimals，绝不当作原生币处理，否则你的 msg.value 会发给一个 ERC-20 曲线。`,
          },
        },
        {
          kind: "p",
          text: {
            en: "The trade log is capped at 10 000 rows (the oldest dropped by time). Per-token trade lists, /stats?window=all and the 24h facts are bounded by what is retained; the chain is the full record.",
            zh: "成交日志上限 10 000 行（按时间丢弃最旧的）。按代币的成交列表、/stats?window=all 和 24 小时数据都受保留范围限制；完整记录在链上。",
          },
        },
        {
          kind: "p",
          text: {
            en: "Logos. A creator-signed logo replaces the on-chain one in what the indexer serves, and the chain is untouched: logo in /launches can differ from the token's logo() getter. /upload is for the launch flow; the URL it returns is what goes on chain.",
            zh: "Logo。创作者签名上传的 logo 在索引器的输出里替换链上的，链本身不变：/launches 里的 logo 可能和代币的 logo() 不同。/upload 是给发射流程用的；它返回的 URL 才是写上链的。",
          },
        },
        {
          kind: "p",
          text: {
            en: "Delegated buys. The BuyAuth shape follows the executor version on the network: v2 adds asset, minPerBuy and minTokensPerQuote and rejects a v1 body. Read the executor address from the manifest, and note that a network can have the contracts deployed but the feature switched off in the site (networks.ts features).",
            zh: "委托买入。BuyAuth 的形状跟随网络上的 executor 版本：v2 多了 asset、minPerBuy、minTokensPerQuote，并拒绝 v1 形状的请求体。从 manifest 读 executor 地址；注意一个网络可能部署了合约但在网站里关闭了这个功能（networks.ts 的 features）。",
          },
        },
        {
          kind: "p",
          text: {
            en: "Verify, do not trust. Anyone can copy a front end and anyone can run an indexer. The addresses and code hashes in the network config, the identity field in /health and /v1/manifest, and the Verify page are the checks; the router's buy and sell take a referrer as the last argument and a zero address forfeits the share.",
            zh: "核验，而不是信任。任何人都能复制一个前端，任何人都能跑一个索引器。网络配置里的地址和代码哈希、/health 与 /v1/manifest 里的 identity 字段、还有核验页，才是核对的依据；路由的 buy 和 sell 最后一个参数是推荐人，零地址等于放弃这一份。",
          },
        },
      ],
    },
  ];
}

/** The sections for one language and one network, ready to render. */
export function apiDocs(lang: Lang, net: NetworkConfig): DocSection[] {
  return defs(net, lang).map((s) => ({
    id: s.id,
    title: pick(lang, s.title),
    blocks: s.blocks.map((b): DocBlock => {
      switch (b.kind) {
        case "p":
          return { kind: "p", text: pick(lang, b.text) };
        case "note":
          return { kind: "note", text: pick(lang, b.text) };
        case "code":
          return b;
        default:
          return { kind: "table", head: b.head.map((h) => pick(lang, h)), rows: b.rows.map((r) => r.map((c) => pick(lang, c))) };
      }
    }),
  }));
}

/** Plain text of a block, for search. */
export function blockText(b: DocBlock): string {
  switch (b.kind) {
    case "p":
    case "note":
      return b.text;
    case "code":
      return `${b.label} ${b.code}`;
    default:
      return [b.head, ...b.rows].flat().join(" ");
  }
}
