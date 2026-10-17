//! Téléchargement reprenable. Le fichier est écrit dans `<dest>.part`, repris là où il s'est arrêté (en-tête Range), vérifié (taille + SHA-256),
//! puis renommé atomiquement : un fichier au nom définitif est TOUJOURS complet et conforme au manifeste.
use crate::{Error, Result};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub done: u64,
    pub total: u64,
}

pub fn part_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// https obligatoire (liens R2 présignés) ; http uniquement vers la machine locale (développement, tests).
fn url_allowed(url: &str) -> bool {
    url.starts_with("https://") || ["http://127.0.0.1", "http://localhost", "http://[::1]"].iter().any(|p| url.starts_with(p))
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(30)).redirects(3).build()
}

fn already_ok(dest: &Path, size: u64, sha256: &str) -> bool {
    fs::metadata(dest).map(|m| m.len() == size).unwrap_or(false) && sha256_file(dest).map(|h| h.eq_ignore_ascii_case(sha256)).unwrap_or(false)
}

pub fn download(url: &str, dest: &Path, size: u64, sha256: &str, cancel: &AtomicBool, mut on: impl FnMut(Progress)) -> Result<()> {
    if !url_allowed(url) {
        return Err(Error::Net("adresse de téléchargement refusée (https obligatoire)".into()));
    }
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir)?;
    }
    if already_ok(dest, size, sha256) {
        on(Progress { done: size, total: size });
        return Ok(());
    }
    let part = part_path(dest);
    let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have > size {
        let _ = fs::remove_file(&part);
        have = 0;
    }
    if have == size && size > 0 {
        // fichier complet mais pas encore renommé : on vérifie directement
    } else {
        let mut req = agent().get(url);
        if have > 0 {
            req = req.set("Range", &format!("bytes={have}-"));
        }
        let resp = match req.call() {
            Ok(r) => r,
            Err(ureq::Error::Status(416, _)) => {                 // plage impossible : on repart de zéro
                let _ = fs::remove_file(&part);
                return download(url, dest, size, sha256, cancel, on);
            }
            Err(ureq::Error::Status(code, _)) => return Err(Error::Http(code)),
            Err(e) => return Err(Error::Net(e.to_string())),
        };
        let resumed = resp.status() == 206;
        if !resumed {
            have = 0;                                              // le serveur a ignoré Range : on réécrit tout
        }
        let mut out = OpenOptions::new().create(true).write(true).append(resumed).truncate(!resumed).open(&part)?;
        let mut body = resp.into_reader();
        let mut buf = vec![0u8; 64 * 1024];
        let mut done = have;
        on(Progress { done, total: size });
        loop {
            if cancel.load(Ordering::Relaxed) {
                out.flush()?;
                return Err(Error::Cancelled);                      // le .part est conservé : la reprise est possible
            }
            let n = body.read(&mut buf).map_err(|e| Error::Net(e.to_string()))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])?;
            done += n as u64;
            on(Progress { done: done.min(size), total: size });
        }
        out.flush()?;
    }
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if fs::metadata(&part)?.len() != size {
        return Err(Error::Size(name));                             // coupure : on garde le .part pour reprendre
    }
    if !sha256_file(&part)?.eq_ignore_ascii_case(sha256) {
        let _ = fs::remove_file(&part);
        return Err(Error::Hash(name));
    }
    if dest.exists() {
        fs::remove_file(dest)?;
    }
    fs::rename(&part, dest)?;
    Ok(())
}
