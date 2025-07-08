import { CodeRef } from "./device-layout";

export type CodeRefMapKey = string;
export function toCodeRefMapKey(codeRef: CodeRef) {
  // TODO: Qualify.
  return codeRef.identifier;
}
