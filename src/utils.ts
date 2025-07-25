export type EnumKeyRecord<TEnum, TValue> = Record<Extract<TEnum, string>, TValue>;

export class Resolvable<T extends any|void> {
  private resolveFunc = (value: T) => {}
  private rejectFunc = (reason?: any) => {}
  private readonly promiseField: Promise<T>;
  private completedField = false;

  constructor() {
    this.promiseField = new Promise<T>((resolve, reject) => { this.resolveFunc = resolve; this.rejectFunc = reject; });
    this.promiseField.finally(() => {this.completedField = true;});
  }

  get completed(): boolean {
    return this.completedField;
  }

  resolve(value: T) {
    this.resolveFunc(value);
  }

  reject(reason?: any) {
    this.rejectFunc(reason);
  }

  get promise(): Promise<T> {
    return this.promiseField;
  }

  get callable(): (value: T) => void {
    return this.resolveFunc;
  }
}

export class WaitableFlag {
  private flag = new Resolvable<void>();

  constructor() {
  }

  async wait() {
    await this.flag.promise;
    this.flag = new Resolvable<void>();
  }

  set() {
    this.flag.resolve();
  }
}

export class WaitableValue<T> {
  readonly skipEqual;
  private _currentValue: T;
  private _latestValue: T;

  get currentValue() { return this._currentValue; }
  get latestValue() { return this._latestValue; }

  private queueHead: Promise<unknown> = Promise.resolve();
  private nextResult = new Resolvable<T>();

  constructor(initial: T, options?: { skipEqual?: boolean; }) {
    this._currentValue = initial;
    this._latestValue = initial;
    this.skipEqual = options?.skipEqual ?? true;
  }

  set(value: T) {
    if (this.skipEqual && this._latestValue === value) {
      return;
    }
    this._latestValue = value;
    const oldQueueHead = this.queueHead;
    this.queueHead = (async () => {
      try {
        await oldQueueHead;
      } finally {
        const oldResult = this.nextResult;
        this.nextResult = new Resolvable<T>();
        this._currentValue = value;
        oldResult.resolve(value);
        await oldResult.promise.finally();
      }
    })();
  }

  async *stream(): AsyncGenerator<T> {
    while (true) {
      yield await this.nextResult.promise;
    }
  }

  listen(
    onfulfilled?: ((value: T) => unknown) | undefined | null,
  ) {
    (async () => {
      for await (const result of this.stream()) {
        onfulfilled?.(result);
      }
    })();
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.nextResult.promise.then(onfulfilled, onrejected);
  }
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<T | TResult> {
    return this.nextResult.promise.catch(onrejected);
  }
  finally(
    onfinally?: (() => void) | undefined | null,
  ): Promise<T> {
    return this.nextResult.promise.finally(onfinally);
  }
}

export class OperationQueue {
  private head = Promise.resolve();

  async push<TResult>(op: () => TResult | PromiseLike<TResult>): Promise<TResult> {
    const result = new Resolvable<TResult>();
    this.head = this.head.then(async () => {
      result.resolve(await op());
    }).catch(e => {
      result.reject(e);
    });
    return result.promise;
  }
}

export type BatchedConsumerFunc<T> = (produced: T[]) => void | PromiseLike<void>;
export type BatchedConsumerThenFunc = () => void | PromiseLike<void>;

export class BatchedProducerConsumerFlow<T> {
  private consumerOp: Promise<void>;
  private consumer = multicast<BatchedConsumerFunc<T>>();
  private batchInProduction: T[] = [];

  constructor(public batchSize: number) {
    // Make this starts as an async op so that `then` doesn't complete immediately.
    this.consumerOp = sleep(0);
  }

  consume(consumer: BatchedConsumerFunc<T>) {
    this.consumer.add(consumer);
  }

  produce(value: T) {
    this.batchInProduction.push(value);
    if (this.batchInProduction.length >= this.batchSize) {
      this.flushProduced();
    }
  }

  flushProduced() {
    if (this.batchInProduction.length <= 0) {
      return;
    }
    const batchToConsume = this.batchInProduction;
    this.batchInProduction = [];

    this.consumerThen(async () => {
      await this.consumer(batchToConsume);
    });
  }

  consumerThen(task: BatchedConsumerThenFunc) {
    const oldConsumerOp = this.consumerOp;
    this.consumerOp = oldConsumerOp.then(task);
  }

  async join(abort = false) {
    if (!abort) {
      this.flushProduced();
    }
    await this.consumer;
  }
}

class Terminated {}

export class AsyncProducerConsumerQueue<T> {
  private readonly queued: T[] = [];
  private readonly flag = new WaitableFlag();
  private readonly endOfQueue = new WaitableFlag();
  private terminated = false;

  add(value: T) {
    this.queued.push(value);
    this.flag.set();
  }

  addRange(values: T[]) {
    this.queued.push(...values);
    this.flag.set();
  }

  async join() {
    while (this.queued.length > 0) {
      await this.endOfQueue.wait();
    }
  }

  terminate() {
    this.terminated = true;
    this.flag.set();
  }

  async pop(): Promise<T> {
    const result = await this.popOrTerminateInternal();
    if (result === Terminated) {
      throw new Error('Queue was terminated.');
    }
    return result as T;
  }

  async popOrTerminate(): Promise<T|undefined> {
    const result = await this.popOrTerminateInternal();
    if (result === Terminated) {
      return undefined;
    }
    return result as T;
  }

  private async popOrTerminateInternal(): Promise<T|typeof Terminated> {
    while (this.queued.length <= 0) {
      if (this.terminated) {
        return Terminated;
      }
      await this.flag.wait();
      if (this.terminated) {
        return Terminated;
      }
    }
    const result = this.queued.splice(0, 1)[0];
    if (this.queued.length === 0) {
      this.endOfQueue.set();
    }
    return result;
  }
}

export class LruCache<TKey, TValue> {
  private readonly values = new Map<TKey, TValue>();

  constructor(public readonly maxEntries: number, public readonly evictCallback?: (evicted: TValue) => void) {}

  get size() {
    return this.values.size;
  }

  entries() {
    return this.values.entries();
  }

  get(key: TKey): TValue|undefined {
    const entry = this.values.get(key);
    if (entry === undefined) {
      return undefined;
    }
    // peek the entry, re-insert for LRU strategy
    this.values.delete(key);
    this.values.set(key, entry);
    return entry;
  }

  put(key: TKey, value: TValue) {
    if (this.values.size >= this.maxEntries) {
      // least-recently used cache eviction strategy
      const keyToDelete = this.values.keys().next().value as TKey;
      if (keyToDelete !== undefined) {
        const valueToEvict = this.values.get(keyToDelete);
        this.values.delete(keyToDelete);
        if (valueToEvict !== undefined) {
          this.evictCallback?.(valueToEvict);
        }
      }
    }
    this.values.set(key, value);
  }

  clear() {
    if (this.evictCallback) {
      const toEvict = Array.from(this.values.values());
      this.values.clear();
      for (const value of toEvict) {
        this.evictCallback(value);
      }
      return;
    }
    this.values.clear();
  }
}

class QueueEntry<T> {
  next?: QueueEntry<T>;

  constructor(public readonly value: T) {}
}

export class Queue<T> {
  private head?: QueueEntry<T>;
  private tail?: QueueEntry<T>;

  enqueue(value: T) {
    if (!this.tail) {
      this.head = new QueueEntry<T>(value);
      this.tail = this.head;
    } else {
      const oldTail = this.tail;
      this.tail = new QueueEntry<T>(value);
      oldTail.next = this.tail;
    }
  }

  enqueueRange(values: Iterable<T>) {
    for (const value of values) {
      this.enqueue(value);
    }
  }

  dequeue(): T|undefined {
    if (!this.head) {
      return undefined;
    }
    const oldHead = this.head;
    this.head = oldHead.next;
    if (!this.head) {
      this.tail = undefined;
    }

    oldHead.next = undefined;
    return oldHead.value;
  }

  empty(): boolean {
    return !!this.head;
  }

  *values() {
    let node = this.head;
    while (node) {
      yield node.value;
      node = node.next;
    }
  }
}

export interface Subscribable<TFunc extends Function> {
  add(handler: TFunc): void;
  remove(handler: TFunc): void;
}

export type Multicast<TFunc extends Function> = Subscribable<TFunc> & TFunc;

export function multicast<TFunc extends Function>(...handlers: TFunc[]): Multicast<TFunc> {
  handlers = Array.from(handlers);

  const subscribable: Subscribable<TFunc> = {
    add(handler) {
      handlers.push(handler);
    },
    remove(handler) {
      handlers = handlers.filter(h => h !== handler);
    }
  };

  const invoke: TFunc = ((...args: any[]) => {
    let result: any;
    handlers.forEach(handler => result = handler.apply(null, args));
    return result;
  }) as any;
  return merge(invoke, subscribable);
}

export function sleep(delayMillis: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, delayMillis); });
}

export function parseIntOr(str: string|undefined, defaultValue?: number) {
  if (str === undefined) {
    return defaultValue;
  }
  const result = parseInt(str);
  if (Number.isNaN(result)) {
    return defaultValue;
  }
  return result;
}

export function parseFloatOr(str: string|undefined, defaultValue?: number) {
  if (str === undefined) {
    return defaultValue;
  }
  const result = parseFloat(str);
  if (Number.isNaN(result)) {
    return defaultValue;
  }
  return result;
}

export function formatDuration(durationSeconds: number|undefined): string {
  if (durationSeconds === undefined) {
    return '';
  }
  const signStr = durationSeconds < 0 ? '-' : '';
  const totalSeconds = Math.trunc(Math.abs(durationSeconds)) || 0;
  const seconds = Math.trunc(totalSeconds % 60) || 0;
  const totalMinutes = Math.trunc(totalSeconds / 60) || 0;
  const minutes = Math.trunc(totalMinutes % 60) || 0;
  const totalHours = Math.trunc(totalMinutes / 60) || 0;
  const hours = totalHours;
  if (hours > 0) {
    return `${signStr}${hours}:${formatIntPadded(minutes, 2)}:${formatIntPadded(seconds, 2)}`;
  }
  return `${signStr}${minutes}:${formatIntPadded(seconds, 2)}`;
}

export function formatIntPadded(value: number, minDigits: number): string {
  const signStr = value < 0 ? '-' : '';
  const absValue = Math.abs(value) || 0;
  let str = absValue.toString();
  while (str.length < minDigits) {
    str = '0' + str;
  }
  return str;
}

export function stringEmptyToNull(value: string|null|undefined): string|undefined {
  if (!value) {
    return undefined;
  }
  return value;
}

export function filePathDirectory(path: string): string {
  const splitIndex = path.lastIndexOf('/');
  if (splitIndex < 0) {
    return '';
  }
  return path.slice(0, splitIndex);
}

export function filePathFileName(path: string): string {
  const splitIndex = path.lastIndexOf('/');
  if (splitIndex < 0) {
    return path;
  }
  return path.slice(splitIndex + 1);
}

export function filePathFileNameWithoutExtension(path: string): string {
  const fileName = filePathFileName(path);
  const splitIndex = fileName.lastIndexOf('.');
  if (splitIndex < 0) {
    return fileName;
  }
  return fileName.slice(0, splitIndex);
}

export function filePathChangeExt(path: string, newExt: string): string {
  if (newExt && !newExt.startsWith('.')) {
    newExt = '.' + newExt;
  }
  const directory = filePathDirectory(path);
  const fileName = filePathFileNameWithoutExtension(path);
  const newFileName = fileName + newExt;
  return filePathCombine(directory, newFileName);
}

export function filePathExtension(path: string): string {
  const fileName = filePathFileName(path);
  const splitIndex = fileName.lastIndexOf('.');
  if (splitIndex < 0) {
    return '';
  }
  return fileName.slice(splitIndex + 1);
}

export function filePathResolveAbsPath(path: string, relativeTo: string): string {
  let initialAbsPath: string;
  if (path.startsWith('/')) {
    initialAbsPath = path;
  } else {
    initialAbsPath = relativeTo + '/' + path;
  }
  const pathParts = initialAbsPath.split('/');
  const resolvedPartsStack: string[] = [];
  for (const part of pathParts) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..' && resolvedPartsStack.length > 0) {
      resolvedPartsStack.pop();
      continue;
    }
    resolvedPartsStack.push(part);
  }
  return '/' + resolvedPartsStack.join('/');
}

export function filePathCombine(...parts: string[]): string {
  return parts.filter(part => part.length > 0).join('/');
}

export interface Point2D {
  x: number;
  y: number;
}

export function rectContains(rect: DOMRectReadOnly, point: Point2D): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export function indexOf<TValue>(values: Iterable<TValue>, predicate: (entry: TValue) => boolean): number {
  let index = 0;
  for (const value of values) {
    if (predicate(value)) {
      return index;
    }
    index++;
  }
  return -1;
}

export function* mapAll<TIn, TOut>(values: Iterable<TIn>, callback: (value: TIn) => Iterable<TOut>|undefined) {
  for (const value of values) {
    const valueResult = callback(value);
    if (valueResult === undefined) {
      continue;
    }
    for (const result of valueResult) {
      yield result;
    }
  }
}

export function unique<TValue>(values: Iterable<TValue>): Array<TValue> {
  return Array.from(new Set(values));
}
export function* filterUnique<TValue, TKey>(values: Iterable<TValue>, keyFn?: ((value: TValue) => TKey)): Iterable<TValue> {
  const addedSet = new Set<TKey|TValue>();
  for (const value of values) {
    const key = keyFn ? keyFn(value) : value;
    if (addedSet.has(key)) {
      continue;
    }
    addedSet.add(key);
    yield value;
  }
}


export function filterNulllike<TValue, TKey>(values: Array<TValue|undefined|null>): Array<TValue>;
export function filterNulllike<TValue, TKey>(values: Iterable<TValue|undefined|null>): Iterable<TValue>;
export function filterNulllike<TValue, TKey>(values: Array<TValue|undefined|null>|Iterable<TValue|undefined|null>): Array<TValue>|Iterable<TValue|undefined|null> {
  if (values instanceof Array) {
    return filterNulllikeArray(values);
  }
  return filterNulllikeIter(values);
}
function filterNulllikeArray<TValue, TKey>(values: Array<TValue|undefined|null>): Array<TValue> {
  const result: TValue[] = [];
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    result.push(value);
  }
  return result;
}
function* filterNulllikeIter<TValue, TKey>(values: Iterable<TValue|undefined|null>): Iterable<TValue> {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    yield value;
  }
}

export function deleteWhere<T>(values: T[], predicate: (value: T) => boolean) {
  for (let i = values.length - 1; i >= 0; --i) {
    if (predicate(values[i])) {
      values.splice(i, 1);
    }
  }
}

export function* range(countOrMin: number, count?: number): Iterable<number> {
  let min = 0;
  let max = countOrMin;
  if (count !== undefined) {
    min = countOrMin;
    max = min + count;
  }
  for (let i = min; i < max; ++i) {
    yield i;
  }
}

export function zip<TLhs, TRhs>(lhs: TLhs[], rhs: TRhs[]): Array<[TLhs, TRhs]> {
  const length = Math.min(lhs.length, rhs.length);
  const result = new Array<[TLhs, TRhs]>(length);
  for (let i = 0; i < length; ++i) {
    result[i] = [ lhs[i], rhs[i] ];
  }
  return result;
}

export function* appendIfMissing<T>(values: Iterable<T>, toAdd: T) {
  let found = false;
  for (const value of values) {
    yield value;
    if (value === toAdd) {
      found = true;
    }
  }
  if (!found) {
    yield toAdd;
  }
}

export function arrayRemove<T>(values: T[], toRemove: T) {
  for (let i = values.length - 1; i >= 0; --i) {
    if (values[i] === toRemove) {
      values.splice(i, 1);
    }
  }
}

export function setAddRange<T>(set: Set<T>, values: Iterable<T>) {
  for (const value of values) {
    set.add(value);
  }
}

export async function arrayFromAsync<T>(asyncIterator: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const value of asyncIterator) {
    result.push(value);
  }
  return result;
}

export function lazyOr<T>(getter: () => Promise<T>): () => Promise<T|undefined> {
  let promise: Promise<T|undefined>|undefined = undefined;
  return () => {
    if (!promise) {
      promise = getter().catch((e) => {
        console.error(e);
        return undefined;
      });
    }
    return promise;
  };
}

export function lazy<T, TResult extends Promise<T>|T>(getter: () => TResult): () => TResult {
  let promise: TResult|undefined = undefined;
  return () => {
    if (!promise) {
      promise = getter();
    }
    return promise;
  };
}

export function upcast<T>(value: T) {
  return value;
}

export function nonvoid<T>(value: T|undefined|void): T|undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as T;
}

export function findEnumName<T>(enumClass: { [s: string]: T }, value: T): string|undefined {
  return Object.entries(enumClass).find(([k, v]) => v === value)?.at(0) as string|undefined;
}

export function getEnumValues<T>(enumClass: { [s: string]: string }) {
  return Object.values(enumClass) as T[];
}

export function putKeyValues<T extends {}>(toUpdate: T, ...entries: Array<[key: string, value: unknown]>): {} {
  for (const [key, value] of entries) {
    (toUpdate as any)[key] = value;
  }
  return toUpdate;
}

export function objectKeys<T extends Record<keyof T, unknown>>(o: T): Array<keyof T> {
  return Object.keys(o) as any;
}

export function objectEntries<T extends Record<keyof T, T[keyof T]>>(o: T): Array<[keyof T, T[keyof T]]> {
  return Object.entries(o) as any;
}

export function objectFromEntries<TValue, T extends Record<keyof T, TValue>>(e: Array<[keyof T, TValue]>): Record<keyof T, TValue> {
  return Object.fromEntries(e) as any;
}

export function objectMapEntries<T extends Record<keyof T&string, T[keyof T]>, TValueOut>(o: T, f: (e: [keyof T&string, T[keyof T]]) => TValueOut): Record<keyof T, TValueOut>;
export function objectMapEntries<T extends Record<keyof T&number, T[keyof T]>, TValueOut>(o: T, f: (e: [keyof T&number, T[keyof T]]) => TValueOut): Record<keyof T, TValueOut>;
export function objectMapEntries<T extends Record<keyof T&symbol, T[keyof T]>, TValueOut>(o: T, f: (e: [keyof T&symbol, T[keyof T]]) => TValueOut): Record<keyof T, TValueOut>;
export function objectMapEntries<T extends Record<keyof T, T[keyof T]>, TValueOut>(o: T, f: (e: [any, T[keyof T]]) => TValueOut): Record<keyof T, TValueOut> {
  return objectFromEntries(objectEntries(o).map(([k, v]) => [k, f([k, v])]));
}

export function groupBy<TKey, TValue>(values: TValue[], keyer: (value: TValue) => TKey) {
  const result = new Map<TKey, TValue[]>();
  for (const value of values) {
    const key = keyer(value);
    let keyValues = result.get(key);
    if (!keyValues) {
      keyValues = [];
      result.set(key, keyValues);
    }
    keyValues.push(value);
  }
  return result;
}

export function visitRec<T>(roots: T[], getEdges: (node: T) => T[], visit: (node: T) => void, visitedSet?: Set<T>) {
  visitedSet ??= new Set<T>();
  const inner = (node: T) => {
    if (visitedSet.has(node)) {
      return;
    }
    visitedSet.add(node);
    visit(node);
    for (const ref of getEdges(node)) {
      inner(ref);
    }
  };
  roots.forEach(inner);
};

export function merge<T1 extends object, T2 extends object>(onto: T1, from: T2): T1 & T2 {
  if (typeof from !== "object" || from instanceof Array) {
      throw new Error("merge: 'from' must be an ordinary object");
  }
  Object.keys(from).forEach(key => (onto as any)[key] = (from as any)[key]);
  return onto as T1 & T2;
}

export function mergeRec<T1 extends object, T2 extends object>(onto: T1, from: T2): T1 & T2 {
  if (typeof from !== 'object' || from instanceof Array) {
    throw new Error('merge: "from" must be an ordinary object');
  }
  Object.keys(from).forEach(key => {
    const ontoValue = (onto as any)[key];
    const fromValue = (from as any)[key];
    if (ontoValue === null || fromValue === null) {
      (onto as any)[key] = fromValue;
    } else if (typeof ontoValue === 'object' && typeof fromValue === 'object') {
      mergeRec(ontoValue, fromValue);
    } else {
      (onto as any)[key] = fromValue;
    }
  });
  return onto as T1 & T2;
}

// TODO: Lazy! Hacky! Switch to Node's isDeepStrictEqual.
export function isDeepStrictEqual(object1: any, object2: any) {
  const keys1 = Object.keys(object1);
  const keys2 = Object.keys(object2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    const val1 = object1[key];
    const val2 = object2[key];
    const areObjects = isObject(val1) && isObject(val2);
    if (areObjects) {
      if (!isDeepStrictEqual(val1, val2)) {
        return false;
      }
    } else {
      if (val1 !== val2) {
        return false;
      }
    }
  }
  return true;
}

function isObject(object: any) {
  return object != null && typeof object === 'object';
}

export function toBase16(bytes: ArrayBuffer) {
  const hashArray = Array.from(new Uint8Array(bytes)); // convert buffer to byte array
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hashHex;
}
