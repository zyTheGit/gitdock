//! 目录级对比（ADR-0025）：把两侧提交的完整树导出到同一临时容器，再交给外部工具。
//!
//! git-read 只负责遍历对象并回调；落盘与临时目录生命周期都留在 app 层，
//! 因此 read 模块仍然不写文件、不启动子进程。

use std::path::{Path, PathBuf};

use git_core::{ErrorCode, Oid, Result, UserVisibleError};
use git_read::{GitReadModule, TreeExport, TreeSink};

use super::config::ExternalToolConfig;
use super::{external, logging};

/// 导出两侧树并启动外部工具；任一步失败都删除本次临时容器。
pub fn run(
    read: &GitReadModule,
    tool: &ExternalToolConfig,
    base: &Oid,
    compare: &Oid,
    temp_root: &Path,
) -> Result<()> {
    let dir = external::prepare_dir(temp_root, "dirs")?;
    let left = dir.join("left");
    let right = dir.join("right");
    let stats = export_pair(read, base, compare, &left, &right).inspect_err(|_| {
        remove_best_effort(&dir);
    })?;
    logging::info(&format!(
        "目录对比导出：base {} 个文件 / {} 字节，compare {} 个文件 / {} 字节，跳过 {}",
        stats.0.files,
        stats.0.bytes,
        stats.1.files,
        stats.1.bytes,
        stats.0.skipped + stats.1.skipped
    ));
    external::launch_dirs(tool, &left, &right).inspect_err(|_| {
        remove_best_effort(&dir);
    })
}

fn export_pair(
    read: &GitReadModule,
    base: &Oid,
    compare: &Oid,
    left: &Path,
    right: &Path,
) -> Result<(TreeExport, TreeExport)> {
    let left_stats = read.export_tree(base, &mut FsSink::new(left))?;
    let right_stats = read.export_tree(compare, &mut FsSink::new(right))?;
    Ok((left_stats, right_stats))
}

fn remove_best_effort(dir: &Path) {
    match std::fs::remove_dir_all(dir) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => logging::warn(&format!(
            "清理目录对比临时目录失败：{}（{err}）",
            dir.display()
        )),
    }
}

/// 把 git-read 回调的条目写到目标目录；路径已由 read 层保证相对且不含 `..`。
struct FsSink {
    root: PathBuf,
}

impl FsSink {
    fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
        }
    }

    fn io_failed(err: std::io::Error) -> UserVisibleError {
        UserVisibleError::new(ErrorCode::Io, "写入目录对比临时文件失败")
            .with_key("errors.externalDirExportFailed")
            .with_detail(err.to_string())
    }
}

impl TreeSink for FsSink {
    fn entry_dir(&mut self, path: &str) -> Result<()> {
        std::fs::create_dir_all(self.root.join(path)).map_err(Self::io_failed)
    }

    fn entry_blob(
        &mut self,
        path: &str,
        data: &[u8],
        executable: bool,
        symlink: bool,
    ) -> Result<()> {
        let target = self.root.join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(Self::io_failed)?;
        }
        if symlink {
            write_symlink(&target, data)?;
        } else {
            std::fs::write(&target, data).map_err(Self::io_failed)?;
            set_executable(&target, executable)?;
        }
        Ok(())
    }
}

#[cfg(unix)]
fn write_symlink(target: &Path, data: &[u8]) -> Result<()> {
    use std::os::unix::ffi::OsStrExt;
    let link = std::ffi::OsStr::from_bytes(data);
    std::os::unix::fs::symlink(link, target).map_err(FsSink::io_failed)
}

/// Windows 普通用户建符号链接需要额外权限；写成内容为链接目标的文本文件，
/// 对比工具仍能看到指向，不会因权限不足中断整次导出。
#[cfg(not(unix))]
fn write_symlink(target: &Path, data: &[u8]) -> Result<()> {
    std::fs::write(target, data).map_err(FsSink::io_failed)
}

#[cfg(unix)]
fn set_executable(target: &Path, executable: bool) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let bits = if executable { 0o755 } else { 0o644 };
    std::fs::set_permissions(target, std::fs::Permissions::from_mode(bits))
        .map_err(FsSink::io_failed)
}

#[cfg(not(unix))]
fn set_executable(_target: &Path, _executable: bool) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fs_sink_writes_nested_paths() {
        let root = std::env::temp_dir().join(format!("dir-diff-sink-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mut sink = FsSink::new(&root);
        sink.entry_dir("src").expect("目录");
        sink.entry_blob("src/main.rs", b"fn main() {}", false, false)
            .expect("文件");
        assert_eq!(
            std::fs::read(root.join("src/main.rs")).expect("读取"),
            b"fn main() {}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
