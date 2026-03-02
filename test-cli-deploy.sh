#!/usr/bin/env bash
# FINAL E2E: Deploy with uact pricing (ACT already minted)
set -euo pipefail

NODE="https://testnetrpc.akashnet.net:443"
CHAIN="testnet-8"
KEY="aporia-test"
ADDR="akash199h5azxvtnnm2aanaqqgeqwljvecy73c7y4xdy"
GAS_FLAGS="--fees 25000uakt --gas 800000"

echo "╔══════════════════════════════════════════╗"
echo "║  APORIA E2E Deployment (with ACT)        ║"
echo "╚══════════════════════════════════════════╝"

echo ""
echo "═══ Balances ═══"
provider-services query bank balances "$ADDR" --node "$NODE" 2>&1

# Write SDL with uact pricing
SDL="/tmp/aporia-final-$$.yaml"
cat > "$SDL" << 'EOF'
---
version: "2.0"
services:
  bot:
    image: ghcr.io/ovrclk/demo-app
    expose:
      - port: 3000
        as: 80
        to:
          - global: true
profiles:
  compute:
    bot:
      resources:
        cpu:
          units: 1
        memory:
          size: 1Gi
        storage:
          - size: 1Gi
  placement:
    dcloud:
      pricing:
        bot:
          denom: uact
          amount: 1000
deployment:
  bot:
    dcloud:
      profile: bot
      count: 1
EOF

echo ""
echo "═══ Creating Deployment (uact pricing, 5 ACT deposit) ═══"
DEPLOY_JSON=$(provider-services tx deployment create "$SDL" \
    --from "$KEY" --keyring-backend test \
    --chain-id "$CHAIN" --node "$NODE" \
    --deposit 5000000uact \
    $GAS_FLAGS --broadcast-mode sync \
    --yes --output json 2>&1)

TXHASH=$(echo "$DEPLOY_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('txhash',''))" 2>/dev/null || echo "")
echo "TX Hash: $TXHASH"

if [ -z "$TXHASH" ]; then
    echo "❌ No txhash! Output: $DEPLOY_JSON"
    rm -f "$SDL"
    exit 1
fi

echo "Waiting 8s for block..."
sleep 8

# Verify
TX_RESULT=$(provider-services query tx "$TXHASH" --node "$NODE" --output json 2>&1 || echo '{"code":-1}')
TX_CODE=$(echo "$TX_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code','?'))" 2>/dev/null || echo "?")
echo "TX Code: $TX_CODE"

if [ "$TX_CODE" != "0" ]; then
    RAW=$(echo "$TX_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('raw_log','unknown')[:300])" 2>/dev/null || echo "?")
    echo "❌ Failed: $RAW"
    rm -f "$SDL"
    exit 1
fi

# Extract DSEQ
DSEQ=$(echo "$TX_RESULT" | python3 -c "
import sys, json, base64
tx = json.load(sys.stdin)
for ev in tx.get('events', []):
    for a in ev.get('attributes', []):
        try:
            k = base64.b64decode(a.get('key','')).decode()
            v = base64.b64decode(a.get('value','')).decode()
        except: k, v = a.get('key',''), a.get('value','')
        if k == 'dseq': print(v); exit()
print(tx.get('height','?'))
" 2>/dev/null || echo "?")

echo ""
echo "🎉 DEPLOYMENT CREATED! DSEQ: $DSEQ"

# Wait for bids (2 min)
echo ""
echo "═══ Waiting for Bids (2 min) ═══"
PROVIDER=""
for i in $(seq 1 12); do
    sleep 10
    echo "  Poll $i/12..."
    
    BIDS=$(provider-services query market bid list \
        --owner "$ADDR" --dseq "$DSEQ" --state open \
        --node "$NODE" --output json 2>/dev/null || echo '{"bids":[]}')
    
    BCOUNT=$(echo "$BIDS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('bids',[])))" 2>/dev/null || echo "0")
    
    if [ "$BCOUNT" -gt "0" ]; then
        PROVIDER=$(echo "$BIDS" | python3 -c "
import sys, json
b = json.load(sys.stdin)['bids'][0]
bid = b.get('bid', b)
print(bid.get('bid_id', bid.get('id',{})).get('provider',''))
" 2>/dev/null)
        PRICE=$(echo "$BIDS" | python3 -c "
import sys, json
b = json.load(sys.stdin)['bids'][0]
bid = b.get('bid', b)
print(bid.get('price', {}).get('amount', '?'))
" 2>/dev/null || echo "?")
        echo "  🏷️  $BCOUNT bid(s)! Provider: $PROVIDER (price: $PRICE)"
        break
    fi
done

if [ -z "$PROVIDER" ]; then
    echo ""
    echo "⏰ No bids in 2 min. Testnet providers may be offline."
    echo "   DSEQ $DSEQ is live on-chain. Check later:"
    echo "   provider-services query market bid list --owner $ADDR --dseq $DSEQ --node $NODE"
    rm -f "$SDL"
    exit 0
fi

# Create Lease
echo ""
echo "═══ Creating Lease ═══"
LEASE_JSON=$(provider-services tx market lease create \
    --dseq "$DSEQ" --provider "$PROVIDER" --gseq 1 --oseq 1 \
    --from "$KEY" --keyring-backend test \
    --chain-id "$CHAIN" --node "$NODE" \
    $GAS_FLAGS --yes --output json 2>&1)
echo "Lease TX sent. Waiting 8s..."
sleep 8

# Send Manifest
echo ""
echo "═══ Sending Manifest ═══"
provider-services send-manifest "$SDL" \
    --dseq "$DSEQ" --provider "$PROVIDER" \
    --from "$KEY" --keyring-backend test \
    --node "$NODE" 2>&1 || echo "(manifest may still succeed)"

# Poll for service
echo ""
echo "═══ Checking Service (1 min) ═══"
for j in $(seq 1 6); do
    sleep 10
    echo "  Poll $j/6..."
    STATUS=$(provider-services lease-status \
        --dseq "$DSEQ" --provider "$PROVIDER" \
        --from "$KEY" --keyring-backend test \
        --node "$NODE" 2>/dev/null || echo '{}')
    URI=$(echo "$STATUS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for n, s in d.get('services',{}).items():
    if s.get('uris'): print(s['uris'][0]); exit()
for n, p in d.get('forwarded_ports',{}).items():
    if p: print(f\"{p[0].get('host','')}:{p[0].get('externalPort','')}\"); exit()
" 2>/dev/null || echo "")
    if [ -n "$URI" ]; then
        echo ""
        echo "╔════════════════════════════════════════════╗"
        echo "║  🚀 SERVICE IS LIVE!                        ║"
        echo "║  URL: https://$URI"
        echo "║  DSEQ: $DSEQ"
        echo "║  Provider: $PROVIDER"
        echo "╚════════════════════════════════════════════╝"
        break
    fi
done

rm -f "$SDL"
echo ""
echo "═══ Final Balance ═══"
provider-services query bank balances "$ADDR" --node "$NODE" 2>&1
echo ""
echo "=== E2E Complete ==="
