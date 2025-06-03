import * as utils from '../../utils';
import { HTMLTemplateResult } from "lit";
import { action, autorun, makeObservable, observable, runInAction } from "mobx";




export interface SelectState {
  renderEditorPanel?(): HTMLTemplateResult|undefined;
  getChild?(part: string): SelectState|undefined;
}


export class SelectPaths {
  @observable private readonly resolvedStates: (SelectState|undefined)[] = [];

  private readonly stateMap = new Map<string, SelectState>;
  @observable private cleanupInFlight = false;
  private cleanupQueued = false;

  private selectedPath: string[] = [];
  @observable private resolvedStatesDirty = false;

  constructor() {
    makeObservable(this);
    autorun(() => {
      if (this.resolvedStatesDirty) {
        runInAction(() => {
          this.resolvedStatesDirty = false;
          const path = this.selectedPath;
          this.resolvedStates.splice(path.length);

          let parent: SelectState|undefined = undefined;
          for (let i = 0; i < path.length; ++i) {
            const pathPart = path[i];
            const oldState = this.resolvedStates.at(i);
            const newState: SelectState|undefined = parent ? parent.getChild?.(pathPart) : this.stateMap.get(pathPart);
            if (oldState !== newState) {
              if (newState) {
                this.resolvedStates.splice(i + 1);
                this.resolvedStates[i] = newState;
              } else {
                this.resolvedStates.splice(i);
              }
            }
            if (!newState) {
              break;
            }
            parent = newState;
          }
          console.log(this.selectedPath, this.resolvedStates, this.stateMap);
        });
      }
      if (this.cleanupInFlight) {
        runInAction(() => {
          this.cleanupInFlight = false;
          this.cleanupQueued = true;
        });
      }
    });
  }

  @action
  definePath(path: string, state: SelectState) {
    if (this.cleanupQueued) {
      this.cleanupQueued = false;
      this.stateMap.clear();
    }

    const oldState = this.stateMap.get(path);
    if (oldState === state) {
      return;
    }
    this.stateMap.set(path, state);
    if (path === this.selectedPath.at(0)) {
      this.resolvedStatesDirty = true;
    }
    this.cleanupInFlight = true;
  }

  @action
  selectPath(path: string|string[]) {
    path = typeof path === 'string' ? [path] : path;
    this.selectedPath = path;
    this.resolvedStatesDirty = true;
  }

  @action
  selectState(state: SelectState) {
    if (this.resolvedStates.length === 1 && this.resolvedStates[0] === state) {
      return;
    }
    this.resolvedStates.splice(0, this.resolvedStates.length, state);
  }

  renderEditorPanels() {
    return this.resolvedStates.map(s => s?.renderEditorPanel?.());
  }
}

