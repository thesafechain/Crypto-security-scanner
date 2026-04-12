from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

@app.route('/')
def index():
    return send_from_directory('../frontend', 'index.html')


from datetime import datetime, date


# Pro wallets — in memory for now { wallet: expiry_timestamp }
pro_wallets = {}
OWNER_WALLET = "0x5f4b9a49e3Ec1B0f630f390F5a45bFEA3ee8fAfD".lower()
PRO_PRICE_USDC = 12  # $12 USDC
USDC_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"  # USDC on Ethereum

def is_pro(wallet):
    wallet = wallet.lower()
    if wallet not in pro_wallets:
        return False
    import time
    return pro_wallets[wallet] > time.time()

def activate_pro(wallet):
    import time
    wallet = wallet.lower()
    pro_wallets[wallet] = time.time() + (30 * 24 * 60 * 60)  # 30 days

# In-memory rate limiter: { wallet_address: { 'date': date, 'count': int } }
scan_counts = {}
FREE_LIMIT = 5

def check_rate_limit(wallet):
    if wallet.lower() == OWNER_WALLET:
        return True
    wallet = wallet.lower()
    today = date.today()
    if wallet not in scan_counts or scan_counts[wallet]['date'] != today:
        scan_counts[wallet] = {'date': today, 'count': 0}
    return scan_counts[wallet]['count'] < FREE_LIMIT

def increment_scan(wallet):
    wallet = wallet.lower()
    today = date.today()
    if wallet not in scan_counts or scan_counts[wallet]['date'] != today:
        scan_counts[wallet] = {'date': today, 'count': 0}
    scan_counts[wallet]['count'] += 1

def get_scan_info(wallet):
    wallet = wallet.lower()
    today = date.today()
    if wallet not in scan_counts or scan_counts[wallet]['date'] != today:
        return {'used': 0, 'limit': FREE_LIMIT, 'remaining': FREE_LIMIT}
    used = scan_counts[wallet]['count']
    return {'used': used, 'limit': FREE_LIMIT, 'remaining': max(0, FREE_LIMIT - used)}


import threading
import time as time_module
from datetime import datetime

# Alert storage: { wallet: [ {token, issue, detected_at, seen} ] }
alerts_store = {}
# Previous scan results: { wallet: { token_address: score } }
previous_scores = {}
# Wallets to monitor (Pro users who have scanned)
monitored_wallets = {}

def monitor_wallets():
    """Background thread — checks wallets every hour for changes"""
    while True:
        time_module.sleep(3600)  # every hour
        for wallet, tokens in list(monitored_wallets.items()):
            try:
                for token_addr in tokens:
                    result = analyze_contract(token_addr, "ethereum")
                    if "error" in result:
                        continue
                    prev_score = previous_scores.get(wallet, {}).get(token_addr)
                    new_score = result.get("score", 100)
                    is_honeypot = result.get("is_honeypot", False)

                    if wallet not in alerts_store:
                        alerts_store[wallet] = []

                    if is_honeypot:
                        alerts_store[wallet].append({
                            "token": result.get("token_name", token_addr),
                            "symbol": result.get("token_symbol", "???"),
                            "address": token_addr,
                            "issue": "Honeypot detected — you can no longer sell this token",
                            "severity": "high",
                            "detected_at": datetime.now().isoformat(),
                            "seen": False
                        })
                    elif prev_score and new_score < prev_score - 20:
                        alerts_store[wallet].append({
                            "token": result.get("token_name", token_addr),
                            "symbol": result.get("token_symbol", "???"),
                            "address": token_addr,
                            "issue": f"Security score dropped from {prev_score} to {new_score}",
                            "severity": "medium",
                            "detected_at": datetime.now().isoformat(),
                            "seen": False
                        })

                    if wallet not in previous_scores:
                        previous_scores[wallet] = {}
                    previous_scores[wallet][token_addr] = new_score
            except:
                pass

# Start monitor thread
monitor_thread = threading.Thread(target=monitor_wallets, daemon=True)
monitor_thread.start()

GOPLUS_BASE = "https://api.gopluslabs.io/api/v1"

CHAIN_IDS = {
    "ethereum": "1",
    "bsc": "56",
    "polygon": "137",
    "arbitrum": "42161",
    "base": "8453",
    "avalanche": "43114",
}

def analyze_contract(address, chain="ethereum"):
    chain_id = CHAIN_IDS.get(chain.lower(), "1")
    url = f"{GOPLUS_BASE}/token_security/{chain_id}"
    params = {"contract_addresses": address}

    try:
        response = requests.get(url, params=params, timeout=10)
        data = response.json()

        if data.get("code") != 1:
            return {"error": "Could not fetch contract data"}

        result = data.get("result", {})
        contract_data = result.get(address.lower(), {})

        if not contract_data:
            return {"error": "Contract not found on this network"}

        return parse_contract(address, chain, contract_data)

    except requests.exceptions.Timeout:
        return {"error": "Request timed out. Try again."}
    except Exception as e:
        return {"error": str(e)}


def parse_contract(address, chain, d):
    def flag(val):
        return val == "1"

    score = 100
    checks = []

    # Honeypot
    is_honeypot = flag(d.get("is_honeypot"))
    if is_honeypot:
        score -= 40
        checks.append({"status": "danger", "text": "Honeypot detected — you will NOT be able to sell", "tag": "Danger"})
    else:
        checks.append({"status": "safe", "text": "No honeypot detected — you can sell freely", "tag": "Safe"})

    # Verified source code
    is_open_source = flag(d.get("is_open_source"))
    if is_open_source:
        checks.append({"status": "safe", "text": "Contract source code is verified and public", "tag": "Safe"})
    else:
        score -= 20
        checks.append({"status": "danger", "text": "Source code is NOT verified — code is hidden", "tag": "Danger"})

    # Ownership renounced
    owner_address = d.get("owner_address", "")
    renounced = owner_address in ["", "0x0000000000000000000000000000000000000000"]
    if renounced:
        checks.append({"status": "safe", "text": "Ownership has been renounced", "tag": "Safe"})
    else:
        score -= 5
        checks.append({"status": "warn", "text": "Owner can still modify contract functions", "tag": "Caution"})

    # Mint function
    can_mint = flag(d.get("is_mintable"))
    if can_mint:
        score -= 15
        checks.append({"status": "warn", "text": "Owner can mint unlimited new tokens (inflation risk)", "tag": "Caution"})
    else:
        checks.append({"status": "safe", "text": "No mint function — supply is fixed", "tag": "Safe"})

    # Proxy contract
    is_proxy = flag(d.get("is_proxy"))
    if is_proxy:
        score -= 10
        checks.append({"status": "warn", "text": "Proxy contract — logic can be changed by the owner", "tag": "Caution"})

    # Blacklist
    can_blacklist = flag(d.get("is_blacklisted"))
    if can_blacklist:
        score -= 15
        checks.append({"status": "danger", "text": "Contract can blacklist addresses — your wallet could be blocked", "tag": "Danger"})
    else:
        checks.append({"status": "safe", "text": "No blacklist function detected", "tag": "Safe"})

    # Whitelist
    has_whitelist = flag(d.get("is_whitelisted"))
    if has_whitelist:
        score -= 5
        checks.append({"status": "warn", "text": "Whitelist mechanism active — trading may be restricted", "tag": "Caution"})

    # Anti-whale
    is_anti_whale = flag(d.get("is_anti_whale"))
    if is_anti_whale:
        score -= 5
        checks.append({"status": "warn", "text": "Anti-whale limit detected — max transaction amount is restricted", "tag": "Caution"})

    # Trading cooldown
    trading_cooldown = flag(d.get("trading_cooldown"))
    if trading_cooldown:
        score -= 5
        checks.append({"status": "warn", "text": "Trading cooldown mechanism detected", "tag": "Caution"})

    # Buy/sell tax
    buy_tax = d.get("buy_tax", "0")
    sell_tax = d.get("sell_tax", "0")
    try:
        buy_tax_f = float(buy_tax) * 100
        sell_tax_f = float(sell_tax) * 100
        if sell_tax_f > 10:
            score -= 15
            checks.append({"status": "danger", "text": f"Very high sell tax: {sell_tax_f:.1f}% — extremely hard to profit", "tag": "Danger"})
        elif sell_tax_f > 5:
            score -= 5
            checks.append({"status": "warn", "text": f"Sell tax is {sell_tax_f:.1f}% — factor this into trades", "tag": "Caution"})
        else:
            checks.append({"status": "safe", "text": f"Buy tax {buy_tax_f:.1f}% / Sell tax {sell_tax_f:.1f}%", "tag": "Safe"})
    except:
        pass

    # Whale concentration — exclude known burn addresses
    BURN_ADDRESSES = [
        "0x0000000000000000000000000000000000000000",
        "0x000000000000000000000000000000000000dead",
        "0xdead000000000000000042069420694206942069",
    ]
    holders = d.get("holders", [])
    if holders:
        real_holders = [h for h in holders if h.get("address", "").lower() not in BURN_ADDRESSES]
        top3 = sum(float(h.get("percent", 0)) for h in real_holders[:3]) * 100
        if top3 > 60:
            score -= 15
            checks.append({"status": "danger", "text": f"Top 3 wallets control {top3:.1f}% of supply — extreme concentration risk", "tag": "Danger"})
        elif top3 > 35:
            score -= 8
            checks.append({"status": "warn", "text": f"Top 3 wallets hold {top3:.1f}% of supply", "tag": "Caution"})
        else:
            checks.append({"status": "safe", "text": f"Supply is well distributed — top 3 wallets hold {top3:.1f}%", "tag": "Safe"})

    # Deployer history
    creator_address = d.get("creator_address", "")
    other_contracts = d.get("other_potential_risks", "")
    if creator_address:
        checks.append({"status": "safe", "text": f"Deployer: {creator_address[:6]}...{creator_address[-4:]}", "tag": "Info"})

    # Liquidity
    dex_info = d.get("dex", [])
    has_liquidity = len(dex_info) > 0
    if has_liquidity:
        lp_info = dex_info[0]
        lp_name = lp_info.get("name", "DEX")
        checks.append({"status": "safe", "text": f"Liquidity found on {lp_name}", "tag": "Safe"})
    else:
        score -= 10
        checks.append({"status": "warn", "text": "No liquidity pool detected", "tag": "Caution"})

    # Locked liquidity
    lp_holders = d.get("lp_holders", [])
    if lp_holders:
        locked = any(h.get("is_locked") for h in lp_holders)
        if locked:
            checks.append({"status": "safe", "text": "Liquidity is locked — reduces rugpull risk", "tag": "Safe"})
        else:
            score -= 5
            checks.append({"status": "warn", "text": "Liquidity is NOT locked — owner can remove it anytime", "tag": "Caution"})

    score = max(0, min(100, score))

    if score >= 70:
        risk = "Low risk"
        risk_level = "low"
    elif score >= 40:
        risk = "Medium risk"
        risk_level = "medium"
    else:
        risk = "High risk"
        risk_level = "high"

    return {
        "address": address,
        "chain": chain,
        "score": score,
        "risk": risk,
        "risk_level": risk_level,
        "is_honeypot": is_honeypot,
        "is_open_source": is_open_source,
        "ownership_renounced": renounced,
        "buy_tax": buy_tax,
        "sell_tax": sell_tax,
        "has_liquidity": has_liquidity,
        "checks": checks,
        "token_name": d.get("token_name", "Unknown"),
        "token_symbol": d.get("token_symbol", "???"),
        "holder_count": d.get("holder_count", None),
        "creator_address": creator_address,
    }



HELIUS_KEY = "b2dd494d-3671-46b3-9c93-af054dd71193"
HELIUS_URL = "https://mainnet.helius-rpc.com/?api-key=" + HELIUS_KEY

def analyze_solana(address):
    """Analyze a Solana token using Helius API"""
    score = 100
    checks = []

    try:
        # Get token metadata
        meta_res = requests.post(HELIUS_URL, json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getAsset",
            "params": {"id": address}
        }, timeout=10)
        meta = meta_res.json().get("result", {})

        token_name = meta.get("content", {}).get("metadata", {}).get("name", "Unknown Token")
        token_symbol = meta.get("content", {}).get("metadata", {}).get("symbol", "???")

        # Check mint authority
        mint_auth = meta.get("mint_extensions", {})
        authorities = meta.get("authorities", [])
        has_mint_auth = any(a.get("scopes", []) and "mint_tokens" in a.get("scopes", []) for a in authorities)

        if has_mint_auth:
            score -= 20
            checks.append({"status": "danger", "text": "Mint authority active — creator can print unlimited tokens", "tag": "Danger"})
        else:
            checks.append({"status": "safe", "text": "Mint authority disabled — supply is fixed", "tag": "Safe"})

        # Check freeze authority
        has_freeze = any(a.get("scopes", []) and "freeze_account" in a.get("scopes", []) for a in authorities)
        if has_freeze:
            score -= 25
            checks.append({"status": "danger", "text": "Freeze authority active — your wallet can be frozen", "tag": "Danger"})
        else:
            checks.append({"status": "safe", "text": "No freeze authority — your tokens cannot be frozen", "tag": "Safe"})

        # Get token supply info
        supply_res = requests.post(HELIUS_URL, json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTokenSupply",
            "params": [address]
        }, timeout=10)
        supply_data = supply_res.json().get("result", {}).get("value", {})
        supply = int(supply_data.get("amount", 0))
        decimals = int(supply_data.get("decimals", 6))

        # Get largest holders
        holders_res = requests.post(HELIUS_URL, json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTokenLargestAccounts",
            "params": [address]
        }, timeout=10)
        holders_data = holders_res.json().get("result", {}).get("value", [])

        BURN_ADDRESSES_SOL = [
            "1nc1nerator11111111111111111111111111111111",
            "So11111111111111111111111111111111111111112"
        ]

        if holders_data and supply > 0:
            real_holders = [h for h in holders_data if h.get("address") not in BURN_ADDRESSES_SOL]
            top3_pct = sum(int(h.get("amount", 0)) for h in real_holders[:3]) / supply * 100 if supply > 0 else 0
            holder_count = len(holders_data)

            if top3_pct > 60:
                score -= 20
                checks.append({"status": "danger", "text": f"Top 3 wallets control {top3_pct:.1f}% of supply — extreme concentration", "tag": "Danger"})
            elif top3_pct > 30:
                score -= 10
                checks.append({"status": "warn", "text": f"Top 3 wallets hold {top3_pct:.1f}% of supply", "tag": "Caution"})
            else:
                checks.append({"status": "safe", "text": f"Supply well distributed — top 3 hold {top3_pct:.1f}%", "tag": "Safe"})
        else:
            holder_count = 0

        # Check if on Raydium (has liquidity)
        # Use Helius enhanced API to check DAS
        liq_res = requests.get(
            f"https://api.helius.xyz/v0/token-metadata?api-key={HELIUS_KEY}",
            json={"mintAccounts": [address]},
            timeout=10
        )

        # Basic liquidity check via Jupiter
        jup_res = requests.get(f"https://price.jup.ag/v6/price?ids={address}", timeout=5)
        jup_data = jup_res.json().get("data", {})
        has_price = address in jup_data

        if has_price:
            price = jup_data[address].get("price", 0)
            checks.append({"status": "safe", "text": f"Token tradeable on Jupiter — price: ${price:.8f}", "tag": "Safe"})
        else:
            score -= 15
            checks.append({"status": "warn", "text": "Token not found on Jupiter — may have no liquidity", "tag": "Caution"})

        # Is mutable (metadata can be changed)
        is_mutable = meta.get("mutable", True)
        if is_mutable:
            score -= 10
            checks.append({"status": "warn", "text": "Metadata is mutable — name/image can be changed by creator", "tag": "Caution"})
        else:
            checks.append({"status": "safe", "text": "Metadata is immutable — cannot be changed", "tag": "Safe"})

        score = max(0, min(100, score))

        if score >= 70:
            risk = "Low risk"
            risk_level = "low"
        elif score >= 40:
            risk = "Medium risk"
            risk_level = "medium"
        else:
            risk = "High risk"
            risk_level = "high"

        return {
            "address": address,
            "token_name": token_name,
            "token_symbol": token_symbol,
            "score": score,
            "risk": risk,
            "risk_level": risk_level,
            "is_honeypot": has_freeze,
            "is_open_source": not is_mutable,
            "holder_count": holder_count,
            "checks": checks,
            "chain": "solana"
        }

    except Exception as e:
        return {"error": f"Could not analyze Solana token: {str(e)}"}

@app.route("/api/analyze", methods=["GET"])
def analyze():
    address = request.args.get("address", "").strip()
    chain = request.args.get("chain", "ethereum").strip()
    wallet = request.args.get("wallet", "").strip()

    if not address or len(address) < 10:
        return jsonify({"error": "Please provide a valid contract address"}), 400

    if chain not in CHAIN_IDS:
        return jsonify({"error": f"Unsupported chain. Use: {', '.join(CHAIN_IDS.keys())}"}), 400

    # Rate limit check (only if wallet is provided)
    if wallet:
        if not check_rate_limit(wallet):
            info = get_scan_info(wallet)
            return jsonify({
                "error": f"Daily limit reached. Free plan allows {FREE_LIMIT} scans per day.",
                "limit_reached": True,
                "scan_info": info
            }), 429
        increment_scan(wallet)

    result = analyze_contract(address, chain)
    return jsonify(result)


@app.route("/api/scan-info", methods=["GET"])
def scan_info():
    wallet = request.args.get("wallet", "").strip().lower()
    if not wallet:
        return jsonify({"error": "Wallet address required"}), 400
    if request.args.get("increment") == "1":
        increment_scan(wallet)
    return jsonify(get_scan_info(wallet))


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "version": "1.0.0"})




# Etherscan API V2 — una sola key para ETH, BSC, Polygon, Arbitrum, Base
ETHERSCAN_KEY = "NJ1366ZNEFAUZ57VTCQFTIBYS2GTA1GIRV"
ETHERSCAN_V2 = "https://api.etherscan.io/v2/api"

# Snowtrace para Avalanche
SNOWTRACE_KEY = "rs_44d605d39c6192eb4d4954c0"
SNOWTRACE_URL = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api"

CHAIN_IDS = {
    "ethereum": 1,
    "bsc": 56,
    "polygon": 137,
    "arbitrum": 42161,
    "base": 8453,
}

@app.route("/api/wallet/<address>", methods=["GET"])
def wallet_tokens(address):
    """Get all ERC-20 tokens held by a wallet across multiple chains"""
    chains = request.args.get("chains", "ethereum,bsc,polygon").split(",")
    all_tokens = []

    for chain in chains:
        chain = chain.strip().lower()
        chain_id = CHAIN_IDS.get(chain)
        if not chain_id and chain != "avalanche":
            continue

        try:
            if chain == "avalanche":
                params = {
                    "module": "account",
                    "action": "tokentx",
                    "address": address,
                    "startblock": 0,
                    "endblock": 99999999,
                    "sort": "desc",
                    "apikey": SNOWTRACE_KEY
                }
                res = requests.get(SNOWTRACE_URL, params=params, timeout=10)
            else:
                params = {
                    "chainid": chain_id,
                    "module": "account",
                    "action": "tokentx",
                    "address": address,
                    "startblock": 0,
                    "endblock": 99999999,
                    "sort": "desc",
                    "apikey": ETHERSCAN_KEY
                }
                res = requests.get(ETHERSCAN_V2, params=params, timeout=10)
            data = res.json()

            if data.get("status") != "1":
                continue

            seen = {}
            for tx in data.get("result", []):
                addr = tx.get("contractAddress", "").lower()
                if addr and addr not in seen:
                    seen[addr] = {
                        "address": addr,
                        "symbol": tx.get("tokenSymbol", "???"),
                        "name": tx.get("tokenName", "Unknown"),
                        "chain": chain,
                        "balance": None
                    }

            chain_tokens = list(seen.values())[:10]
            all_tokens.extend(chain_tokens)

        except Exception:
            continue

    return jsonify({"tokens": all_tokens[:30], "total": len(all_tokens)})


@app.route("/api/check-payment", methods=["GET"])
def check_payment():
    """Check if wallet has paid for Pro by scanning recent USDC transfers to owner wallet"""
    wallet = request.args.get("wallet", "").strip().lower()
    if not wallet:
        return jsonify({"error": "Wallet required"}), 400

    # Already pro
    if is_pro(wallet):
        return jsonify({"is_pro": True, "message": "Pro plan active"})

    # Check Etherscan for USDC transfers from this wallet to owner
    url = "https://api.etherscan.io/api"
    params = {
        "module": "account",
        "action": "tokentx",
        "address": OWNER_WALLET,
        "contractaddress": USDC_CONTRACT,
        "startblock": 0,
        "endblock": 99999999,
        "sort": "desc",
        "apikey": "NJ1366ZNEFAUZ57VTCQFTIBYS2GTA1GIRV"
    }
    try:
        res = requests.get(url, params=params, timeout=10)
        data = res.json()
        txs = data.get("result", [])

        for tx in txs:
            sender = tx.get("from", "").lower()
            value = int(tx.get("value", 0))
            decimals = int(tx.get("tokenDecimal", 6))
            amount = value / (10 ** decimals)

            if sender == wallet and amount >= PRO_PRICE_USDC:
                activate_pro(wallet)
                return jsonify({"is_pro": True, "message": "Payment verified — Pro activated!"})

        return jsonify({"is_pro": False, "message": "No payment found"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/pro-status", methods=["GET"])
def pro_status():
    wallet = request.args.get("wallet", "").strip().lower()
    if not wallet:
        return jsonify({"error": "Wallet required"}), 400
    return jsonify({"is_pro": is_pro(wallet)})


@app.errorhandler(404)
def not_found(e):
    return send_from_directory('../frontend', '404.html'), 404


@app.route("/api/permissions/<address>", methods=["GET"])
def wallet_permissions(address):
    """Scan all token approvals given by a wallet"""
    url = "https://api.etherscan.io/api"
    params = {
        "module": "account",
        "action": "tokentx",
        "address": address,
        "startblock": 0,
        "endblock": 99999999,
        "sort": "desc",
        "apikey": "NJ1366ZNEFAUZ57VTCQFTIBYS2GTA1GIRV"
    }

    try:
        res = requests.get(url, params=params, timeout=10)
        data = res.json()

        if data.get("status") != "1":
            return jsonify({"permissions": [], "message": "No transactions found"})

        txs = data.get("result", [])

        # Get approval events via logs
        approval_params = {
            "module": "logs",
            "action": "getLogs",
            "address": "",
            "topic0": "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",  # Approval event
            "topic1": "0x000000000000000000000000" + address[2:].lower(),
            "fromBlock": "0",
            "toBlock": "latest",
            "apikey": "NJ1366ZNEFAUZ57VTCQFTIBYS2GTA1GIRV"
        }

        approval_res = requests.get(url, params=approval_params, timeout=10)
        approval_data = approval_res.json()
        approval_logs = approval_data.get("result", [])

        # Process approvals
        seen = {}
        for log in approval_logs[:50]:
            contract = log.get("address", "").lower()
            topics = log.get("topics", [])
            if len(topics) < 3:
                continue

            spender = "0x" + topics[2][-40:]
            value_hex = log.get("data", "0x0")

            try:
                value = int(value_hex, 16)
                is_unlimited = value >= (2**256 - 1) * 0.99
                amount = "Unlimited" if is_unlimited else str(round(value / 10**18, 4))
            except:
                amount = "Unknown"
                is_unlimited = False

            key = f"{contract}_{spender}"
            if key not in seen:
                # Find token name from txs
                token_name = "Unknown Token"
                token_symbol = "???"
                for tx in txs:
                    if tx.get("contractAddress", "").lower() == contract:
                        token_name = tx.get("tokenName", "Unknown Token")
                        token_symbol = tx.get("tokenSymbol", "???")
                        break

                risk = "high" if is_unlimited else "medium"
                risk_label = "Danger" if is_unlimited else "Caution"

                seen[key] = {
                    "token_contract": contract,
                    "token_name": token_name,
                    "token_symbol": token_symbol,
                    "spender": spender,
                    "amount": amount,
                    "is_unlimited": is_unlimited,
                    "risk": risk,
                    "risk_label": risk_label,
                    "block": log.get("blockNumber", "0")
                }

        permissions = list(seen.values())
        permissions.sort(key=lambda x: (0 if x["is_unlimited"] else 1))

        return jsonify({
            "permissions": permissions,
            "total": len(permissions),
            "unlimited_count": sum(1 for p in permissions if p["is_unlimited"])
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/alerts/<wallet>", methods=["GET"])
def get_alerts(wallet):
    """Get unread alerts for a Pro wallet"""
    wallet = wallet.lower()

    # Check pro
    if not is_pro(wallet):
        return jsonify({"error": "Pro plan required", "alerts": []}), 403

    alerts = alerts_store.get(wallet, [])
    unread = [a for a in alerts if not a["seen"]]
    return jsonify({
        "alerts": unread,
        "total_unread": len(unread)
    })


@app.route("/api/alerts/<wallet>/mark-seen", methods=["POST"])
def mark_alerts_seen(wallet):
    """Mark all alerts as seen"""
    wallet = wallet.lower()
    if wallet in alerts_store:
        for alert in alerts_store[wallet]:
            alert["seen"] = True
    return jsonify({"message": "Marked as seen"})


@app.route("/api/monitor/register", methods=["POST"])
def register_monitor():
    """Register a Pro wallet for monitoring"""
    data = request.get_json()
    wallet = data.get("wallet", "").lower()
    tokens = data.get("tokens", [])

    if not wallet or not is_pro(wallet):
        return jsonify({"error": "Pro plan required"}), 403

    monitored_wallets[wallet] = [t.lower() for t in tokens[:20]]
    return jsonify({"message": f"Monitoring {len(tokens)} tokens for {wallet[:8]}..."})

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5001)

