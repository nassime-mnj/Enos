//! Staging : téléchargement silencieux (même application en marche) des seuls fichiers modifiés, vers
//! `<racine>/<produit>/<version>/files/<chemin>`. Quand tout est complet et vérifié, `<racine>/<produit>/ready.json` est écrit ATOMIQUEMENT.
//! La signature du manifeste est vérifiée par l'appelant (`manifest::open`).
use crate::download::{download, Progress};
use crate::install::Overall;
use crate::manifest::{self, Manifest, MODE_FILES};
use crate::signals::{now, valid_product};
use crate::{store::atomic_write, version, Error, Result};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Staged {
    pub manifest: Manifest,
    /// chemins à écrire (nouveaux ou dont l'empreinte diffère)
    pub changed: Vec<String>,
    /// chemins installés mais absents du nouveau manifeste (hors chemins protégés)
    pub removed: Vec<String>,
    pub size: u64,
    pub staged_at: u64,
}

pub fn product_dir(root: &Path, product: &str) -> PathBuf {
    root.join(product)
}

pub fn files_dir(root: &Path, m: &Manifest) -> PathBuf {
    root.join(&m.product).join(&m.version).join("files")
}

fn ready_file(root: &Path, product: &str) -> PathBuf {
    root.join(product).join("ready.json")
}

/// Mise à jour complète en staging pour ce produit, ou None (absente, illisible, incomplète).
pub fn staged(root: &Path, product: &str) -> Option<Staged> {
    if !valid_product(product) {
        return None;
    }
    let bytes = fs::read(ready_file(root, product)).ok()?;
    if bytes.len() > 4 * 1024 * 1024 {
        return None;
    }
    let s: Staged = serde_json::from_slice(&bytes).ok()?;
    let m = &s.manifest;
    if m.product != product || m.mode != MODE_FILES || version::parse(&m.version).is_none() {
        return None;
    }
    let dir = files_dir(root, m);
    for p in &s.changed {
        let f = m.files.iter().find(|f| &f.path == p)?;
        match fs::symlink_metadata(dir.join(p)) {
            Ok(md) if md.is_file() && md.len() == f.size => {}
            _ => return None,
        }
    }
    Some(s)
}

pub fn discard(root: &Path, product: &str) {
    if valid_product(product) {
        let _ = fs::remove_dir_all(product_dir(root, product));
    }
}

/// Fichiers à télécharger : ceux dont l'empreinte diffère de celle installée.
pub fn diff(m: &Manifest, current: &BTreeMap<String, String>) -> (Vec<usize>, Vec<String>) {
    let changed = m.files.iter().enumerate().filter(|(_, f)| !current.get(&f.path).map(|h| h.eq_ignore_ascii_case(&f.sha256)).unwrap_or(false)).map(|(i, _)| i).collect();
    let removed = current
        .keys()
        .filter(|p| manifest::safe_path(p) && !manifest::is_protected(p) && !m.files.iter().any(|f| &f.path == *p))
        .cloned()
        .collect();
    (changed, removed)
}

pub fn stage(m: &Manifest, current: &BTreeMap<String, String>, root: &Path, link: &mut dyn FnMut(usize) -> Result<String>, cancel: &AtomicBool, on: &mut dyn FnMut(Overall)) -> Result<Staged> {
    if m.mode != MODE_FILES {
        return Err(Error::Manifest("staging: only the \"files\" mode is supported".into()));
    }
    if !valid_product(&m.product) {
        return Err(Error::Manifest("invalid product name".into()));
    }
    let (idx, removed) = diff(m, current);
    let changed: Vec<String> = idx.iter().map(|&i| m.files[i].path.clone()).collect();
    let total: u64 = idx.iter().map(|&i| m.files[i].size).sum();

    // état existant : même version déjà complète -> rien à refaire ; plus ancienne -> remplacée ; plus récente -> refus
    if let Some(old) = staged(root, &m.product) {
        match version::compare(&old.manifest.version, &m.version) {
            Some(Ordering::Equal) if old.manifest.channel == m.channel && old.changed == changed && old.removed == removed => {
                on(Overall { done: total, total });
                return Ok(old);
            }
            Some(Ordering::Greater) => return Err(Error::Other(format!("a newer version ({}) is already ready", old.manifest.version))),
            _ => {}
        }
    }
    let pdir = product_dir(root, &m.product);
    let keep = files_dir(root, m);
    // supprime tout ce qui n'est pas la version visée (anciennes versions, ready.json périmé) ; garde les .part de la version visée pour la reprise
    let _ = fs::remove_file(ready_file(root, &m.product));
    if let Ok(rd) = fs::read_dir(&pdir) {
        for e in rd.flatten() {
            if e.path() != keep.parent().unwrap_or(&keep) {
                let p = e.path();
                let _ = if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
            }
        }
    }
    fs::create_dir_all(&keep)?;

    let mut before = 0u64;
    for &i in &idx {
        let f = &m.files[i];
        let dest = keep.join(&f.path);
        let mut attempt = 0;
        loop {
            let url = link(i)?;
            let r = download(&url, &dest, f.size, &f.sha256, cancel, |p: Progress| on(Overall { done: before + p.done, total }));
            match r {
                Err(Error::Http(401 | 403 | 410)) if attempt == 0 => attempt += 1,
                other => break other?,
            }
        }
        before += f.size;
    }
    let s = Staged { manifest: m.clone(), changed, removed, size: total, staged_at: now() };
    atomic_write(&ready_file(root, &m.product), &serde_json::to_vec_pretty(&s).map_err(|e| Error::Other(e.to_string()))?)?;
    Ok(s)
}
