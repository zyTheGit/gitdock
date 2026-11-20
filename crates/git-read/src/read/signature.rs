//! 提交签名头类型标注（ADR-0034 §4）。
//!
//! 只读、不验签：从 commit 的 `gpgsig` / `gpgsig-sha256` 附加头读取签名体首行，
//! 归类为 gpg / ssh / x509 / unknown。签名体本身绝不透传前端，也不缓存。

/// 按签名体首行判断签名类型；无法识别时返回 `unknown`。
pub(crate) fn classify(first_line: &str) -> &'static str {
    let line = first_line.trim();
    if line.starts_with("-----BEGIN PGP SIGNATURE-----") {
        "gpg"
    } else if line.starts_with("-----BEGIN SSH SIGNATURE-----") {
        "ssh"
    } else if line.starts_with("-----BEGIN SIGNED MESSAGE-----")
        || line.starts_with("-----BEGIN CERTIFICATE-----")
    {
        "x509"
    } else {
        "unknown"
    }
}

/// 读取提交的签名类型；无签名头或解码失败时返回 None。
pub(crate) fn signature_kind(commit: &gix::Commit<'_>) -> Option<String> {
    let decoded = commit.decode().ok()?;
    let value = decoded
        .extra_headers()
        .find("gpgsig")
        .or_else(|| decoded.extra_headers().find("gpgsig-sha256"))?;
    let bytes: &[u8] = value;
    let first_line = bytes.split(|byte| *byte == b'\n').next().unwrap_or(bytes);
    Some(classify(&String::from_utf8_lossy(first_line)).to_owned())
}

#[cfg(test)]
mod tests {
    use super::classify;

    #[test]
    fn classify_signature_body_first_lines() {
        assert_eq!(classify("-----BEGIN PGP SIGNATURE-----"), "gpg");
        assert_eq!(classify("  -----BEGIN PGP SIGNATURE-----  "), "gpg");
        assert_eq!(classify("-----BEGIN SSH SIGNATURE-----"), "ssh");
        assert_eq!(classify("-----BEGIN SIGNED MESSAGE-----"), "x509");
        assert_eq!(classify("-----BEGIN CERTIFICATE-----"), "x509");
        assert_eq!(classify("-----BEGIN UNKNOWN SIGNATURE-----"), "unknown");
        assert_eq!(classify(""), "unknown");
    }
}
