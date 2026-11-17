"""Embarque Stockfish.js 19 (nmrugg, build « lite-single » WASM, GPLv3) dans vendor/stockfish19_src.js.
Usage : python3 gen_sf19.py <dossier contenant stockfish-19-lite-single.js et .wasm>
Le JS d'origine est mis en chaîne (window.ENOS_SF19.js) et le .wasm en base64 (window.ENOS_SF19.wasm) :
chess_local.js lance un Worker blob et remplace fetch() dans le Worker (connect-src 'none' + file://)."""
import base64, json, os, sys
src = sys.argv[1]
js = open(os.path.join(src, "stockfish-19-lite-single.js"), encoding="utf-8").read()
wasm = open(os.path.join(src, "stockfish-19-lite-single.wasm"), "rb").read()
out = os.path.join(os.path.dirname(__file__), "..", "assets", "mobile", "vendor", "stockfish19_src.js")
with open(out, "w", encoding="utf-8") as f:
    f.write("/* Stockfish.js 19 (lite-single WASM, GPLv3, (c) Chess.com / nmrugg, réseau NNUE de Chris Bao) — généré par android/tools/gen_sf19.py, chargé à la demande */\n")
    f.write("window.ENOS_SF19 = { js: " + json.dumps(js) + ",\n wasm: \"" + base64.b64encode(wasm).decode() + "\", size: %d };\n" % len(wasm))
print(out, os.path.getsize(out))
