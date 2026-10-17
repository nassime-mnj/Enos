use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("network error: {0}")]
    Net(String),
    #[error("the server responded with {0}")]
    Http(u16),
    #[error("invalid manifest signature")]
    BadSignature,
    #[error("invalid manifest: {0}")]
    Manifest(String),
    #[error("SHA-256 checksum mismatch for {0}: the file is corrupted or has been modified")]
    Hash(String),
    #[error("incorrect size for {0}")]
    Size(String),
    #[error("operation cancelled")]
    Cancelled,
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;
