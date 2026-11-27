# 产品展示图维护说明

README 的产品展示图统一放在本目录，图片随仓库一起版本管理，不依赖外部图床。

## 当前清单（2026-11-27，核销无效占位）

| 文件 | 状态 | 可追溯来源 | 当前用途 / 处理 |
|---|---|---|---|
| `compare-overview-01.png` | **当前有效（基线展示图）** | `ae10fa9`（2026-11-20） | README「产品展示」主图；展示多标签与并排 diff |
| `graph-overview-02.png` | **当前有效（备选图）** | `ae10fa9`（2026-11-20） | 多仓库标签与图谱备选图，路径已遮蔽 |
| `graph-overview-01.png` | **旧图（历史保留）** | `ef1e467`（2026-11-04） | 单仓库旧版界面样式；历史留档，不删除、不作主图 |

> 注：早期清单中长期缺失的三张占位图（`diff-split-01.png`、`staging-batch-01.png`、`settings-gitconfig-01.png`）已随 `docs/17` / `T33` 正式核销，不再作为待补负债挂账；后续仅在有当前 release 实拍需求时按新序号补充。

## 存放位置与命名

```text
docs/assets/screenshots/
  graph-overview-01.png          # 旧图，历史保留
  graph-overview-02.png          # 备选图
  compare-overview-01.png        # README 主图
  # 新增图使用 <视图>-<场景>-<序号>.png，不覆盖历史文件
```

- 宽度建议 1200–1600 px，PNG 或 WebP（≤ 2 MB）；遮蔽私人仓库路径、邮箱与令牌。
- 每次新增截图需在提交说明或本表中记录版本/tag、commit、日期、系统、主题与语言。
