/**
 * Public entry point for the parser module. The parser has NO dependency on the
 * renderer — it converts a supported survey file into the normalized CaveModel.
 *
 * To add a new format: implement `parseX(buffer): CaveModel` in its own file,
 * targeting `types.ts`, and dispatch to it from `parseCaveFile` below.
 */

export * from "./types";
export { parseSurvex3d, Survex3dParseError } from "./survex3d";
export { caveStats } from "./caveStats";
export type { CaveStats } from "./caveStats";

import { CaveModel } from "./types";
import { parseSurvex3d } from "./survex3d";

export class UnsupportedFormatError extends Error {
  constructor(readonly extension: string) {
    super(
      `Unsupported file type "${extension}". Supported: .3d (Survex). ` +
        `Compass .plt and Therion .lox are planned.`,
    );
    this.name = "UnsupportedFormatError";
  }
}

/** Dispatch by file extension to the right format parser. */
export function parseCaveFile(filename: string, buffer: ArrayBuffer): CaveModel {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "3d":
      return parseSurvex3d(buffer);
    default:
      throw new UnsupportedFormatError(ext ? `.${ext}` : filename);
  }
}
