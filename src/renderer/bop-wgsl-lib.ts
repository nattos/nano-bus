
export const WGSL_LIB_CODE = `

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

`;
