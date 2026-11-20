import { useI18n } from "../../i18n";
import type { FileDiffDto } from "../../shared/types";

/**
 * 图片类二进制文件的并排预览（ADR-0030 §2.6）。只接受后端给出的 data URI，
 * 以 `<img>` 渲染：SVG 也不得内联进 DOM，避免脚本执行面。
 */
export function ImageDiffView({ diff }: { diff: FileDiffDto }) {
  const { t } = useI18n();
  const both = Boolean(diff.image_before && diff.image_after);
  const alt = (label: string) =>
    diff.image_kind ? t("diff.imageAlt", { label, kind: diff.image_kind }) : label;

  return (
    <div className={both ? "image-diff" : "image-diff single"}>
      {diff.image_before && (
        <figure className="image-diff-pane">
          <figcaption className="muted">{t("diff.imageBefore")}</figcaption>
          <img src={diff.image_before} alt={alt(t("diff.imageBefore"))} />
        </figure>
      )}
      {diff.image_after && (
        <figure className="image-diff-pane">
          <figcaption className="muted">{t("diff.imageAfter")}</figcaption>
          <img src={diff.image_after} alt={alt(t("diff.imageAfter"))} />
        </figure>
      )}
    </div>
  );
}
