//! read_head_message 的行为验证：HEAD 消息读取与 unborn 降级。

use git_read::GitReadModule;
use test_support::{fixtures, git_ok, init_temp_repo, write};

#[test]
fn head_message_returns_current_head_body() {
    let set = fixtures();
    let read = GitReadModule::open(&set.linear(), None).expect("打开夹具仓库");
    // 夹具 linear 的 HEAD 消息由 fixture-gen 写入；与 `git log -1 --pretty=%B` 对照。
    // message_raw 保留原始消息体的末尾换行，git_output 的 trim 剥掉了它，两侧归一化后比较。
    let dir = &set.linear();
    let expected = git_ok(dir, &["log", "-1", "--pretty=%B"]);
    let message = read.read_head_message().expect("读取 HEAD 消息");
    let actual = message.as_deref().map(|value| value.trim_end_matches('\n'));
    assert_eq!(actual, Some(expected.as_str()));
}

#[test]
fn head_message_is_none_for_unborn_head() {
    let temp = init_temp_repo();
    let read = GitReadModule::open(temp.path(), None).expect("打开空仓库");
    assert_eq!(read.read_head_message().expect("读取 unborn HEAD"), None);
}

#[test]
fn head_message_follows_commit_and_amend() {
    // 与写路径协同：新提交后消息可读，git commit --amend -F 后消息更新。
    let temp = init_temp_repo();
    let dir = temp.path();
    write(&dir.join("a.txt"), "one\n");
    git_ok(dir, &["add", "-A"]);
    git_ok(dir, &["commit", "-m", "第一条"]);
    let read = GitReadModule::open(dir, None).expect("打开仓库");
    assert_eq!(
        read.read_head_message().expect("读取消息").as_deref(),
        Some("第一条\n")
    );

    // 经临时文件 amend（写路径的 --file 机制），消息随后可读。
    let msg_file = dir.join(".git").join("gitdock-test-amend-msg");
    write(&msg_file, "改后的消息\n");
    git_ok(
        dir,
        &["commit", "--amend", "-F", msg_file.to_str().unwrap()],
    );
    assert_eq!(
        read.read_head_message()
            .expect("读取 amend 后消息")
            .as_deref(),
        Some("改后的消息\n")
    );
}
