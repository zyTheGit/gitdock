# 产品展示图维护说明

README 的产品展示图统一放在本目录，图片随仓库一起版本管理，不依赖外部图床。

## 存放位置

```text
docs/
  assets/
    screenshots/
      graph-overview-01.png
      diff-split-01.png
      staging-batch-01.png
      settings-gitconfig-01.png
```

README 中从仓库根目录写相对路径：

```md
![GitDock 提交图谱](docs/assets/screenshots/graph-overview-01.png)
```

## 命名规范

- 使用小写 kebab-case：`<视图>-<场景>-<序号>.png`
- 示例：`graph-overview-01.png`、`compare-three-dot-01.png`、`terminal-lazygit-01.png`
- 浅色/深色成对出现时追加主题：`graph-overview-dark-01.png`
- 同一场景更新时递增序号，不覆盖历史图片。

## 图片要求

- UI 截图宽度建议 1200–1600 px，保持原始比例，不要拉伸。
- 优先 PNG；体积较大时可用 WebP。单张控制在 2 MB 以内。
- 动图仅在必须展示交互时使用，优先 WebP，GIF 不超过 5 MB。
- 截图内容避免出现令牌、密码、私有仓库地址、个人信息。
- 每张图在 Markdown 中都要写有意义的 alt 文本。

## 上传步骤

推荐方式（图片进仓库，README 在任何分支/离线状态下都能显示）：

1. 把图片放到 `docs/assets/screenshots/`。
2. 在 `README.md` 的「产品展示」一节按相对路径引用。
3. 提交并推送：

```bash
git add docs/assets/screenshots README.md
git commit -m "文档：补充产品展示图"
git push
```

GitHub 网页端也可以直接在 README 编辑框里拖入图片，但生成的是 `user-images.githubusercontent.com` 外链，图片不属于仓库。需要长期稳定、可随版本归档时，请把图片下载后按上面的方式提交到本目录。
