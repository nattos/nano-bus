import * as utils from '../../utils';
import { BapDebugInEntry, BapStaticFunctionSignature, BapStaticType } from '../bap-exports';
import { evalJavascriptInContext, PushInternalContinueFlag, SharedMTLInternals } from '../runtime/bop-javascript-lib';

const TEXT_ENCODER = new TextEncoder();

export interface BusBapSerializedState {
  module?: {
    code: string;
    hash: string;
    exports: {
      functions: BapStaticFunctionSignature[];
    };
  };
  run?: {
    code: string;
    hash: string;
    runner: {
      cpuPrepareCode: string;
      cpuRunFrameCode: string;
      gpuCode: string;
      cpuDebugIns: BapDebugInEntry[];
      gpuDebugIns: BapDebugInEntry[];
      debugOuts: BapDebugInEntry[];
      compileMessages: string[];
    };
  };
}

export interface BusBapFrameRunnerState {
  runnerFunc: BusBapFrameRunner;
  codeLines: string[];
}

export interface BusBapFrameRunner {
  runOneFrame(): Promise<void>;
}

export class BusBapCompiler {
  private readonly bapImport = utils.lazy(async () => await import('../bap'));
  private readonly taskQueue = new utils.OperationQueue();

  private state: BusBapSerializedState = {};
  private frameRunnerState?: BusBapFrameRunnerState;

  private moduleDirty = false;
  private queuedModuleCode?: string;
  private runDirty = false;
  private queuedRunCode?: string;
  private frameRunnerDirty = false;
  private stateDirty?: {
    stateChanged?: boolean;
    frameRunnerChanged?: boolean;
  };

  onStateChanged?: (event: {
    state: BusBapSerializedState;
    stateChanged: boolean;
    frameRunner?: BusBapFrameRunnerState;
    frameRunnerChanged: boolean;
  }) => void;

  serialize(): BusBapSerializedState {
    return structuredClone(this.state);
  }

  deserialize(state: BusBapSerializedState|undefined) {
    this.state = state ?? {};
    this.taskQueue.push(async () => {
      this.moduleDirty = true;
      this.runDirty = true;
      this.frameRunnerDirty = true;
      await this.processValidate();
    });
  }

  private async processValidate() {
    await this.validateModuleCode();
    await this.validateRunCode();
    await this.validateFrameRunner();
    if (this.stateDirty) {
      const event = {
        state: this.state,
        stateChanged: this.stateDirty.stateChanged ?? false,
        frameRunner: this.frameRunnerState,
        frameRunnerChanged: this.stateDirty.frameRunnerChanged ?? false,
      };
      this.stateDirty = undefined;
      this.onStateChanged?.(event);
    }
  }

  async setModuleCode(moduleCode: string) {
    await this.taskQueue.push(async () => {
      this.moduleDirty = true;
      this.queuedModuleCode = moduleCode;
      await this.processValidate();
    });
  }

  private async validateModuleCode() {
    if (!this.moduleDirty) {
      return;
    }
    this.moduleDirty = false;
    const moduleCode = this.queuedModuleCode ?? this.state.module?.code;
    this.queuedModuleCode = undefined;
    if (!moduleCode) {
      return;
    }
    const codeHash = await this.getCodeHash(moduleCode);
    if (codeHash === this.state.module?.hash) {
      return;
    }

    const bap = await this.bapImport();
    const withoutRunCode = await (await fetch('libcode/testcode/test.ts')).text();
    const precompileResult = await bap.compile(withoutRunCode);
    const exports = precompileResult.exports;

    this.state.module = {
      code: moduleCode,
      hash: codeHash,
      exports: {
        functions: exports.functions,
      },
    };
    this.runDirty = true;
    this.stateDirty ??= {};
    this.stateDirty.stateChanged = true;
  }

  async setRunCode(runCode: string) {
    await this.taskQueue.push(async () => {
      this.runDirty = true;
      this.queuedRunCode = runCode;
      await this.processValidate();
    });
  }

  private async validateRunCode() {
    if (!this.runDirty || !this.state.module) {
      return;
    }
    this.runDirty = false;
    const runCode = this.queuedRunCode ?? this.state.run?.code;
    this.queuedRunCode = undefined;
    if (!runCode) {
      return;
    }
    const codeHash = await this.getCodeHash(runCode);
    if (codeHash === this.state.run?.hash) {
      return;
    }

    const moduleCode = this.state.module.code;
    const bap = await this.bapImport();
    const withRunCode = moduleCode + '\n' + runCode;
    const compileResult = await bap.compile(withRunCode);

    const runner: Required<BusBapSerializedState>['run']['runner'] = {
      cpuPrepareCode: compileResult.cpuPrepareCode,
      cpuRunFrameCode: compileResult.cpuRunFrameCode,
      gpuCode: compileResult.gpuCode,
      cpuDebugIns: compileResult.cpuDebugIns,
      gpuDebugIns: compileResult.gpuDebugIns,
      debugOuts: compileResult.debugOuts,
      compileMessages: compileResult.messages.map(m => m.message),
    };
    this.state.run = {
      code: runCode,
      hash: codeHash,
      runner: runner,
    };
    this.frameRunnerDirty = true;
    this.stateDirty ??= {};
    this.stateDirty.stateChanged = true;
  }

  private async validateFrameRunner() {
    if (!this.frameRunnerDirty || !this.state.module || !this.state.run) {
      return;
    }
    this.frameRunnerDirty = false;

    const moduleCode = this.state.module.code;
    const runCode = this.state.run.code;
    const withRunCode = moduleCode + '\n' + runCode;
    const codeLines = withRunCode.split('\n');
    this.frameRunnerState = {
      runnerFunc: createFrameRunner(this.state.run.runner),
      codeLines: codeLines,
    };
    this.stateDirty ??= {};
    this.stateDirty.frameRunnerChanged = true;
  }

  private async getCodeHash(code: string) {
    return utils.toBase16(await crypto.subtle.digest('SHA-1', TEXT_ENCODER.encode(code)));
  }
}

function createFrameRunner(init: {
  cpuPrepareCode: string;
  cpuRunFrameCode: string;
  gpuCode: string;
  cpuDebugIns: BapDebugInEntry[];
  gpuDebugIns: BapDebugInEntry[];
  debugOuts: BapDebugInEntry[];
}): BusBapFrameRunner {
  let prepared = false;
  const frameRunner: BusBapFrameRunner = {
    async runOneFrame() {
      if (!prepared) {
        prepared = true;
        SharedMTLInternals().loadShaderCode(init.gpuCode);
        SharedMTLInternals().loadDebugIns(init.cpuDebugIns, init.gpuDebugIns);
        const continueFlag = new utils.Resolvable<unknown>();
        PushInternalContinueFlag(continueFlag);
        evalJavascriptInContext(init.cpuPrepareCode);
        await continueFlag.promise;
      }
      const continueFlag = new utils.Resolvable<unknown>();
      PushInternalContinueFlag(continueFlag);
      evalJavascriptInContext(init.cpuRunFrameCode);
      await continueFlag.promise;
    },
  };
  return frameRunner;
}
