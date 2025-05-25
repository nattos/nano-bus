import { Point } from "../bus/layout-utils";

export class PointerDragOp {
  private isDisposed = false;
  private readonly pointerId;
  private readonly moveFunc;
  private readonly upFunc;
  private readonly cancelFunc;

  private initialThresholdReached = false;
  private readonly startX;
  private readonly startY;

  constructor(e: PointerEvent, private readonly element: HTMLElement, readonly callbacks: {
      move?: (e: PointerEvent, delta: Point) => void,
      accept?: (e: PointerEvent, delta: Point) => void,
      cancel?: () => void,
      complete?: () => void,
      callMoveImmediately?: boolean,
      callMoveBeforeDone?: boolean,
    }) {
    this.pointerId = e.pointerId;
    e.preventDefault()

    this.moveFunc = this.onPointerMove.bind(this);
    this.upFunc = this.onPointerUp.bind(this);
    this.cancelFunc = this.onPointerCancel.bind(this);
    window.addEventListener('pointermove', this.moveFunc);
    window.addEventListener('pointerup', this.upFunc);
    window.addEventListener('pointercancel', this.cancelFunc);

    this.startX = e.clientX;
    this.startY = e.clientY;

    if (this.callbacks.callMoveImmediately) {
      this.element.setPointerCapture(this.pointerId);
      this.initialThresholdReached = true;
      this.moveFunc(e);
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (this.isDisposed || e.pointerId !== this.pointerId) {
      return;
    }
    const delta: Point = [this.startX - e.clientX, this.startY - e.clientY];
    if (!this.initialThresholdReached) {
      const deltaFromStart = Math.abs(delta[0]) + Math.abs(delta[1]);
      if (deltaFromStart > 5) {
        this.element.setPointerCapture(this.pointerId);
        this.initialThresholdReached = true;
      }
    }
    if (!this.initialThresholdReached) {
      return;
    }
    this.callbacks?.move?.(e, delta);
  }

  private onPointerUp(e: PointerEvent) {
    if (this.isDisposed || e.pointerId !== this.pointerId) {
      return;
    }
    const delta: Point = [this.startX - e.clientX, this.startY - e.clientY];
    if (this.callbacks.callMoveBeforeDone) {
      this.callbacks?.move?.(e, delta);
    }
    if (!this.initialThresholdReached) {
      this.callbacks?.cancel?.();
    } else {
      this.callbacks?.accept?.(e, delta);
    }
    this.callbacks?.complete?.();
    this.finishDispose();
  }

  private onPointerCancel(e: PointerEvent) {
    if (this.isDisposed || e.pointerId !== this.pointerId) {
      return;
    }
    const delta: Point = [this.startX - e.clientX, this.startY - e.clientY];
    if (this.callbacks.callMoveBeforeDone) {
      this.callbacks?.move?.(e, delta);
    }
    this.callbacks?.cancel?.();
    this.callbacks?.complete?.();
    this.finishDispose();
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.callbacks?.cancel?.();
    this.callbacks?.complete?.();
    this.finishDispose();
  }

  private finishDispose() {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    this.element.releasePointerCapture(this.pointerId);
    window.removeEventListener('pointermove', this.moveFunc);
    window.removeEventListener('pointerup', this.upFunc);
    window.removeEventListener('pointercancel', this.cancelFunc);
  }
}
