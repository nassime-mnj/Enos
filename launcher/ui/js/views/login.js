// Sign-in / registration by invitation. No open registration: without an invitation code from the CEO, no account can be created.
import { h, clear, $ } from "../ui.js";
import * as api from "../api.js";

export function renderLogin(root, onDone) {
  let mode = "login", needTotp = false, busy = false;

  const draw = () => {
    clear(root);
    const err = h("div", { class: "err", id: "lg-err", role: "alert", hidden: true });
    const f = (id, label, type, extra) => h("div", { class: "fld" }, h("label", { for: id }, label), h("input", { id, type: type || "text", autocomplete: "off", spellcheck: "false", ...(extra || {}) }));
    const form = h("form", { id: "lg-form", novalidate: true },
      mode === "register" ? [f("lg-invite", "INVITATION CODE", "text", { placeholder: "DP-XXXXXXXXXXXXXXXX", autocapitalize: "characters" }),
        h("p", { class: "hint" }, "Registration is by invitation only. Ask Dual Pulse for a code."), f("lg-name", "DISPLAY NAME (optional)", "text", { maxlength: "60" })] : null,
      f("lg-email", "EMAIL ADDRESS", "email", { autocomplete: "username" }),
      f("lg-pw", "PASSWORD", "password", { autocomplete: mode === "register" ? "new-password" : "current-password" }),
      mode === "register" ? h("p", { class: "hint" }, "At least 10 characters.") : null,
      needTotp ? [f("lg-totp", "6-DIGIT CODE (TWO-FACTOR AUTHENTICATION)", "text", { inputmode: "numeric", maxlength: "8", autocomplete: "one-time-code" })] : null,
      err,
      h("button", { class: "btn pri wide", type: "submit", id: "lg-go" }, mode === "register" ? "CREATE MY ACCOUNT" : "SIGN IN"));
    const srv = h("div", { class: "srv" }, "Server: ", h("span", { id: "lg-srv" }, api.session.server), " · ", h("a", { id: "lg-chg", role: "button", tabindex: "0" }, "change"));
    const card = h("div", { class: "lg-card" },
      h("div", { class: "lg-logo" }, h("img", { src: "logo.svg", alt: "" }), h("div", null, h("h1", null, "DUAL PULSE"), h("small", null, "E.N.O.S. · TERNA · THE WHOLE ECOSYSTEM"))),
      h("div", { class: "tabs", role: "tablist" },
        h("button", { class: mode === "login" ? "on" : "", role: "tab", id: "tab-login", type: "button", onclick: () => { mode = "login"; needTotp = false; draw(); } }, "SIGN IN"),
        h("button", { class: mode === "register" ? "on" : "", role: "tab", id: "tab-register", type: "button", onclick: () => { mode = "register"; needTotp = false; draw(); } }, "I HAVE AN INVITATION")),
      form, srv);
    root.append(h("main", { id: "login" }, card));
    const show = (m) => { err.hidden = !m; err.textContent = m || ""; };
    $("#lg-chg").onclick = () => {
      const v = prompt("Dual Pulse server address (https://…)", api.session.server);
      if (v === null) return;
      try { api.setServer(v); $("#lg-srv").textContent = api.session.server; show(""); } catch (e) { show(e.message); }
    };
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); if (busy) return; busy = true; show("");
      const go = $("#lg-go"); go.disabled = true; go.textContent = "…";
      try {
        const email = $("#lg-email").value.trim(), pw = $("#lg-pw").value;
        if (!email || !pw) throw new Error("Enter your email and password.");
        if (mode === "register") {
          const code = $("#lg-invite").value.trim();
          if (!code) throw new Error("An invitation code is required.");
          await api.register(code, email, pw, $("#lg-name").value.trim());
        } else await api.login(email, pw, needTotp ? $("#lg-totp").value : "", "Launcher");
        onDone();
      } catch (x) {
        if (x.extra && x.extra.mfa_required) { needTotp = true; const keep = { e: $("#lg-email").value, p: $("#lg-pw").value }; draw(); $("#lg-email").value = keep.e; $("#lg-pw").value = keep.p; $("#lg-totp").focus(); const e2 = $("#lg-err"); e2.hidden = false; e2.textContent = "Enter the code from your authenticator app."; }
        else show(x.message);
        busy = false; const g = $("#lg-go"); if (g) { g.disabled = false; g.textContent = mode === "register" ? "CREATE MY ACCOUNT" : "SIGN IN"; }
        return;
      }
      busy = false;
    });
    setTimeout(() => $(mode === "register" ? "#lg-invite" : "#lg-email").focus(), 30);
  };
  draw();
}
