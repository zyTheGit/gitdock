import type { SettingsMessages } from "../zh-CN/settings";

/** settings 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const settings = {
  // Dialog frame and shared actions
  title: "Settings",
  subtitle: "Configure GitDock behavior and tools",
  closeAria: "Close settings",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  browse: "Browse…",

  // Section navigation
  navAria: "Settings sections",
  sectionStartup: "Startup",
  sectionAppearance: "Appearance",
  sectionKeybindings: "Shortcuts",
  sectionTerminal: "Terminal",
  sectionTools: "Compare tools",
  sectionGitConfig: "Git config",
  sectionAbout: "About",

  // Startup
  startupTitle: "Startup",
  startupRestore: "Restore the last opened repository on startup",
  startupWatch: "Watch the Git directory and refresh automatically (external commits, branch switches, etc.)",

  // Appearance (language dropdown lives in the common namespace)
  appearanceTitle: "Appearance",
  appearanceHint: "Choose the GitDock color scheme; terminal content always uses the dark ANSI palette.",
  themeLabel: "Theme",
  themeOptionSystem: "Follow system",
  themeOptionLight: "Light",
  themeOptionDark: "Dark",
  zoomLabel: "UI zoom",
  zoomIn: "Zoom in",
  zoomInAria: "Zoom in the interface",
  zoomOut: "Zoom out",
  zoomOutAria: "Zoom out the interface",
  zoomReset: "Reset to 100%",
  zoomCurrent: "Current zoom {{n}}%, reset to 100%",
  zoomHint: 'Zoom shortcuts can be adjusted in the "Shortcuts" section; changes apply immediately and are saved.',

  // Terminal
  terminalTitle: "Terminal",
  terminalHint:
    "GitDock does not bundle LazyGit. When empty, it is looked up on PATH; once set, only that file is used, and a missing file is reported in the terminal panel. The terminal runs with the current user's privileges, inside the currently opened repository.",
  terminalLazygitLabel: "LazyGit executable",
  terminalLazygitPlaceholder: "Full path to the executable (e.g. lazygit)",
  terminalShellProfileLabel: "Shell mode launcher",
  terminalShellProfileDefault: "System default (PowerShell)",
  terminalShellProfileGitBash: "Git Bash (bundled with Git for Windows)",
  terminalShellProfileGitBashMissing:
    "Git Bash was not detected: make sure Git for Windows is installed, or use the system default.",

  // External compare tools ($LOCAL / $REMOTE and command examples stay verbatim, rendered as code)
  toolsTitle: "External file compare tools",
  toolsHintTemplateHead: "In the argument template, ",
  toolsHintTemplateTail: " must each stand as a separate argument; the program is launched with an argument array, never through a shell.",
  toolsHintDetect:
    "Installed VS Code / Beyond Compare / Zed are detected on the current system (fill in the path manually if none is found).",
  toolsHintExampleHead: "Example: VS Code / Zed uses ",
  toolsHintExampleMid: ", and Beyond Compare uses ",
  toolsHintExampleTail: "; passing only two paths opens two separate files instead of a diff view; when no default tool is set, the first item in the list is used.",
  toolsEmpty: "No external tools configured yet.",
  toolsNameLabel: "Name",
  toolsNamePlaceholder: "e.g. Beyond Compare",
  toolsExecutableLabel: "Executable",
  toolsExecutablePlaceholder: "Full path to the compare tool executable",
  toolsArgsTemplateLabel: "Argument template",
  toolsSetDefault: "Set as default compare tool",
  toolsRemove: "Remove",
  toolsAdd: "Add tool",

  // Keyboard shortcuts (key symbols Esc / ↑ / ↓ / Enter stay verbatim)
  keybindTitle: "Shortcuts",
  keybindHintEditable: 'Click "Modify" and press a new combination; it takes effect immediately and is stored only on this machine.',
  keybindHintKbdMid: " and ",
  keybindHintKbdTail: " inside controls carry fixed exit and navigation semantics and cannot be rebound.",
  keybindCapturing: "Press a new combination…",
  keybindModify: "Modify",
  keybindResetOne: "Reset",
  keybindResetAll: "Reset all",
  keybindChangedMessage: '"{{action}}" is now {{spec}}.',
  keybindResetMessage: '"{{action}}" has been reset to its default.',
  keybindResetAllMessage: "All shortcuts have been reset to defaults.",
  keybindFixedTitle: "Fixed keys",
  keybindKeyClick: "Click",
  keybindRejectNoModifier:
    "Must include Ctrl or Alt. On macOS, ⌘ is equivalent to Ctrl and can be used directly.",
  keybindRejectShift:
    "Shift combos are not supported: browser devtools and most system shortcuts rely on them.",
  keybindRejectCtrlAltWin: "Ctrl+Alt combos are reserved by Windows input methods.",
  keybindRejectCtrlAltMac: "Ctrl+Option is reserved for special character input on macOS.",
  keybindRejectCtrlAltLinux: "Ctrl+Alt equals AltGr (special characters) on most layouts.",
  keybindRejectAltReserved: "Alt+{{key}} is reserved by the system.",
  keybindRejectCtrlLetter:
    "Ctrl/Cmd+letter combos are reserved for common shortcuts such as copy, paste and find.",
  keybindRejectUnsupported: "Unsupported combo {{modifier}}+{{key}}.",
  keybindRejectUnrecognized: "Could not recognize this combo.",
  keybindRejectClash: "Already used by \"{{action}}\".",
  actionTerminalToggle: "Toggle terminal",
  actionZoomIn: "Zoom in one step",
  actionZoomOut: "Zoom out one step",
  actionZoomReset: "Reset zoom to 100%",
  fixedEsc:
    "Exits one level at a time: cancel the pending replace slot → exit search → exit compare → clear both slots; also collapses the zoomed diff and closes menus and the repository switcher",
  fixedTerminalZoom: "Zoom the terminal to the full window / restore it (only inside the terminal panel)",
  fixedArrows:
    "Moves the highlight in the repository switcher and search suggestions; adjusts column widths while dragging splitters, with larger steps when Shift is held",
  fixedEnter: "Confirms the highlighted item in the repository switcher / search input",
  fixedCtrlClick:
    "{{modifier}}+click: puts the commit into the compare slots; a second click switches to the other slot",

  // Git configuration: shared
  gitConfigTitle: "Git configuration",
  gitConfigTabsAria: "Config scope",
  gitConfigScopeUser: "User",
  gitConfigScopeRepoTab: "Repository",
  gitConfigSourceUser: "user level",
  gitConfigSourceRepo: "repository level",
  gitConfigSourceSystem: "system level",
  gitConfigSourceCommand: "command-line arguments",
  gitConfigRepoTabUnavailable: "No repository open; repository-level config is unavailable",
  gitConfigFilesLabel: "Config files",
  gitConfigLoading: "Reading Git configuration…",
  gitConfigUnset: "Not set",
  gitConfigEffectiveFrom: "From {{source}}",
  gitConfigDirtyAria: "Unsaved changes",
  gitConfigGitDefaultNote: "Git default: {{text}}",
  gitConfigRawValue: "{{value}} — raw value from the config file",
  gitConfigEffectiveHintHead:
    "The badge on each row shows which layer the effective value comes from; precedence: repository > user > system. Saving writes only to the selected layer",
  gitConfigScopeUserNote: " (applies to all repositories of this user)",
  gitConfigScopeRepoNote: " (applies only to this repository)",
  gitConfigEffectiveHintTail:
    "; clearing an item and saving removes that key only from this layer, and if another layer still sets a value, the effective value falls back to that layer.",
  gitConfigShadowedRepo:
    "This repository also sets this item ({{value}}); the {{source}} value takes effect; this layer has no value yet.",
  gitConfigShadowedRepoOwn:
    "This repository also sets this item ({{value}}); the {{source}} value takes effect; this layer is set to {{own}}.",
  gitConfigShadowedUser:
    "The user level also sets this item ({{value}}); the {{source}} value takes effect; this layer has no value yet.",
  gitConfigShadowedUserOwn:
    "The user level also sets this item ({{value}}); the {{source}} value takes effect; this layer is set to {{own}}.",
  gitConfigSavedUser: "Written to the user-level configuration.",
  gitConfigSavedRepo: "Written to this repository's configuration.",
  gitConfigSaveToUser: "Save to user level",
  gitConfigSaveToRepo: "Save to repository level",
  gitConfigReload: "Reload",
  gitConfigReloading: "Reloading…",
  gitConfigReloaded: "Configuration reloaded",

  // Git configuration: items (keys like user.name and enum values stay verbatim in the component)
  gitConfigUserNameLabel: "Commit author name",
  gitConfigUserNameDesc: "The author name written into every commit; may contain spaces.",
  gitConfigUserNameDefault:
    "When unset, git commit refuses to create a commit and asks you to configure an author first.",
  gitConfigUserEmailLabel: "Commit email",
  gitConfigUserEmailDesc:
    "The author email written into every commit; platforms usually link commits to accounts by email. Must not contain spaces.",
  gitConfigUserEmailDefault:
    "When unset, Git builds an email from the login name and hostname, which platforms usually cannot match to an account.",
  gitConfigAutocrlfLabel: "Line-ending conversion",
  gitConfigAutocrlfTrue: "true — LF on commit, CRLF on checkout",
  gitConfigAutocrlfInput: "input — convert to LF only on commit",
  gitConfigAutocrlfFalse: "false — no conversion",
  gitConfigAutocrlfDesc:
    "true is common on Windows; cross-platform projects often use input. Affects only line endings on checkout and commit, never history.",
  gitConfigAutocrlfDefault:
    "No conversion (equivalent to false); checkout and commit use the line endings stored in the repository as-is.",
  gitConfigDefaultBranchLabel: "Default branch for new repositories",
  gitConfigDefaultBranchPlaceholder: "e.g. main",
  gitConfigDefaultBranchDesc:
    "Only affects repositories created with git init; existing repositories keep their branch names.",
  gitConfigDefaultBranchDefault:
    "master, with a hint at git init time that the value is not configured.",
  gitConfigPullRebaseLabel: "How pulls integrate changes",
  gitConfigPullRebaseFalse: "false — merge (Git default)",
  gitConfigPullRebaseTrue: "true — rebase",
  gitConfigPullRebaseInteractive: "interactive — interactive rebase",
  gitConfigPullRebaseDesc:
    "Determines how the command-line git pull integrates remote commits; does not affect the history of existing repositories.",
  gitConfigPullRebaseDefault:
    "merge; when local and remote have diverged, an extra merge commit appears.",

  // About
  aboutTitle: "About",
  aboutVersion: "Version",
  aboutPlatform: "Platform",
  aboutGitNotDetected: "not detected",
  aboutGitMinimum: " (minimum {{version}})",
  aboutLoading: "Reading version info…",
  aboutChecking: "Checking…",
  aboutFoundVersion: "New version available",
  aboutPublishedAt: "Published {{date}}",
  aboutCheckFailed: "Update check failed",
  aboutSkipped: "Skipped",
  aboutUpToDate: "Up to date",
  aboutNotChecked: "Update check hasn't run yet.",
  aboutSkipVersion: "Skip this version",
  aboutOpenDownload: "Open download page",
  aboutUndoSkip: "Undo skip",
  aboutRecheck: "Check again",
  aboutCheckUpdate: "Check for updates",
  aboutSubmitIssue: "Submit an issue…",
  aboutFeedbackHint:
    "The feedback dialog only prefills the app version, OS, and Git version — no logs or repository paths; you review and submit it yourself in the browser.",

  // Feedback (issue title and body templates are intentionally not migrated; see the migration report)
  feedbackTitle: "Submit an issue",
  feedbackCloseAria: "Close feedback",
  feedbackHint:
    "You can edit the content. GitDock uploads nothing automatically; the button below only opens the GitHub new-issue page in your default browser, and you review and submit it yourself.",
  feedbackTitleLabel: "Title",
  feedbackBodyLabel: "Body",
  feedbackCopied: "Copied",
  feedbackCopy: "Copy content",
  feedbackOpening: "Opening…",
  feedbackOpenIssue: "Open GitHub new issue",

  // Settings draft: native file picker titles
  draftSelectToolTitle: "Select the compare tool executable",
  draftSelectLazygitTitle: "Select the LazyGit executable",
} satisfies SettingsMessages;

export default settings;