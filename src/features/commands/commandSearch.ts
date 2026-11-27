export interface CommandPaletteItem {
  id: string;
  title: string;
  context: string;
  shortcut?: string;
  disabledReason?: string;
  keywords?: string;
}

export function searchCommandItems(
  items: readonly CommandPaletteItem[],
  query: string,
): CommandPaletteItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return [...items];
  }

  return items.filter((item) =>
    [item.title, item.context, item.keywords ?? ""].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );
}
