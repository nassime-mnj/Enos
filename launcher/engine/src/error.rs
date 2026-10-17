use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("erreur de fichier : {0}")]
    Io(#[from] std::io::Error),
    #[error("erreur réseau : {0}")]
    Net(String),
    #[error("le serveur a répondu {0}")]
    Http(u16),
    #[error("signature du manifeste invalide")]
    BadSignature,
    #[error("manifeste invalide : {0}")]
    Manifest(String),
    #[error("empreinte SHA-256 incorrecte pour {0} : fichier corrompu ou modifié")]
    Hash(String),
    #[error("taille incorrecte pour {0}")]
    Size(String),
    #[error("opération annulée")]
    Cancelled,
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;
