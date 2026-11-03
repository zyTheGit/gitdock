/** 递归把字面量类型放宽为 string：en 资源用 satisfies 校验与 zh-CN 的 key 结构同构。 */
export type MessageShape<T> = {
  [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]>;
};