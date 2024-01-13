declare module 'bop-lib';
export as namespace boplib;


interface boolean2 {}
interface boolean3 {}
interface boolean4 {}
interface int { isInt: true }
interface int2 {}
interface int3 {}
interface int4 {}
interface float { isFloat: true }
interface float2 {}
interface float3 {}
interface float4 {}

interface Vector2Constructor<TVector, TElement> {
  new (): TVector;
  new (value: TElement): TVector;
  new (x: TElement, y: TElement): TVector;
  new (xy: Swizzlable2<TElement>): TVector;
  readonly zero: TVector;
  readonly one: TVector;
}
declare var boolean2: Vector2Constructor<boolean2, boolean>;
declare var int2: Vector2Constructor<int2, int>;
declare var float2: Vector2Constructor<float2, float>;

interface Vector3Constructor<TVector, TElement> {
  new (): TVector;
  new (value: TElement): TVector;
  new (x: TElement, yz: Swizzlable2<TElement>): TVector;
  new (xy: Swizzlable2<TElement>, z: TElement): TVector;
  new (xyz: Swizzlable3<TElement>): TVector;
  readonly zero: TVector;
  readonly one: TVector;
}
declare var boolean3: Vector3Constructor<boolean3, boolean>;
declare var int3: Vector3Constructor<int3, int>;
declare var float3: Vector3Constructor<float3, float>;

interface Vector4Constructor<TVector, TElement> {
  new (): TVector;
  new (value: TElement): TVector;
  new (x: TElement, y: TElement, zw: Swizzlable2<TElement>): TVector;
  new (x: TElement, yz: Swizzlable2<TElement>, w: TElement): TVector;
  new (xy: Swizzlable2<TElement>, z: TElement, w: TElement): TVector;
  new (xy: Swizzlable2<TElement>, zw: Swizzlable2<TElement>): TVector;
  new (x: TElement, yzw: Swizzlable3<TElement>): TVector;
  new (xyz: Swizzlable3<TElement>, w: TElement): TVector;
  new (xyzw: Swizzlable4<TElement>): TVector;

  readonly zero: TVector;
  readonly one: TVector;
}
declare var boolean4: Vector4Constructor<boolean4, boolean>;
declare var int4: Vector4Constructor<int4, int>;
declare var float4: Vector4Constructor<float4, float>;





interface Swizzlable2<T> {
  x: T;
  y: T;
  xy: Swizzlable2<T>;
  yx: Swizzlable2<T>;
}
interface boolean2 extends Swizzlable2<boolean> {}
interface int2 extends Swizzlable2<int> {}
interface float2 extends Swizzlable2<float> {}

interface Swizzlable3<T> {
  x: T;
  y: T;
  z: T;
  xy: Swizzlable2<T>;
  xz: Swizzlable2<T>;
  yx: Swizzlable2<T>;
  yz: Swizzlable2<T>;
  zx: Swizzlable2<T>;
  zy: Swizzlable2<T>;
  xyz: Swizzlable3<T>;
  xzy: Swizzlable3<T>;
  yxz: Swizzlable3<T>;
  yzx: Swizzlable3<T>;
  zxy: Swizzlable3<T>;
  zyx: Swizzlable3<T>;
}
interface boolean3 extends Swizzlable3<boolean> {}
interface int3 extends Swizzlable3<int> {}
interface float3 extends Swizzlable3<float> {}

interface Swizzlable4<T> {
  x: T;
  y: T;
  z: T;
  w: T;
  xy: Swizzlable2<T>;
  xz: Swizzlable2<T>;
  xw: Swizzlable2<T>;
  yx: Swizzlable2<T>;
  yz: Swizzlable2<T>;
  yw: Swizzlable2<T>;
  zx: Swizzlable2<T>;
  zy: Swizzlable2<T>;
  zw: Swizzlable2<T>;
  wx: Swizzlable2<T>;
  wy: Swizzlable2<T>;
  wz: Swizzlable2<T>;
  xyz: Swizzlable3<T>;
  xyw: Swizzlable3<T>;
  xzy: Swizzlable3<T>;
  xzw: Swizzlable3<T>;
  xwy: Swizzlable3<T>;
  xwz: Swizzlable3<T>;
  yxz: Swizzlable3<T>;
  yxw: Swizzlable3<T>;
  yzx: Swizzlable3<T>;
  yzw: Swizzlable3<T>;
  ywx: Swizzlable3<T>;
  ywz: Swizzlable3<T>;
  zxy: Swizzlable3<T>;
  zxw: Swizzlable3<T>;
  zyx: Swizzlable3<T>;
  zyw: Swizzlable3<T>;
  zwx: Swizzlable3<T>;
  zwy: Swizzlable3<T>;
  wxy: Swizzlable3<T>;
  wxz: Swizzlable3<T>;
  wyx: Swizzlable3<T>;
  wyz: Swizzlable3<T>;
  wzx: Swizzlable3<T>;
  wzy: Swizzlable3<T>;
  xyzw: Swizzlable4<T>;
  xywz: Swizzlable4<T>;
  xzyw: Swizzlable4<T>;
  xzwy: Swizzlable4<T>;
  xwyz: Swizzlable4<T>;
  xwzy: Swizzlable4<T>;
  yxzw: Swizzlable4<T>;
  yxwz: Swizzlable4<T>;
  yzxw: Swizzlable4<T>;
  yzwx: Swizzlable4<T>;
  ywxz: Swizzlable4<T>;
  ywzx: Swizzlable4<T>;
  zxyw: Swizzlable4<T>;
  zxwy: Swizzlable4<T>;
  zyxw: Swizzlable4<T>;
  zywx: Swizzlable4<T>;
  zwxy: Swizzlable4<T>;
  zwyx: Swizzlable4<T>;
  wxyz: Swizzlable4<T>;
  wxzy: Swizzlable4<T>;
  wyxz: Swizzlable4<T>;
  wyzx: Swizzlable4<T>;
  wzxy: Swizzlable4<T>;
  wzyx: Swizzlable4<T>;
}
interface boolean4 extends Swizzlable4<boolean> {}
interface int4 extends Swizzlable4<int> {}
interface float4 extends Swizzlable4<float> {}



interface AtomicCounter {
  relaxedGet(): int;
  relaxedGetAndIncrement(): int;
  relaxedGetAndIncrement(delta: int): int;
}
interface AtomicCounterConstructor {
  new (): AtomicCounter;
  new (initialValue: int): AtomicCounter;
}
declare var AtomicCounter: AtomicCounterConstructor;


interface Texture {
  width: int;
  height: int;
  size: int2;
  channels: int;

  fill(color: float4);
  syncToGpu();

  sample<TCoordMode extends CoordMode, TFilterMode extends FilterMode, TAddressMode extends AddressMode>(
      uv: float2): float4;
}
interface TextureConstructor {
  new (width: int, height: int, channels: int = 4): Texture;
  new (size: int2, channels: int = 4): Texture;
}
declare var Texture: TextureConstructor;


interface CoordMode { coordMode: 0|1; }
interface NormalizedCoordMode extends CoordMode { coordMode: 0; }
interface PixelCoordMode extends CoordMode { coordMode: 1; }

interface FilterMode { filterMode: 0|1|2; }
interface NearestFilterMode { filterMode: 0; }
interface LinearFilterMode { filterMode: 1; }
interface BicubicFilterMode { filterMode: 2; }

interface AddressMode { addressMode: 0|1|2|3|4; }
interface ClampToZeroAddressMode { addressMode: 0; }
interface ClampToEdgeAddressMode { addressMode: 1; }
interface RepeatAddressMode { addressMode: 2; }
interface MirroredRepeatAddressMode { addressMode: 3; }
interface ClampToBorderAddressMode { addressMode: 4; }



interface Array<T> {
  [n: int]: T;
  length: int;

  readonly isGpuBufferDirty: boolean;
  readonly isCpuBufferDirty: boolean;

  syncToGpu();
  syncToCpu();
}
interface ArrayConstructor {
  new <T>(): Array<T>;
  new <T>(length: int): Array<T>;
  new <T>(length: int, fill: T): Array<T>;
}
declare var Array: ArrayConstructor;


interface RelativeIndexable<T> {
  at(index: int): T | undefined;
}
interface Array<T> extends RelativeIndexable<T> {}


