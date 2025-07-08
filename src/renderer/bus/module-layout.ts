import * as utils from "../../utils";
import { BusLaneLayout, isBusLane } from "./bus-lane-layout";
import { CodeRefMapKey, toCodeRefMapKey } from "./code-refs";
import { CodeRef, DeviceDecl, DeviceLayout, PinDecl, TypeSpec } from "./device-layout";
import { InterconnectLayout } from "./interconnect-layout";
import { LaneLayout } from "./lane-layout";
import { PinLayout } from "./pin-layout";
import { BusLaneEphemeralPinSource, DevicePinSource, StorageEditableValue } from "./pin-sources";
import { isTrackLane, TrackLaneLayout } from "./track-lane-layout";
import { canonical } from "./utils";

export class ModuleLayout {
  lanes: LaneLayout[] = [];
  allDevices: DeviceLayout[] = [];
  allInterconnects: InterconnectLayout[] = [];

  continuousEdit?: ModuleEditLayout;
  get editType() { return ModuleEditLayout; };

  insertLane(lane: LaneLayout, index?: number) {
    this.lanes.splice(index ?? this.lanes.length, 0, canonical(lane));
  }
  removeLane(lane: LaneLayout) {
    utils.arrayRemove(this.lanes, canonical(lane));
  }

  insertDevice(device: DeviceLayout, index?: number) {
    this.allDevices.splice(index ?? this.allDevices.length, 0, canonical(device));
  }
  removeDevice(device: DeviceLayout) {
    utils.arrayRemove(this.allDevices, canonical(device));
  }

  insertInterconnect(interconnect: InterconnectLayout, index?: number) {
    this.allInterconnects.splice(index ?? this.allInterconnects.length, 0, canonical(interconnect));
  }
  removeInterconnect(interconnect: InterconnectLayout) {
    utils.arrayRemove(this.allInterconnects, canonical(interconnect));
  }
}

export class ModuleEditLayout implements ModuleLayout {
  constructor(readonly shadowOf: ModuleLayout) {}

  get lanes(): LaneLayout[] { return this._lanes ?? this.shadowOf.lanes; }
  private _lanes?: LaneLayout[];

  get allDevices(): DeviceLayout[] { return this._allDevices ?? this.shadowOf.allDevices; }
  private _allDevices?: DeviceLayout[];

  get allInterconnects(): InterconnectLayout[] { return this._allInterconnects ?? this.shadowOf.allInterconnects; }
  private _allInterconnects?: InterconnectLayout[];

  readonly continuousEdit = this;
  get editType() { return ModuleEditLayout; };

  insertLane(lane: TrackLaneLayout, index: number) {
    this._lanes ??= Array.from(this.shadowOf.lanes);
    this._lanes.splice(index, 0, canonical(lane));
  }
  removeLane(lane: TrackLaneLayout) {
    this._lanes ??= Array.from(this.shadowOf.lanes);
    utils.arrayRemove(this._lanes, canonical(lane));
  }

  insertDevice(device: DeviceLayout, index: number) {
    this._allDevices ??= Array.from(this.shadowOf.allDevices);
    this._allDevices.splice(index, 0, canonical(device));
  }
  removeDevice(device: DeviceLayout) {
    this._allDevices ??= Array.from(this.shadowOf.allDevices);
    utils.arrayRemove(this._allDevices, canonical(device));
  }

  insertInterconnect(interconnect: InterconnectLayout, index?: number) {
    this._allInterconnects ??= Array.from(this.shadowOf.allInterconnects);
    this._allInterconnects.splice(index ?? this._allInterconnects.length, 0, canonical(interconnect));
  }
  removeInterconnect(interconnect: InterconnectLayout) {
    this._allInterconnects ??= Array.from(this.shadowOf.allInterconnects);
    utils.arrayRemove(this._allInterconnects, canonical(interconnect));
  }
}

export interface NewDecls {
  deviceDeclsMap: Map<string, DeviceDecl>;
  typeDeclsMap: Map<string, TypeSpec>;
}

export function collectAll(module: ModuleLayout) {
  const allDevices = Array.from(module.allDevices);
  const allLanes = Array.from(module.lanes);
  const allInterconnects = Array.from(module.allInterconnects);
  const allPins: PinLayout[] = utils.unique([
    ...allDevices.flatMap(d => d.inPins.concat(d.outPins)),
    ...allLanes.filter(isBusLane).flatMap(l => l.importPins.concat(l.exportPins)),
  ]);

  const allDeviceDecls: DeviceDecl[] = utils.unique([
    ...allDevices.map(d => d.decl),
  ]);
  const allPinDecls: PinDecl[] = utils.unique([
    ...allPins.flatMap(d => d.decl),
  ]);
  const allTypeDecls: TypeSpec[] = utils.unique([
    ...allPinDecls.flatMap(p => p.type),
  ]);
  const deviceDeclMap = new Map(allDeviceDecls.map(decl => [toCodeRefMapKey(decl.codeRef), decl]));
  const typeDeclMap = new Map(allTypeDecls.map(decl => [toCodeRefMapKey(decl.codeRef), decl]));

  const moduleRefs = new Map([module].map((v, i) => {
    return [v, { '$ref': 'm', key: i }];
  }));
  const laneRefs = new Map(allLanes.map((v, i) => {
    return [v, { '$ref': 'l', key: i }];
  }));
  const deviceRefs = new Map(allDevices.map((v, i) => {
    return [v, { '$ref': 'd', key: i }];
  }));
  const interconnectRefs = new Map(allInterconnects.map((v, i) => {
    return [v, { '$ref': 'ic', key: i }];
  }));
  const pinRefs = new Map(allPins.map((v, i) => {
    return [v, { '$ref': 'p', key: i }];
  }));

  const deviceDeclRefs = new Map(allDeviceDecls.map((v, i) => {
    return [v, { '$ref': 'dd', key: i }];
  }));
  const pinDeclRefs = new Map(allPinDecls.map((v, i) => {
    return [v, { '$ref': 'pd', key: i }];
  }));
  const typeDeclRefs = new Map(allTypeDecls.map((v, i) => {
    return [v, { '$ref': 'td', key: i }];
  }));

  return {
    allDevices,
    allLanes,
    allPins,
    allInterconnects,
    allDeviceDecls,
    allPinDecls,
    allTypeDecls,
    deviceDeclMap,
    typeDeclMap,

    moduleRefs,
    laneRefs,
    deviceRefs,
    interconnectRefs,
    pinRefs,
    deviceDeclRefs,
    pinDeclRefs,
    typeDeclRefs,
  };
}

export function toDeclMap<T extends { codeRef: CodeRef }>(decls: Array<T>): Map<CodeRefMapKey, T> {
  return new Map(decls.map(decl => [toCodeRefMapKey(decl.codeRef), decl]));
}

export function moduleToJson(module: ModuleLayout): string {
  const {
    allDevices,
    allLanes,
    allPins,
    allInterconnects,
    allDeviceDecls,
    allPinDecls,
    allTypeDecls,
    deviceDeclMap,
    typeDeclMap,

    moduleRefs,
    laneRefs,
    deviceRefs,
    interconnectRefs,
    pinRefs,
    deviceDeclRefs,
    pinDeclRefs,
    typeDeclRefs,
  } = collectAll(module);

  const baseJsonObject = {
    lanes: allLanes,
    allDevices: allDevices,
    allInterconnects: allInterconnects,
    allPins: allPins,
    deviceDecls: allDeviceDecls,
    pinDecls: allPinDecls,
    typeDecls: allTypeDecls,
  };
  const baseFieldsSet = new Set([
    module,
    baseJsonObject,
    ...Object.values(baseJsonObject),
  ]);

  function replacer(this: any, key: string, value: any) {
    if (baseFieldsSet.has(this)) {
      return value;
    }
    if (key === 'continuousEdit') {
      return;
    }
    if (value instanceof ModuleLayout && key) {
      return moduleRefs.get(value);
    } else if (value instanceof LaneLayout) {
      return laneRefs.get(value);
    } else if (value instanceof DeviceLayout) {
      return deviceRefs.get(value);
    } else if (value instanceof InterconnectLayout) {
      return interconnectRefs.get(value);
    } else if (value instanceof PinLayout) {
      return pinRefs.get(value);
    } else if (isDeviceDecl(value)) {
      return deviceDeclRefs.get(value);
    } else if (isPinDecl(value)) {
      return pinDeclRefs.get(value);
    } else if (isTypeDecl(value)) {
      return typeDeclRefs.get(value);
    } else if (value instanceof DevicePinSource) {
      return {
        '$type': 'ps-d',
        ...value,
      };
    } else if (value instanceof BusLaneEphemeralPinSource) {
      return {
        '$type': 'ps-b',
        ...value,
      };
    } else if (value instanceof StorageEditableValue) {
      return StorageEditableValue.toJson({
        '$type': 'ev-s',
        ...value,
      } as any);
    }
    return value;
  }
  const stringified = JSON.stringify(baseJsonObject, replacer);
  return stringified;
}

export function moduleFromJson(text: string) {
  const toReplaceRefs: Array<{
    inObject: any;
    key: string;
    ref: { '$ref': string; key: number|string; };
  }> = [];
  const toInitializeClasses: Array<{
    inObject: any;
    key: string;
    instance: { '$type': string; };
  }> = [];
  function reviver(this: any, key: string, value: any) {
    if (typeof value === 'object' && '$ref' in value) {
      toReplaceRefs.push({
        inObject: this,
        key: key,
        ref: value,
      });
    } else if (typeof value === 'object' && '$type' in value) {
      toInitializeClasses.push({
        inObject: this,
        key: key,
        instance: value,
      });
    }
    return value;
  }
  const result = JSON.parse(text, reviver) as ModuleLayout&{
    allPins: PinLayout[];
    deviceDecls: DeviceDecl[];
    pinDecls: PinDecl[];
    typeDecls: TypeSpec[];
  };
  const realModule = {
    lanes: result.lanes,
    allDevices: result.allDevices,
    allInterconnects: result.allInterconnects,
  } as ModuleLayout;
  const realModules = [realModule];
  const realLanes = result.lanes;
  const realDevices = result.allDevices;
  const realInterconnects = result.allInterconnects;
  const realPins = result.allPins;
  const realDeviceDecls = result.deviceDecls;
  const realPinDecls = result.pinDecls;
  const realTypeDecls = result.typeDecls;
  for (const toReplaceRef of toReplaceRefs) {
    const key = toReplaceRef.ref.key;
    const index = typeof key === 'number' ? key : utils.parseIntOr(key) ?? 0;
    let realValue: any = undefined;
    if (toReplaceRef.ref.$ref === 'm') {
      realValue = realModules.at(index);
    } else if (toReplaceRef.ref.$ref === 'l') {
      realValue = realLanes.at(index);
    } else if (toReplaceRef.ref.$ref === 'd') {
      realValue = realDevices.at(index);
    } else if (toReplaceRef.ref.$ref === 'ic') {
      realValue = realInterconnects.at(index);
    } else if (toReplaceRef.ref.$ref === 'p') {
      realValue = realPins.at(index);
    } else if (toReplaceRef.ref.$ref === 'dd') {
      realValue = realDeviceDecls.at(index);
    } else if (toReplaceRef.ref.$ref === 'pd') {
      realValue = realPinDecls.at(index);
    } else if (toReplaceRef.ref.$ref === 'td') {
      realValue = realTypeDecls.at(index);
    }
    toReplaceRef.inObject[toReplaceRef.key] = realValue;
    if (realValue === undefined) {
      console.log(`Missing reference`, toReplaceRef);
    }
  }

  const applyPrototype = <T>(instances: T[], prototype: { new(...args: any[]): T; }) => {
    for (const instance of instances) {
      Object.setPrototypeOf(instance, prototype.prototype);
    }
  };
  applyPrototype(realModules, ModuleLayout);
  applyPrototype(realLanes.filter(isTrackLane), TrackLaneLayout);
  applyPrototype(realLanes.filter(isBusLane), BusLaneLayout);
  applyPrototype(realDevices, DeviceLayout);
  applyPrototype(realInterconnects, InterconnectLayout);
  applyPrototype(realPins, PinLayout);

  for (const newObjectData of toInitializeClasses) {
    const newObject = newObjectData.instance;
    const type = newObject.$type;
    delete (newObject as any)['$type'];

    let objectClass;
    switch (type) {
      case 'ps-d':
        objectClass = DevicePinSource;
        break;
      case 'ps-b':
        objectClass = BusLaneEphemeralPinSource;
        break;
      case 'ev-s':
        objectClass = StorageEditableValue;
        break;
      default:
        continue;
    }
    Object.setPrototypeOf(newObject, objectClass.prototype);
    objectClass.fromJson(newObject as any, {
      // getTypeLayout: (typeSpec: TypeSpec) => {
      //   // TODO: Implement!
      //   const type = new TypeLayout();
      //   type.typeSpec = typeSpec;
      //   return type;
      // },
    });
  }

  return realModule;
}

function isDeviceDecl(value: any): value is DeviceDecl {
  return typeof value === 'object' && 'codeRef' in value && 'inPins' in value && 'outPins' in value;
}
function isPinDecl(value: any): value is PinDecl {
  return typeof value === 'object' && 'codeRef' in value && 'type' in value;
}
function isTypeDecl(value: any): value is TypeSpec {
  return typeof value === 'object' && 'codeRef' in value && ('primitive' in value || 'struct' in value);
}
