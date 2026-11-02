import { sdk } from "../sdk";

// The part of the app's src/lib/desktop.ts that tools use, on top of the plugin SDK.
// Needs `files:save`, `clipboard:read` and `clipboard:write` in plugin.json when used.

/** Asks the host for a save dialog. False when the user cancelled. */
export async function saveFile(data: Blob, fileName: string): Promise<boolean> {
  return sdk.files.save(fileName, await data.arrayBuffer());
}

export const readClipboardText = (): Promise<string> => sdk.clipboard.readText();
export const writeClipboardText = (text: string): Promise<void> => sdk.clipboard.writeText(text);
