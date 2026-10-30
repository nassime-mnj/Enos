"use strict";
// SCAN DU QR D'APPAIRAGE : le PC (bouton « APPAIRER LE TÉLÉPHONE ») affiche un QR contenant le paquet chiffré + le code ; on le lit avec la caméra
// (jsQR, vendor/jsQR.js, chargé à la demande) et on le passe à l'import Java. Aucun réseau commun, aucune adresse ni code à saisir.
(() => {
  const E = window.ENOS, U = E.ui;
  let stream = null, raf = 0, root = null;

  function loadLib() {
    if (window.jsQR) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "vendor/jsQR.js"; s.onload = res; s.onerror = () => rej(new Error("Lecteur de QR introuvable"));
      document.head.appendChild(s);
    });
  }

  function stop() {
    cancelAnimationFrame(raf); raf = 0;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (root) { root.remove(); root = null; }
  }

  async function open() {
    if (root) return;
    try { await loadLib(); } catch (e) { return U.toast(e.message, "warn"); }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return U.toast("Caméra indisponible dans cette version.", "warn");
    root = document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column";
    root.innerHTML = `<video playsinline muted autoplay style="flex:1;min-height:0;width:100%;object-fit:cover"></video>
      <div style="position:absolute;left:50%;top:42%;width:62vmin;height:62vmin;transform:translate(-50%,-50%);border:3px solid #e0243c;border-radius:18px;box-shadow:0 0 0 100vmax rgba(0,0,0,.55)"></div>
      <div id="ps-msg" style="position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top) + 18px);text-align:center;color:#fff;font:600 15px system-ui;padding:0 24px">Vise le QR code affiché sur le PC</div>
      <button id="ps-x" class="btn" style="position:absolute;left:24px;right:24px;bottom:calc(env(safe-area-inset-bottom) + 24px)">ANNULER</button>`;
    document.body.appendChild(root);
    root.querySelector("#ps-x").onclick = stop;
    const msg = root.querySelector("#ps-msg"), video = root.querySelector("video");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (e) { stop(); return U.toast("Caméra refusée : autorise-la dans les réglages d'Android.", "warn"); }
    video.srcObject = stream;
    await video.play().catch(() => {});
    const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
    let busy = false;
    const tick = async () => {
      if (!root) return;
      if (!busy && video.videoWidth) {
        const k = Math.min(1, 900 / video.videoWidth);                       // un QR de 1,4 Ko est dense : on garde une bonne résolution
        cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
        cx.drawImage(video, 0, 0, cv.width, cv.height);
        const img = cx.getImageData(0, 0, cv.width, cv.height);
        const hit = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (hit && hit.data) {
          if (/^enos:\/\/pair\?/.test(hit.data)) {
            busy = true; msg.textContent = "QR lu : import en cours…";
            const r = await E.importer.applyLink(hit.data);
            if (r.ok) { stop(); return; }
            msg.textContent = r.error || "Échec de l'import.";
            setTimeout(() => { busy = false; }, 2500);
          } else if (!busy) { msg.textContent = "Ce n'est pas le QR d'appairage E.N.O.S."; busy = true; setTimeout(() => { busy = false; msg.textContent = "Vise le QR code affiché sur le PC"; }, 2000); }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  E.pairScan = { open };
})();
