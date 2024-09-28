
export const WGSL_LIB_CODE = `

fn BopLib_float4_constructor(x: f32, y: f32, z: f32, w: f32) -> vec4f { return vec4f(x, y, z, w); }
fn BopLib_float4_get_x(t: vec4f) -> f32 { return t.x; }
fn BopLib_float4_get_y(t: vec4f) -> f32 { return t.y; }
fn BopLib_float4_get_z(t: vec4f) -> f32 { return t.z; }
fn BopLib_float4_get_w(t: vec4f) -> f32 { return t.w; }
fn BopLib_float4_set_x(t: ptr<function, vec4f>, v: f32) { t.x = v; }
fn BopLib_float4_set_y(t: ptr<function, vec4f>, v: f32) { t.y = v; }
fn BopLib_float4_set_z(t: ptr<function, vec4f>, v: f32) { t.z = v; }
fn BopLib_float4_set_w(t: ptr<function, vec4f>, v: f32) { t.w = v; }

`;
