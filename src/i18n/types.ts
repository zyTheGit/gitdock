import type zhCnCommon from "./locales/zh-CN/common";

// i18next 类型增强：消息 key 的类型来自 zh-CN 资源（as const），
// t() 的 key 在编译期校验；各语言资源结构由 en/*.ts 的 satisfies 保证同构。
// 新增资源域时在 resources 里补一行。
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof zhCnCommon;
    };
  }
}