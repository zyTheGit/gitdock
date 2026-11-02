import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Select } from "../../shared/Select";
import type { GitConfigDto, GitConfigScope, GitConfigValue } from "../../shared/types";

interface ConfigItem {
  key: string;
  label: string;
  /** 枚举项给出固定取值；文本项用占位文案提示格式。 */
  options?: { value: string; label: string }[];
  placeholder?: string;
  description: string;
  /** 三层都没设置时 Git 自己的行为；界面只标「未设置」，不冒充用户设过值。 */
  gitDefault: string;
}

const UNSET = { value: "", label: "未设置" };

const SCOPE_TABS: { value: GitConfigScope; label: string; command: string }[] = [
  { value: "user", label: "用户级", command: "git config --global" },
  { value: "repo", label: "项目级", command: "git config --local" },
];

/** 后端 `effective_scope` 的取值 → 界面层名。 */
const SOURCE_LABELS: Record<string, string> = {
  user: "用户级",
  repo: "仓库级",
  system: "系统级",
  command: "命令行参数",
};

/** 与 Rust 侧 `KNOWN_KEYS` 白名单一一对应，顺序即展示顺序。 */
const ITEMS: ConfigItem[] = [
  {
    key: "user.name",
    label: "提交署名",
    placeholder: "user.name",
    description: "写进每个提交的 Author 姓名，可以带空格。",
    gitDefault: "未设置时 git commit 会拒绝生成提交并要求先配置署名。",
  },
  {
    key: "user.email",
    label: "提交邮箱",
    placeholder: "user.email",
    description: "写进每个提交的 Author 邮箱；代码平台一般按邮箱把提交关联到账号。不能包含空格。",
    gitDefault: "未设置时 Git 用登录名和主机名拼一个邮箱，平台通常认不出账号。",
  },
  {
    key: "core.autocrlf",
    label: "换行转换",
    options: [
      { value: "true", label: "true — 提交转 LF，签出转 CRLF" },
      { value: "input", label: "input — 只在提交时转 LF" },
      { value: "false", label: "false — 不转换" },
    ],
    description: "Windows 上常见 true；跨平台项目也常用 input。只影响签出与提交时的换行处理，不改历史。",
    gitDefault: "不转换（等价于 false），签出与提交都按仓库里存的换行原样处理。",
  },
  {
    key: "init.defaultBranch",
    label: "新建仓库默认分支",
    placeholder: "例如 main",
    description: "只作用于 git init 新建的仓库，已有仓库的分支名不受影响。",
    gitDefault: "master，并在 git init 时提示该值尚未配置。",
  },
  {
    key: "pull.rebase",
    label: "拉取整合方式",
    options: [
      { value: "false", label: "false — 合并（Git 默认）" },
      { value: "true", label: "true — 变基" },
      { value: "interactive", label: "interactive — 交互式变基" },
    ],
    description: "决定命令行的 git pull 如何整合远端提交；对已有仓库的历史没有影响。",
    gitDefault: "merge，本地与远端分叉时会多出一个合并提交。",
  },
];

function toIndex(entries: GitConfigValue[]): Record<string, GitConfigValue> {
  return Object.fromEntries(entries.map((entry) => [entry.key, entry]));
}

/** 仓库名只用于标签显示，路径本身仍由后端给出。 */
function repoName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** 手改过的配置文件可能写着选项外的值；把它原样列出来，避免下拉框悄悄改掉它。 */
function optionsFor(item: ConfigItem, value: string) {
  const known = item.options?.some((option) => option.value === value) ?? false;
  if (!item.options || !value || known) return [UNSET, ...item.options ?? []];
  return [UNSET, ...item.options, { value, label: `${value} — 配置文件原值` }];
}

/**
 * Git 配置面板：一屏同时给出用户级与当前仓库级的取值，每行显示实际生效值与来源层。
 * 保存只写入选中的作用域，其它层的值不动；与 GitDock 自身的设置分开保存。
 */
export function GitConfigSection({ onError }: { onError: (message: string) => void }) {
  const [scope, setScope] = useState<GitConfigScope>("user");
  const [config, setConfig] = useState<GitConfigDto | null>(null);
  // 只存被编辑过的键；未编辑的行继续显示后端给出的生效值。
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const load = useCallback(async () => {
    setNotice(null);
    try {
      setConfig(await ipc.readGitConfig());
      setDraft({});
    } catch (err) {
      onErrorRef.current(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const repoAvailable = config?.repo_path != null;

  // 仓库被关掉后项目级一栏没有写入目标，退回用户级。
  useEffect(() => {
    if (config && !config.repo_path && scope === "repo") setScope("user");
  }, [config, scope]);

  const values = toIndex(config?.entries ?? []);
  const baseOf = (key: string) => values[key]?.effective ?? "";
  const currentOf = (key: string) => draft[key] ?? baseOf(key);
  const changed = ITEMS.filter((item) => currentOf(item.key) !== baseOf(item.key)).map((item) => ({
    key: item.key,
    value: currentOf(item.key).trim(),
  }));

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const dto = await ipc.saveGitConfig(scope, changed);
      setConfig(dto);
      setDraft({});
      setNotice(scope === "user" ? "已写入用户级配置。" : "已写入当前仓库的配置。");
    } catch (err) {
      onErrorRef.current(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <p className="muted settings-hint">正在读取 Git 配置…</p>;
  }

  const paths =
    scope === "user"
      ? config.user_file_paths
      : [config.repo_file_path ?? config.repo_path].filter((path): path is string => path != null);
  const tab = SCOPE_TABS.find((item) => item.value === scope);
  const repoLabel = config.repo_path ? repoName(config.repo_path) : null;

  return (
    <>
      <div className="git-config-head">
        <div className="git-config-tabs" role="tablist" aria-label="配置作用域">
          {SCOPE_TABS.map((item) => {
            const unavailable = item.value === "repo" && !repoAvailable;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={scope === item.value}
                className={`git-config-tab${scope === item.value ? " active" : ""}`}
                disabled={unavailable}
                title={unavailable ? "未打开仓库，项目级配置不可用" : undefined}
                onClick={() => {
                  setScope(item.value);
                  setDraft({});
                  setNotice(null);
                }}
              >
                {item.label}
                {item.value === "repo" && repoLabel ? (
                  <span className="mono git-config-scope-name">{repoLabel}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <code className="git-config-command">{tab?.command}</code>
      </div>
      <div className="git-config-files">
        <span className="git-config-files-label">配置文件</span>
        <span className="git-config-files-paths">
          {paths.map((path) => (
            <span key={path} className="mono git-config-path" title={path}>
              {path}
            </span>
          ))}
        </span>
      </div>
      <p className="muted settings-hint">
        每行的徽标标出实际生效值来自哪一层，生效顺序：仓库级 &gt; 用户级 &gt; 系统级。
        保存只写当前选中的这一层
        {scope === "user" ? "（对该用户的所有仓库生效）" : "（只对本仓库生效）"}
        ；清空某一项并保存，只删除这一层里的该键，若另一层还设过值，生效值会回落到那一层。
      </p>
      <ul className="git-config-list">
        {ITEMS.map((item) => {
          const entry = values[item.key];
          const value = currentOf(item.key);
          const dirty = value !== baseOf(item.key);
          const source = entry?.effective_scope ?? null;
          const own = scope === "user" ? entry?.user : entry?.repo;
          const other = scope === "user" ? entry?.repo : entry?.user;
          const shadowedBy =
            source != null && source !== scope && other != null ? source : null;
          return (
            <li key={item.key} className={dirty ? "is-dirty" : undefined}>
              <span className="git-config-label">
                <span className="git-config-name">
                  {item.label}
                  {dirty ? (
                    <span
                      className="git-config-dirty"
                      role="img"
                      aria-label="有未保存的修改"
                      title="有未保存的修改"
                    />
                  ) : null}
                </span>
                <span className="git-config-key mono">{item.key}</span>
              </span>
              <span className="git-config-control">
                {item.options ? (
                  <Select
                    block
                    value={value}
                    options={optionsFor(item, value)}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [item.key]: event.target.value }))
                    }
                  />
                ) : (
                  <input
                    className="mono"
                    value={value}
                    placeholder={item.placeholder ?? "未设置"}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [item.key]: event.target.value }))
                    }
                  />
                )}
              </span>
              <span className="git-config-state">
                <span className={`git-config-source mono${source ? "" : " is-unset"}`}>
                  {source ? `生效自 ${SOURCE_LABELS[source]}` : "未设置"}
                </span>
              </span>
              <p className="muted git-config-desc">{item.description}</p>
              {entry?.effective == null ? (
                <p className="muted git-config-note">Git 默认：{item.gitDefault}</p>
              ) : shadowedBy ? (
                <p className="muted git-config-note">
                  {scope === "user" ? "本仓库" : "用户级"}另设了该项（{other}），生效的是
                  {SOURCE_LABELS[shadowedBy]}的值；当前这一层
                  {own == null ? "还没有设过值" : `已设为 ${own}`}。
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="git-config-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void save()}
          disabled={saving || changed.length === 0 || (scope === "repo" && !repoAvailable)}
        >
          {saving ? "保存中…" : `保存到${scope === "user" ? "用户级" : "仓库级"}`}
        </button>
        <button type="button" className="link" onClick={() => void load()} disabled={saving}>
          重新读取
        </button>
        {notice && <span className="muted git-config-notice">{notice}</span>}
      </div>
    </>
  );
}
