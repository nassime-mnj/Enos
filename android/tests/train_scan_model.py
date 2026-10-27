"""Entraîne le classifieur de pièces (silhouette 20×20 + proportions -> p, n, b, r, q, k) de board_scan.js.
usage : train_scan_model.py <tranches.json...>   [--final]    (sans --final : validation croisée par jeux de pièces ; avec : entraîne sur tout et écrit data/piece_model.js)"""
import base64, json, os, sys, time
import numpy as np
import cv2

args = [a for a in sys.argv[1:] if not a.startswith("--")]
FINAL = "--final" in sys.argv
N = 20
TYPES = "pnbrqk"
rng = np.random.default_rng(7)
AUG = float(os.environ.get('AUG', '0.6'))

rows = {}
miss = fp = tot = 0
for f in args:
    for name, lst in json.load(open(f)).items():
        rows[name] = lst
EXCL = [a.split("=", 1)[1].split(",") for a in sys.argv[1:] if a.startswith("--exclude=")]
if EXCL:
    rows = {k: v for k, v in rows.items() if k not in EXCL[0]}
names = sorted(rows)
print("jeux :", len(names), "(écartés : %s)" % (EXCL[0] if EXCL else "aucun"), flush=True)


def feats(r):
    g = np.frombuffer(r["g"].encode(), dtype=np.uint8) - 48
    rel = min(1.05, r["bh"] / r["hmax"]) if r.get("hmax") else 1.0
    return np.concatenate([g.astype(np.float32) / 9.0, [np.log(r["a"]) * 2.0, rel * 2.0 - 1.0, min(1.0, r["area"] * 3) - 0.5]]).astype(np.float32)


X, Y, S, W, L = [], [], [], [], []
for si, name in enumerate(names):
    for r in rows[name]:
        tot += 1
        if r["t"] == "":
            fp += 1
            continue
        if r.get("miss"):
            miss += 1
            continue
        X.append(feats(r)); Y.append(TYPES.index(r["t"].lower())); S.append(si); W.append(r["t"].isupper()); L.append(r["lum"])
X = np.stack(X); Y = np.array(Y); S = np.array(S); W = np.array(W); L = np.array(L)
print("échantillons :", len(X), "| pièces non vues :", miss, "| fausses pièces sur cases vides :", fp, flush=True)

# --- couleur : meilleur seuil de luminosité
best = max(((np.mean((L >= t) == W), t) for t in range(60, 200, 4)))
print("couleur par luminosité : %.2f %% au seuil %d" % (best[0] * 100, best[1]), flush=True)



def augment(x, k=1):
    """Déformations plausibles d'un jeu de pièces à l'autre : échelle x/y, cisaillement, rotation, épaisseur ; on recompose la silhouette dans le cadre de la case, on la déforme, puis on la re-normalise."""
    out = np.empty_like(x)
    for i in range(len(x)):
        g = x[i, :N * N].reshape(N, N)
        a = float(np.exp(x[i, N * N] / 2.0)); rel = (x[i, N * N + 1] + 1) / 2.0
        hp = max(6.0, rel * 34.0); wp = max(6.0, min(38.0, a * hp))
        piece = cv2.resize(g, (max(2, int(round(wp))), max(2, int(round(hp)))), interpolation=cv2.INTER_LINEAR)
        cv = np.zeros((40, 40), np.float32)
        y0 = int(40 - 3 - piece.shape[0]); x0 = int((40 - piece.shape[1]) / 2)
        cv[max(0, y0):max(0, y0) + piece.shape[0], max(0, x0):max(0, x0) + piece.shape[1]] = piece[: 40 - max(0, y0), : 40 - max(0, x0)]
        sx, sy = rng.uniform(0.86, 1.14), rng.uniform(0.86, 1.14)
        sh, rot = rng.uniform(-0.1, 0.1), np.deg2rad(rng.uniform(-5, 5))
        M = np.array([[sx * np.cos(rot), -np.sin(rot) + sh, 0], [np.sin(rot), sy * np.cos(rot), 0]], np.float32)
        M[:, 2] = np.array([20, 20]) - M[:, :2] @ np.array([20, 20]) + rng.uniform(-1.5, 1.5, 2)
        w = cv2.warpAffine(cv, M, (40, 40), flags=cv2.INTER_LINEAR)
        d = rng.integers(-1, 2)                                              # épaisseur : -1 amincit, +1 épaissit
        if d:
            k3 = np.ones((3, 3), np.uint8)
            w = cv2.dilate(w, k3) if d > 0 else cv2.erode(w, k3)
        ys, xs = np.where(w > 0.5)
        if len(ys) < 20:
            out[i] = x[i]; continue
        by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        crop = w[by0:by1, bx0:bx1]
        gn = cv2.resize(crop, (N, N), interpolation=cv2.INTER_AREA)
        out[i, :N * N] = np.round(np.clip(gn, 0, 1) * 9).reshape(-1) / 9.0
        bw, bh = bx1 - bx0, by1 - by0
        out[i, N * N] = np.log(bw / bh) * 2.0
        out[i, N * N + 1] = min(1.05, bh / 34.0) * 2 - 1
        out[i, N * N + 2] = x[i, N * N + 2]
    return out

def init(sizes):
    ps = []
    for a, b in zip(sizes[:-1], sizes[1:]):
        ps.append([rng.normal(0, np.sqrt(2.0 / a), (a, b)).astype(np.float32), np.zeros(b, np.float32)])
    return ps


def forward(ps, x, drop=0.0):
    hs = [x]
    h = x
    for i, (w, b) in enumerate(ps):
        z = h @ w + b
        if i < len(ps) - 1:
            h = np.maximum(z, 0)
            if drop:
                m = (rng.random(h.shape) > drop).astype(np.float32) / (1 - drop)
                h = h * m
            hs.append(h)
        else:
            h = z
    return h, hs


def train(Xt, Yt, epochs=30, hidden=(192, 96), lr=2e-3, wd=1e-4):
    ps = init([Xt.shape[1], *hidden, 6])
    m = [[np.zeros_like(w), np.zeros_like(b)] for w, b in ps]
    v = [[np.zeros_like(w), np.zeros_like(b)] for w, b in ps]
    t = 0
    n = len(Xt)
    for ep in range(epochs):
        idx = rng.permutation(n)
        for s in range(0, n, 256):
            bi = idx[s:s + 256]
            x = Xt[bi].copy()
            if AUG:
                am = rng.random(len(bi)) < AUG
                if am.any():
                    x[am] = augment(x[am])
            # augmentation : bruit sur la silhouette, légère déformation des proportions
            x[:, :N * N] = np.clip(x[:, :N * N] + rng.normal(0, 0.06, x[:, :N * N].shape).astype(np.float32), 0, 1)
            x[:, N * N] += rng.normal(0, 0.05, len(bi)).astype(np.float32)
            x[:, N * N + 1] += rng.normal(0, 0.06, len(bi)).astype(np.float32)
            y = Yt[bi]
            logits, hs = forward(ps, x, drop=0.15)
            p = np.exp(logits - logits.max(1, keepdims=True)); p /= p.sum(1, keepdims=True)
            d = p; d[np.arange(len(bi)), y] -= 1; d /= len(bi)
            t += 1
            for i in range(len(ps) - 1, -1, -1):
                gw = hs[i].T @ d + wd * ps[i][0]
                gb = d.sum(0)
                if i:
                    d = (d @ ps[i][0].T) * (hs[i] > 0)
                for j, gr in ((0, gw), (1, gb)):
                    m[i][j] = 0.9 * m[i][j] + 0.1 * gr
                    v[i][j] = 0.999 * v[i][j] + 0.001 * gr * gr
                    ps[i][j] -= lr * (m[i][j] / (1 - 0.9 ** t)) / (np.sqrt(v[i][j] / (1 - 0.999 ** t)) + 1e-8)
        if ep == int(epochs * 0.6):
            lr *= 0.3
    return ps


def acc(ps, x, y):
    lg, _ = forward(ps, x)
    return float(np.mean(lg.argmax(1) == y)), lg


if not FINAL:
    K = 5
    folds = [list(range(i, len(names), K)) for i in range(K)]
    tot_ok = tot_n = 0
    for fi, fs in enumerate(folds):
        te = np.isin(S, fs)
        t0 = time.time()
        ps = train(X[~te], Y[~te], epochs=int(os.environ.get("EP", "24")))
        a, lg = acc(ps, X[te], Y[te])
        tot_ok += a * te.sum(); tot_n += te.sum()
        conf = {}
        for yt, yp in zip(Y[te], lg.argmax(1)):
            if yt != yp:
                conf[(TYPES[yt], TYPES[yp])] = conf.get((TYPES[yt], TYPES[yp]), 0) + 1
        per = {}
        for si in fs:
            mk = S[te] == si
            if mk.sum():
                per[names[si]] = round(float(np.mean(lg.argmax(1)[mk] == Y[te][mk])) * 100, 1)
        worst = sorted(per.items(), key=lambda kv: kv[1])[:4]
        print("pli %d : %.2f %% sur %d jeux inconnus (%d s) | pires : %s | confusions : %s" % (fi, a * 100, len(fs), time.time() - t0, worst, sorted(conf.items(), key=lambda kv: -kv[1])[:4]), flush=True)
    print("PRÉCISION SUR JEUX INCONNUS : %.2f %%" % (100 * tot_ok / tot_n))
else:
    ps = train(X, Y, epochs=int(os.environ.get("EP", "30")))
    a, _ = acc(ps, X, Y)
    print("précision d'entraînement : %.2f %%" % (a * 100))
    # quantification int8 par colonne de sortie
    layers = []
    for w, b in ps:
        sc = np.maximum(np.abs(w).max(0), 1e-6) / 127.0
        q = np.round(w / sc).astype(np.int8)
        layers.append({"i": w.shape[0], "o": w.shape[1], "w": base64.b64encode(q.T.tobytes()).decode(), "s": [round(float(x), 6) for x in sc], "b": [round(float(x), 5) for x in b]})
    wq = [(np.round(w / (np.maximum(np.abs(w).max(0), 1e-6) / 127.0)) * (np.maximum(np.abs(w).max(0), 1e-6) / 127.0), b) for w, b in ps]
    aq, _ = acc(wq, X, Y)
    print("précision après quantification : %.2f %%" % (aq * 100))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "mobile", "data", "piece_model.js")
    json_s = json.dumps({"types": TYPES, "n": N, "lumCut": int(best[1]), "layers": layers}, separators=(",", ":"))
    open(out, "w", encoding="utf-8").write("window.ENOS_PM=" + json_s + ";\n")
    print(out, os.path.getsize(out) // 1024, "Ko")
