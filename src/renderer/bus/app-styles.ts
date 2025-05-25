import { css } from 'lit';

export const APP_STYLES = css`
:host {
  --app-bgcolor1: #171717;
  --app-bgcolor2: #313131;
  --app-bgcolor3: #0f0f0f;

  font-family: monospace;
  color: white;
}

.lane-grid {
  --grid-size-x: 20px;
  --grid-size-y: 20px;
  width: 500px;
  height: 500px;
  position: relative;
  user-select: none;
}
.lane {
  --y: 0;
  --height: 0;
  position: absolute;
  background-color: var(--app-bgcolor1);
  top: calc(var(--y) * var(--grid-size-y));
  height: calc((var(--height) + 1) * var(--grid-size-y));
  left: 0;
  right: 0;
  box-sizing: border-box;
}
.lane-device-track {
  position: absolute;
  top: 0;
  height: calc(var(--height) * var(--grid-size-y));
  left: 0;
  right: 0;
  box-sizing: border-box;
  border-bottom: 1px solid var(--app-bgcolor2);
}
.lane-gutter {
  position: absolute;
  top: calc(var(--height) * var(--grid-size-y));
  height: calc(1 * var(--grid-size-y));
  left: 0;
  right: 0;
  box-sizing: border-box;
  border-bottom: 1px solid var(--app-bgcolor2);
}
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
    var(--height) * var(--grid-size-y) / var(--y-count) - 2px
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

.in-pins .pin-field {
  left: 3px;
}
.out-pins .pin-field {
  right: 3px;
}
.pin-field {
  top: 3px;
  bottom: 3px;
  position: absolute;
  width: calc(var(--grid-size-x) * 3);
  box-sizing: border-box;
  border: 1px solid var(--app-bgcolor3);
  background-color: rgba(80, 12, 0, 0.5);
  text-align: center;
  font-size: 11px;
  display: grid;
  grid-template-columns: 50% 50%;

  > div {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pin-field-label {
    grid-column: 1;
  }
  .pin-field-value {
    grid-column: 2;
  }
}

:host-context(.mode-devices) .pin-field {
  display: none;
}

:host-context(.mode-pins) .device {
  --card-bg-darken: 35%;
  --label-opacity: 40%;
}
:host-context(.mode-pins) .device .label {
  mask-image: linear-gradient(345deg, white, transparent);
}
:host-context(.mode-pins) .pin-field {
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

`;
