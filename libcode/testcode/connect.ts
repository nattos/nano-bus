
declare function textureIn(): { out: Texture; };
declare function textureOut(out: Texture): void;

interface FindGradData {
  primaryColor: float4;
  primaryPoint: float2;
  secondaryColor: float4;
  secondaryPoint: float2;
}
declare function findColorGrad(tex: Texture): { out: FindGradData; };

declare function unpack(v: FindGradData): {
  primaryColor: float4;
  primaryPoint: float2;
  secondaryColor: float4;
  secondaryPoint: float2;
};

declare function drawGrad(
  primaryColor: float4,
  primaryPoint: float2,
  secondaryColor: float4,
  secondaryPoint: float2,
): { out: Texture };



function run() {
  const { out: textureInResult } = textureIn();
  const { out: findColorGradResult } = findColorGrad(textureInResult);
  const {
    primaryColor: unpackResult_primaryColor,
    primaryPoint: unpackResult_primaryPoint,
    secondaryColor: unpackResult_secondaryColor,
    secondaryPoint: unpackResult_secondaryPoint,
  } = unpack(findColorGradResult);
  const { out: drawGradResult } = drawGrad(
    unpackResult_primaryColor,
    unpackResult_primaryPoint,
    unpackResult_secondaryColor,
    unpackResult_secondaryPoint,
  );
  textureOut(drawGradResult);


const { out: texture_in0_0 } = textureIn();
const { out: find_color_grad0_0 } = findColorGrad(texture_in0_0);
const { primaryColor: unpack0_0, primaryPoint: unpack0_1, secondaryColor: unpack0_2, secondaryPoint: unpack0_3 } = unpack(find_color_grad0_0);
const { out: draw_grad0_0 } = drawGrad(unpack0_0, unpack0_1, unpack0_2, unpack0_3);
textureOut(draw_grad0_0);

}






