#!/usr/bin/env bash
# Puts the GitHub Pages site together.
#
#   scripts/assemble-site.sh <single-threaded build> <multi-threaded build> <wine.zip> <output dir>
#
# The builds are the folders Boxedwine's `make jit` / `make multiThreadedJit`
# produce. The Wine filesystem is split into 50 MB parts, because GitHub
# limits single file sizes; the service worker stitches them back together.
set -euo pipefail

st_build=$1
mt_build=$2
wine_zip=$3
out=$4
root=$(cd "$(dirname "$0")/.." && pwd)

rm -rf "$out"
mkdir -p "$out/emu" "$out/wine"
cp -r "$root/web/." "$out/"
cp -r "$st_build" "$out/emu/st"
cp -r "$mt_build" "$out/emu/mt"

# Load HubD's iPhone layer (sizing, touch controls) into Boxedwine's page.
for page in "$out/emu/st/boxedwine.html" "$out/emu/mt/boxedwine.html"; do
    python3 - "$page" <<'EOF'
import sys
path = sys.argv[1]
html = open(path, encoding="utf-8").read()
head = ('<meta name="viewport" content="width=device-width, initial-scale=1, '
        'maximum-scale=1, user-scalable=no, viewport-fit=cover">\n'
        '<meta name="apple-mobile-web-app-capable" content="yes">\n'
        '<link rel="stylesheet" href="../../touch.css">\n')
body = '<script src="../../touch.js"></script>\n'
if "</head>" not in html or "</body>" not in html:
    sys.exit(path + ": no </head> or </body> to inject into")
html = html.replace("</head>", head + "</head>", 1)
html = html.replace("</body>", body + "</body>", 1)
open(path, "w", encoding="utf-8").write(html)
EOF
done

split -b 50m -d -a 3 "$wine_zip" "$out/wine/boxedwine.zip.part"
python3 - "$out/wine" <<'EOF'
import json, os, sys
folder = sys.argv[1]
parts = sorted(p for p in os.listdir(folder) if ".part" in p)
manifest = {
    "parts": parts,
    "size": sum(os.path.getsize(os.path.join(folder, p)) for p in parts),
}
json.dump(manifest, open(os.path.join(folder, "parts.json"), "w"))
print("wine filesystem:", manifest["size"], "bytes in", len(parts), "parts")
EOF

# Lets the service worker drop caches from an older deploy.
date -u +%Y%m%d%H%M%S > "$out/version.txt"
