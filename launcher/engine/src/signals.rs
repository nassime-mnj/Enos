//! Fichiers-signal entre le Launcher et l'application (E.N.O.S., etc.). Contrat :
//!
//! Dossier : `<base>/<produit>/` ; `<base>` = `DP_SIGNALS_DIR`, sinon Windows `%LOCALAPPDATA%\DualPulse\signals`,
//! sinon `$XDG_DATA_HOME/DualPulse/signals` ou `~/.local/share/DualPulse/signals`. Produit : `^[a-z0-9][a-z0-9-]{0,30}$`.
//! Tous les fichiers sont du JSON UTF-8, écrits ATOMIQUEMENT (`.tmp` puis renommage), ≤ 16 Ko ; lecture tolérante (absent / corrompu = absent).
//!
//! * `update-ready.json`   (Launcher -> application) : `{product, channel, version, notes, staged_at, size}`
//! * `running.json`        (application -> Launcher) : `{pid, started_at, exe}` ; périmé si le PID n'existe plus ou n'a pas ce nom -> ignoré
//! * `update-apply.json`   (application -> Launcher) : `{requested_at, pid}` ; périmé après 10 min -> ignoré
//! * `update-applied.json` (Launcher -> application, informatif) : `{version, applied_at}`
use crate::{store::atomic_write, Error, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_SIGNAL_BYTES: u64 = 16 * 1024;
pub const APPLY_TTL_SECS: u64 = 10 * 60;
const READY: &str = "update-ready.json";
const RUNNING: &str = "running.json";
const APPLY: &str = "update-apply.json";
const APPLIED: &str = "update-applied.json";

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// `^[a-z0-9][a-z0-9-]{0,30}$`
pub fn valid_product(p: &str) -> bool {
    let b = p.as_bytes();
    !b.is_empty() && b.len() <= 31 && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit()) && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

/// Dossier de base des signaux (voir l'en-tête du module).
pub fn base_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("DP_SIGNALS_DIR").filter(|v| !v.is_empty()) {
        return PathBuf::from(d);
    }
    #[cfg(windows)]
    {
        let root = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("AppData").join("Local"));
        root.join("DualPulse").join("signals")
    }
    #[cfg(not(windows))]
    {
        let root = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".local").join("share"));
        root.join("DualPulse").join("signals")
    }
}

/// Dossier des signaux d'un produit (None si le nom est invalide).
pub fn dir(product: &str) -> Option<PathBuf> {
    valid_product(product).then(|| base_dir().join(product))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Ready {
    pub product: String,
    pub channel: String,
    pub version: String,
    #[serde(default)]
    pub notes: String,
    pub staged_at: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Running {
    pub pid: u32,
    #[serde(default)]
    pub started_at: u64,
    pub exe: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Apply {
    pub requested_at: u64,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppliedInfo {
    pub version: String,
    pub applied_at: u64,
}

/// Accès aux signaux sous un dossier de base donné (les tests passent un dossier temporaire ; l'application réelle : `Signals::from_env()`).
#[derive(Debug, Clone)]
pub struct Signals {
    base: PathBuf,
}

impl Signals {
    pub fn new(base: impl Into<PathBuf>) -> Signals {
        Signals { base: base.into() }
    }

    pub fn from_env() -> Signals {
        Signals::new(base_dir())
    }

    pub fn base(&self) -> &Path {
        &self.base
    }

    pub fn dir(&self, product: &str) -> Option<PathBuf> {
        valid_product(product).then(|| self.base.join(product))
    }

    fn file(&self, product: &str, name: &str) -> Option<PathBuf> {
        self.dir(product).map(|d| d.join(name))
    }

    fn write<T: Serialize>(&self, product: &str, name: &str, v: &T) -> Result<()> {
        let dir = self.dir(product).ok_or_else(|| Error::Other(format!("invalid product name: {product}")))?;
        let bytes = serde_json::to_vec(v).map_err(|e| Error::Other(e.to_string()))?;
        if bytes.len() as u64 > MAX_SIGNAL_BYTES {
            return Err(Error::Other("signal file too large".into()));
        }
        fs::create_dir_all(&dir)?;
        atomic_write(&dir.join(name), &bytes)
    }

    fn read<T: DeserializeOwned>(&self, product: &str, name: &str) -> Option<T> {
        let f = self.file(product, name)?;
        let meta = fs::symlink_metadata(&f).ok()?;
        if !meta.is_file() || meta.len() > MAX_SIGNAL_BYTES {
            return None;
        }
        serde_json::from_slice(&fs::read(&f).ok()?).ok()
    }

    fn clear(&self, product: &str, name: &str) {
        if let Some(f) = self.file(product, name) {
            let _ = fs::remove_file(f);
        }
    }

    // ---- update-ready.json
    pub fn write_ready(&self, r: &Ready) -> Result<()> {
        let mut r = r.clone();
        if r.notes.len() > 8000 {
            let mut cut = 8000;
            while !r.notes.is_char_boundary(cut) {
                cut -= 1;
            }
            r.notes.truncate(cut);
        }
        if r.product.len() > 64 || r.channel.len() > 64 || r.version.len() > 64 {
            return Err(Error::Other("fields too long".into()));
        }
        self.write(&r.product.clone(), READY, &r)
    }
    pub fn read_ready(&self, product: &str) -> Option<Ready> {
        self.read(product, READY)
    }
    pub fn clear_ready(&self, product: &str) {
        self.clear(product, READY)
    }

    // ---- running.json (écrit par l'application ; la version Launcher sert aux tests)
    pub fn write_running(&self, product: &str, r: &Running) -> Result<()> {
        self.write(product, RUNNING, r)
    }
    /// Retourne le signal seulement s'il est frais : PID vivant et de ce nom. Sinon il est périmé et ignoré.
    pub fn read_running(&self, product: &str) -> Option<Running> {
        let r: Running = self.read(product, RUNNING)?;
        let simple = !r.exe.is_empty() && r.exe.len() < 100 && !r.exe.contains(['/', '\\']);
        (simple && crate::procs::matches_name(r.pid, &r.exe)).then_some(r)
    }
    pub fn clear_running(&self, product: &str) {
        self.clear(product, RUNNING)
    }

    // ---- update-apply.json
    pub fn write_apply(&self, product: &str, a: &Apply) -> Result<()> {
        self.write(product, APPLY, a)
    }
    /// Lecture brute, sans test de péremption.
    pub fn read_apply_raw(&self, product: &str) -> Option<Apply> {
        self.read(product, APPLY)
    }
    /// Demande valide à l'instant `now` (moins de 10 minutes ; une date légèrement dans le futur est tolérée).
    pub fn read_apply(&self, product: &str, now: u64) -> Option<Apply> {
        self.read_apply_raw(product).filter(|a| now.saturating_sub(a.requested_at) <= APPLY_TTL_SECS && a.requested_at <= now + 300)
    }
    pub fn clear_apply(&self, product: &str) {
        self.clear(product, APPLY)
    }

    // ---- update-applied.json
    pub fn write_applied(&self, product: &str, version: &str, applied_at: u64) -> Result<()> {
        self.write(product, APPLIED, &AppliedInfo { version: version.to_string(), applied_at })
    }
    pub fn read_applied(&self, product: &str) -> Option<AppliedInfo> {
        self.read(product, APPLIED)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn product_names() {
        for ok in ["enos", "terna", "a", "a-b-1", &"a".repeat(31)] {
            assert!(valid_product(ok), "{ok}");
        }
        for bad in ["", "-a", "A", "a_b", "../x", "a/b", "a\\b", "a.b", " a", "a b", &"a".repeat(32), "é", "enos\0"] {
            assert!(!valid_product(bad), "{bad:?}");
        }
    }

    #[test]
    fn env_override_wins() {
        // un seul test touche à la variable d'environnement (les autres passent par Signals::new)
        std::env::set_var("DP_SIGNALS_DIR", "/tmp/dp-sig-test");
        assert_eq!(base_dir(), PathBuf::from("/tmp/dp-sig-test"));
        assert_eq!(dir("enos"), Some(PathBuf::from("/tmp/dp-sig-test/enos")));
        assert_eq!(dir("../x"), None);
        std::env::remove_var("DP_SIGNALS_DIR");
    }
}
