
export const WGSL_LIB_PREAMBLE_CODE = `
diagnostic(off, derivative_uniformity);
`;
export const WGSL_LIB_CODE = `

fn BopLib_float2_constructor(x: f32, y: f32) -> vec2f { return vec2f(x, y); }

fn BopLib_float4_constructor(x: f32, y: f32, z: f32, w: f32) -> vec4f { return vec4f(x, y, z, w); }
fn BopLib_float4_constructor2(x: f32, y: f32, z: f32, w: f32) -> vec4f { return vec4f(x, y, z, w); }
fn BopLib_float4_get_x(t: vec4f) -> f32 { return t.x; }
fn BopLib_float4_get_y(t: vec4f) -> f32 { return t.y; }
fn BopLib_float4_get_z(t: vec4f) -> f32 { return t.z; }
fn BopLib_float4_get_w(t: vec4f) -> f32 { return t.w; }
fn BopLib_float4_set_x(t: ptr<function, vec4f>, v: f32) { t.x = v; }
fn BopLib_float4_set_y(t: ptr<function, vec4f>, v: f32) { t.y = v; }
fn BopLib_float4_set_z(t: ptr<function, vec4f>, v: f32) { t.z = v; }
fn BopLib_float4_set_w(t: ptr<function, vec4f>, v: f32) { t.w = v; }
fn BopLib_float4_set_x_storage(t: ptr<storage, vec4f, read_write>, v: f32) { t.x = v; }
fn BopLib_float4_set_y_storage(t: ptr<storage, vec4f, read_write>, v: f32) { t.y = v; }
fn BopLib_float4_set_z_storage(t: ptr<storage, vec4f, read_write>, v: f32) { t.z = v; }
fn BopLib_float4_set_w_storage(t: ptr<storage, vec4f, read_write>, v: f32) { t.w = v; }
fn BopLib_float4_get_xy(t: vec4f) -> vec2f { return t.xy; }

fn BopLib_float4_operatorAdd(lhs: vec4f, rhs: vec4f) -> vec4f { return vec4f(lhs.x + rhs.x, lhs.y + rhs.y, lhs.z + rhs.z, lhs.w + rhs.w); }
fn BopLib_float4_operatorAdd1(lhs: f32, rhs: vec4f) -> vec4f { return vec4f(lhs + rhs.x, lhs + rhs.y, lhs + rhs.z, lhs + rhs.w); }
fn BopLib_float4_operatorAdd2(lhs: vec4f, rhs: f32) -> vec4f { return vec4f(lhs.x + rhs, lhs.y + rhs, lhs.z + rhs, lhs.w + rhs); }
fn BopLib_float4_operatorSubtract(lhs: vec4f, rhs: vec4f) -> vec4f { return vec4f(lhs.x - rhs.x, lhs.y - rhs.y, lhs.z - rhs.z, lhs.w - rhs.w); }
fn BopLib_float4_operatorSubtract1(lhs: f32, rhs: vec4f) -> vec4f { return vec4f(lhs - rhs.x, lhs - rhs.y, lhs - rhs.z, lhs - rhs.w); }
fn BopLib_float4_operatorSubtract2(lhs: vec4f, rhs: f32) -> vec4f { return vec4f(lhs.x - rhs, lhs.y - rhs, lhs.z - rhs, lhs.w - rhs); }
fn BopLib_float4_operatorMultiply(lhs: vec4f, rhs: vec4f) -> vec4f { return vec4f(lhs.x * rhs.x, lhs.y * rhs.y, lhs.z * rhs.z, lhs.w * rhs.w); }
fn BopLib_float4_operatorMultiply1(lhs: f32, rhs: vec4f) -> vec4f { return vec4f(lhs * rhs.x, lhs * rhs.y, lhs * rhs.z, lhs * rhs.w); }
fn BopLib_float4_operatorMultiply2(lhs: vec4f, rhs: f32) -> vec4f { return vec4f(lhs.x * rhs, lhs.y * rhs, lhs.z * rhs, lhs.w * rhs); }
fn BopLib_float4_operatorDivide(lhs: vec4f, rhs: vec4f) -> vec4f { return vec4f(lhs.x / rhs.x, lhs.y / rhs.y, lhs.z / rhs.z, lhs.w / rhs.w); }
fn BopLib_float4_operatorDivide1(lhs: f32, rhs: vec4f) -> vec4f { return vec4f(lhs / rhs.x, lhs / rhs.y, lhs / rhs.z, lhs / rhs.w); }
fn BopLib_float4_operatorDivide2(lhs: vec4f, rhs: f32) -> vec4f { return vec4f(lhs.x / rhs, lhs.y / rhs, lhs.z / rhs, lhs.w / rhs); }
fn BopLib_float4_operatorNegate(lhs: vec4f) -> vec4f { return vec4f(-lhs.x, -lhs.y, -lhs.z, -lhs.w); }

struct BopLib_DebugOuts_MetadataType {
  viewportStartLine: i32,
  viewportEndLine: i32,
};
struct BopLib_DebugOuts_Entry {
  length: i32,
  values: array<f32, 4>,
};

@group(2) @binding(0) var<storage, read> BopLib_DebugIns_ValuesArray: array<f32>;
@group(2) @binding(1) var<uniform> BopLib_DebugOuts_Metadata: BopLib_DebugOuts_MetadataType;
@group(2) @binding(2) var<storage, read_write> BopLib_DebugOuts_ValuesArray: array<BopLib_DebugOuts_Entry>;

fn BopLib_exportDebugOut(lineNumber: i32, length: i32, v0: f32, v1: f32, v2: f32, v3: f32) {
  if (lineNumber < BopLib_DebugOuts_Metadata.viewportStartLine ||
      lineNumber >= BopLib_DebugOuts_Metadata.viewportEndLine) {
    return;
  }
  var values = array<f32, 4>(v0, v1, v2, v3);
  BopLib_DebugOuts_ValuesArray[lineNumber - BopLib_DebugOuts_Metadata.viewportStartLine] = BopLib_DebugOuts_Entry(length, values);
}

fn BopLib_readDebugIn(entryIndex: i32) -> f32 {
  return BopLib_DebugIns_ValuesArray[entryIndex];
}

`;
