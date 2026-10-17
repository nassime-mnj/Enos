//! État local du Launcher : `installed.json` (produit -> version, canal, dossier), écrit de façon atomique.
use crate::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Installed {
    pub version: String,
    pub channel: String,
    #[serde(default)]
    pub dir: String,
    #[serde(default)]
    pub run: String,
    #[serde(default)]
    pub installed_at: u64,
    /// chemin relatif -> SHA-256 des fichiers installés par le Launcher (mode « files ») ; vide si inconnu
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    /// « installer » (défaut) ou « files »
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_mode() -> String {
    crate::manifest::MODE_INSTALLER.into()
}

/// Réglages du Launcher (`settings.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Settings {
    /// mises à jour automatiques en arrière-plan (le Launcher reste actif dans la zone de notification)
    #[serde(default)]
    pub auto_update: bool,
    /// minutes entre deux vérifications (5 à 1440)
    #[serde(default = "default_interval")]
    pub check_interval_min: u32,
}

fn default_interval() -> u32 {
    30
}

impl Default for Settings {
    fn default() -> Self {
        Settings { auto_update: false, check_interval_min: 30 }
    }
}

impl Settings {
    pub fn clamped(mut self) -> Settings {
        self.check_interval_min = self.check_interval_min.clamp(5, 1440);
        self
    }
}

pub struct Store {
    file: PathBuf,
    settings: PathBuf,
}

impl Store {
    pub fn new(dir: &Path) -> Result<Store> {
        fs::create_dir_all(dir)?;
        Ok(Store { file: dir.join("installed.json"), settings: dir.join("settings.json") })
    }

    pub fn all(&self) -> BTreeMap<String, Installed> {
        fs::read(&self.file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn get(&self, product: &str) -> Option<Installed> {
        self.all().remove(product)
    }

    pub fn set(&self, product: &str, v: Installed) -> Result<()> {
        let mut all = self.all();
        all.insert(product.to_string(), v);
        self.write(&all)
    }

    pub fn remove(&self, product: &str) -> Result<()> {
        let mut all = self.all();
        all.remove(product);
        self.write(&all)
    }

    fn write(&self, all: &BTreeMap<String, Installed>) -> Result<()> {
        atomic_write(&self.file, &serde_json::to_vec_pretty(all).expect("json"))
    }

    /// Réglages ; fichier absent ou illisible = valeurs par défaut.
    pub fn settings(&self) -> Settings {
        fs::read(&self.settings).ok().and_then(|b| serde_json::from_slice::<Settings>(&b).ok()).unwrap_or_default().clamped()
    }

    pub fn set_settings(&self, s: Settings) -> Result<Settings> {
        let s = s.clamped();
        atomic_write(&self.settings, &serde_json::to_vec_pretty(&s).expect("json"))?;
        Ok(s)
    }
}

/// Écrit `<fichier>.tmp` puis le renomme : jamais de fichier à moitié écrit.
pub(crate) fn atomic_write(file: &Path, bytes: &[u8]) -> Result<()> {
    let mut name = file.file_name().unwrap_or_default().to_owned();
    name.push(".tmp");
    let tmp = file.with_file_name(name);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, file)?;
    Ok(())
}
