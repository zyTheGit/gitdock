import { splitCombo } from "../app/keybindings";

/** 把组合键规格渲染成逐个的 `<kbd>`，界面提示与设置分区共用。 */
export function Kbd({ spec }: { spec: string }) {
  return (
    <>
      {splitCombo(spec).map((part, index) => (
        <kbd key={`${part}-${index}`}>{part}</kbd>
      ))}
    </>
  );
}
