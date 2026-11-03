use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{ErrorCode, Result, UserVisibleError};
use crate::oid::Oid;

/// 不透明续页令牌的内部载荷。
///
/// 对外只暴露编码后的字符串；offset 从不出现在公开接口中。
/// `generation` 绑定使 refs 变化后的旧游标立即失效。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CursorData {
    pub v: u8,
    pub view_key: String,
    pub generation: u64,
    pub after: String,
}

const CURSOR_VERSION: u8 = 1;

pub fn encode_cursor(view_key: &str, generation: u64, after: &Oid) -> String {
    let payload = CursorData {
        v: CURSOR_VERSION,
        view_key: view_key.to_owned(),
        generation,
        after: after.as_str().to_owned(),
    };
    URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).expect("cursor 序列化不会失败"))
}

pub fn decode_cursor(token: &str) -> Result<CursorData> {
    let invalid = |detail: String| {
        UserVisibleError::new(ErrorCode::CursorInvalid, "分页游标无效，请刷新图谱")
            .with_key("errors.paginationCursorInvalid")
            .with_detail(detail)
    };
    let bytes = URL_SAFE_NO_PAD
        .decode(token)
        .map_err(|e| invalid(format!("base64: {e}")))?;
    let payload: CursorData =
        serde_json::from_slice(&bytes).map_err(|e| invalid(format!("json: {e}")))?;
    if payload.v != CURSOR_VERSION {
        return Err(invalid(format!("版本不受支持: {}", payload.v)));
    }
    Oid::new(payload.after.clone()).map_err(|e| invalid(e.to_string()))?;
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid() -> Oid {
        Oid::new("a".repeat(40)).unwrap()
    }

    #[test]
    fn roundtrip() {
        let token = encode_cursor("head", 42, &oid());
        let decoded = decode_cursor(&token).unwrap();
        assert_eq!(decoded.view_key, "head");
        assert_eq!(decoded.generation, 42);
        assert_eq!(decoded.after, oid().as_str());
    }

    #[test]
    fn token_does_not_expose_offset() {
        let token = encode_cursor("head", 1, &oid());
        assert!(!token.contains("offset"));
        assert!(!token.contains("index"));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(
            decode_cursor("not-a-cursor").unwrap_err().code,
            ErrorCode::CursorInvalid
        );
    }
}
