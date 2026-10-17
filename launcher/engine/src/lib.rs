//! Moteur du Dual Pulse Launcher. Aucune dépendance à Tauri : testable seul (`cargo test -p dp-engine`).
//!
//! * `canon`    : JSON canonique, identique octet pour octet à celui du serveur Python (`json.dumps(sort_keys, separators, ensure_ascii=False)`)
//! * `manifest` : vérification Ed25519 + contrôle de forme (chemins sûrs, empreintes SHA-256)
//! * `download` : téléchargement reprenable (Range), vérification taille + SHA-256, renommage atomique
//! * `install`  : télécharge les fichiers d'un manifeste puis lance l'installeur silencieux
//! * `signals`, `procs`, `staging`, `apply`, `updater` : mises à jour en arrière-plan (mode « files ») : le Launcher télécharge dans un dossier de staging,
//!   signale à l'application par des fichiers-signal, puis remplace les fichiers (avec journal et retour arrière) une fois l'application fermée
//! * `store`    : état local (`installed.json`) ; `launch` : détection de l'installation (registre Windows) et lancement
pub mod apply;
pub mod canon;
pub mod download;
pub mod error;
pub mod install;
pub mod launch;
pub mod manifest;
pub mod procs;
pub mod signals;
pub mod staging;
pub mod store;
pub mod updater;
pub mod version;

pub use error::{Error, Result};
