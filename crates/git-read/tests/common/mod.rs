//! git-read 集成测试公共夹具。
//!
//! 各测试二进制只用到其中一部分，未使用的条目不应产生 dead_code 告警。

#![allow(dead_code)]

use std::path::Path;

use git_read::GitReadModule;

pub fn module(path: &Path) -> GitReadModule {
    GitReadModule::open(path, None).expect("打开夹具仓库")
}
