//! 远程失败分类：只按 Git stderr 的稳定片段归类，不猜测具体远端。

use git_core::WriteKind;

/// 按 stderr 稳定片段把远程失败映射为（message, i18n key）。
pub(crate) fn remote_failure(
    kind: WriteKind,
    stderr: &str,
) -> Option<(&'static str, &'static str)> {
    let lower = stderr.to_lowercase();
    let auth = lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("terminal prompts disabled")
        || lower.contains("permission denied (publickey)");
    if auth {
        return Some((
            "远程认证失败；本应用不接收密码。请在内置终端完成一次 fetch/push 授权，或配置系统凭据管理器 / SSH agent 后重试",
            "errors.outcomeRemoteAuthFailed",
        ));
    }
    match kind {
        WriteKind::DeleteBranchRemote
            if lower.contains("remote ref does not exist") =>
        {
            Some((
                "远程分支不存在或已删除，无需再删除",
                "errors.outcomeRemoteRefMissing",
            ))
        }
        WriteKind::Pull if lower.contains("not possible to fast-forward") => Some((
            "远端有本地没有的提交，pull --ff-only 无法快进；请先 fetch，并在终端 merge/rebase（批次 5）",
            "errors.outcomePullNotFastForward",
        )),
        WriteKind::Push
            if lower.contains("non-fast-forward")
                || lower.contains("failed to push some refs")
                || lower.contains("rejected") =>
        {
            Some((
                "远端拒绝了推送（可能非快进或 hook 拒绝）；本应用不提供 force push，请在终端处理",
                "errors.outcomePushRejected",
            ))
        }
        _ => None,
    }
}
