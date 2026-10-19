import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Homescreen-Icon für iOS (braucht PNG, SVG reicht dort nicht). */
export default function AppleIcon() {
  const bar = (w: number, h: number) => (
    <div style={{ width: w, height: h, background: "#fff", borderRadius: 6 }} />
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#059669",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        }}
      >
        {bar(16, 46)}
        {bar(16, 74)}
        {bar(50, 16)}
        {bar(16, 74)}
        {bar(16, 46)}
      </div>
    ),
    size,
  );
}
