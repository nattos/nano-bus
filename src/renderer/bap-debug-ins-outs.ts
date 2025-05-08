import { BapGenerateContext, BapWriteIntoExpressionFunc } from "./bap-value";

export interface BapDebugInEntry {
  readonly lineNumber: number;
  readonly isGpu: boolean;
  readonly defaultValue: number;
}

export class BapDebugInOuts {
  readonly cpuIns: BapDebugInEntry[] = [];
  readonly gpuIns: BapDebugInEntry[] = [];

  allocateIn(context: BapGenerateContext, init: { lineNumber: number; defaultValue: number; }) {
    const isGpu = !!context.scope.gpu;
    const ins = isGpu ? this.gpuIns : this.cpuIns;
    const entryIndex = ins.length;
    ins.push({ lineNumber: init.lineNumber, isGpu, defaultValue: init.defaultValue });
    return {
      entryIndex: entryIndex,
    };
  }

  writeInRead(entry: BapDebugInEntry): BapWriteIntoExpressionFunc {
    return (prepare) => {
      return (expr) => {
      };
    };
  }
}