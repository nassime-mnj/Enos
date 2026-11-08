"use strict";
// Données communes : langages, rangs, succès, et petits constructeurs pour écrire les cours de façon compacte.
// Une LEÇON = { id, t (titre), lv (1..5), min, why, when, stages:[{t, code, notes:{ligne:"…"}, steps:[S(...)]}], quiz:[...], ex:{...} }
// Une ÉTAPE (S) = ligne surlignée + explication + variables modifiées (null = supprimée) + sortie ajoutée + options { push, pop, heap, ret }.
window.ACAD = {
  langs: [
    { id: "python", n: "Python", ic: "🐍", mo: "python", ext: "py" },
    { id: "c", n: "C", ic: "⚙️", mo: "c", ext: "c" },
    { id: "cpp", n: "C++", ic: "🧩", mo: "cpp", ext: "cpp" },
    { id: "java", n: "Java", ic: "☕", mo: "java", ext: "java" },
    { id: "js", n: "JavaScript", ic: "🟨", mo: "javascript", ext: "js" },
    { id: "shell", n: "Shell", ic: "🐚", mo: "shell", ext: "sh" },
  ],
  ranks: [[0, "Novice"], [60, "Apprenti"], [180, "Codeur"], [400, "Développeur"], [800, "Ingénieur"], [1400, "Expert"], [2200, "Architecte"], [3200, "Légende"]],
  badges: [
    { id: "first", e: "🌱", n: "Premier pas", d: "Terminer une leçon", f: (s) => s.done >= 1 },
    { id: "five", e: "🔥", n: "En feu", d: "5 leçons terminées", f: (s) => s.done >= 5 },
    { id: "twenty", e: "🚀", n: "Turbo", d: "20 leçons terminées", f: (s) => s.done >= 20 },
    { id: "ex1", e: "✅", n: "Correcteur validé", d: "Réussir un exercice", f: (s) => s.ex >= 1 },
    { id: "ex10", e: "🧠", n: "Cerveau", d: "10 exercices réussis", f: (s) => s.ex >= 10 },
    { id: "quiz", e: "🎯", n: "Œil de lynx", d: "10 bonnes prédictions", f: (s) => s.quiz >= 10 },
    { id: "poly", e: "🌍", n: "Polyglotte", d: "Leçons dans 3 langages", f: (s) => s.langs >= 3 },
    { id: "all", e: "👑", n: "Maître des 6", d: "Leçons dans les 6 langages", f: (s) => s.langs >= 6 },
    { id: "compile", e: "🛠️", n: "Sous le capot", d: "Voir une compilation animée", f: (s) => s.comp >= 1 },
    { id: "streak3", e: "📆", n: "3 jours de suite", d: "Série de 3 jours", f: (s) => s.streak >= 3 },
  ],
  lessons: { python: [], c: [], cpp: [], java: [], js: [], shell: [] },
  sheets: {},
  compile: {},
};
// S(ligne, texte, variables, sortie, options)
window.S = (l, t, v, o, x) => Object.assign({ l, t, v: v || {}, o: o || "" }, x || {});
// leçon rapide : ACAD.add("python", {...})
ACAD.add = (lang, les) => { les.lang = lang; ACAD.lessons[lang].push(les); };
