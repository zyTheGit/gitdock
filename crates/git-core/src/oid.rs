use serde::{Deserialize, Serialize};
use std::fmt;

/// Git 对象 ID。长度由仓库对象格式决定，不得假设固定 40 位。
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Oid(String);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OidError(pub String);

impl fmt::Display for OidError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for OidError {}

impl Oid {
    pub fn new(value: impl Into<String>) -> Result<Self, OidError> {
        let value = value.into();
        if !value.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(OidError(format!("OID 含非十六进制字符: {value}")));
        }
        let len = value.len();
        if len != 40 && len != 64 {
            return Err(OidError(format!(
                "OID 长度必须为 40（SHA-1）或 64（SHA-256），实际为 {len}"
            )));
        }
        Ok(Self(value.to_ascii_lowercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// 用于显示的短 OID；不会超过完整长度。
    pub fn short(&self, n: usize) -> &str {
        let end = n.min(self.0.len());
        &self.0[..end]
    }
}

impl fmt::Display for Oid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectFormat {
    Sha1,
    Sha256,
}

impl ObjectFormat {
    pub fn hex_len(self) -> usize {
        match self {
            Self::Sha1 => 40,
            Self::Sha256 => 64,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sha1 => "sha1",
            Self::Sha256 => "sha256",
        }
    }

    pub fn from_hex_len(len: usize) -> Option<Self> {
        match len {
            40 => Some(Self::Sha1),
            64 => Some(Self::Sha256),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_sha1_and_sha256_lengths() {
        assert!(Oid::new("a".repeat(40)).is_ok());
        assert!(Oid::new("b".repeat(64)).is_ok());
        assert!(Oid::new("c".repeat(39)).is_err());
        assert!(Oid::new("z".repeat(40)).is_err());
    }

    #[test]
    fn normalizes_to_lowercase() {
        let oid = Oid::new("A".repeat(40)).unwrap();
        assert_eq!(oid.as_str(), "a".repeat(40));
    }

    #[test]
    fn short_oid_never_overflows() {
        let oid = Oid::new("a".repeat(40)).unwrap();
        assert_eq!(oid.short(7).len(), 7);
        assert_eq!(oid.short(100).len(), 40);
    }
}
