#!/usr/bin/env bash
set -e

NODE="https://testnetrpc.akashnet.net:443"
CHAIN="testnet-8"
KEY="aporia-test"
ADDR="akash199h5azxvtnnm2aanaqqgeqwljvecy73c7y4xdy"

echo "=== Step 1: Install akash v2.1.0-a22 with BME ==="
cd /root
curl -sSL -o akash-bme.zip "https://github.com/akash-network/node/releases/download/v2.1.0-a22/akash_2.1.0-a22_linux_amd64.zip"
unzip -o akash-bme.zip akash
cp akash /usr/local/bin/akash
chmod +x /usr/local/bin/akash
echo "Version: $(akash version)"
echo "BME check:"
akash tx bme mint-act --help 2>&1 | head -5

echo ""
echo "=== Step 2: Mint 100 AKT → ACT ==="
echo "  Balance before:"
akash query bank balances "$ADDR" --node "$NODE" 2>&1

akash tx bme mint-act 100000000uakt \
    --from "$KEY" --keyring-backend test \
    --chain-id "$CHAIN" --node "$NODE" \
    --fees 25000uakt --gas 800000 \
    --yes --output json 2>&1 | head -5

echo "  Waiting 60s for epoch processing..."
sleep 60

echo "  Balance after:"
akash query bank balances "$ADDR" --node "$NODE" 2>&1

echo ""
echo "=== Done ==="
