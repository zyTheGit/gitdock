import { CommandError } from "./ipc";

export function errorText(err: unknown): string {
  if (err instanceof CommandError) {
    return err.detail ? `${err.message}（${err.detail}）` : err.message;
  }
  return String(err);
}
