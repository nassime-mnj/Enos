// Magnétisme : cibles (tête de lecture, 0, bords des autres clips, repères) et calcul de l'aimantation.
import { state, clipEnd } from "./state.js";

/** Cibles d'aimantation. exclude : id du clip en cours de déplacement. */
export function snapTargets({ exclude = null, playhead = true } = {}) {
  const t = [{ t: 0, label: "Début" }];
  if (playhead) t.push({ t: state.playhead, label: "Tête de lecture" });
  for (const m of state.markers) t.push({ t: m.t, label: "Repère" });
  for (const c of state.clips) {
    if (c.id === exclude) continue;
    t.push({ t: c.start, label: "Début de clip" }, { t: clipEnd(c), label: "Fin de clip" });
  }
  return t;
}

/**
 * edges : temps des bords du clip déplacé. Retourne {delta, target} pour la cible la plus proche
 * à moins de `threshold` secondes, sinon null.
 */
export function snapValue(edges, targets, threshold) {
  let best = null;
  for (const e of edges) {
    for (const tg of targets) {
      const d = tg.t - e;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, target: tg };
      }
    }
  }
  return best;
}
