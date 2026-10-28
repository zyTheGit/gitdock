use std::path::PathBuf;

fn main() {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            manifest.join("../../target/test-fixtures")
        });
    match fixture_gen::generate_all(&root) {
        Ok(set) => {
            println!("夹具已生成: {}", set.root.display());
        }
        Err(err) => {
            eprintln!("生成夹具失败: {err}");
            std::process::exit(1);
        }
    }
}
