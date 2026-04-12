const BACKEND = 'https://crypto-security-scanner-production.up.railway.app';
let selectedChain = 'ethereum';

document.querySelectorAll('.chain-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chain-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedChain = btn.dataset.chain;
  });
});

document.getElementById('addr-input').addEventListener('keydown', e => { if (e.key === 'Enter') scanManual(); });

function showError(msg) { const b = document.getElementById('error-box'); b.textContent = msg; b.style.display = 'block'; }
function hideError() { document.getElementById('error-box').style.display = 'none'; }
function shortAddr(a) { return a.slice(0,6) + '...' + a.slice(-4); }

async function connectWallet() {
  if (typeof window.ethereum === 'undefined') {
    showError('MetaMask not detected. Please install MetaMask to connect your wallet.');
    return;
  }
  try {
    let accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length === 0) accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    window.location.href = '/dashboard.html';
  } catch(e) {
    showError('Wallet connection cancelled.');
  }
}

async function scanManual() {
  const address = document.getElementById('addr-input').value.trim();
  if (!address || address.length < 10) { showError('Please enter a valid contract address.'); return; }
  hideError();
  document.getElementById('loading-wrap').style.display = 'block';
  document.getElementById('result-wrap').style.display = 'none';
  document.getElementById('loading-text').textContent = 'Scanning contract on-chain...';
  document.getElementById('scan-btn').disabled = true;

  try {
    const res = await fetch(`${BACKEND}/api/analyze?address=${encodeURIComponent(address)}&chain=${selectedChain}`);
    const d = await res.json();
    document.getElementById('loading-wrap').style.display = 'none';
    document.getElementById('scan-btn').disabled = false;
    if (d.error) { showError(d.error); return; }
    renderResult(d);
  } catch(e) {
    document.getElementById('loading-wrap').style.display = 'none';
    document.getElementById('scan-btn').disabled = false;
    showError('Could not connect to server. Make sure the backend is running on localhost:5001');
  }
}

function renderResult(d) {
  const scoreColor = d.score >= 75 ? 'v-green' : d.score >= 45 ? 'v-amber' : 'v-red';
  const barColor = d.score >= 75 ? 'var(--green)' : d.score >= 45 ? 'var(--amber)' : 'var(--red)';
  const sym = (d.token_symbol || '?').slice(0,2);
  const avCls = `av-${d.risk_level}`;

  const checksHTML = d.checks.map(c => {
    const cls = c.status==='safe'?'chk-safe':c.status==='warn'?'chk-warn':'chk-danger';
    const icon = c.status==='safe'?'✓':c.status==='warn'?'!':'✕';
    const tagCls = c.status==='safe'?'tag-safe':c.status==='warn'?'tag-warn':'tag-danger';
    const lang = localStorage.getItem('cg_lang') || 'en';
    const translatedText = translateCheck(c.text, lang);
    const translatedTag = translateTag(c.tag, lang);
    return `<div class="chk ${cls}"><span class="chk-icon">${icon}</span><span class="chk-text">${translatedText}</span><span class="chk-tag ${tagCls}">${translatedTag}</span></div>`;
  }).join('');

  document.getElementById('result-card').innerHTML = `
    <div class="result-top">
      <div class="token-info">
        <div class="token-av ${avCls}">${sym}</div>
        <div>
          <div class="token-name">${d.token_name} (${d.token_symbol})</div>
          <div class="token-addr">${shortAddr(d.address)} · ${selectedChain}</div>
        </div>
      </div>
      <div class="risk-pill risk-${d.risk_level}">
        <div class="rdot rdot-${d.risk_level}"></div>
        ${d.risk}
      </div>
    </div>
    <div class="result-metrics">
      <div class="r-metric"><div class="r-metric-label">Security score</div><div class="r-metric-val ${scoreColor}">${d.score}/100</div></div>
      <div class="r-metric"><div class="r-metric-label">Honeypot</div><div class="r-metric-val ${d.is_honeypot?'v-red':'v-green'}">${d.is_honeypot?'Yes':'No'}</div></div>
      <div class="r-metric"><div class="r-metric-label">Verified code</div><div class="r-metric-val ${d.is_open_source?'v-green':'v-red'}">${d.is_open_source?'Yes':'No'}</div></div>
      <div class="r-metric"><div class="r-metric-label">Holders</div><div class="r-metric-val v-dim">${d.holder_count ? Number(d.holder_count).toLocaleString() : 'N/A'}</div></div>
    </div>
    <div class="score-wrap">
      <div class="score-bar-label"><span>Security score</span><span>${d.score}/100</span></div>
      <div class="score-track"><div class="score-fill" style="width:${d.score}%;background:${barColor};"></div></div>
    </div>
    <div class="checks-wrap">${checksHTML}</div>
    <div style="margin-top:16px;padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <span style="font-size:13px;color:var(--text-muted);">Share this report</span>
      <div style="display:flex;gap:8px;">
        <a href="/token.html?address=${d.address}&chain=${selectedChain}" target="_blank" style="font-size:12px;font-weight:600;color:var(--green);text-decoration:none;padding:6px 14px;border:1px solid var(--border-green);border-radius:99px;">View full report →</a>
        <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(d.token_name+' ('+d.token_symbol+') scored '+d.score+'/100 on @thesafechain — '+d.risk)}&url=${encodeURIComponent('https://www.thesafechain.xyz/token.html?address='+d.address+'&chain='+selectedChain)}" target="_blank" style="font-size:12px;font-weight:600;color:var(--text-muted);text-decoration:none;padding:6px 14px;border:1px solid var(--border);border-radius:99px;">Share on X</a>
      </div>
    </div>
  `;

  const wrap = document.getElementById('result-wrap');
  wrap.style.display = 'block';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Auto detect wallet
window.addEventListener('load', async () => {
  if (typeof window.ethereum !== 'undefined') {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) {
      document.getElementById('connect-btn').style.display = 'none';
      document.getElementById('wallet-pill').style.display = 'flex';
      document.getElementById('wallet-addr-nav').textContent = shortAddr(accounts[0]);
      document.getElementById('wallet-cta').style.display = 'none';
      const navRight = document.querySelector('.nav-right');
      const dashLink = document.createElement('a');
      dashLink.href = '/dashboard.html';
      dashLink.style.cssText = 'font-size:14px;color:var(--green);font-weight:600;text-decoration:none;';
      dashLink.textContent = 'My wallet →';
      document.getElementById('wallet-pill').after(dashLink);
    }
  }
});


// ── LANGUAGE SELECTOR ──────────────────────────────────────
const T = {
  en: {
    badge: 'Real-time on-chain security analysis',
    h1: 'Know what\'s <span class="accent">safe</span> before you <span class="dim">risk anything</span>',
    sub: 'Paste any contract address and get a full risk report in seconds. Detect rugpulls, honeypots, and dangerous wallets — instantly.',
    placeholder: 'Paste a contract address...',
    scan: 'Scan now', hint: 'Free · No signup · Results in seconds',
    s1: 'Contracts analyzed', s2: 'Lost to rugpulls', s3: 'Supported networks',
    cta_h: 'Scan your entire wallet instantly',
    cta_p: 'Connect and TheSafeChain automatically checks every token you hold — flagging dangerous ones before you lose money.',
    cta_btn: "Connect wallet \u2014 it's free",
    cta_note: 'Read-only · We never request transaction permissions',
    connect: 'Connect wallet', pricing: 'Pricing',
    feat_label: 'Why TheSafeChain', feat_title: 'Everything you need to stay safe on-chain',
    f1_t: 'Honeypot detection', f1_d: 'Know instantly if a token will trap your funds and prevent you from selling.',
    f2_t: 'Deployer history', f2_d: 'See if the contract creator has a history of rugpulls across any chain.',
    f3_t: 'Real-time analysis', f3_d: 'On-chain data fetched live — no cached results, no outdated information.',
    f4_t: 'Wallet scanner', f4_d: 'Connect your wallet and scan every token you hold in one click.',
    f5_t: 'Multi-chain', f5_d: 'Ethereum, BSC, Polygon, Arbitrum, Base, Avalanche — all supported.',
    f6_t: 'No KYC ever', f6_d: 'Connect with your wallet. No email, no password, no personal data.',
    p_label: 'Pricing', p_title: 'Pay with crypto.\nNo banks. No KYC.',
    p1_name: 'Free', p1_desc: 'For users who want to explore.',
    p1_f1: '5 scans per day', p1_f2: 'Wallet portfolio scan', p1_f3: 'Basic risk detection', p1_f4: 'Main networks',
    p1_btn: 'Connect wallet',
    p2_badge: 'Most popular', p2_name: 'Pro', p2_desc: "For active investors who can't afford surprises.",
    p2_f1: 'Unlimited scans', p2_f2: 'Full deployer history', p2_f3: 'Real-time alerts',
    p2_f4: 'Wallet permission scanner', p2_f5: 'All EVM networks', p2_f6: 'API access',
    p2_btn: 'Start 7-day free trial',
    p3_name: 'Team', p3_desc: 'For DAOs, funds and groups.',
    p3_f1: 'Everything in Pro', p3_f2: 'Up to 5 users', p3_f3: 'Priority API access', p3_f4: 'Exportable reports',
    p3_btn: 'Contact us',
    footer_tagline: "The most complete crypto security scanner. Protect your investments before it's too late.",
    footer_product: 'Product', footer_legal: 'Legal',
    footer_scan: 'Contract scanner', footer_dash: 'Wallet dashboard', footer_pricing: 'Pricing', footer_upgrade: 'Upgrade to Pro',
    footer_terms: 'Terms of service', footer_privacy: 'Privacy policy', footer_disc: 'Disclaimer',
    footer_copy: '© 2026 TheSafeChain. All rights reserved.', footer_dyor: 'Not financial advice. Always DYOR.',
  },
  es: {
    badge: 'Análisis de seguridad on-chain en tiempo real',
    h1: 'Sabe qué es <span class="accent">seguro</span> antes de <span class="dim">arriesgar nada</span>',
    sub: 'Pega cualquier dirección de contrato y obtén un informe de riesgo completo en segundos. Detecta rugpulls, honeypots y wallets peligrosas.',
    placeholder: 'Pega una dirección de contrato...',
    scan: 'Analizar', hint: 'Gratis · Sin registro · Resultados en segundos',
    s1: 'Contratos analizados', s2: 'Perdido en rugpulls', s3: 'Redes soportadas',
    cta_h: 'Escanea toda tu wallet al instante',
    cta_p: 'Conecta y TheSafeChain analiza automáticamente cada token que tienes — marcando los peligrosos antes de que pierdas dinero.',
    cta_btn: 'Conectar wallet — es gratis',
    cta_note: 'Solo lectura · Nunca pedimos permisos de transacción',
    connect: 'Conectar wallet', pricing: 'Precios',
    feat_label: 'Por qué TheSafeChain', feat_title: 'Todo lo que necesitas para estar seguro on-chain',
    f1_t: 'Detección de honeypot', f1_d: 'Sabe al instante si un token atrapará tus fondos e impedirá que vendas.',
    f2_t: 'Historial del deployer', f2_d: 'Ve si el creador del contrato tiene historial de rugpulls en cualquier red.',
    f3_t: 'Análisis en tiempo real', f3_d: 'Datos on-chain en vivo — sin resultados en caché ni información desactualizada.',
    f4_t: 'Escáner de wallet', f4_d: 'Conecta tu wallet y escanea cada token que tienes en un clic.',
    f5_t: 'Multi-chain', f5_d: 'Ethereum, BSC, Polygon, Arbitrum, Base, Avalanche — todo soportado.',
    f6_t: 'Sin KYC nunca', f6_d: 'Conecta con tu wallet. Sin email, sin contraseña, sin datos personales.',
    p_label: 'Precios', p_title: 'Paga con crypto.\nSin bancos. Sin KYC.',
    p1_name: 'Gratis', p1_desc: 'Para usuarios que quieren explorar.',
    p1_f1: '5 análisis al día', p1_f2: 'Análisis de portfolio', p1_f3: 'Detección básica de riesgo', p1_f4: 'Redes principales',
    p1_btn: 'Conectar wallet',
    p2_badge: 'Más popular', p2_name: 'Pro', p2_desc: 'Para inversores activos que no pueden permitirse sorpresas.',
    p2_f1: 'Análisis ilimitados', p2_f2: 'Historial completo del deployer', p2_f3: 'Alertas en tiempo real',
    p2_f4: 'Escáner de permisos', p2_f5: 'Todas las redes EVM', p2_f6: 'Acceso API',
    p2_btn: 'Empezar prueba gratis 7 días',
    p3_name: 'Equipo', p3_desc: 'Para DAOs, fondos y grupos.',
    p3_f1: 'Todo lo de Pro', p3_f2: 'Hasta 5 usuarios', p3_f3: 'Acceso API prioritario', p3_f4: 'Informes exportables',
    p3_btn: 'Contáctanos',
    footer_tagline: 'El escáner de seguridad cripto más completo. Protege tus inversiones antes de que sea tarde.',
    footer_product: 'Producto', footer_legal: 'Legal',
    footer_scan: 'Escáner de contratos', footer_dash: 'Dashboard de wallet', footer_pricing: 'Precios', footer_upgrade: 'Mejorar a Pro',
    footer_terms: 'Términos de servicio', footer_privacy: 'Política de privacidad', footer_disc: 'Aviso legal',
    footer_copy: '© 2026 TheSafeChain. Todos los derechos reservados.', footer_dyor: 'No es asesoramiento financiero. Siempre DYOR.',
  },
  zh: {
    badge: '实时链上安全分析',
    h1: '在<span class="dim">冒险</span>之前了解什么是<span class="accent">安全的</span>',
    sub: '粘贴任何合约地址，几秒内获取完整的风险报告。即时检测跑路、蜜罐和危险钱包。',
    placeholder: '粘贴合约地址...',
    scan: '立即扫描', hint: '免费 · 无需注册 · 秒速结果',
    s1: '已分析合约', s2: '用户跑路损失', s3: '支持网络',
    cta_h: '一键扫描整个钱包',
    cta_p: '连接后，TheSafeChain自动检查您持有的每个代币——在您损失之前标记危险代币。',
    cta_btn: '连接钱包 — 免费',
    cta_note: '只读 · 我们从不请求交易权限',
    connect: '连接钱包', pricing: '价格',
    feat_label: '为什么选择TheSafeChain', feat_title: '保障链上安全所需的一切',
    f1_t: '蜜罐检测', f1_d: '立即了解代币是否会锁定您的资金并阻止您出售。',
    f2_t: '部署者历史', f2_d: '查看合约创建者是否在任何链上有跑路记录。',
    f3_t: '实时分析', f3_d: '实时获取链上数据——无缓存结果，无过期信息。',
    f4_t: '钱包扫描器', f4_d: '连接钱包，一键扫描您持有的每个代币。',
    f5_t: '多链支持', f5_d: '以太坊、BSC、Polygon、Arbitrum、Base、Avalanche——全部支持。',
    f6_t: '永不KYC', f6_d: '使用钱包连接。无需邮箱、密码或个人数据。',
    p_label: '价格', p_title: '用加密货币支付。\n无银行。无KYC。',
    p1_name: '免费', p1_desc: '适合想要探索的用户。',
    p1_f1: '每天5次扫描', p1_f2: '钱包组合扫描', p1_f3: '基本风险检测', p1_f4: '主要网络',
    p1_btn: '连接钱包',
    p2_badge: '最受欢迎', p2_name: '专业版', p2_desc: '适合不能承受意外的活跃投资者。',
    p2_f1: '无限扫描', p2_f2: '完整部署者历史', p2_f3: '实时警报',
    p2_f4: '钱包权限扫描器', p2_f5: '所有EVM网络', p2_f6: 'API访问',
    p2_btn: '开始7天免费试用',
    p3_name: '团队版', p3_desc: '适合DAO、基金和投资群体。',
    p3_f1: '专业版全部功能', p3_f2: '最多5个用户', p3_f3: '优先API访问', p3_f4: '可导出报告',
    p3_btn: '联系我们',
    footer_tagline: '最完整的加密安全扫描器。在为时已晚之前保护您的投资。',
    footer_product: '产品', footer_legal: '法律',
    footer_scan: '合约扫描器', footer_dash: '钱包仪表板', footer_pricing: '价格', footer_upgrade: '升级到专业版',
    footer_terms: '服务条款', footer_privacy: '隐私政策', footer_disc: '免责声明',
    footer_copy: '© 2026 TheSafeChain. 保留所有权利。', footer_dyor: '非财务建议。请自行研究。',
  },
  ja: {
    badge: 'リアルタイムオンチェーンセキュリティ分析',
    h1: '<span class="dim">リスクを取る</span>前に何が<span class="accent">安全</span>かを知る',
    sub: 'コントラクトアドレスを貼り付けると、数秒でリスクレポートを取得できます。ラグプル、ハニーポット、危険なウォレットを即座に検出。',
    placeholder: 'コントラクトアドレスを貼り付け...',
    scan: '今すぐスキャン', hint: '無料 · 登録不要 · 数秒で結果',
    s1: '分析済みコントラクト', s2: 'ラグプル被害', s3: '対応ネットワーク',
    cta_h: 'ウォレット全体を即座にスキャン',
    cta_p: '接続するとTheSafeChainが保有する全トークンを自動的にチェック — 損失前に危険なものをフラグします。',
    cta_btn: 'ウォレットを接続 — 無料',
    cta_note: '読み取り専用 · 取引権限は要求しません',
    connect: 'ウォレットを接続', pricing: '料金',
    feat_label: 'なぜTheSafeChainか', feat_title: 'オンチェーンで安全を守るために必要なすべて',
    f1_t: 'ハニーポット検出', f1_d: 'トークンが資金をロックして売却を妨げるかどうかを即座に確認。',
    f2_t: 'デプロイヤー履歴', f2_d: 'コントラクト作成者がどのチェーンでもラグプルの履歴があるかを確認。',
    f3_t: 'リアルタイム分析', f3_d: 'ライブのオンチェーンデータ取得 — キャッシュなし、古い情報なし。',
    f4_t: 'ウォレットスキャナー', f4_d: 'ウォレットを接続して、保有するすべてのトークンをワンクリックでスキャン。',
    f5_t: 'マルチチェーン', f5_d: 'Ethereum、BSC、Polygon、Arbitrum、Base、Avalanche — すべてサポート。',
    f6_t: 'KYC不要', f6_d: 'ウォレットで接続。メール、パスワード、個人データ不要。',
    p_label: '料金', p_title: '暗号通貨で支払い。\n銀行不要。KYC不要。',
    p1_name: '無料', p1_desc: '探索したいユーザー向け。',
    p1_f1: '1日5回スキャン', p1_f2: 'ウォレットポートフォリオスキャン', p1_f3: '基本リスク検出', p1_f4: 'メインネットワーク',
    p1_btn: 'ウォレットを接続',
    p2_badge: '最人気', p2_name: 'プロ', p2_desc: '予期せぬ事態を許容できないアクティブ投資家向け。',
    p2_f1: '無制限スキャン', p2_f2: 'デプロイヤー履歴完全版', p2_f3: 'リアルタイムアラート',
    p2_f4: 'ウォレット権限スキャナー', p2_f5: 'すべてのEVMネットワーク', p2_f6: 'APIアクセス',
    p2_btn: '7日間無料トライアル開始',
    p3_name: 'チーム', p3_desc: 'DAO、ファンド、投資グループ向け。',
    p3_f1: 'プロのすべて', p3_f2: '最大5ユーザー', p3_f3: '優先APIアクセス', p3_f4: 'エクスポート可能レポート',
    p3_btn: 'お問い合わせ',
    footer_tagline: '最も完全な暗号セキュリティスキャナー。手遅れになる前に投資を守りましょう。',
    footer_product: '製品', footer_legal: '法律',
    footer_scan: 'コントラクトスキャナー', footer_dash: 'ウォレットダッシュボード', footer_pricing: '料金', footer_upgrade: 'プロにアップグレード',
    footer_terms: '利用規約', footer_privacy: 'プライバシーポリシー', footer_disc: '免責事項',
    footer_copy: '© 2026 TheSafeChain. All rights reserved.', footer_dyor: '投資アドバイスではありません。常にDYOR。',
  }
};

const langLabels = { en: '🇺🇸 EN', es: '🇪🇸 ES', zh: '🇨🇳 中文', ja: '🇯🇵 JP' };
// ── CHECK TRANSLATIONS ──────────────────────────────────────
const CHECK_T = {
  es: {
    'No honeypot detected — you can sell freely': 'Sin honeypot detectado — puedes vender libremente',
    'Honeypot detected — you will NOT be able to sell': 'Honeypot detectado — NO podrás vender',
    'Contract source code is verified and public': 'El código fuente del contrato está verificado y es público',
    'Source code is NOT verified — code is hidden': 'El código fuente NO está verificado — el código está oculto',
    'Ownership has been renounced': 'La propiedad ha sido renunciada',
    'Owner can still modify contract functions': 'El propietario aún puede modificar las funciones del contrato',
    'No mint function — supply is fixed': 'Sin función de mint — el suministro es fijo',
    'Owner can mint unlimited new tokens (inflation risk)': 'El propietario puede acuñar tokens ilimitados (riesgo de inflación)',
    'Proxy contract — logic can be changed by the owner': 'Contrato proxy — la lógica puede ser cambiada por el propietario',
    'No blacklist function detected': 'No se detectó función de lista negra',
    'Contract can blacklist addresses — your wallet could be blocked': 'El contrato puede bloquear direcciones — tu wallet podría ser bloqueada',
    'Whitelist mechanism active — trading may be restricted': 'Mecanismo de whitelist activo — el trading puede estar restringido',
    'Anti-whale limit detected — max transaction amount is restricted': 'Límite anti-ballena detectado — el monto máximo de transacción está restringido',
    'Trading cooldown mechanism detected': 'Mecanismo de enfriamiento de trading detectado',
    'No liquidity pool detected': 'No se detectó pool de liquidez',
    'Liquidity is locked — reduces rugpull risk': 'La liquidez está bloqueada — reduce el riesgo de rugpull',
    'Liquidity is NOT locked — owner can remove it anytime': 'La liquidez NO está bloqueada — el propietario puede retirarla en cualquier momento',
    'Safe': 'Seguro', 'Danger': 'Peligro', 'Caution': 'Precaución', 'Info': 'Info',
  },
  zh: {
    'No honeypot detected — you can sell freely': '未检测到蜜罐 — 您可以自由出售',
    'Honeypot detected — you will NOT be able to sell': '检测到蜜罐 — 您将无法出售',
    'Contract source code is verified and public': '合约源代码已验证并公开',
    'Source code is NOT verified — code is hidden': '源代码未验证 — 代码隐藏',
    'Ownership has been renounced': '所有权已放弃',
    'Owner can still modify contract functions': '所有者仍可修改合约功能',
    'No mint function — supply is fixed': '无铸币功能 — 供应量固定',
    'Owner can mint unlimited new tokens (inflation risk)': '所有者可铸造无限新代币（通胀风险）',
    'Proxy contract — logic can be changed by the owner': '代理合约 — 逻辑可被所有者更改',
    'No blacklist function detected': '未检测到黑名单功能',
    'Contract can blacklist addresses — your wallet could be blocked': '合约可将地址列入黑名单 — 您的钱包可能被封锁',
    'Whitelist mechanism active — trading may be restricted': '白名单机制激活 — 交易可能受限',
    'Anti-whale limit detected — max transaction amount is restricted': '反鲸鱼限制检测 — 最大交易金额受限',
    'Trading cooldown mechanism detected': '检测到交易冷却机制',
    'No liquidity pool detected': '未检测到流动性池',
    'Liquidity is locked — reduces rugpull risk': '流动性已锁定 — 降低跑路风险',
    'Liquidity is NOT locked — owner can remove it anytime': '流动性未锁定 — 所有者可随时撤除',
    'Safe': '安全', 'Danger': '危险', 'Caution': '注意', 'Info': '信息',
  },
  ja: {
    'No honeypot detected — you can sell freely': 'ハニーポット未検出 — 自由に売却できます',
    'Honeypot detected — you will NOT be able to sell': 'ハニーポット検出 — 売却できません',
    'Contract source code is verified and public': 'コントラクトのソースコードは検証済みで公開されています',
    'Source code is NOT verified — code is hidden': 'ソースコードは未検証 — コードが隠されています',
    'Ownership has been renounced': '所有権が放棄されています',
    'Owner can still modify contract functions': 'オーナーはコントラクト機能を変更できます',
    'No mint function — supply is fixed': 'ミント機能なし — 供給量は固定',
    'Owner can mint unlimited new tokens (inflation risk)': 'オーナーは無制限にトークンをミントできます（インフレリスク）',
    'Proxy contract — logic can be changed by the owner': 'プロキシコントラクト — オーナーがロジックを変更可能',
    'No blacklist function detected': 'ブラックリスト機能未検出',
    'Contract can blacklist addresses — your wallet could be blocked': 'コントラクトがアドレスをブラックリストに追加できます',
    'Whitelist mechanism active — trading may be restricted': 'ホワイトリスト機能が有効 — 取引が制限される可能性',
    'Anti-whale limit detected — max transaction amount is restricted': 'アンチクジラ制限検出 — 最大取引額が制限されています',
    'Trading cooldown mechanism detected': '取引クールダウンメカニズム検出',
    'No liquidity pool detected': '流動性プール未検出',
    'Liquidity is locked — reduces rugpull risk': '流動性がロックされています — ラグプルリスクを低減',
    'Liquidity is NOT locked — owner can remove it anytime': '流動性がロックされていません — オーナーがいつでも撤退可能',
    'Safe': '安全', 'Danger': '危険', 'Caution': '注意', 'Info': '情報',
  }
};

function translateCheck(text, lang) {
  if (lang === 'en' || !CHECK_T[lang]) return text;
  // Exact match
  if (CHECK_T[lang][text]) return CHECK_T[lang][text];

  // Dynamic: Buy tax X% / Sell tax X%
  var taxMatch = text.match(/Buy tax ([\d.]+)% \/ Sell tax ([\d.]+)%/);
  if (taxMatch) {
    var templates = {
      es: 'Compra tax ' + taxMatch[1] + '% / Venta tax ' + taxMatch[2] + '%',
      zh: '买入税 ' + taxMatch[1] + '% / 卖出税 ' + taxMatch[2] + '%',
      ja: '購入税 ' + taxMatch[1] + '% / 売却税 ' + taxMatch[2] + '%'
    };
    return templates[lang] || text;
  }

  // Dynamic: sell tax X% — very hard to profit
  var highTaxMatch = text.match(/Very high sell tax: ([\d.]+)%/);
  if (highTaxMatch) {
    var templates2 = {
      es: 'Sell tax muy alto: ' + highTaxMatch[1] + '% — muy difícil obtener ganancias',
      zh: '卖出税极高: ' + highTaxMatch[1] + '% — 盈利非常困难',
      ja: '売却税が非常に高い: ' + highTaxMatch[1] + '% — 利益を得るのが非常に困難'
    };
    return templates2[lang] || text;
  }

  // Dynamic: Top 3 wallets control X% — extreme
  var whaleMatch = text.match(/Top 3 wallets control ([\d.]+)% of supply — extreme/);
  if (whaleMatch) {
    var templates3 = {
      es: 'Las 3 mejores wallets controlan el ' + whaleMatch[1] + '% del suministro — riesgo de concentración extremo',
      zh: '前3个钱包控制 ' + whaleMatch[1] + '% 的供应量 — 极端集中风险',
      ja: 'トップ3ウォレットが供給量の ' + whaleMatch[1] + '% を保有 — 極端な集中リスク'
    };
    return templates3[lang] || text;
  }

  // Dynamic: Top 3 wallets hold X%
  var whaleMatch2 = text.match(/Top 3 wallets hold ([\d.]+)% of supply/);
  if (whaleMatch2) {
    var templates4 = {
      es: 'Las 3 mejores wallets tienen el ' + whaleMatch2[1] + '% del suministro',
      zh: '前3个钱包持有 ' + whaleMatch2[1] + '% 的供应量',
      ja: 'トップ3ウォレットが供給量の ' + whaleMatch2[1] + '% を保有'
    };
    return templates4[lang] || text;
  }

  // Dynamic: Supply is well distributed — top 3 wallets hold X%
  var distMatch = text.match(/Supply is well distributed — top 3 wallets hold ([\d.]+)%/);
  if (distMatch) {
    var templates5 = {
      es: 'El suministro está bien distribuido — las 3 mejores wallets tienen el ' + distMatch[1] + '%',
      zh: '供应分布良好 — 前3个钱包持有 ' + distMatch[1] + '%',
      ja: '供給は適切に分散されています — トップ3ウォレットが ' + distMatch[1] + '% を保有'
    };
    return templates5[lang] || text;
  }

  // Dynamic: Liquidity found on X
  var liqMatch = text.match(/Liquidity found on (.+)/);
  if (liqMatch) {
    var templates6 = {
      es: 'Liquidez encontrada en ' + liqMatch[1],
      zh: '在 ' + liqMatch[1] + ' 发现流动性',
      ja: liqMatch[1] + ' で流動性を検出'
    };
    return templates6[lang] || text;
  }

  // Dynamic: Sell tax is X%
  var sellTaxMatch = text.match(/Sell tax is ([\d.]+)%/);
  if (sellTaxMatch) {
    var templates7 = {
      es: 'Sell tax es ' + sellTaxMatch[1] + '% — tenlo en cuenta al operar',
      zh: '卖出税为 ' + sellTaxMatch[1] + '%',
      ja: '売却税は ' + sellTaxMatch[1] + '%'
    };
    return templates7[lang] || text;
  }

  // Dynamic: Deployer: 0x...
  var deployMatch = text.match(/Deployer: (.+)/);
  if (deployMatch) {
    var templates8 = {
      es: 'Deployer: ' + deployMatch[1],
      zh: '部署者: ' + deployMatch[1],
      ja: 'デプロイヤー: ' + deployMatch[1]
    };
    return templates8[lang] || text;
  }

  return text;
}

function translateTag(tag, lang) {
  if (lang === 'en' || !CHECK_T[lang]) return tag;
  return CHECK_T[lang][tag] || tag;
}



function applyLang(lang) {
  var t = T[lang];
  if (!t) return;
  var q = function(s) { return document.querySelector(s); };
  var qa = function(s) { return document.querySelectorAll(s); };

  var pl = q('a[data-i18n="nav_pricing"]');
  if (pl) pl.textContent = t.pricing;
  var cb = document.getElementById('connect-btn');
  if (cb && cb.style.display !== 'none') cb.textContent = t.connect;

  var badge = q('.hero-badge');
  if (badge) badge.innerHTML = '<div class="badge-dot"></div>' + t.badge;
  var h1 = q('.hero h1');
  if (h1) h1.innerHTML = t.h1;
  var sub = q('.hero-sub');
  if (sub) sub.textContent = t.sub;
  var inp = document.getElementById('addr-input');
  if (inp) inp.placeholder = t.placeholder;
  var sb = document.getElementById('scan-btn');
  if (sb) sb.textContent = t.scan;
  var hint = q('.hint');
  if (hint) hint.textContent = t.hint;

  var stats = qa('.stat');
  if (stats[0]) stats[0].querySelector('.stat-label').textContent = t.s1;
  if (stats[1]) stats[1].querySelector('.stat-label').textContent = t.s2;
  if (stats[2]) stats[2].querySelector('.stat-label').textContent = t.s3;

  var ctah = q('.cta-card h3');
  if (ctah) ctah.textContent = t.cta_h;
  var ctap = q('.cta-card p');
  if (ctap) ctap.textContent = t.cta_p;
  var ctabtn = q('.cta-connect');
  if (ctabtn) ctabtn.textContent = t.cta_btn;
  var ctanote = q('.cta-sub');
  if (ctanote) ctanote.textContent = t.cta_note;

  // Features
  var fl = q('.features-label'); if (fl) fl.textContent = t.feat_label;
  var ft = q('.features-title'); if (ft) ft.textContent = t.feat_title;
  var fc = qa('.feature-card');
  var ftitles = [t.f1_t,t.f2_t,t.f3_t,t.f4_t,t.f5_t,t.f6_t];
  var fdescs = [t.f1_d,t.f2_d,t.f3_d,t.f4_d,t.f5_d,t.f6_d];
  fc.forEach(function(card,i) {
    var tt = card.querySelector('.feature-title'); if (tt && ftitles[i]) tt.textContent = ftitles[i];
    var td = card.querySelector('.feature-desc'); if (td && fdescs[i]) td.textContent = fdescs[i];
  });

  // Pricing
  var pl2 = q('.pricing-label'); if (pl2) pl2.textContent = t.p_label;
  var pt = q('.pricing-title'); if (pt) pt.innerHTML = t.p_title.replace('\n','<br>');
  var plans = qa('.plan');
  if (plans[0]) {
    var pn = plans[0].querySelector('.plan-name'); if (pn) pn.textContent = t.p1_name;
    var pd = plans[0].querySelector('.plan-desc'); if (pd) pd.textContent = t.p1_desc;
    var pf = plans[0].querySelectorAll('.plan-features li');
    if (pf[0]) pf[0].textContent = t.p1_f1; if (pf[1]) pf[1].textContent = t.p1_f2;
    if (pf[2]) pf[2].textContent = t.p1_f3; if (pf[3]) pf[3].textContent = t.p1_f4;
    var pb = plans[0].querySelector('.plan-btn'); if (pb) pb.textContent = t.p1_btn;
  }
  if (plans[1]) {
    var pb2 = plans[1].querySelector('.plan-badge'); if (pb2) pb2.textContent = t.p2_badge;
    var pn2 = plans[1].querySelector('.plan-name'); if (pn2) pn2.textContent = t.p2_name;
    var pd2 = plans[1].querySelector('.plan-desc'); if (pd2) pd2.textContent = t.p2_desc;
    var pf2 = plans[1].querySelectorAll('.plan-features li');
    if (pf2[0]) pf2[0].textContent = t.p2_f1; if (pf2[1]) pf2[1].textContent = t.p2_f2;
    if (pf2[2]) pf2[2].textContent = t.p2_f3; if (pf2[3]) pf2[3].textContent = t.p2_f4;
    if (pf2[4]) pf2[4].textContent = t.p2_f5; if (pf2[5]) pf2[5].textContent = t.p2_f6;
    var pb3 = plans[1].querySelector('.plan-btn'); if (pb3) pb3.textContent = t.p2_btn;
  }
  if (plans[2]) {
    var pn3 = plans[2].querySelector('.plan-name'); if (pn3) pn3.textContent = t.p3_name;
    var pd3 = plans[2].querySelector('.plan-desc'); if (pd3) pd3.textContent = t.p3_desc;
    var pf3 = plans[2].querySelectorAll('.plan-features li');
    if (pf3[0]) pf3[0].textContent = t.p3_f1; if (pf3[1]) pf3[1].textContent = t.p3_f2;
    if (pf3[2]) pf3[2].textContent = t.p3_f3; if (pf3[3]) pf3[3].textContent = t.p3_f4;
    var pb4 = plans[2].querySelector('.plan-btn'); if (pb4) pb4.textContent = t.p3_btn;
  }

  document.getElementById('lang-current').textContent = langLabels[lang] + ' ▾';
  qa('.lang-item').forEach(function(item) {
    item.classList.toggle('selected', item.dataset.lang === lang);
  });
  localStorage.setItem('cg_lang', lang);
}

// Wire up selector — same as test-lang.html
document.getElementById('lang-current').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('lang-menu').classList.toggle('visible');
});

document.querySelectorAll('.lang-item').forEach(function(item) {
  item.addEventListener('click', function(e) {
    e.stopPropagation();
    applyLang(this.dataset.lang);
    document.getElementById('lang-menu').classList.remove('visible');
  });
});

document.addEventListener('click', function() {
  document.getElementById('lang-menu').classList.remove('visible');
});