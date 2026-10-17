//! Manifeste de version signé : vérification Ed25519 (sur le JSON canonique) puis contrôle de forme.
//! Règles identiques à celles du serveur (`app/launcher/manifests.py`) : le Launcher ne fait jamais confiance au serveur, il re-vérifie tout.
use crate::{canon, Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileEntry {
    pub path: String,
    pub sha256: String,
    pub size: u64,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Manifest {
    pub product: String,
    pub channel: String,
    pub version: String,
    #[serde(default)]
    pub released: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub min_launcher: String,
    /// fichier à lancer après le téléchargement (l'installeur)
    #[serde(default)]
    pub launch: String,
    #[serde(default)]
    pub silent_args: String,
    /// identifiant Inno Setup (AppId) pour retrouver l'installation, et exécutable à lancer ensuite
    #[serde(default)]
    pub app_id: String,
    #[serde(default)]
    pub run: String,
    /// « installer » (défaut) : `launch` est un installeur silencieux ; « files » : les fichiers sont ceux de l'application elle-même
    #[serde(default = "default_mode")]
    pub mode: String,
    pub files: Vec<FileEntry>,
}

pub const MODE_INSTALLER: &str = "installer";
pub const MODE_FILES: &str = "files";

fn default_mode() -> String {
    MODE_INSTALLER.into()
}

/// Données de l'utilisateur : jamais écrasées ni supprimées par une mise à jour (mode « files »). Comparaison insensible à la casse.
pub const PROTECTED_DIRS: &[&str] = &["data"];
pub const PROTECTED_FILES: &[&str] = &["nasko_config.json"];

/// Vrai si `path` (relatif, séparateur `/`) est une donnée utilisateur protégée ou un fichier interne du mécanisme de mise à jour.
pub fn is_protected(path: &str) -> bool {
    let low = path.to_ascii_lowercase();
    let first = low.split('/').next().unwrap_or("");
    PROTECTED_DIRS.contains(&first)
        || PROTECTED_FILES.contains(&low.as_str())
        || low.split('/').any(|c| c.starts_with(".update-"))
        || low.ends_with(".update-new")
        || low.ends_with(".part")
}

pub fn verify_signature(manifest: &Value, signature_b64: &str, pubkey_b64: &str) -> Result<()> {
    let pk: [u8; 32] = STANDARD.decode(pubkey_b64.trim()).map_err(|_| Error::BadSignature)?.try_into().map_err(|_| Error::BadSignature)?;
    let sig: [u8; 64] = STANDARD.decode(signature_b64.trim()).map_err(|_| Error::BadSignature)?.try_into().map_err(|_| Error::BadSignature)?;
    let key = VerifyingKey::from_bytes(&pk).map_err(|_| Error::BadSignature)?;
    key.verify_strict(&canon::canonical(manifest), &Signature::from_bytes(&sig)).map_err(|_| Error::BadSignature)
}

pub(crate) fn safe_path(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 1000
        && !p.starts_with('/')
        && p.split('/').all(|c| {
            !c.is_empty()
                && c != ".."
                && c.as_bytes()[0].is_ascii_alphanumeric()
                && c.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b' ' | b'-'))
        })
}

/// Vérifie la signature PUIS la forme ; ne retourne un manifeste que s'il est digne de confiance.
pub fn open(manifest: &Value, signature_b64: &str, pubkey_b64: &str) -> Result<Manifest> {
    verify_signature(manifest, signature_b64, pubkey_b64)?;
    parse(manifest)
}

pub fn parse(manifest: &Value) -> Result<Manifest> {
    let m: Manifest = serde_json::from_value(manifest.clone()).map_err(|e| Error::Manifest(e.to_string()))?;
    if crate::version::parse(&m.version).is_none() {
        return Err(Error::Manifest("version invalide".into()));
    }
    if m.files.is_empty() || m.files.len() > 5000 {
        return Err(Error::Manifest("liste de fichiers invalide".into()));
    }
    for f in &m.files {
        if !safe_path(&f.path) {
            return Err(Error::Manifest(format!("chemin refusé : {}", f.path)));
        }
        if f.sha256.len() != 64 || !f.sha256.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            return Err(Error::Manifest(format!("empreinte invalide pour {}", f.path)));
        }
    }
    if !m.launch.is_empty() && !m.files.iter().any(|f| f.path == m.launch) {
        return Err(Error::Manifest("« launch » doit désigner un fichier du manifeste".into()));
    }
    if !m.app_id.is_empty() && !m.app_id.bytes().all(|b| b.is_ascii_hexdigit() || matches!(b, b'{' | b'}' | b'-')) {
        return Err(Error::Manifest("app_id invalide".into()));
    }
    if !m.run.is_empty() && !safe_path(&m.run) {
        return Err(Error::Manifest("« run » refusé".into()));
    }
    match m.mode.as_str() {
        MODE_INSTALLER => {}
        MODE_FILES => {
            if m.run.is_empty() || !m.files.iter().any(|f| f.path == m.run) {
                return Err(Error::Manifest("mode « files » : « run » doit désigner un fichier du manifeste".into()));
            }
            if !m.launch.is_empty() {
                return Err(Error::Manifest("mode « files » : « launch » doit rester vide".into()));
            }
            if let Some(f) = m.files.iter().find(|f| is_protected(&f.path)) {
                return Err(Error::Manifest(format!("chemin protégé (données de l'utilisateur) : {}", f.path)));
            }
            let mut seen = std::collections::HashSet::new();
            if let Some(f) = m.files.iter().find(|f| !seen.insert(f.path.to_ascii_lowercase())) {
                return Err(Error::Manifest(format!("chemin en double : {}", f.path)));
            }
        }
        other => return Err(Error::Manifest(format!("mode inconnu : {other}"))),
    }
    Ok(m)
}
