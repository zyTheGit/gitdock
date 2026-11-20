// HEAD reflog 契约镜像（ADR-0029）。只读视图：前端只能用 new_oid 派生既有的写操作，
// 不得把它当成「移动分支指针」的句柄。

/**
 * `HEAD` reflog 的一条记录，最新在前。
 * 字段名沿用 Rust DTO 的 snake_case（无 rename_all）。
 */
export interface ReflogEntryDto {
  /** reflog 序号，0 = 最新；与 selector 的 `HEAD@{N}` 一一对应，不是分页 offset。 */
  index: number;
  /** 服务端拼好的 `HEAD@{N}` 选择器；原样展示，前端不自行拼接。 */
  selector: string;
  /** 变更前对象；引用创建等场景为空哈希，序列化为 null。 */
  old_oid: string | null;
  /** 变更后对象；总是指向有效提交（引用删除的空哈希条目已在服务端过滤）。 */
  new_oid: string;
  /** Git 原始 reflog 消息（`commit: ...`、`reset: moving to ...`），不翻译。 */
  message: string;
  /** reflog 时间（Unix 秒）。 */
  created_at: number;
}
