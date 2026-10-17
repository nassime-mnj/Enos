//! Application d'une mise à jour en staging, avec journal et retour arrière complet.
//!
//! Déroulé : (a) contrôle de l'empreinte de CHAQUE fichier du staging ; (b) journal `.update-journal.json` « in_progress » (liste des opérations prévues) ;
//! (c) phase 1 : copie de chaque fichier modifié vers `<destination>.update-new` (même volume -> renommage atomique), empreinte revérifiée pendant la copie ;
//! (d) phase 2 : pour chaque fichier, l'ancien est DÉPLACÉ vers `.update-rollback/<version>/<chemin>` puis `.update-new` est renommé ; les fichiers retirés sont déplacés de même ;
//! (e) à la moindre erreur : tout est restauré depuis le rollback (l'ordre inverse) ; (f) succès : journal « done », puis rollback + staging + journal supprimés.
//! `recover` fait la même restauration après un plantage. Les données de l'utilisateur (`manifest::is_protected`) ne sont jamais touchées.
use crate::download::sha256_file;
use crate::manifest::{is_protected, safe_path};
use crate::signals::{now, Signals};
use crate::staging::{self, Staged};
use crate::{procs, store::atomic_write, version, Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const JOURNAL: &str = ".update-journal.json";
pub const ROLLBACK: &str = ".update-rollback";
const NEW_SUFFIX: &str = ".update-new";

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// test : échec injecté à la n-ième opération (0 = la première)
    pub fail_after: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    pub version: String,
    /// état complet après mise à jour : chemin -> SHA-256 de TOUS les fichiers du manifeste
    pub files: BTreeMap<String, String>,
    pub removed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Op {
    path: String,
    /// "replace" (un fichier existait : déplacé vers le rollback), "add" (nouveau), "remove"
    kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Journal {
    state: String,
    product: String,
    version: String,
    started_at: u64,
    ops: Vec<Op>,
}

struct Counter {
    n: usize,
    fail_after: Option<usize>,
}

impl Counter {
    fn tick(&mut self) -> Result<()> {
        let i = self.n;
        self.n += 1;
        if self.fail_after == Some(i) {
            return Err(Error::Other(format!("échec injecté à l'opération {i}")));
        }
        Ok(())
    }
}

fn join(base: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(base.to_path_buf(), |p, c| p.join(c))
}

fn suffixed(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

fn exists(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

fn remove_any(p: &Path) {
    match fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => {
            let _ = fs::remove_dir_all(p);
        }
        Ok(_) => {
            let _ = fs::remove_file(p);
        }
        Err(_) => {}
    }
}

/// Chemin de destination sûr : relatif propre, pas protégé, aucun composant existant qui soit un lien symbolique ou un fichier à la place d'un dossier.
fn checked_dest(install_dir: &Path, rel: &str) -> Result<PathBuf> {
    if !safe_path(rel) || is_protected(rel) {
        return Err(Error::Manifest(format!("chemin refusé : {rel}")));
    }
    let comps: Vec<&str> = rel.split('/').collect();
    let mut cur = install_dir.to_path_buf();
    for (i, c) in comps.iter().enumerate() {
        cur.push(c);
        let last = i + 1 == comps.len();
        match fs::symlink_metadata(&cur) {
            Ok(m) if !last && m.file_type().is_symlink() => return Err(Error::Other(format!("lien symbolique refusé dans le chemin : {rel}"))),
            Ok(m) if !last && !m.is_dir() => return Err(Error::Other(format!("un fichier occupe l'emplacement d'un dossier : {rel}"))),
            Ok(m) if last && m.is_dir() => return Err(Error::Other(format!("un dossier occupe l'emplacement du fichier : {rel}"))),
            _ => {}
        }
    }
    Ok(cur)
}

fn write_journal(install_dir: &Path, j: &Journal) -> Result<()> {
    atomic_write(&install_dir.join(JOURNAL), &serde_json::to_vec_pretty(j).map_err(|e| Error::Other(e.to_string()))?)
}

fn rollback_dir(install_dir: &Path, version: &str) -> PathBuf {
    install_dir.join(ROLLBACK).join(version)
}

fn clean_rollback(install_dir: &Path) {
    let rb = install_dir.join(ROLLBACK);
    if let Ok(m) = fs::symlink_metadata(&rb) {
        if m.file_type().is_symlink() || !m.is_dir() {
            let _ = fs::remove_file(&rb);
        } else {
            let _ = fs::remove_dir_all(&rb);
        }
    }
}

/// Copie `src` vers `dst` (créé en exclusivité, jamais à travers un lien) en recalculant l'empreinte ; refuse si elle diffère.
fn copy_verified(src: &Path, dst: &Path, sha256: &str, size: u64, perms: Option<fs::Permissions>) -> Result<()> {
    if exists(dst) {
        remove_any(dst);                                           // reste d'un essai précédent (ou lien piégé) : supprimé, jamais suivi
    }
    let mut input = fs::File::open(src)?;
    let mut out = OpenOptions::new().write(true).create_new(true).open(dst)?;
    let (mut h, mut buf, mut total) = (Sha256::new(), vec![0u8; 1 << 20], 0u64);
    let res = (|| -> Result<()> {
        loop {
            let n = input.read(&mut buf)?;
            if n == 0 {
                break;
            }
            h.update(&buf[..n]);
            out.write_all(&buf[..n])?;
            total += n as u64;
        }
        out.sync_all()?;
        if total != size || !hex::encode(h.clone().finalize()).eq_ignore_ascii_case(sha256) {
            return Err(Error::Hash(src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
        }
        Ok(())
    })();
    drop(out);
    if let Err(e) = res {
        let _ = fs::remove_file(dst);
        return Err(e);
    }
    if let Some(p) = perms {
        let _ = fs::set_permissions(dst, p);                       // droits de l'ancien fichier conservés (bit exécutable, lecture seule…)
    }
    Ok(())
}

fn move_to_rollback(dest: &Path, rb: &Path) -> Result<()> {
    if let Some(parent) = rb.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(dest, rb)?;
    Ok(())
}

/// Restaure tout ce que le journal prévoyait (idempotent : sûr après un plantage à n'importe quel point).
fn restore(install_dir: &Path, j: &Journal) -> Result<()> {
    let rbd = rollback_dir(install_dir, &j.version);
    let mut first_err: Option<Error> = None;
    for op in j.ops.iter().rev() {
        if !safe_path(&op.path) || is_protected(&op.path) {
            continue;
        }
        let dest = join(install_dir, &op.path);
        let _ = fs::remove_file(suffixed(&dest, NEW_SUFFIX));
        let rb = join(&rbd, &op.path);
        let r: Result<()> = (|| {
            match op.kind.as_str() {
                "replace" | "remove" => {
                    if exists(&rb) {
                        if exists(&dest) {
                            remove_any(&dest);
                        }
                        if let Some(parent) = dest.parent() {
                            fs::create_dir_all(parent)?;
                        }
                        fs::rename(&rb, &dest)?;
                    }
                }
                "add" => {
                    if fs::symlink_metadata(&dest).map(|m| !m.is_dir()).unwrap_or(false) {
                        fs::remove_file(&dest)?;
                    }
                    let mut p = dest.parent().map(Path::to_path_buf);
                    while let Some(d) = p {
                        if d == install_dir || fs::remove_dir(&d).is_err() {
                            break;
                        }
                        p = d.parent().map(Path::to_path_buf);
                    }
                }
                _ => {}
            }
            Ok(())
        })();
        if let Err(e) = r {
            first_err.get_or_insert(e);
        }
    }
    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

fn cleanup(install_dir: &Path) {
    clean_rollback(install_dir);
    let _ = fs::remove_file(install_dir.join(JOURNAL));
}

/// Après un plantage pendant l'application : restaure l'état d'avant. Retourne vrai si une restauration a eu lieu.
pub fn recover(install_dir: &Path) -> Result<bool> {
    let jf = install_dir.join(JOURNAL);
    let meta = match fs::symlink_metadata(&jf) {
        Ok(m) if m.is_file() && m.len() < 4 * 1024 * 1024 => m,
        Ok(_) => return Err(Error::Other("journal de mise à jour illisible".into())),
        Err(_) => return Ok(false),
    };
    let _ = meta;
    let j: Journal = serde_json::from_slice(&fs::read(&jf)?).map_err(|_| Error::Other("journal de mise à jour corrompu : restauration impossible automatiquement".into()))?;
    if version::parse(&j.version).is_none() {
        return Err(Error::Other("journal de mise à jour invalide".into()));
    }
    if j.state == "done" {
        cleanup(install_dir);
        return Ok(false);
    }
    restore(install_dir, &j)?;
    cleanup(install_dir);
    Ok(true)
}

pub fn apply(sig: &Signals, root: &Path, product: &str, install_dir: &Path, opts: &Options) -> Result<Applied> {
    let staged: Staged = staging::staged(root, product).ok_or_else(|| Error::Other("aucune mise à jour prête".into()))?;
    let m = &staged.manifest;
    if !install_dir.is_dir() {
        return Err(Error::Other(format!("dossier d'installation introuvable : {}", install_dir.display())));
    }
    if procs::app_running(sig, product, install_dir, &m.run) {
        return Err(Error::Other("L'application est en cours d'exécution : elle doit être fermée avant d'appliquer la mise à jour.".into()));
    }
    recover(install_dir)?;
    clean_rollback(install_dir);
    let src_dir = staging::files_dir(root, m);

    // (a) vérification de chaque fichier du staging + (b) plan
    let mut ops: Vec<Op> = vec![];
    let mut dests: Vec<(PathBuf, PathBuf, usize)> = vec![];       // (source, destination, index dans m.files)
    for p in &staged.changed {
        let (i, entry) = m.files.iter().enumerate().find(|(_, f)| &f.path == p).ok_or_else(|| Error::Manifest(format!("fichier inconnu du manifeste : {p}")))?;
        let dest = checked_dest(install_dir, p)?;
        let src = join(&src_dir, p);
        match fs::symlink_metadata(&src) {
            Ok(md) if md.is_file() && md.len() == entry.size => {}
            _ => return Err(Error::Size(p.clone())),
        }
        if !sha256_file(&src)?.eq_ignore_ascii_case(&entry.sha256) {
            return Err(Error::Hash(p.clone()));
        }
        ops.push(Op { path: p.clone(), kind: if exists(&dest) { "replace" } else { "add" }.into() });
        dests.push((src, dest, i));
    }
    let mut removals: Vec<(String, PathBuf)> = vec![];
    for p in &staged.removed {
        let dest = checked_dest(install_dir, p)?;
        if exists(&dest) {
            ops.push(Op { path: p.clone(), kind: "remove".into() });
            removals.push((p.clone(), dest));
        }
    }
    let journal = Journal { state: "in_progress".into(), product: product.to_string(), version: m.version.clone(), started_at: now(), ops };
    write_journal(install_dir, &journal)?;

    let rbd = rollback_dir(install_dir, &m.version);
    let mut ctr = Counter { n: 0, fail_after: opts.fail_after };
    let run = (|| -> Result<()> {
        // phase 1 : copies (rien d'existant n'est encore touché)
        for (src, dest, i) in &dests {
            ctr.tick()?;
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            let perms = fs::symlink_metadata(dest).ok().filter(|md| md.is_file()).map(|md| md.permissions());
            let f = &m.files[*i];
            copy_verified(src, &suffixed(dest, NEW_SUFFIX), &f.sha256, f.size, perms)?;
        }
        // phase 2 : permutations
        for (k, (_, dest, i)) in dests.iter().enumerate() {
            if journal.ops[k].kind == "replace" {
                ctr.tick()?;
                move_to_rollback(dest, &join(&rbd, &m.files[*i].path))?;
            }
            ctr.tick()?;
            fs::rename(suffixed(dest, NEW_SUFFIX), dest)?;
        }
        for (p, dest) in &removals {
            ctr.tick()?;
            move_to_rollback(dest, &join(&rbd, p))?;
        }
        Ok(())
    })();
    if let Err(e) = run {
        if restore(install_dir, &journal).is_ok() {
            cleanup(install_dir);                                  // sinon le journal reste : `recover` réessaiera
        }
        return Err(e);
    }

    // (f) succès
    write_journal(install_dir, &Journal { state: "done".into(), ..journal })?;
    clean_rollback(install_dir);
    staging::discard(root, product);
    let _ = fs::remove_file(install_dir.join(JOURNAL));
    Ok(Applied { version: m.version.clone(), files: m.files.iter().map(|f| (f.path.clone(), f.sha256.clone())).collect(), removed: removals.into_iter().map(|(p, _)| p).collect() })
}
