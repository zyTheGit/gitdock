import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n, tLoose } from "../../i18n";
import type settingsZh from "../../i18n/locales/zh-CN/settings";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Select } from "../../shared/Select";
import type { GitConfigDto, GitConfigScope, GitConfigValue } from "../../shared/types";

/** settings 域消息 key（带命名空间前缀）：映射表字段用它收窄，t() 才能编译期校验。 */
type SettingsKey = `settings.${keyof typeof settingsZh}`;

interface ConfigItem {
  /** Git 配置键名（原文展示，不翻译）。 */
  key: string;
  /** 展示名的 i18n key。 */
  labelKey: SettingsKey;
  /** 枚举项给出固定取值（labelKey 存 i18n key）；文本项用占位文案提示格式。 */
  options?: { value: string; labelKey: SettingsKey }[];
  /** 不翻译的占位文案（Git 键名示例）。 */
  placeholder?: string;
  /** 需要翻译的占位文案 key。 */
  placeholderKey?: SettingsKey;
  /** 说明文案的 i18n key。 */
  descriptionKey: SettingsKey;
  /** 三层都没设置时 Git 自己的行为（i18n key）；界面只标「未设置」，不冒充用户设过值。 */
  gitDefaultKey: SettingsKey;
}

const SCOPE_TABS: { value: GitConfigScope; labelKey: SettingsKey; command: string }[] = [
  { value: "user", labelKey: "settings.gitConfigScopeUser", command: "git config --global" },
  { value: "repo", labelKey: "settings.gitConfigScopeRepoTab", command: "git config --local" },
];

/** 后端 `effective_scope` 的取值 → 层名 i18n key（用户级 / 仓库级 / 系统级 / 命令行参数）。 */
const SOURCE_LABEL_KEYS: Record<string, SettingsKey> = {
  user: "settings.gitConfigSourceUser",
  repo: "settings.gitConfigSourceRepo",
  system: "settings.gitConfigSourceSystem",
  command: "settings.gitConfigSourceCommand",
};

/** 与 Rust 侧 `KNOWN_KEYS` 白名单一一对应，顺序即展示顺序。 */
const ITEMS: ConfigItem[] = [
  {
    key: "user.name",
    labelKey: "settings.gitConfigUserNameLabel",
    placeholder: "user.name",
    descriptionKey: "settings.gitConfigUserNameDesc",
    gitDefaultKey: "settings.gitConfigUserNameDefault",
  },
  {
    key: "user.email",
    labelKey: "settings.gitConfigUserEmailLabel",
    placeholder: "user.email",
    descriptionKey: "settings.gitConfigUserEmailDesc",
    gitDefaultKey: "settings.gitConfigUserEmailDefault",
  },
  {
    key: "core.autocrlf",
    labelKey: "settings.gitConfigAutocrlfLabel",
    options: [
      { value: "true", labelKey: "settings.gitConfigAutocrlfTrue" },
      { value: "input", labelKey: "settings.gitConfigAutocrlfInput" },
      { value: "false", labelKey: "settings.gitConfigAutocrlfFalse" },
    ],
    descriptionKey: "settings.gitConfigAutocrlfDesc",
    gitDefaultKey: "settings.gitConfigAutocrlfDefault",
  },
  {
    key: "init.defaultBranch",
    labelKey: "settings.gitConfigDefaultBranchLabel",
    placeholderKey: "settings.gitConfigDefaultBranchPlaceholder",
    descriptionKey: "settings.gitConfigDefaultBranchDesc",
    gitDefaultKey: "settings.gitConfigDefaultBranchDefault",
  },
  {
    key: "pull.rebase",
    labelKey: "settings.gitConfigPullRebaseLabel",
    options: [
      { value: "false", labelKey: "settings.gitConfigPullRebaseFalse" },
      { value: "true", labelKey: "settings.gitConfigPullRebaseTrue" },
      { value: "interactive", labelKey: "settings.gitConfigPullRebaseInteractive" },
    ],
    descriptionKey: "settings.gitConfigPullRebaseDesc",
    gitDefaultKey: "settings.gitConfigPullRebaseDefault",
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

/**
 * Git 配置面板：一屏同时给出用户级与当前仓库级的取值，每行显示实际生效值与来源层。
 * 保存只写入选中的作用域，其它层的值不动；与 GitDock 自身的设置分开保存。
 */
export function GitConfigSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
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

  /** 手改过的配置文件可能写着选项外的值；把它原样列出来，避免下拉框悄悄改掉它。 */
  const optionsFor = (item: ConfigItem, value: string) => {
    const known = item.options?.some((option) => option.value === value) ?? false;
    const unset = { value: "", label: t("settings.gitConfigUnset") };
    if (!item.options || !value || known) {
      return [unset, ...(item.options?.map((o) => ({ value: o.value, label: t(o.labelKey) })) ?? [])];
    }
    return [
      unset,
      ...item.options.map((o) => ({ value: o.value, label: t(o.labelKey) })),
      { value, label: t("settings.gitConfigRawValue", { value }) },
    ];
  };

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
      setNotice(
        scope === "user" ? t("settings.gitConfigSavedUser") : t("settings.gitConfigSavedRepo"),
      );
    } catch (err) {
      onErrorRef.current(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <p className="muted settings-hint">{t("settings.gitConfigLoading")}</p>;
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
        <div className="git-config-tabs" role="tablist" aria-label={t("settings.gitConfigTabsAria")}>
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
                title={unavailable ? t("settings.gitConfigRepoTabUnavailable") : undefined}
                onClick={() => {
                  setScope(item.value);
                  setDraft({});
                  setNotice(null);
                }}
              >
                {t(item.labelKey)}
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
        <span className="git-config-files-label">{t("settings.gitConfigFilesLabel")}</span>
        <span className="git-config-files-paths">
          {paths.map((path) => (
            <span key={path} className="mono git-config-path" title={path}>
              {path}
            </span>
          ))}
        </span>
      </div>
      <p className="muted settings-hint">
        {t("settings.gitConfigEffectiveHintHead")}
        {scope === "user"
          ? t("settings.gitConfigScopeUserNote")
          : t("settings.gitConfigScopeRepoNote")}
        {t("settings.gitConfigEffectiveHintTail")}
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
          const shadowKey =
            own == null
              ? scope === "user"
                ? "settings.gitConfigShadowedRepo"
                : "settings.gitConfigShadowedUser"
              : scope === "user"
                ? "settings.gitConfigShadowedRepoOwn"
                : "settings.gitConfigShadowedUserOwn";
          return (
            <li key={item.key} className={dirty ? "is-dirty" : undefined}>
              <span className="git-config-label">
                <span className="git-config-name">
                  {t(item.labelKey)}
                  {dirty ? (
                    <span
                      className="git-config-dirty"
                      role="img"
                      aria-label={t("settings.gitConfigDirtyAria")}
                      title={t("settings.gitConfigDirtyAria")}
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
                    placeholder={item.placeholder ?? t(item.placeholderKey ?? "settings.gitConfigUnset")}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [item.key]: event.target.value }))
                    }
                  />
                )}
              </span>
              <span className="git-config-state">
                <span className={`git-config-source mono${source ? "" : " is-unset"}`}>
                  {source
                    ? t("settings.gitConfigEffectiveFrom", { source: t(SOURCE_LABEL_KEYS[source]) })
                    : t("settings.gitConfigUnset")}
                </span>
              </span>
              <p className="muted git-config-desc">{t(item.descriptionKey)}</p>
              {entry?.effective == null ? (
                <p className="muted git-config-note">
                  {t("settings.gitConfigGitDefaultNote", { text: t(item.gitDefaultKey) })}
                </p>
              ) : shadowedBy ? (
                <p className="muted git-config-note">
                  {tLoose(shadowKey, {
                    value: other ?? t("settings.gitConfigUnset"),
                    source: t(SOURCE_LABEL_KEYS[shadowedBy]) as string,
                    own: own ?? undefined,
                  })}
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
          {saving
            ? t("settings.saving")
            : scope === "user"
              ? t("settings.gitConfigSaveToUser")
              : t("settings.gitConfigSaveToRepo")}
        </button>
        <button type="button" className="link" onClick={() => void load()} disabled={saving}>
          {t("settings.gitConfigReload")}
        </button>
        {notice && <span className="muted git-config-notice">{notice}</span>}
      </div>
    </>
  );
}
