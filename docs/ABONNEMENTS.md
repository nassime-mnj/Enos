# Abonnements ETO et éditions privées E.N.O.S.

## Les versions

| Version | Public | Couleur | Prix | Où elle apparaît |
|---|---|---|---|---|
| ETO Free | grand public | vert | 0 € | Abonnement |
| ETO Pro | grand public | bleu | 9,99 €/mois · 95,90 €/an | Abonnement |
| ETO MAX | grand public | jaune | 29,99 €/mois · 287,90 €/an | Abonnement |
| ETO Ultra | grand public | violet | 119,99 €/mois · 1 151,90 €/an | Abonnement |
| E.N.O.S. Standard Edition | amis (profil PC `friends`) | gris acier | privé | Espace CEO |
| E.N.O.S. Dev | employés (profil PC `dev`) | rose | privé | Espace CEO |
| E.N.O.S. CEO | toi et ton associé (profil PC `ceo`) | cramoisi | privé | Espace CEO |

L'en-tête de l'application affiche **E.T.O. · AUTONOME** quand une offre ETO est active, **E.N.O.S. · AUTONOME** pour une édition privée.

## Le marché (novembre 2026)

- Assistants IA : environ 20 $ par mois pour le premier palier payant (ChatGPT Plus, Claude Pro, Gemini AI Pro), environ 8 € pour ChatGPT Go, 100 à 200 $ pour les paliers « gros usage » (ChatGPT Pro, Claude Max 5x / 20x, Google AI Ultra).
- Échecs : Chess.com Gold / Platinum / Diamond, de l'ordre de 30 à 100 $ par an.
- Google Play : environ 15 % de commission sur les abonnements (10 % de service + 5 % de facturation).

ETO mélange les deux mondes (assistant personnel + échecs + outils) : Pro se place sous un assistant IA à 20 $ mais au-dessus d'un abonnement d'échecs, Ultra sous les paliers « gros usage » de l'IA.

## Contenu proposé

- **Free** : Stockfish 19 sur le téléphone, bots E.N.O.S. et 20 adversaires, 5 puzzles et 1 revue par jour, chat ETO avec sa propre clé, outils (PDF, scanner, photos, dossiers, agenda).
- **Pro** : les 142 bots et les moteurs natifs, puzzles / leçons / revues illimités, Conseiller « !! », 500 messages ETO inclus par mois, sauvegarde cloud.
- **MAX** : Chess Edit Studio complet sans filigrane, tous les modes (Royale ×4, Variantes, 5D, Fog, Prime, Game Clips), coach ETO à la voix (2 h par mois), 3 000 messages + vision, Codelab / Studio audio / CinePulse.
- **Ultra** : ETO sur le PC (copilote de jeu, Smart AFK, Auto-Clipper), bot personnel entraîné sur ses parties, messages et voix sans compter (usage raisonnable), exports 4K, accès anticipé, famille jusqu'à 6.

## Ce qu'il faut ajouter pour que les prix soient justifiés

1. **Comptes ETO et facturation** : connexion, abonnements Google Play (obligatoires pour vendre un abonnement numérique dans une application du Play Store), vérification du reçu côté serveur, restauration d'achat.
2. **IA hébergée** : aujourd'hui chacun apporte sa clé Groq / ElevenLabs. Pour inclure des messages et de la voix, il faut un relais serveur avec quotas par offre (c'est le premier coût : à budgéter avant de fixer les quotas).
3. **Verrouillage réel des fonctions** par offre (aujourd'hui les offres changent la marque, la couleur et le badge ; les modules ne sont pas encore bridés).
4. **ETO sur le PC** pour Ultra : une édition grand public du PC (aujourd'hui seules les éditions privées existent).
5. **Juridique** : CGV, mentions légales, politique de confidentialité (RGPD), TVA, droit de rétractation.

## Tester

Dans l'app « Eto TEST » : Modules › Paramètres › Abonnement (offres publiques) ou Espace CEO (les 7 versions), bandeau « Mode test ». Code : `android/assets/mobile/js/plans.js`, `css/plans.css`. Test : `android/tests/t_plans.py`.
