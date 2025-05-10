interface TriangleVertex {
  /* @position */ position: float4;
  color: float4;
}

@computeShader
function computeShader(threadId: int, options: { positions: TriangleVertex[], texture: Texture }) {
  const positions = options.positions;
  // positions[0] = { position: new float4(0, 0, 0, 1), color: new float4(0, 0, 1, 1) };
  // positions[1] = { position: new float4(1, 0, 0, 1), color: new float4(1, 0, 1, 1) };
  // positions[2] = { position: new float4(1, 1.1, 0, 1), color: new float4(1, 1, 1, 1) };
  // positions[0] = { position: new float4(0, 0, 0, 1), color: new float4(0, 0, 1, 1) };
  // positions[1] = { position: new float4(1, 0, 0, 1), color: new float4(1, 0, 1, 1) };
  // positions[2] = { position: new float4(1, 1.1, 0, 1), color: new float4(1, 0.6, 1, 1) };
  // const p = positions[2];
  const i: int = threadId;
  // p.color.x = i;
  const p = positions.at(i);
  // p.color.x = p.color.x + 1;
  // positions[2] = p;
  // positions[2].color.x = positions[2].color.x + 1;
}

@vertexShader
function vertexShader(position: TriangleVertex, threadId: int, options: { placeholder: float }): TriangleVertex {
  // position.color = new float4(1, 1, 0, 1);
  // position.color += new float4(-0.5, 0, 0, 0);
  // const texColor = options.inTex.sample(position.position.xy);
  // position.color += texColor;
  return position;
}
@fragmentShader
function fragmentShader(position: TriangleVertex, options: { alpha: float, beta: float, other: { theta: float }, color: float4, someBuf: TriangleVertex[] }): float4 {
  let color = position.color;
  // const buf = options.someBuf[options.someBuf.length - 1];
  // const bufValue = buf.position.x;
  // const bufValue = options.someBuf.length;
  // const lenValue = options.someBuf.length;
  // color.x = gpuTest(options.alpha) / options.beta + options.other.theta;
  // color = color * 5.0 + (-color) * 4.0;
  // color.x = -0.5;
  // color.x += bufValue;
  // color = color + options.color;
  return color;
}

function test() {
  // let a = 0;
  // a;
  const tex = Texture.persistent(128, 128);

  // const v: TriangleVertex = { position: new float4(0.25, 0.25, 0, 1), color: new float4(0, 0, 0, 1) };
  // v.position = new float4(1, 2, 3, 4);
  // v.position.x += 1;
  // v.position.x++;
  const positions: TriangleVertex[] = Array.persistent<TriangleVertex>(3);
  positions[0] = ({ position: new float4(0.25, 0.25, 0, 1), color: new float4(0, 0, 0, 1) });
  positions[1] = ({ position: new float4(1, 0.25, 0, 1), color: new float4(1, 0, 0, 1) });
  positions[2] = ({ position: new float4(0.5, 0.5, 0, 1), color: new float4(0, 0, 0, 1) });
  // positions[0].position.x = 1.0;

  Gpu.compute(1, computeShader)({ positions: positions, texture: tex });

  Gpu.renderElements
      (positions.length, vertexShader, fragmentShader)
      (positions, { placeholder: 0.2 })
      ({ alpha: 0.9, beta: 1.8, other: { theta: 2.0 }, color: new float4(0.1, 0.2, 0.3, 0.0), someBuf: positions });
}
