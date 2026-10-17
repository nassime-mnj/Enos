//! Retrouver une installation Inno Setup (registre Windows) et lancer l'application.
use crate::{Error, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub dir: PathBuf,
    pub version: String,
}

/// Cherche `{app_id}_is1` dans la clé « Uninstall » (machine, puis utilisateur). Hors Windows : toujours None.
#[cfg(windows)]
pub fn locate(app_id: &str) -> Option<Found> {
    use winreg::{enums::*, RegKey};
    if app_id.is_empty() {
        return None;
    }
    let sub = format!(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{}_is1", app_id);
    for (root, flag) in [(HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY), (HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY), (HKEY_CURRENT_USER, KEY_READ)] {
        if let Ok(k) = RegKey::predef(root).open_subkey_with_flags(&sub, KEY_READ | flag) {
            let dir: std::result::Result<String, _> = k.get_value("InstallLocation");
            let ver: std::result::Result<String, _> = k.get_value("DisplayVersion");
            if let (Ok(d), Ok(v)) = (dir, ver) {
                return Some(Found { dir: PathBuf::from(d), version: v });
            }
        }
    }
    None
}

#[cfg(not(windows))]
pub fn locate(_app_id: &str) -> Option<Found> {
    None
}

/// Lance `dir/run` sans attendre sa fin ; refuse tout chemin qui sortirait du dossier d'installation.
pub fn spawn(dir: &Path, run: &str) -> Result<()> {
    let exe = dir.join(run);
    let (d, e) = (dir.canonicalize()?, exe.canonicalize().map_err(|_| Error::Other(format!("{run} introuvable dans {}", dir.display())))?);
    if !e.starts_with(&d) {
        return Err(Error::Other("chemin d'exécutable refusé".into()));
    }
    let mut c = Command::new(&e);
    c.current_dir(&d);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0000_0008 | 0x0000_0200);               // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP : survit à la fermeture du Launcher
    }
    c.spawn()?;
    Ok(())
}
