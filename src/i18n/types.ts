import type zhCnCommon from "./locales/zh-CN/common";
import type zhCnCompare from "./locales/zh-CN/compare";
import type zhCnDetail from "./locales/zh-CN/detail";
import type zhCnDiff from "./locales/zh-CN/diff";
import type zhCnErrors from "./locales/zh-CN/errors";
import type zhCnGraph from "./locales/zh-CN/graph";
import type zhCnRepository from "./locales/zh-CN/repository";
import type zhCnSearch from "./locales/zh-CN/search";
import type zhCnSettings from "./locales/zh-CN/settings";
import type zhCnShell from "./locales/zh-CN/shell";
import type zhCnStaging from "./locales/zh-CN/staging";
import type zhCnTerminal from "./locales/zh-CN/terminal";
import type zhCnWrite from "./locales/zh-CN/write";

// i18next 类型增强：消息 key 的类型来自 zh-CN 资源（as const），
// t() 的 key 在编译期校验（「域.key」全限定形式）；各语言资源结构由
// en/*.ts 的 satisfies 保证同构。新域在此与 index.ts 的 MESSAGE_NAMESPACES 注册。
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    /** 命名空间分隔符用「.」：t("graph.keyName") 全限定形式。 */
    nsSeparator: ".";
    resources: {
      common: typeof zhCnCommon;
      shell: typeof zhCnShell;
      repository: typeof zhCnRepository;
      graph: typeof zhCnGraph;
      detail: typeof zhCnDetail;
      diff: typeof zhCnDiff;
      search: typeof zhCnSearch;
      compare: typeof zhCnCompare;
      staging: typeof zhCnStaging;
      terminal: typeof zhCnTerminal;
      settings: typeof zhCnSettings;
      write: typeof zhCnWrite;
      errors: typeof zhCnErrors;
    };
  }
}