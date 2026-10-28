import { useEffect, useState } from "react";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { GateReportDto } from "../../shared/types";

interface BranchDescriptionDialogProps {
  branch: string;
  onCancel: () => void;
  onSaved: (message: string) => void;
}

/** 分支描述编辑器：写入 local config，留空保存等价于删除。 */
export function BranchDescriptionDialog({
  branch,
  onCancel,
  onSaved,
}: BranchDescriptionDialogProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [shared, setShared] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gate, setGate] = useState<GateReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ipc
      .readBranchDescription(branch)
      .then((dto) => {
        if (!cancelled) {
          setText(dto.description);
          setShared(dto.shared_across_worktrees);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(errorText(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [branch]);

  const save = async () => {
    if (saving || loading || loadError) {
      return;
    }
    setSaving(true);
    setGate(null);
    setError(null);
    try {
      const report = await ipc.validateWrite({
        kind: "set_branch_description",
        branch,
        description: text,
      });
      setGate(report);
      if (!report.ok) {
        return;
      }
      const outcome = await ipc.executeWrite({
        kind: "set_branch_description",
        branch,
        description: text,
      });
      if (outcome.status === "succeeded") {
        onSaved(outcome.message);
        return;
      }
      setError(outcome.stderr?.trim() || outcome.message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="confirm-dialog description-dialog">
        <header>
          <h2>编辑分支描述</h2>
          <button className="detail-close" onClick={onCancel} aria-label="关闭描述编辑器">
            ×
          </button>
        </header>

        <section>
          <p className="confirm-target">
            <span className="mono">{branch}</span>
          </p>
          <p className="muted confirm-hint">
            写入 <span className="mono">git config --local branch.{branch}.description</span>
            ；留空保存将删除该键。
          </p>
          {loading ? (
            <p className="muted">正在读取现有描述…</p>
          ) : (
            <textarea
              className="description-input"
              rows={5}
              autoFocus
              disabled={saving || Boolean(loadError)}
              placeholder="为该分支写一段说明（可留空）"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
          {shared && (
            <p className="muted confirm-hint">
              该仓库是 linked worktree：描述写入共享的仓库级 local config，同仓库其他 worktree
              也会看到。
            </p>
          )}
          {loadError && <p className="danger-text">{loadError}</p>}
          {gate && !gate.ok && (
            <div className="gate-report">
              <p className="danger-text">写前检查未通过：</p>
              <ul className="gate-issues">
                {gate.issues.map((issue) => (
                  <li key={`${issue.code}:${issue.message}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="danger-text">{error}</p>}
        </section>

        <footer>
          <button onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button
            className="primary"
            onClick={() => void save()}
            disabled={loading || saving || Boolean(loadError)}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}
