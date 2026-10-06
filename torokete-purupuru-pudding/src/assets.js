export const PUDDING_SPRITE = Object.freeze({
  key: "pudding.base",
  url: "./assets/custard-pudding.png",
  expectedWidth: 1254,
  expectedHeight: 1254,
  alphaBounds: Object.freeze({ left: 70, top: 226, right: 1185, bottom: 1062 }),
});

export function loadOptionalImage(asset = PUDDING_SPRITE) {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = async () => {
      try {
        if (typeof image.decode === "function") await image.decode();
      } catch {
        // onload already guarantees a drawable image.
      }
      resolve({
        image,
        asset,
        matchesExpectedSize: image.naturalWidth === asset.expectedWidth
          && image.naturalHeight === asset.expectedHeight,
      });
    };
    image.onerror = () => resolve(null);
    image.src = asset.url;
  });
}
