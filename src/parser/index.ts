/**
 * Public entry point for the parser module. The parser has NO dependency on the
 * renderer — it converts a supported survey file into the normalized CaveModel.
 *
 * To add a new format: implement `parseX(buffer): CaveModel` in its own file,
 * targeting `types.ts`, and dispatch to it from `parseCaveFile` below.
 */

export * from "./types";
export { parseSurvex3d, Survex3dParseError } from "./survex3d";
export { parseCompassPlt, CompassPltParseError } from "./compassPlt";
export { parseTherionLox, TherionLoxParseError } from "./therionLox";
export { parsePocketTopo, PocketTopoParseError } from "./pocketTopoTop";
export { caveStats } from "./caveStats";
export type { CaveStats } from "./caveStats";

import { CaveModel } from "./types";
import { parseSurvex3d } from "./survex3d";
import { parseCompassPlt } from "./compassPlt";
import { parseTherionLox } from "./therionLox";
import { parsePocketTopo } from "./pocketTopoTop";

export class UnsupportedFormatError extends Error {
  constructor(readonly extension: string) {
    super(
      `Unsupported file type "${extension}". ` +
        `Supported: .3d (Survex), .plt (Compass), .lox (Therion), .top (PocketTopo).`,
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
    case "plt":
      return parseCompassPlt(buffer);
    case "lox":
      return parseTherionLox(buffer);
    case "top":
      return parsePocketTopo(buffer);
    default:
      throw new UnsupportedFormatError(ext ? `.${ext}` : filename);
  }
}
