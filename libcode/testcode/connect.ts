
declare function textureIn(): Texture;
declare function textureOut(out: Texture): void;

interface FindGradData {
  primaryColor: float4;
  primaryPoint: float2;
  secondaryColor: float4;
  secondaryPoint: float2;
}
declare function findColorGrad(tex: Texture): FindGradData;

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
): Texture;



function run() {
  const textureInResult = textureIn();
  const findColorGradResult = findColorGrad(textureInResult);
  const {
    primaryColor: unpackResult_primaryColor,
    primaryPoint: unpackResult_primaryPoint,
    secondaryColor: unpackResult_secondaryColor,
    secondaryPoint: unpackResult_secondaryPoint,
  } = unpack(findColorGradResult);
  const drawGradResult = drawGrad(
    unpackResult_primaryColor,
    unpackResult_primaryPoint,
    unpackResult_secondaryColor,
    unpackResult_secondaryPoint,
  );
  textureOut(drawGradResult);
}






