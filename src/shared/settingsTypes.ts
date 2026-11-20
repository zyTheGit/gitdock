// 设置域 DTO（ADR-0032 起含打开仓库列表）；实体独立成文件，types.ts 统一 re-export。

export interface ExternalToolConfig {
  name: string;
  executable: string;
  args_template: string;
}

export interface RecentRepository {
  path: string;
  last_opened_at: number;
}

export interface SettingsDto {
  schema_version: number;
  recent_repositories: RecentRepository[];
  external_tools: ExternalToolConfig[];
  restore_last_repository: boolean;
  watch_enabled: boolean;
  /** LazyGit 可执行文件路径；留空时从 PATH 查找。 */
  lazygit_path?: string | null;
  default_tool?: string | null;
  /** 只读：保存时后端强制置 true，前端无需回写。 */
  tools_seeded?: boolean;
  window_width?: number;
  window_height?: number;
  /** 界面缩放比例，1.0 为 100%；后端正反校验 0.75–2.0。 */
  font_scale: number;
  /** 界面语言覆盖；空值跟随系统（"zh-CN" | "en"）。只经 set_language 命令修改。 */
  language?: string | null;
  /** 终端 Shell 启动器（"default" | "git_bash"）；缺省 Windows 为 git_bash、其余平台 default。经 set_shell_profile 面板内切换即时生效。 */
  shell_profile: string;
  /**
   * 上次打开的全部仓库路径（打开顺序）。启动恢复的唯一来源；
   * save_settings 缺该字段会清空恢复列表，设置草稿必须原样回传（ADR-0032）。
   */
  open_repositories: string[];
  /** 上次活动的仓库路径；null 表示没有活动仓库。 */
  active_repository?: string | null;
}
