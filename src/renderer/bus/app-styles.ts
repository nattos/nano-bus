import { css } from 'lit';

export const APP_STYLES = css`
:host {
  --app-color1: #e2e2e2;
  --app-bgcolor1: #171717;
  --app-bgcolor2: #313131;
  --app-bgcolor3: #0f0f0f;
  --app-chip-color: #1e1e1e;

  font-family: monospace;
  color: var(--app-color1);
  user-select: none;
}

.app {
  position: fixed;
  inset: 0;
}

.lane-grid {
  --grid-size-x: 20px;
  --grid-size-y: 20px;
  position: absolute;
  inset: 0;
  user-select: none;
  overflow: scroll;
}

.lane {
  --y: 0;
  --height: 0;
  --track-height: 0;
  position: absolute;
  background-color: var(--app-bgcolor1);
  top: calc(var(--y) * var(--grid-size-y));
  height: calc((var(--height) + 1) * var(--grid-size-y));
  left: 0;
  right: 0;
  box-sizing: border-box;
}
.lane.bus {
  background-color: var(--app-bgcolor2);
}
.lane-device-track {
  position: absolute;
  top: 0;
  height: calc(var(--track-height) * var(--grid-size-y));
  left: 0;
  right: 0;
  box-sizing: border-box;
  border-bottom: 1px solid var(--app-bgcolor2);
}
.lane-gutter {
  position: absolute;
  top: calc(var(--track-height) * var(--grid-size-y));
  height: calc(1 * var(--grid-size-y));
  left: 0;
  right: 0;
  box-sizing: border-box;
  border-bottom: 1px solid var(--app-bgcolor2);
}
:host(bus-device) {
  .device {
    --x: 0;
    --width: 0;
    --card-color: white;
    --card-bgcolor: cornflowerblue;
    --card-bg-darken: 0%;
    --label-opacity: 100%;
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc((var(--x) + 0.5) * var(--grid-size-x));
    width: calc((var(--width) - 1) * var(--grid-size-x));
    box-sizing: border-box;
    background-color: color-mix(in srgb, var(--card-bgcolor), black var(--card-bg-darken));
    z-index: 0;
    border: 1px solid var(--app-bgcolor3);
  }
  .label {
    --x-count: 6;
    --y-count: 2;
    position: absolute;
    overflow: hidden;
    inset: 0;
    z-index: -1;
    align-self: center;
    place-items: center;
    font-size: calc(min(
      (var(--width) - 1) * var(--grid-size-x) / var(--x-count) * 2.0 - 4px,
      var(--track-height) * var(--grid-size-y) / var(--y-count) - 2px
    ));
    letter-spacing: -0.15em;
    line-height: 1em;
    color: color-mix(in srgb, var(--card-bgcolor), var(--card-color) var(--label-opacity));

    > div {
      padding-right: 0.15em;
    }
  }
  .in-pins,
  .out-pins {
    position: absolute;
    top: -1px;
    bottom: 0;
    width: 0;
  }
  .in-pins {
    left: -1px;
  }
  .out-pins {
    right: 0;
  }
  .pin {
    position: relative;
    width: 0;
    height: calc(var(--grid-size-y));
  }
  .in-pins .pin::before,
  .in-pins .pin::after {
    content: '';
    display: block;
    position: absolute;
    right: 0;
    top: calc(50% - 4px);
    width: 5px;
    height: 8px;
    border-left: 1px solid var(--app-bgcolor3);
    border-top: 1px solid var(--app-bgcolor3);
    border-bottom: 1px solid var(--app-bgcolor3);
    box-sizing: border-box;
    background-color: var(--card-bgcolor);
  }
  .in-pins .pin::before {
    transform: translate(1px, -4.5px);
  }
  .in-pins .pin::after {
    transform: translate(1px, 4.5px);
  }

  .out-pins .pin::before,
  .out-pins .pin::after {
    content: '';
    display: block;
    position: absolute;
    left: 0;
    top: calc(50% - 2px);
    width: 5px;
    height: 4px;
    border-right: 1px solid var(--app-bgcolor3);
    border-top: 1px solid var(--app-bgcolor3);
    border-bottom: 1px solid var(--app-bgcolor3);
    box-sizing: border-box;
    background-color: var(--card-bgcolor);
  }
  .out-pins .pin::before {
    transform: translate(0, -2.5px);
  }
  .out-pins .pin::after {
    transform: translate(0, 2.5px);
  }

  .in-pins .field {
    left: 3px;
  }
  .out-pins .field {
    right: 3px;
  }
  .field {
    top: 3px;
    bottom: 3px;
    position: absolute;
    width: calc(var(--grid-size-x) * 3);
    box-sizing: border-box;
    font-size: 11px;
  }
}

.lane.bus .import-pin {
  --x: 0;
  --y: 0;
  position: absolute;
  left: calc(var(--x) * var(--grid-size-x));
  top: calc(var(--y) * var(--grid-size-y));
  width: calc(var(--grid-size-x) * 0.8);
  height: calc(var(--grid-size-x) * 0.8);
  background-color: pink;
}

:host-context(.mode-devices) .lane-grid .field {
  display: none;
}

:host-context(.mode-pins) .device {
  --card-bg-darken: 35%;
  --label-opacity: 40%;
}
:host-context(.mode-pins) .device .label {
  mask-image: linear-gradient(345deg, white, transparent);
}
:host-context(.mode-pins) .field {
  display: grid;
}

.interconnect {
  --wire-color: white;
}
.path-segment {
  position: absolute;
  border: 0px solid var(--wire-color);
}
.interconnect.implicit .path-segment {
  border-style: dotted;
}
.path-segment.horizontal {
  --y: 0;
  --start-x: 0;
  --end-x: 0;
  left: calc(var(--start-x) * var(--grid-size-x));
  width: calc((var(--end-x) - var(--start-x)) * var(--grid-size-x));
  top: calc(var(--y) * var(--grid-size-y) - 0.5px);
  border-bottom-width: 1px;
}
.path-segment.vertical {
  --x: 0;
  --start-y: 0;
  --end-y: 0;
  left: calc(var(--x) * var(--grid-size-x));
  top: calc(var(--start-y) * var(--grid-size-y));
  height: calc((var(--end-y) - var(--start-y)) * var(--grid-size-y) - 0.5px);
  border-right-width: 1px;
}

.editor-panels {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: calc(15em + 2px);
  padding: 1em 0;
  overflow-x: scroll;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 1em;
  font-size: 16px;
}
.editor-panels > * {
  flex-shrink: 0;
}
.editor-panels-bookend {
  flex-shrink: 1;
  flex-grow: 1;
  flex-basis: 0;
  width: 0;
}

.editor-panel {
  background-color: var(--app-bgcolor2);
  aspect-ratio: 4 / 3;
  border: 1px solid var(--app-bgcolor3);
  border-radius: 0.25em;
}

:host(bus-monitor-editor-panel) {
  background-color: var(--app-bgcolor2);
  border: 1px solid var(--app-bgcolor3);
  border-radius: 0.25em;

  position: sticky;
  left: 1em;
  background-color: coral;
  aspect-ratio: 16 / 9;
  border-radius: 0;
}


.panel-standard-container {
  margin: 0.5em;
  display: flex;
  flex-direction: column;
  gap: 0.5em;
}

.landmark-header {
  --chip-color: var(--app-chip-color);
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  width: fit-content;
  border: 1px solid var(--app-bgcolor3);
  border-radius: 0.125em;
  background-color: var(--chip-color);
  overflow: hidden;

  > * {
    padding-right: 0.5em;
  }
  > *:hover {
    background-color: coral;
  }
  > :first-child {
    padding-left: 0.5em;
  }
  > :not(:first-child)::before {
    content: '';
    border-left: 1px dashed var(--app-bgcolor3);
    padding-right: 0.5em;
  }
}
.landmark-label {
}
.landmark-type {
}

.chip-block {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.25em;
  row-gap: 0.125em;

  .header {
    width: 100%;
  }
}

.editor-panel {
  .field {
    font-size: 95%;
    height: calc(1.1875lh);
    box-sizing: border-box;
  }
}

.chip {
  --chip-color: var(--app-chip-color);
  display: inline-block;
  border: 1px solid var(--app-bgcolor3);
  border-radius: 0.125em;
  padding: 0 0.5em;
  background-color: var(--chip-color);
}
.chip:hover {
  background-color: coral;
}


.field {
  position: relative;
  border: 1px solid var(--app-bgcolor3);
  background-color: rgba(12, 12, 12, 0.5);
  text-align: center;
  display: grid;
  grid-template-columns: 50% 50%;
  z-index: 0;
  overflow: hidden;
  user-select: none;
  cursor: text;

  > div {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .field-label {
    grid-column: 1;
  }
  .field-value {
    grid-column: 2;
  }
  .field-bar {
    --value: 0.5;
    position: absolute;
    z-index: -1;
    left: 0;
    top: 0;
    bottom: 0;
    width: calc(var(--value) * 100%);
    background-color: rgba(80, 12, 0, 0.5);
  }
}

.spark-chart {
  border: 1px solid var(--app-bgcolor3);
  height: 3em;
  width: 8em;
  box-sizing: border-box;
  background-color: rgba(80, 12, 0, 0.5);
}


`;
