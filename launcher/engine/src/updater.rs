//! Flux « arrière-plan » en fonctions pures et injectables (pas de Tauri, pas de réseau) :
//! `plan` décide s'il faut télécharger ; `tick_apply` honore la demande « Redémarrer pour appliquer » une fois l'application fermée ;
//! `prepare_launch` applique silencieusement une mise à jour prête juste avant un lancement depuis le Launcher.
//! Le Launcher ne ferme JAMAIS l'application : sans demande explicite (`update-apply.json`), on ne touche à rien.
use crate::manifest::{Manifest, MODE_FILES};
use crate::signals::{Ready, Signals};
use crate::staging::{self, Staged};
use crate::store::{Installed, Store};
use crate::{apply, procs, version, Result};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    Nothing,
    Stage,
    AlreadyStaged,
}

/// Mode « files » uniquement ; produit installé ; version strictement supérieure ; déjà en staging (même version ou plus récente) = rien à faire.
pub fn plan(installed: Option<&Installed>, latest: &Manifest, staged: Option<&Staged>) -> Plan {
    let Some(inst) = installed else { return Plan::Nothing };
    if latest.mode != MODE_FILES || version::compare(&latest.version, &inst.version) != Some(Ordering::Greater) {
        return Plan::Nothing;
    }
    match staged {
        Some(s) if s.manifest.product == latest.product && s.manifest.channel == latest.channel && version::compare(&s.manifest.version, &latest.version).map(|o| o != Ordering::Less).unwrap_or(false) => Plan::AlreadyStaged,
        _ => Plan::Stage,
    }
}

/// Empreintes connues des fichiers installés (vide si l'installation n'a pas été faite en mode « files »).
pub fn current_files(installed: &Installed) -> BTreeMap<String, String> {
    installed.files.clone()
}

/// Écrit `update-ready.json` pour une mise à jour complète et vérifiée.
pub fn announce(sig: &Signals, s: &Staged) -> Result<()> {
    sig.write_ready(&Ready { product: s.manifest.product.clone(), channel: s.manifest.channel.clone(), version: s.manifest.version.clone(), notes: s.manifest.notes.clone(), staged_at: s.staged_at, size: s.size })
}

pub struct Ctx<'a> {
    pub signals: &'a Signals,
    pub store: &'a Store,
    pub staging_root: &'a Path,
    pub product: &'a str,
    /// horloge injectée (secondes Unix)
    pub now: u64,
    pub opts: &'a apply::Options,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApplyOutcome {
    /// rien à faire (pas de demande, pas de mise à jour prête, demande périmée…)
    Nothing,
    /// demande valide mais l'application tourne encore : on attend, sans rien forcer
    Waiting,
    Applied { relaunch: bool, version: String },
}

/// Mise à jour prête ET plus récente que l'installation, avec le dossier d'installation. Un staging périmé (déjà installé) est nettoyé.
fn pending(ctx: &Ctx) -> Option<(Installed, Staged, PathBuf)> {
    let inst = ctx.store.get(ctx.product)?;
    if inst.dir.is_empty() {
        return None;
    }
    let staged = staging::staged(ctx.staging_root, ctx.product)?;
    if version::compare(&staged.manifest.version, &inst.version) != Some(Ordering::Greater) {
        staging::discard(ctx.staging_root, ctx.product);
        ctx.signals.clear_ready(ctx.product);
        return None;
    }
    let dir = PathBuf::from(&inst.dir);
    Some((inst, staged, dir))
}

fn do_apply(ctx: &Ctx, inst: Installed, staged: &Staged, dir: &Path) -> Result<ApplyOutcome> {
    let m = &staged.manifest;
    if procs::app_running(ctx.signals, ctx.product, dir, &m.run) {
        return Ok(ApplyOutcome::Waiting);
    }
    let res = apply::apply(ctx.signals, ctx.staging_root, ctx.product, dir, ctx.opts);
    ctx.signals.clear_apply(ctx.product);                          // succès ou échec : la demande est traitée (pas de boucle de nouvelles tentatives)
    let done = res?;
    ctx.store.set(
        ctx.product,
        Installed { version: done.version.clone(), channel: m.channel.clone(), dir: inst.dir, run: m.run.clone(), installed_at: ctx.now, files: done.files, mode: MODE_FILES.into() },
    )?;
    let _ = ctx.signals.write_applied(ctx.product, &done.version, ctx.now);
    ctx.signals.clear_ready(ctx.product);
    Ok(ApplyOutcome::Applied { relaunch: true, version: done.version })
}

/// Appelé périodiquement pour un produit. Sans `update-apply.json` valide : ne touche à rien (« Plus tard »).
pub fn tick_apply(ctx: &Ctx) -> Result<ApplyOutcome> {
    if ctx.signals.read_apply_raw(ctx.product).is_none() {
        return Ok(ApplyOutcome::Nothing);
    }
    if ctx.signals.read_apply(ctx.product, ctx.now).is_none() {
        ctx.signals.clear_apply(ctx.product);                      // périmée (plus de 10 min) : ignorée et supprimée
        return Ok(ApplyOutcome::Nothing);
    }
    let Some((inst, staged, dir)) = pending(ctx) else {
        ctx.signals.clear_apply(ctx.product);                      // rien de prêt : la demande n'a pas d'objet
        return Ok(ApplyOutcome::Nothing);
    };
    do_apply(ctx, inst, &staged, &dir)
}

/// Lancement depuis le Launcher : si une mise à jour est prête et que l'application n'est pas lancée, on l'applique d'abord (silencieux).
pub fn prepare_launch(ctx: &Ctx) -> Result<ApplyOutcome> {
    match pending(ctx) {
        Some((inst, staged, dir)) => do_apply(ctx, inst, &staged, &dir),
        None => Ok(ApplyOutcome::Nothing),
    }
}
