# The Pound：四个来源的借鉴清单与设计结论

日期：2026-09-22。来源：fomo.family（线上产品，含公开资料）、Spectrum（spectrumindexes.xyz，线上产品与开发者文档）、HOLD（本地仓库 `hold-mono`，Go 微服务 + React 前端，逐文件读完）、baskvia（本地仓库，含对 Spectrum 的三轮研究与 BSC 合约实验）。每条结论都注明出处；未读到的不写。

## 0. 一句话定位

| 来源 | 是什么 | 和 The Pound 的关系 |
| --- | --- | --- |
| fomo.family | 社交化跨链交易 App：一个美元余额买任何链上的币，Relay 跨链、ERC-4337 代付 gas、Privy 嵌入钱包、Apple Pay 入金（Crossmint），feed、排行榜、跟单提醒。2026 年 40 亿美元成交、62.5 万用户。它不是发射台，只"发现"新币。 | "发一次到处买"的用户体验原型：余额抽象、无 gas、跨链隐形 |
| Spectrum | Uniswap V4 hook 篮子代币平台，Base / Ethereum / Robinhood Chain 三链，75 个篮子。费用瀑布不可变、推荐分成链上结算、跨网络 bundle、无 owner 合约、MCP 代理接口 | 费用分配、推荐返佣、跨链"一个想法多个网络"的产品表达、信任页 |
| HOLD | 一个完整的多链社交交易后端（parser / market / trade / fund / user / social / bff）加三栏前端。支持 Solana / BNB / Robinhood，已解码 Pons V2 曲线事件，Relay 只做主链侧解码；交易层 Solana 路径完整、EVM 路径原型 | 索引器、K 线、排行、返佣账本、跨链交易状态机、Privy 静默签名的现成实现 |
| baskvia | BNB 篮子平台的静态原型与 09-22 的合约实验；记录了 Spectrum 的费用常量与 Robinhood 股票代币的倍率陷阱 | 费用瀑布的数学与测试、股票代币做配对资产的硬约束 |

## 1. 借鉴清单（按 The Pound 的模块）

### 1.1 手续费瀑布与 Pack 销毁

**采用 Spectrum 的瀑布顺序，把 PRISM 换成 Pack。** Spectrum 文档给出的顺序：销毁份额从顶部扣（`BURN_SHARE_BPS = 1000`，吸收全部舍入余数）；然后当有标记时才切接口方和发射方各 555 bps（约 5%，"redirect existing fee, never an added fee"）；创作者取余额的 0–30%（`creatorShareBps`）；剩下的归持有人；没有标记的份额留在余额而不是归平台。这套规则 baskvia 已用测试钉住（`web/src/domain/fees.ts:148-189`、`fees.test.ts`），并记录了一条代价：各级 floor 的余数统一归 burn 会让 burn 系统性多拿，改动时必须前后端合约一起改（`fees.ts:143-146`）。

映射到 The Pound：
- 顶部扣的份额 = Pack 销毁池；接口方标记 = 推荐人；发射方标记 = 带来创作者的推荐人；创作者份额 = 创作者分成；"持有人"这一层在曲线阶段替换为国库或直接留在曲线（我们没有篮子持有人）。
- 推荐返佣用**标记（tag）** 而不是折扣：fomo 用推荐码给被推荐人打 9 折并按 Silver/Gold/Platinum 给推荐人分成，但 HOLD 的实现证明"折扣"要穿透到报价层，最终没做出来（`trade-buy-implementation.md:13`）。Spectrum 的 `pendingFrontendFees(you)` 拉取式记账加无许可 crank 更简单，也天然支持多前端。

**销毁触发做成无许可 crank，触发者拿赏金。** Spectrum 的 `CRANK_BOUNTY_BPS = 50`，"任何人可执行，无 operator"。HOLD 的经验是奖励低于 gas 时没人会来敲（BTCNVDA keeper 0.0015 NVDA 奖励 < 0.00019 ETH gas，`launchpad-reference-btcnvda.md:51-75`），所以 keeper 仍要自己跑，但把执行权公开能消除"平台停摆就没人烧"的单点。

**LEGACY LINEAGE 教训必须写进合约。** Spectrum 换工厂后，旧篮子的 PRISM 销毁腿失效，费用堆到一个不可动地址（baskvia `spectrum-live-comparison-2026-09-14.md:10`）。Pack 是轮换的，销毁目标会变，所以销毁池的收款方要可由 Safe 更新，而不是把 Pack 币地址写死在每个曲线里。

**周度批次的会计模型直接抄 HOLD 的返佣账本。** `rebate` 表 `UNIQUE(fill_id, fill_version)`，每次修订写增量行而不是回滚已付款项，`payout_batch` 用 `UNIQUE(user_id, batch_date)` 加确定性 `client_request_id`，结算由链上交易阶段驱动，失败的批次自动回到 ACCRUED 进入下一批（`fund/internal/repository/rebate_repo.go:76-112`、`payout_repo.go:64-173`）。每周一次的 Pack 销毁就是同一个模型：累计、锁定、执行、结算、失败回滚。

**小额费用分账用进位累加器。** baskvia 的 `splitFeeOnce` 让多笔累计结果等于加总后再分，残差 O(1)，避免 1 美元交易的 1 分钱手续费 100% 归某一方（`local-preview/dist/fees.mjs:35-56`）。

### 1.2 跨链买入（"发一次，到处买"）

**用户侧体验照 fomo：一个余额、无 gas、看不见桥。** fomo 的做法是 Privy 嵌入钱包（Solana + EVM 智能账户）、ERC-4337 paymaster 代付 gas、Relay 做跨链、DFlow 做 Solana 同链成交、Crossmint 做法币入金。费用约 0.5% 每笔加最小额，无单独提现或跨链费。

**执行层照 HOLD trade 的状态机，但只取骨架。** HOLD 的可复用部分：
- 报价 → 下单 → 服务端固定交易计划 → 客户端只签名 → 提交 → 轮询，签名前后校验消息哈希和签名槽（`apps/web/src/features/trade/signing.ts`），客户端永远签不了报价预览。
- 未知结果时"同字节重发"：先把加密的签名交易存库再广播，超时只重发同一份，绝不重新签名（`engine.go:533-543`、`worker.go:135-159`）。
- 每个钱包一个预留守卫，防止同一笔余额被算两次（`postgres.go:188-287`）；但一个钱包同一时间只能有一笔在途，发射狙击场景要放宽。
- Relay 适配的严格绑定：`/quote/v2` 响应必须逐字段匹配（`depositFeePayer`、`refundTo`、`disableOriginSwaps`、精度），状态只当提示并绑定到源链签名，到账用目标链日志证明且只允许一笔到账，退款从已验证的转账累加（`relay.go`、`status.go`、`receipts.go:256-332`）。
- 代付 gas 的预算桶按天按用户，按实际成本结算（`repository/budget.go`）。
- 不要照抄的部分：41 张表和六种修复流程；EVM 源链执行从未在服务端实现（靠 Privy `sendTransaction`，丢掉了同字节重发保证）；只有源链是原子的，手续费收了但目标链失败会卡在 REVIEW_REQUIRED；solver 批量到账会被"单笔到账"规则拒绝。

**HOLD parser 的 Relay 解码只覆盖 Robinhood 一侧。** 它解码 Relay V3 Router / ApprovalProxy 在主链上的调用，"never proves that funds arrived on another chain"（`protocol/relay/README.md:27,49`）。The Pound 需要新写的是：主链上的接收合约（`buyFor(token, recipient, minOut, refundTo)`）、目标链 fill 的证明、源链（Solana / Base / BNB）的入金证明。

**路由方事实（2026-09-22 核实）**：Relay 支持 Robinhood Chain（4663）、Base、BNB，不支持 Solana；deBridge DLN 支持 Robinhood Chain、Solana、Base、BNB，EVM 目标链支持完整的 hook 执行；Across 已上线 Robinhood Chain，13 条链的 USDC 约 2 秒到账变 USDG。Relay 的 refund 打到源链 `refundTo`，未设则不自动退款。结论：Base / BNB 走 Relay 或 Across 的目标链调用，Solana 走 deBridge hook；HOLD 文档里"Relay 对 Robinhood 支持待确认"（`trade.md:117`）已经过时。

**Solana 用户的地址问题** fomo 和 HOLD 都靠 Privy 同时创建 Solana 和 EVM 嵌入钱包解决（HOLD `privy-provider.tsx:180-196`，`createOnLogin: 'users-without-wallets'` 两条链都开）。The Pound 的 Solana 买家在主链上的接收地址就是他的 Privy EVM 智能账户。HOLD 记录的坑：Privy `supportedChains` 漏了 Robinhood（4663），`getClientForChain` 会失败；同一个智能账户地址在各 EVM 链相同是一个假设，不是保证。

**Spectrum 的 bundle 给出了另一种"多网络"表达**：同一个想法在每条链各发一个兄弟代币，页面按 TVL 加权算合并价，一次购买按权重拆成每条链一个签名（`/thesis/...` 页）。这不是 The Pound 要的"一个池一个价"，但 bundle 页的信息架构（合并价、每链占比、每链一个 BUY）可以直接用在毕业后全链代币的页面上。

### 1.3 毕业后的全链代币

四个来源都没有 OFT 类实现：fomo 不发币，Spectrum 每链独立篮子，HOLD 没有代币发行，baskvia 未上链。可借鉴的只有 Spectrum 的一条原则："never price from the basket's own pool"，以及"代币地址即 hook 地址、无 owner、无升级、无暂停"的信任表达。The Pound 的全链层要自己做（LayerZero OFT 或 Hyperlane），卖出路由回主链以维持"一个价格"。

### 1.4 索引、行情与发现列表

**Pons V2 已经被 HOLD 解码过。** parser 里有 Pons V2 工厂与曲线的全部事件签名（`TokenLaunched`、`PoolGraduated`、`CurveBuy`、`CurveSell`、`SnipeTaxCharged`）、路由器按字节码哈希和区块范围白名单、AA/EIP-7702 归因到智能账户而不是 bundler（`protocol/evm/catalog.go:116-151`、`assembly/pons*.go`、`protocol/aa`）。The Pound 的合约就是 Pons V2 引擎加我们的路由，事件形状一致，索引器可以直接对照。

**HOLD market 里值得搬的模块**：按事件时刻的报价资产美元价折算成交额、绝不用未来价格（`price/settlement.go`、`source/quotes.go`）；精确有理数的 K 线折叠、按链序定开收、幂等重放（`kline/aggregator.go`、`store/postgres/realtime.go`）；5m/15m/1h/4h/24h 滚动统计不用 GROUP BY（`token_stats.go`）；热榜用经验百分位加 2 进 3 出的滞回（`discoveryrank/rank.go`）；Robinhood 链 EVM 持有人用 finalized 区块加 EIP-1898 读并与总供给对账（`holders/evm.go`）；创作者提供的 URI 用防 SSRF 的抓取（`tokens/metadata.go`）；"自发射以来 2 倍"的价格尖峰事件带 exactly-once outbox（`svc/price_spike.go`）。

**HOLD 的反面教材**：发现列表永远为空，因为 risk / protocol 两个校验没有任何提供者，fail-closed 到没用（`discoverycatalog`）；历史回填 315 行迁移、35 个文件，QA 却关着；价格快照每 10 秒每币一行永不清理；串行刷新价格无法扩到上千个币；没有任何 bonding 进度、曲线储备或"即将毕业"字段（虚拟储备被刻意排除在流动性之外）；一笔未知交易会卡住整条链的游标（parser `routing.go:62-260`）。The Pound 自己拥有曲线事件，用自己的索引器做真相源即可，不要抄 Bitquery 归档重建。

**HOLD PRD 的列表阈值可以直接当默认值**（`PRD-左侧发现与社交面板-V1.1.md`）：热榜准入流动性 ≥ 5 万美元、1 小时成交 ≥ 1 万、1 小时独立交易者 ≥ 50，权重 35/30/20/15；内盘列表年龄 ≥ 3 分钟、持有人 ≥ 30、1 小时独立买家 ≥ 20、成交 ≥ 2000 美元、最后成交 ≤ 15 分钟、最大持有人 ≤ 10%、前十 ≤ 40%（开发者钱包计入），按毕业进度排序；毕业以协议事件为准；列表进出 2 次通过进、3 次失败出。

### 1.5 社交与增长

**fomo 的四件套**：公开 feed 带已实现盈亏、排行榜按表现排名、关注某人开仓即提醒、"跟随"只是浮现不是自动跟单（fomo 自己说明"should not be confused with automated copy trading"）。affiliates：任何有受众的人可申请，按被推荐人的每笔 swap 实时计佣、无上限、三档奖励、月度奖金。

**HOLD 的现成实现**：关注 feed 一次落库按 `source_event_id` 幂等、按 revision 更新、扇出到封顶 1000 条的 Redis ZSET、失败降级不报错（`social/feed_service.go:136-273`）；通知按金额 / 市值 / 组合规模过滤后再按"同人同币同方向 2 分钟"合并（`notify_group.go`）；排行榜的窗口盈亏公式扣除净入金（`pnl = Δtotal − Δnet`，`base = start + max(0, Δnet)`），百分比榜设最小本金 100 美元，整表原子重建（`fund/domain/snapshot.go:113-197`）；邀请码 8 位 Crockford base32、注册时一次性写入 `invite_ref`、无效码不阻塞、落地页把码存 30 天 cookie 穿过 OAuth 跳转（`user/auth_service.go:291-357`、`apps/web/.../AttributionCapture.tsx`）。

**HOLD 里坏掉的、要引以为戒的**：trade 发的 Kafka 事件是信封结构，fund 按扁平结构解码，返佣永远不会计提；`platformFee.usd` 永远为空；撤销成交没有撤销返佣；T+1 付款任务从未接线；"已交易才能发观点"的门从未打开（fund/dynamic 扫描 §0）。教训：事件 schema 早冻结，合同测试要跑生产者的真实字节。

### 1.6 信任与非托管表达

- Spectrum `/verify`：给每个合约地址生成 emoji 三连加词组的视觉指纹，"任何人都能复制前端，不能伪造的是这个站实际经手的合约地址"；我们的 /verify 已有代码哈希校验，加指纹是低成本改进。
- Spectrum 文档的整套"给集成方看"的姿态：事件签名与 topic0、`exchangeRate()` 而不是池价、`idleHeld` 而不是 `balanceOf`、`effectiveSupply` 而不是 `totalSupply`、"never print a universal fee split, read it per basket"。The Pound 的 /docs 应该按这个粒度写，让聚合器、机器人和 AI 代理能接。
- Spectrum 附带 MCP 服务器（15 个工具，读链、组交易、钱包签名）；我们的 /v1 agent API 已经是同一方向，可以补一个 MCP 包装。
- baskvia 的纪律：报价接口没接通时抛错而不给估算值；模拟、真实只读、真实执行三层分别标明；每次部署留可审计的 JSON 证据。

### 1.7 配对资产是 Robinhood 股票代币时的硬约束

baskvia 核实并记录的事实（`spectrum-bnb-research-2026-09-14.md:9-23`、`launchpad-reference-btcnvda.md:40-45`）：Robinhood 股票代币有 ERC-8056 `currentMultiplier`（NVDA 1.000775，AAPL 1.000566），1 个原始单位不等于 1 股；链上同时有 `NVDA / USD` 和 `Robinhood NVDA / USD` 两种 feed，读股票 feed 再乘倍率是双重换算。我们的 `gen-stock-quotes.mjs` 已按倍率换算经济参数；前端显示估值时必须选对 feed。xStocks 在 BSC 是 share 型 rebase 代币，`transfer(1e18)` 到账 `999999999999999999`，进不了 V4 池，需要包装层（`bsc-asset-verification-2026-09-23.md:146-191`）；Robinhood 的代币不是这种类型，但发行方可暂停、可升级的风险相同。

## 2. 对 The Pound 的设计决定

1. **费用**：单一费率（曲线阶段 1%，毕业后 V4 hook 费）下的瀑布：Pack 销毁份额顶部扣并吸收余数 → 推荐人标记 555 bps、创作者推荐人标记 555 bps（无标记不扣）→ 创作者份额（发射时设定，0–30%）→ 国库。常数放合约、不可变；每个发射页展示自己的实际拆分，不打印全局比例。
2. **Pack 销毁**：`PackBurner` 合约持有销毁池，`burn(packIndex)` 无许可，满足"轮到该币且池内 ≥ 下限（2.5 万美元或 0.1% 供应，二者取低）"才能执行，执行者拿 50 bps 赏金；Pack 名单和轮换顺序由 Safe 更新；每次销毁发事件，前端自动生成交易链接。主链上不存在的 Pack 币由 keeper 在对应链执行，先只选主链上有的币。
3. **跨链买入**：主链部署 `CrossBuyReceiver`，接受路由方送达的 USDG/ETH 并调用路由 `buyFor`，失败退款给 `refundTo`；Base/BNB 用 Relay 或 Across 的目标链调用，Solana 用 deBridge DLN hook；服务端只产出交易计划，客户端只签名，同字节重发；Solana 用户的接收地址是其 Privy EVM 智能账户。
4. **无 gas**：主链买入用 ERC-4337 paymaster 代付（需确认 Robinhood Chain 上的 bundler 与 paymaster 供应商）；Solana 侧用平台 fee payer 联合签名，模拟审计限定平台可垫付的范围。
5. **全链代币**：毕业后 OFT 镜像，卖出路由回主链；页面用 Spectrum bundle 式的"合并价 + 每链占比"表达。
6. **索引与列表**：沿用我们的索引器，补 bonding 进度、即将毕业、热榜滞回、持有人分布；阈值取 HOLD PRD 的默认值。
7. **社交**：feed（发射、买入、毕业、销毁四类卡片）、排行榜（扣净入金的盈亏）、关注提醒；先做 feed 和销毁日志，排行榜其次。
8. **信任**：/verify 加视觉指纹；/docs 面向集成方；事件 schema 冻结并写合同测试。

## 3. 各来源的坑（不要照搬）

- fomo：卖出侧失败被多次投诉（"trades that failed on the sell side despite easy buying"），feed 和提醒的设计目标就是催人下单，Terms 里承认；美国用户不能用永续。
- Spectrum：PRISM 是平台币，与 The Pound "无平台币"冲突；工厂升级导致旧篮子销毁腿失效；首铸必须带完整 hookData，否则份额基准被夺。
- HOLD：过度工程（parser + market + trade 三个服务 12 万行，QA 上没有行情数据）；上游事件契约漂移导致返佣、付款、门控三条链路全断；密钥进 git（QA 的 Solana fee payer seed、AES key、内部 token 都在受 git 跟踪的清单里）；一把热钥匙同时当 fee payer、费用账户 owner、退款来源和 HMAC 密钥。
- baskvia：README 声称的和代码不一致（40/30/30 与瀑布并存）；全部是浏览器内模拟，没有任何真实链上能力。

## 4. 来源索引

- fomo.family：首页、/answers（73 篇）、/affiliates；Datawallet《Fomo App Explained》；Crossmint 案例；Yahoo Finance 2025-05-06 发布稿。
- Spectrum：/docs、/learn、/earn、/integrate、/risk、/claim、/create、/thesis/iroradev/theport。
- HOLD：`hold-mono` 五路扫描报告（parser、market、trade、fund/user/social/bff、web），文件路径见各条。
- baskvia：README、docs/（含 spectrum-gap-analysis-2026-09-23、bsc-asset-verification-2026-09-23、fee-config-spec、launchpad-reference-btcnvda）、local-preview/dist/*.mjs、contracts/。
- 路由方：Relay `/chains` API、deBridge `supported-chains-info`、Across 博客与 Robinhood 桥接文档。
