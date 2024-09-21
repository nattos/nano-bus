
export const WGSL_LIB_CODE = `

fn BopLib_float4_set_x(t: ptr<function, vec4f>, v: f32) { t.x = v; }
fn BopLib_float4_set_y(t: ptr<function, vec4f>, v: f32) { t.y = v; }
fn BopLib_float4_set_z(t: ptr<function, vec4f>, v: f32) { t.z = v; }
fn BopLib_float4_set_w(t: ptr<function, vec4f>, v: f32) { t.w = v; }

`;
