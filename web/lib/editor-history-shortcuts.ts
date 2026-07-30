export type EditorHistoryShortcut = "undo" | "redo";

type EditorHistoryShortcutInput = {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

export function resolveEditorHistoryShortcut(
  input: EditorHistoryShortcutInput,
): EditorHistoryShortcut | null {
  if (input.isComposing || input.keyCode === 229) return null;
  if ((!input.metaKey && !input.ctrlKey) || input.altKey) return null;

  const key = input.key.toLowerCase();
  const isZ = input.code === "KeyZ" || key === "z";
  if (isZ) return input.shiftKey ? "redo" : "undo";

  const isWindowsRedo = input.ctrlKey
    && !input.metaKey
    && !input.shiftKey
    && (input.code === "KeyY" || key === "y");
  return isWindowsRedo ? "redo" : null;
}
