//! 图片预览白名单与 data URI 构造（ADR-0030）。
//!
//! 只服务于只读 diff 预览：按后缀给媒体类型，内容原样 base64 编码。
//! 前端必须用 `<img src="data:...">` 渲染（SVG 尤其不得内联为 DOM），
//! CSP 的 `img-src` 需要包含 `data:`。

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// 支持预览的图片后缀到媒体类型映射；未知后缀返回 None。
pub fn image_media_type(path: &str) -> Option<&'static str> {
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// 图片预览用的规范化后缀（小写）；非图片返回 None。
pub fn image_kind(path: &str) -> Option<String> {
    image_media_type(path)?;
    Some(path.rsplit_once('.')?.1.to_ascii_lowercase())
}

/// 把图片字节编码成 `data:<mime>;base64,...`；只在已通过大小上限时调用。
pub fn image_data_uri(media_type: &str, bytes: &[u8]) -> String {
    format!("data:{media_type};base64,{}", STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_extensions_map_to_media_types() {
        assert_eq!(image_media_type("a/b/logo.PNG"), Some("image/png"));
        assert_eq!(image_media_type("photo.jpeg"), Some("image/jpeg"));
        assert_eq!(image_media_type("photo.jpg"), Some("image/jpeg"));
        assert_eq!(image_media_type("anim.webp"), Some("image/webp"));
        assert_eq!(image_media_type("anim.gif"), Some("image/gif"));
        assert_eq!(image_media_type("icon.svg"), Some("image/svg+xml"));
        assert_eq!(image_media_type("readme.md"), None);
        assert_eq!(image_media_type("no-extension"), None);
        assert_eq!(image_kind("icon.SVG").as_deref(), Some("svg"));
    }

    #[test]
    fn data_uri_carries_media_type_and_payload() {
        assert_eq!(
            image_data_uri("image/png", b"hi"),
            "data:image/png;base64,aGk="
        );
    }
}
