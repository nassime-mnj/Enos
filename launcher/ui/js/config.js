// Launcher settings. The server address can be changed from the sign-in screen ("Server"); it is remembered on this device.
export const DEFAULT_SERVER = "https://launcher.dualpulse.example";   // REPLACE with the Dual Pulse server domain
export const PRODUCTS = {
  enos: { id: "enos", name: "E.N.O.S.", tagline: "The AI desktop assistant: calendar, PDF, media studio, tools.", app_id: "{6F1E2B7A-4C3D-4E8B-9A57-E905A1C0D3B2}", run: "ENOS.exe" },
  terna: { id: "terna", name: "TERNA", tagline: "Solo & co-op roguelike. Pilot remotely. Take Earth back." },
};
export const TERNA_PITCH = {
  main: "Earth has fallen. A ruthless AI, the Core, has taken control of every machine. What remains is TERNA, a ship-planet in orbit, and you: a pilot linked by thought to a combat robot standing where humanity was born. Every descent is different. Every death brings you closer to victory. Alone or together, take Earth back, one run at a time.",
  banner: "Pilot remotely. Destroy. Start over.",
};
// Banners shown while the server has published none
export const FALLBACK_NEWS = [
  { id: "f1", kind: "announcement", title: "Welcome to Dual Pulse", body: "Two pulses, one vision. Find our software and the progress of TERNA here.", image: "", link: "" },
  { id: "f2", kind: "event", title: "TERNA is coming", body: TERNA_PITCH.banner + " Join the wishlist to follow the project.", image: "", link: "", goto: "games" },
];
