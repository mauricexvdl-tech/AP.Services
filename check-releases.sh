#!/usr/bin/env bash
# Check releases and try to download BME-compatible akash binary
set -e

echo "=== Checking GitHub releases ==="
RELEASES=$(curl -sSL https://api.github.com/repos/akash-network/node/releases 2>/dev/null)
echo "$RELEASES" | python3 -c "
import sys, json
releases = json.load(sys.stdin)
for r in releases[:15]:
    tag = r['tag_name']
    pre = r.get('prerelease', False)
    name = r.get('name', '')
    print(f'{tag} pre={pre} | {name}')
"

# Try downloading the latest pre-release (likely has BME)
echo ""
echo "=== Finding BME-compatible binary ==="
DOWNLOAD_URL=$(echo "$RELEASES" | python3 -c "
import sys, json
releases = json.load(sys.stdin)
for r in releases:
    for a in r.get('assets', []):
        if 'linux_amd64' in a['name'] and a['name'].endswith('.zip'):
            print(a['browser_download_url'])
            exit()
")

if [ -n "$DOWNLOAD_URL" ]; then
    echo "Downloading: $DOWNLOAD_URL"
    curl -sSL -o /tmp/akash-latest.zip "$DOWNLOAD_URL"
    cd /tmp && unzip -o akash-latest.zip akash 2>/dev/null || true
    if [ -f /tmp/akash ]; then
        chmod +x /tmp/akash
        echo "Version: $(/tmp/akash version 2>&1)"
        echo "Has BME: $(/tmp/akash tx bme --help 2>&1 | head -3)"
    fi
fi
