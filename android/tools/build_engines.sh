#!/usr/bin/env bash
# MOTEURS D'ÉCHECS NATIFS ARM64 (Android) — compilés par GitHub Actions (kit NDK + Internet pour les réseaux de neurones).
# Sortie : android/native/arm64-v8a/libeng_<id>.so (exécutables, nommés « lib*.so » pour qu'Android les installe dans
# nativeLibraryDir, le seul dossier d'une application où un exécutable a le droit d'être lancé ; construire_apk.py les met dans lib/arm64-v8a/).
#   sf19       Stockfish 19 officiel (tag sf_19), réseau NNUE complet embarqué, ARCH=armv8-dotprod      — GPLv3
#   obsidian   Obsidian (gab8192), porté sur ARM avec sse2neon (chemin SSSE3), réseau embarqué            — GPLv3
#   plenty     PlentyChess (Yoshie2000), cible « android » du projet, réseau embarqué                      — GPLv3
#   caissa     Caissa (Witek902), chemin NEON, réseau embarqué                                             — MIT
#   viridithas Viridithas (cosmobobak), Rust, cible aarch64-linux-android, réseau embarqué                 — MIT
# Binaires C++ STATIQUES (bionic) ; chaque binaire est testé (uci / isready / go depth) sous qemu-aarch64 quand il est installé.
# Usage : android/tools/build_engines.sh [dossier de sortie]   (ONLY="sf19 caissa" pour en compiler une partie)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(realpath -m "${1:-$ROOT/android/native/arm64-v8a}")"; mkdir -p "$OUT"
W="${WORK:-$(mktemp -d)}"; mkdir -p "$W"
NDK="${ANDROID_NDK_LATEST_HOME:-${ANDROID_NDK_HOME:-}}"; [ -d "$NDK" ] || { echo "NDK Android introuvable (ANDROID_NDK_LATEST_HOME)"; exit 1; }
TC="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin"; API=29; export PATH="$TC:$PATH"
CXX="$TC/aarch64-linux-android$API-clang++"; CC="$TC/aarch64-linux-android$API-clang"; STRIP="$TC/llvm-strip"
MARCH="-march=armv8.2-a+dotprod"                                             # Galaxy S23+ (Snapdragon 8 Gen 2) : NEON + produit scalaire
JOBS="$(nproc)"; ONLY="${ONLY:-sf19 obsidian plenty caissa viridithas}"
# versions figées (reproductibles)
SF_REF="refs/tags/sf_19"
OBS_SHA=720614a61ed6201037516d555f0bd2f7e5aeae3c; OBS_NET=net89perm.bin
PLENTY_SHA=fb2e2b2bb34d49dc934c85e14d05828429c0534d
CAISSA_SHA=0ec07379943a3fc1723a276150c537d5be12d3d6; CAISSA_NET=eval-ml-14-q16-80B-spsa-transplant
VIRI_SHA=4609ff2a898160f1576fe83c0529a949148541c0
SSE2NEON_SHA=2272251cc3ad9cba8b8c47c4065811cfb396b802

fetch() { curl -fsSL --retry 4 --retry-delay 3 -o "$2" "$1"; }
src() { local d="$W/$1"; rm -rf "$d"; git init -q "$d"; git -C "$d" fetch -q --depth 1 "https://github.com/$2" "$3"; git -C "$d" checkout -q FETCH_HEAD; echo "$d"; }
smoke() {                                                                    # le binaire répond-il en UCI et joue-t-il un coup ?
  local bin="$1" name="$2"
  if ! command -v qemu-aarch64-static >/dev/null 2>&1; then echo "  (qemu absent : test d'exécution sauté pour $name)"; return 0; fi
  local o; o=$( (printf 'uci\nisready\nposition startpos moves e2e4\ngo depth 8\n'; sleep "${SMOKE_WAIT:-40}"; echo quit) | timeout 120 qemu-aarch64-static "$bin" 2>&1 || true)
  echo "$o" | grep -m1 "^id name" || true
  echo "$o" | grep -q "^bestmove [a-h][1-8]" || { echo "ÉCHEC : $name ne joue pas de coup"; echo "$o" | tail -15; exit 1; }
  echo "  OK $name : $(echo "$o" | grep -m1 '^bestmove')"
}

b_sf19() { echo "== Stockfish 19"
  d=$(src sf19 official-stockfish/Stockfish "$SF_REF"); cd "$d/src"
  make -s net
  make -s -j"$JOBS" build ARCH=armv8-dotprod COMP=ndk EXTRALDFLAGS="-static" >/dev/null
  cp stockfish "$OUT/libeng_sf19.so"; "$STRIP" "$OUT/libeng_sf19.so"; smoke "$OUT/libeng_sf19.so" "Stockfish 19"
}

b_obsidian() { echo "== Obsidian"
  d=$(src obsidian gab8192/Obsidian "$OBS_SHA"); s=$(src sse2neon DLTcollab/sse2neon "$SSE2NEON_SHA"); cd "$d"
  fetch "https://github.com/gab8192/Obsidian-nets/releases/download/nets/$OBS_NET" "$OBS_NET"
  cp "$s/sse2neon.h" src/
  sed -i -E 's#<(nmmintrin|immintrin|xmmintrin|emmintrin|pmmintrin|tmmintrin|smmintrin|x86intrin)\.h>#"sse2neon.h"#' src/*.h src/*.cpp   # intrinsics SSE -> NEON
  sed -i 's/#elif defined(__SSSE3__)/#elif defined(__SSSE3__) || defined(__aarch64__)/' src/simd.h                                         # chemin SSSE3 du code (le seul sans AVX)
  "$CXX" -O3 -std=c++17 -DNDEBUG -DEvalFile=\"$OBS_NET\" $MARCH -static -pthread -w src/*.cpp -x c src/fathom/src/tbprobe.c -o "$OUT/libeng_obsidian.so"
  "$STRIP" "$OUT/libeng_obsidian.so"; smoke "$OUT/libeng_obsidian.so" "Obsidian"
}

b_plenty() { echo "== PlentyChess"
  d=$(src plenty Yoshie2000/PlentyChess "$PLENTY_SHA"); cd "$d"
  make -s -j"$JOBS" arch=android EXE=plentychess >/dev/null                  # télécharge le réseau, le prépare (outil hôte, -DARCH_ARM) puis compile avec le NDK (statique)
  bin=$(ls -t plentychess* 2>/dev/null | head -1); cp "$bin" "$OUT/libeng_plenty.so"; "$STRIP" "$OUT/libeng_plenty.so"; smoke "$OUT/libeng_plenty.so" "PlentyChess"
}

b_caissa() { echo "== Caissa"
  d=$(src caissa Witek902/Caissa "$CAISSA_SHA"); cd "$d"
  mkdir -p data/neuralNets; fetch "https://github.com/Witek902/Caissa-Nets/releases/download/$CAISSA_NET/$CAISSA_NET.pnn" "data/neuralNets/$CAISSA_NET.pnn"
  cd src; "$CXX" -std=c++20 -O3 -fno-rtti -fno-exceptions -DCONFIGURATION_FINAL -DNDEBUG -DCAISSA_VERSION=\"$(tr -d '[:space:]' < ../version.txt)\" \
    -DCAISSA_EVALFILE=\"../data/neuralNets/$CAISSA_NET.pnn\" -DUSE_ARM_NEON $MARCH -static -pthread -w backend/*.cpp frontend/*.cpp backend/syzygy/tbprobe.cpp -o "$OUT/libeng_caissa.so"
  "$STRIP" "$OUT/libeng_caissa.so"; smoke "$OUT/libeng_caissa.so" "Caissa"
}

b_viridithas() { echo "== Viridithas"
  d=$(src viridithas cosmobobak/viridithas "$VIRI_SHA"); cd "$d"
  url=$(curl -fsSL ${GH_TOKEN:+-H "Authorization: Bearer $GH_TOKEN"} https://api.github.com/repos/cosmobobak/viridithas-networks/releases/latest | grep -o '"browser_download_url": "[^"]*' | awk -F'"' '{print $4}' | head -n1)
  fetch "$url" viridithas.nnue.zst; test "$(wc -c < viridithas.nnue.zst)" -gt 1000000
  rustup target add aarch64-linux-android >/dev/null
  CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CC" RUSTFLAGS="-C target-feature=+neon,+dotprod" cargo build -q --release --target aarch64-linux-android
  cp target/aarch64-linux-android/release/viridithas "$OUT/libeng_viridithas.so"; "$STRIP" "$OUT/libeng_viridithas.so"
  # binaire Android dynamique (bionic) : qemu ne peut pas le lancer sur le serveur -> on vérifie le MÊME code compilé pour le serveur
  cargo build -q --release; o=$( (printf 'uci\nisready\nposition startpos moves e2e4\ngo depth 8\n'; sleep 15; echo quit) | timeout 60 target/release/viridithas 2>&1 || true)
  echo "$o" | grep -q "^bestmove [a-h][1-8]" && echo "  OK Viridithas (build serveur) : $(echo "$o" | grep -m1 '^bestmove')" || { echo "ÉCHEC Viridithas"; echo "$o" | tail -10; exit 1; }
}

FAILED=""
for e in $ONLY; do                                                         # chaque moteur dans son sous-shell (errexit actif : PAS dans une liste « || », où bash l'ignorerait)
  set +e; ( set -euo pipefail; "b_$e" ); rc=$?; set -e
  [ $rc -eq 0 ] || { echo "!! ÉCHEC $e (l'APK sera construite sans ce moteur)"; FAILED="$FAILED $e"; rm -f "$OUT/libeng_$e.so"; }
done
ls -la "$OUT"; [ -z "$FAILED" ] || echo "Moteurs en échec :$FAILED"
