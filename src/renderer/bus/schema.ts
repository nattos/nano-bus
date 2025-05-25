
export interface Placeable {
  laneX: number;
}

export interface Connectable extends Placeable {
  noHandshake: boolean;
  readBus?: BusRef;
  writeBus?: BusRef;
  routePoints: RoutePoint[];
}

export interface Device extends Connectable {
}

export interface RoutePoint extends Connectable {
}

export interface Lane {
}

export interface TrackLane extends Lane {
  devices: Device[];
}

export interface BusLane extends Lane {
}

export interface BusRef {
  busKey?: string;
}




