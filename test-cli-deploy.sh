#!/usr/bin/env bash
set -e

NODE="https://testnetrpc.akashnet.net:443"
CHAIN_ID="testnet-8"
KEY="aporia-test"
ADDR="akash199h5azxvtnnm2aanaqqgeqwljvecy73c7y4xdy"

echo "=== Step 1: List existing deployments ==="
DEPS=$(provider-services query deployment list --node "$NODE" --output json 2>&1)
echo "$DEPS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
deps = data.get('deployments', [])
print(f'Found {len(deps)} total deployments')
for d in deps:
    did = d.get('deployment',{}).get('deployment_id',{})
    state = d.get('deployment',{}).get('state','')
    owner = did.get('owner','')
    dseq = did.get('dseq','')
    if owner == '$ADDR':
        print(f'  DSEQ={dseq} state={state} owner={owner}')
" 2>/dev/null || echo "$DEPS" | head -10

echo ""
echo "=== Step 2: Close all open deployments ==="
echo "$DEPS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for d in data.get('deployments', []):
    did = d.get('deployment',{}).get('deployment_id',{})
    state = d.get('deployment',{}).get('state','')
    if did.get('owner') == '$ADDR' and state != 'closed':
        print(did.get('dseq',''))
" 2>/dev/null | while read DSEQ; do
    if [ -n "$DSEQ" ]; then
        echo "Closing DSEQ $DSEQ..."
        provider-services tx deployment close \
            --dseq "$DSEQ" \
            --from "$KEY" \
            --keyring-backend test \
            --chain-id "$CHAIN_ID" \
            --node "$NODE" \
            --fees 25000uakt \
            --gas 800000 \
            --yes 2>&1 | head -3
        sleep 3
    fi
done

echo ""
echo "=== Step 3: Create fresh deployment ==="
cat > /tmp/aporia-fresh.yaml << 'SDLEOF'
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
          denom: uakt
          amount: 1000
deployment:
  bot:
    dcloud:
      profile: bot
      count: 1
SDLEOF

sleep 6
echo "Creating deployment..."
RESULT=$(provider-services tx deployment create /tmp/aporia-fresh.yaml \
    --from "$KEY" \
    --keyring-backend test \
    --chain-id "$CHAIN_ID" \
    --node "$NODE" \
    --deposit 5000000uakt \
    --fees 25000uakt \
    --gas 800000 \
    --broadcast-mode sync \
    --yes --output json 2>&1)

echo "$RESULT"

TXHASH=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('txhash',''))" 2>/dev/null)
echo "TX Hash: $TXHASH"

echo ""
echo "=== Step 4: Wait and verify ==="
sleep 8

if [ -n "$TXHASH" ]; then
    provider-services query tx "$TXHASH" --node "$NODE" 2>&1 | head -20
fi

echo ""
echo "--- Balance ---"
provider-services query bank balances "$ADDR" --node "$NODE" 2>&1

echo ""
echo "=== DONE ==="
