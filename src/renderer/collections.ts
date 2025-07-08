import * as utils from '../utils';

// type VarArgs = readonly unknown[];

export interface MultiMapEntrySet<TValue> {
  has(value: TValue): boolean;
  add(value: TValue): void;
  delete(value: TValue): void;
  readonly size: number;
}
export interface MultiMapEntrySetConstructor<TValue, TValueSet extends MultiMapEntrySet<TValue>> {
  new(): TValueSet;
}

export class MultiMap<TKey, TValue, TValueSet extends MultiMapEntrySet<TValue>> {
  private readonly map = new Map<TKey, TValueSet>();
  private readonly valueSetType;

  constructor(init: {
    valueSetType: MultiMapEntrySetConstructor<TValue, TValueSet>,
  }) {
    this.valueSetType = init.valueSetType;
  }

  clear(): void {
    this.map.clear();
  }
  delete(key: TKey): boolean {
    return this.map.delete(key);
  }
  get(key: TKey): TValueSet | undefined {
    return this.map.get(key);
  }
  has(key: TKey): boolean {
    return this.map.has(key);
  }
  add(key: TKey, value: TValue): this {
    let valueSet = this.map.get(key);
    if (valueSet === undefined) {
      valueSet = new this.valueSetType();
      this.map.set(key, valueSet);
    }
    valueSet.add(value);
    return this;
  }
  remove(key: TKey, value: TValue): this {
    const valueSet = this.map.get(key);
    if (valueSet !== undefined) {
      valueSet.delete(value);
      if (valueSet.size === 0) {
        this.map.delete(key);
      }
    }
    return this;
  }

  static basic<TKey, TValue>() {
    return new MultiMap<TKey, TValue, Set<TValue>>({
      valueSetType: Set<TValue>
    })
  }
}



export type ShadowActivator<TKey, TValue, TShadow> = ShadowActivatorClass<TKey, TValue, TShadow> | ShadowActivatorFunc<TKey, TValue, TShadow>;

export interface ShadowActivatorClass<TKey, TValue, TShadow> {
  new(key: TKey, value: TValue): TShadow;
}
export type ShadowActivatorFunc<TKey, TValue, TShadow> = (key: TKey, value: TValue) => TShadow;

function isShadowActivatorFunc<TKey, TValue, TShadow>(activator: ShadowActivator<TKey, TValue, TShadow>): activator is ShadowActivatorFunc<TKey, TValue, TShadow> {
  return typeof activator === 'function';
}

function activateShadow<TKey, TValue, TShadow>(activator: ShadowActivator<TKey, TValue, TShadow>, key: TKey, value: TValue): TShadow {
  if (isShadowActivatorFunc(activator)) {
    return activator(key, value);
  } else {
    return new activator(key, value);
  }
}

export class ShadowMap<TKey, TValue, TShadow extends Disposable> {
  private readonly map = new Map<TKey, TShadow>();
  private readonly shadowType;

  constructor(init: {
    shadowType: ShadowActivator<TKey, TValue, TShadow>,
  }) {
    this.shadowType = init.shadowType;
  }

  sync(values: ReadonlyMap<TKey, TValue>) {
    const removed = [];
    const added = [];
    for (const oldKey of this.map.keys()) {
      if (!values.has(oldKey)) {
        removed.push({ key: oldKey, value: this.map.get(oldKey)! });
      }
    }
    for (const newKey of values.keys()) {
      if (!this.map.has(newKey)) {
        added.push({ key: newKey, value: values.get(newKey)! });
      }
    }
    for (const { key } of removed) {
      this.map.delete(key);
    }
    for (const { value } of removed) {
      value?.[Symbol.dispose]();
    }
    for (const { key, value } of added) {
      this.map.set(key, activateShadow(this.shadowType, key, value));
    }
  }
}

export class ShadowSet<TValue, TValueSet extends Disposable> {
  private readonly map = new Map<TValue, TValueSet>();
  private readonly shadowType;

  constructor(init: {
    shadowType: ShadowActivator<TValue, TValue, TValueSet>,
  }) {
    this.shadowType = init.shadowType;
  }

  has(key: TValue) {
    return this.map.has(key);
  }

  get(key: TValue) {
    return this.map.get(key);
  }

  sync(values: Iterable<TValue>) {
    const removedKeys = new Set<TValue>(this.map.keys());
    const added = [];
    for (const newKey of values) {
      if (!this.map.has(newKey)) {
        added.push(newKey);
      } else {
        removedKeys.delete(newKey);
      }
    }
    const removedValues = [];
    for (const key of removedKeys) {
      if (this.map.has(key)) {
        removedValues.push(this.map.get(key)!);
      }
      this.map.delete(key);
    }
    for (const value of removedValues) {
      value?.[Symbol.dispose]();
    }
    for (const key of added) {
      this.map.set(key, activateShadow(this.shadowType, key, key));
    }
  }
}


export interface SyncListsAccessors<TTheirs, TOurs, TKey = TTheirs> {
  theirKey(v: TTheirs): TKey;
  ourKey(v: TOurs): TKey;
  newOurs(v: TTheirs, newIndex: number): TOurs;
  retainOurs?(theirs: TTheirs, ours: TOurs, oldIndex: number, newIndex: number): void;
  syncOurs?(theirs: TTheirs, ours: TOurs, index: number): void;
  deleteOurs?(v: TOurs, oldIndex: number): void;
};

export function syncLists<TTheirs, TOurs, TKey = TTheirs>(
  accessors: {
    from: TTheirs[],
    to: TOurs[],
  } & SyncListsAccessors<TTheirs, TOurs, TKey>,
) {
  const from = accessors.from;
  const to = accessors.to;
  const ourKeyIndexMap = new Map(to.map((v, i) => {
    return [accessors.ourKey(v), i];
  }));
  const unusedOurIndexSet = new Set(utils.range(to.length));

  const newOurs: TOurs[] = [];
  const retainedOurs: [TOurs, TTheirs, number, number][] = [];
  for (const theirs of from) {
    const theirIndex = newOurs.length;
    const key = accessors.theirKey(theirs);
    const ourIndex = ourKeyIndexMap.get(key);
    let ours;
    if (ourIndex !== undefined) {
      ourKeyIndexMap.delete(key);
      unusedOurIndexSet.delete(ourIndex);
      ours = to[ourIndex];
      retainedOurs.push([ours, theirs, ourIndex, theirIndex]);
    } else {
      ours = accessors.newOurs(theirs, theirIndex);
    }
    newOurs.push(ours);
  }

  const removedOurs = Array.from(unusedOurIndexSet).map(i => [to[i], i] as const);
  for (let i = 0; i < newOurs.length; ++i) {
    if (to[i] !== newOurs[i]) {
      to[i] = newOurs[i];
    }
  }
  if (newOurs.length < to.length) {
    to.splice(newOurs.length);
  }
  if (accessors.retainOurs) {
    for (const [ours, theirs, oldIndex, newIndex] of retainedOurs) {
      accessors.retainOurs(theirs, ours, oldIndex, newIndex);
    }
  }
  if (accessors.deleteOurs) {
    for (const [ours, oldIndex] of removedOurs) {
      accessors.deleteOurs(ours, oldIndex);
    }
  }
  if (accessors.syncOurs) {
    for (let i = 0; i < newOurs.length; ++i) {
      accessors.syncOurs(from[i], newOurs[i], i);
    }
  }
}





// type VarArgHead<T extends VarArgs> = T extends [infer Head, ...unknown[]] ? Head : never;
// type VarArgTail<T extends VarArgs> = T extends [unknown, ...infer Tail] ? Tail : never;

// type MapMap<TPath extends VarArgs> = TPath[2] extends undefined ? Map<TPath[0], TPath[1]> : Map<TPath[0], MapMap<VarArgTail<TPath>>>;

// export class ShadowMap<TPath extends VarArgs, TShadowValue> {
//   head?: VarArgHead<TPath> = undefined;
//   tail?: VarArgTail<TPath> = undefined;
//   m: MapMap<[...TPath, TShadowValue]> = new Map();

//   ensure(path: TPath) {
//     let node = this.m;
//     for (const part of path) {
//       let child = node.get(part) as Map<unknown, unknown>;
//       if (!child) {
//         child = new Map();
//         node.set(part, child as any);
//       }
//     }
//   }
// }

// function test2() {
//   const t: ShadowMap<[boolean, number, string], HTMLElement> = undefined as any;
//   t.m
// }


// export interface MapLike<TKey, TValue> {
//   get(key: TKey): TValue|undefined;
//   has(key: TKey): boolean;
//   set(key: TKey, value: TValue): void;
// }
// export interface MapValueConstructor<TKey, TValue, TArgs extends VarArgs> {
//   new(key: TKey, ...tailArgs: TArgs): TValue;
// }

// export function ensureMapEntry<TKey, TValue, TArgs extends VarArgs>(
//   map: MapLike<TKey, TValue>,
//   key: TKey,
//   valueType: MapValueConstructor<TKey, TValue, TArgs>,
//   ...tailArgs: TArgs
// ): TValue {
//   if (map.has(key)) {
//     return map.get(key)!;
//   }
//   const newValue = new valueType(key, ...tailArgs);
//   map.set(key, newValue);
//   return newValue;
// }

// function test() {
//   const map = MultiMap.basic<number, string>();
// }


