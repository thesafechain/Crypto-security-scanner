import requests
import time
import threading

BOT_TOKEN = "8694625987:AAEIPERmGt5lN4l-dQTiPi-mTJy1P2waVbI"
BACKEND = "https://crypto-security-scanner-production.up.railway.app"
API_URL = f"https://api.telegram.org/bot{BOT_TOKEN}"

def send(chat_id, text, parse_mode="Markdown"):
    requests.post(f"{API_URL}/sendMessage", json={
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True
    })

def send_typing(chat_id):
    requests.post(f"{API_URL}/sendChatAction", json={
        "chat_id": chat_id,
        "action": "typing"
    })

def handle_scan(chat_id, address, chain="ethereum"):
    send_typing(chat_id)
    try:
        res = requests.get(f"{BACKEND}/api/analyze", params={
            "address": address,
            "chain": chain
        }, timeout=20)
        d = res.json()

        if "error" in d:
            send(chat_id, f"❌ Error: {d['error']}")
            return

        score = d.get("score", 0)
        risk = d.get("risk", "Unknown")
        name = d.get("token_name", "Unknown")
        symbol = d.get("token_symbol", "???")
        is_honeypot = d.get("is_honeypot", False)
        holders = d.get("holder_count", d.get("holders_count", "?"))

        if score >= 70:
            emoji = "🟢"
        elif score >= 40:
            emoji = "🟡"
        else:
            emoji = "🔴"

        honey_text = "⚠️ YES — DO NOT BUY" if is_honeypot else "✅ No"

        msg = f"""*{name} ({symbol})*
`{address[:8]}...{address[-6:]}`

{emoji} *Security Score: {score}/100* — {risk}
🍯 Honeypot: {honey_text}
👥 Holders: {holders}

"""
        checks = d.get("checks", [])
        for c in checks[:6]:
            icon = "✅" if c["status"] == "safe" else "⚠️" if c["status"] == "warn" else "❌"
            msg += f"{icon} {c['text']}\n"

        msg += f"\n🔍 [Full report](https://www.thesafechain.xyz?address={address}&chain={chain})"
        send(chat_id, msg)

    except Exception as e:
        send(chat_id, f"❌ Could not analyze contract. Try again.")

def handle_wallet(chat_id, address):
    send_typing(chat_id)
    try:
        res = requests.get(f"{BACKEND}/api/wallet/{address}", params={
            "chains": "ethereum,bsc,polygon"
        }, timeout=20)
        d = res.json()
        tokens = d.get("tokens", [])

        if not tokens:
            send(chat_id, "No tokens found in this wallet.")
            return

        msg = f"*Wallet* `{address[:8]}...{address[-6:]}`\n"
        msg += f"Found *{len(tokens)} tokens* across chains\n\n"

        for t in tokens[:8]:
            chain = t.get("chain", "eth").upper()
            msg += f"• *{t.get('symbol','?')}* ({t.get('name','?')}) — {chain}\n"

        if len(tokens) > 8:
            msg += f"\n_...and {len(tokens)-8} more_\n"

        msg += f"\n🔍 [Full analysis](https://www.thesafechain.xyz/dashboard.html)"
        send(chat_id, msg)

    except Exception as e:
        send(chat_id, "❌ Could not scan wallet. Try again.")

def handle_message(msg):
    chat_id = msg["chat"]["id"]
    text = msg.get("text", "").strip()

    if text.startswith("/start"):
        send(chat_id, """👋 *Welcome to TheSafeChain Bot!*

Your crypto security scanner on Telegram.

*Commands:*
🔍 `/scan 0x...` — Scan any contract
👛 `/wallet 0x...` — Scan your wallet
ℹ️ `/help` — Show this message

*Example:*
`/scan 0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE`

🌐 [thesafechain.xyz](https://www.thesafechain.xyz)""")

    elif text.startswith("/help"):
        send(chat_id, """*TheSafeChain Commands:*

🔍 `/scan <address>` — Full security analysis of any contract
👛 `/wallet <address>` — Scan all tokens in a wallet
🌐 Visit [thesafechain.xyz](https://www.thesafechain.xyz) for full reports""")

    elif text.startswith("/scan"):
        parts = text.split()
        if len(parts) < 2:
            send(chat_id, "Usage: `/scan 0x...contractaddress`")
            return
        address = parts[1]
        chain = parts[2] if len(parts) > 2 else "ethereum"
        if not address.startswith("0x") or len(address) < 40:
            send(chat_id, "❌ Invalid address. Make sure it starts with `0x`.")
            return
        send(chat_id, f"🔍 Analyzing `{address[:8]}...` Please wait...")
        handle_scan(chat_id, address, chain)

    elif text.startswith("/wallet"):
        parts = text.split()
        if len(parts) < 2:
            send(chat_id, "Usage: `/wallet 0x...youraddress`")
            return
        address = parts[1]
        if not address.startswith("0x") or len(address) < 40:
            send(chat_id, "❌ Invalid address.")
            return
        send(chat_id, f"👛 Scanning wallet `{address[:8]}...` Please wait...")
        handle_wallet(chat_id, address)

    else:
        # If they paste an address directly
        if text.startswith("0x") and len(text) >= 40:
            send(chat_id, f"🔍 Analyzing `{text[:8]}...` Please wait...")
            handle_scan(chat_id, text)
        else:
            send(chat_id, "Use /scan or /wallet followed by an address.\nType /help for more info.")

def poll():
    offset = None
    print("TheSafeChain bot started...")
    while True:
        try:
            params = {"timeout": 30}
            if offset:
                params["offset"] = offset
            res = requests.get(f"{API_URL}/getUpdates", params=params, timeout=35)
            updates = res.json().get("result", [])
            for update in updates:
                offset = update["update_id"] + 1
                if "message" in update:
                    threading.Thread(target=handle_message, args=(update["message"],), daemon=True).start()
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    poll()
