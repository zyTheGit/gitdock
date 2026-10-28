//! git-read 内部共用的小工具：OID 转换与文本降级。

use git_core::{ErrorCode, Oid, Result, UserVisibleError};

pub(crate) fn gix_oid(oid: &Oid) -> Result<gix::hash::ObjectId> {
    gix::hash::ObjectId::from_hex(oid.as_str().as_bytes()).map_err(|e| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "OID 无效").with_detail(e.to_string())
    })
}

pub(crate) fn oid_from_gix(id: &gix::oid) -> Oid {
    Oid::new(id.to_string()).expect("gix 生成的 OID 长度合法")
}

pub(crate) fn oid_from_id(id: &gix::Id<'_>) -> Oid {
    Oid::new(id.detach().to_string()).expect("gix 生成的 OID 长度合法")
}

fn internal(err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, "读取 Git 对象失败").with_detail(err.to_string())
}

pub(crate) fn find_commit<'repo>(
    repo: &'repo gix::Repository,
    oid: &Oid,
) -> Result<gix::Commit<'repo>> {
    let id = gix_oid(oid)?;
    repo.find_commit(id).map_err(internal)
}

pub(crate) fn find_tree<'repo>(
    repo: &'repo gix::Repository,
    oid: &Oid,
) -> Result<gix::Tree<'repo>> {
    let id = gix_oid(oid)?;
    repo.find_tree(id).map_err(internal)
}

/// 读取原始对象内容；不存在时返回 None（例如 gitlink 指向未拉取的子模块提交）。
pub(crate) fn try_object_bytes(repo: &gix::Repository, oid: &Oid) -> Option<Vec<u8>> {
    let id = gix_oid(oid).ok()?;
    repo.find_object(id).ok().map(|object| object.detach().data)
}

/// 解析 `SignatureRef.time` 的原始文本（`"1700000000 +0800"`）。
pub(crate) fn raw_time_seconds(raw: &str) -> i64 {
    raw.split_whitespace()
        .next()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0)
}

#[derive(Debug, Clone)]
pub(crate) struct DecodedText {
    pub text: String,
    pub binary: bool,
    /// 内容不是合法 UTF-8，已做有损解码。
    pub encoding_fallback: bool,
}

/// 将 blob 内容转为可 diff 的文本；二进制（前 8KB 含 NUL）不尝试解码。
pub(crate) fn decode_text(data: &[u8]) -> DecodedText {
    if data.iter().take(8000).any(|b| *b == 0) {
        return DecodedText {
            text: String::new(),
            binary: true,
            encoding_fallback: false,
        };
    }
    // UTF-16 BOM 常见于 Windows 项目，按 BOM 解码并标记降级。
    if data.starts_with(&[0xFF, 0xFE]) {
        return DecodedText {
            text: decode_utf16(&data[2..], true),
            binary: false,
            encoding_fallback: true,
        };
    }
    if data.starts_with(&[0xFE, 0xFF]) {
        return DecodedText {
            text: decode_utf16(&data[2..], false),
            binary: false,
            encoding_fallback: true,
        };
    }
    match std::str::from_utf8(data) {
        Ok(text) => DecodedText {
            text: text.to_owned(),
            binary: false,
            encoding_fallback: false,
        },
        Err(_) => DecodedText {
            text: String::from_utf8_lossy(data).into_owned(),
            binary: false,
            encoding_fallback: true,
        },
    }
}

// workspace MSRV 为 1.85，as_chunks 需要更新的工具链，这里保留 chunks_exact。
#[allow(clippy::chunks_exact_to_as_chunks)]
fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

pub(crate) fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}
