// Réglages du Launcher. L'adresse du serveur peut être changée depuis l'écran de connexion (« Serveur ») ; elle est mémorisée sur cet appareil.
export const DEFAULT_SERVER = "https://launcher.dualpulse.example";   // À REMPLACER par le domaine du serveur Dual Pulse
export const PRODUCTS = {
  enos: { id: "enos", name: "E.N.O.S.", tagline: "L'assistant IA de bureau : agenda, PDF, studio média, outils.", app_id: "{6F1E2B7A-4C3D-4E8B-9A57-E905A1C0D3B2}", run: "ENOS.exe" },
  terna: { id: "terna", name: "TERNA", tagline: "Roguelike solo & coop. Pilotez à distance. Reprenez la Terre." },
};
export const TERNA_PITCH = {
  main: "La Terre est tombée. Une IA sans pitié, ENOS, a pris le contrôle de toutes les machines. Il reste TERNA, une planète-vaisseau en orbite, et vous : pilote, relié par la pensée à un robot de combat posé là où l'humanité est née. Chaque descente est unique. Chaque mort vous rapproche de la victoire. Seul ou à plusieurs, reprenez la Terre, une run à la fois.",
  banner: "Pilotez à distance. Détruisez. Recommencez.",
};
// Bannières affichées tant que le serveur n'en publie aucune
export const FALLBACK_NEWS = [
  { id: "f1", kind: "announcement", title: "Bienvenue chez Dual Pulse", body: "Deux pulsations. Un seul jeu. Retrouvez ici nos logiciels et l'avancée de TERNA.", image: "", link: "" },
  { id: "f2", kind: "event", title: "TERNA arrive", body: TERNA_PITCH.banner + " Inscrivez-vous à la liste de souhaits pour suivre le projet.", image: "", link: "", goto: "games" },
];
