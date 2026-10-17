//! Installation d'une version : téléchargement de chaque fichier du manifeste (avec nouveau lien si le précédent a expiré), puis lancement de l'installeur silencieux.
use crate::download::{download, Progress};
use crate::manifest::Manifest;
use crate::{Error, Result};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;

pub trait Runner {
    /// Lance l'installeur et attend sa fin ; retourne son code de sortie.
    fn run_installer(&self, exe: &Path, args: &[String]) -> Result<i32>;
}

pub struct SystemRunner;

impl Runner for SystemRunner {
    fn run_installer(&self, exe: &Path, args: &[String]) -> Result<i32> {
        let status = Command::new(exe).args(args).status()?;       // sous Windows : l'invite UAC de l'installeur apparaît ici
        Ok(status.code().unwrap_or(-1))
    }
}

/// Dossier de travail d'une version : <travail>/<produit>/<version>/
pub fn work_dir(base: &Path, m: &Manifest) -> PathBuf {
    base.join(&m.product).join(&m.version)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Overall {
    pub done: u64,
    pub total: u64,
}

/// `link(i)` retourne l'URL de téléchargement du fichier i (appelée de nouveau si le serveur répond 401/403/410 : lien expiré).
pub fn fetch_files(m: &Manifest, base: &Path, link: &mut dyn FnMut(usize) -> Result<String>, cancel: &AtomicBool, on: &mut dyn FnMut(Overall)) -> Result<PathBuf> {
    let dir = work_dir(base, m);
    let total: u64 = m.files.iter().map(|f| f.size).sum();
    let mut before = 0u64;
    for (i, f) in m.files.iter().enumerate() {
        let dest = dir.join(&f.path);
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
    Ok(dir)
}

pub fn run_installer(m: &Manifest, dir: &Path, runner: &dyn Runner) -> Result<()> {
    if m.launch.is_empty() {
        return Ok(());
    }
    let args: Vec<String> = m.silent_args.split_whitespace().map(String::from).collect();
    let code = runner.run_installer(&dir.join(&m.launch), &args)?;
    if code != 0 {
        return Err(Error::Other(format!("l'installeur s'est terminé avec le code {code} (installation annulée ou refusée)")));
    }
    Ok(())
}
