"""Renomme les fichiers ElevenLabs du dossier Audionew en noms utilisables par main.py.

La correspondance a ete etablie en transcrivant chaque fichier (reconnaissance vocale locale) :
chaque horodatage ci-dessous correspond a la phrase indiquee. Le script est rejouable.
"""
import os
import sys

DOSSIER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Audionew")

# horodatage dans le nom du fichier -> nouveau nom
CORRESPONDANCE = {
    "2026-10-03T16_12_41": "reponse_identite.mp3",  # "Je suis E.N.O.S. A.I., une entité cybernétique..."
    "2026-10-03T16_14_40": "reponse_speech.mp3",    # "J'ai été compilé dans les lignes de code..."
    "2026-10-03T16_16_15": "reponse_statut.mp3",    # "Systèmes nominaux. Cœurs logiques..."
    "2026-10-03T16_17_43": "reponse_inconnu.mp3",   # "Je suis actuellement en phase d'apprentissage..."
    # reponse_terna.mp3 : aucun fichier correspondant dans Audionew pour l'instant.
}
ATTENDUS = ["reponse_identite.mp3", "reponse_speech.mp3", "reponse_statut.mp3",
            "reponse_terna.mp3", "reponse_inconnu.mp3"]


def main():
    if not os.path.isdir(DOSSIER):
        sys.exit(f"Dossier introuvable : {DOSSIER}")
    fichiers = os.listdir(DOSSIER)
    for stamp, cible in CORRESPONDANCE.items():
        if cible in fichiers:
            print(f"deja fait : {cible}")
            continue
        source = next((f for f in fichiers if stamp in f), None)
        if source is None:
            print(f"INTROUVABLE : fichier {stamp}")
            continue
        os.rename(os.path.join(DOSSIER, source), os.path.join(DOSSIER, cible))
        print(f"{source}  ->  {cible}")
    restants = os.listdir(DOSSIER)
    manquants = [n for n in ATTENDUS if n not in restants]
    if manquants:
        print("\nManquants :", ", ".join(manquants))
    autres = [f for f in restants if f not in ATTENDUS]
    if autres:
        print("Non utilises (laisses tels quels) :")
        for f in autres:
            print("  ", f)


if __name__ == "__main__":
    main()
