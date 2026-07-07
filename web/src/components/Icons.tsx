import type { ReactNode } from "react";

// Pixel-art icon set (Win95 homage). All decorative: aria-hidden, crispEdges.
// Fixed hexes (not theme tokens) because these sit on known grounds: window
// icons on the navy title bar, coins/marks on surface in both themes.

const px = { shapeRendering: "crispEdges" } as const;

function Svg({
  size = 16,
  children,
}: {
  size?: number;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={px}
      className="inline-block shrink-0 align-[-2px]"
    >
      {children}
    </svg>
  );
}

/** Bundled brand PNGs from /icons (explorer, botdex, wbot). */
export function PngIcon({
  src,
  size = 14,
  className = "",
}: {
  src: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
    />
  );
}

/* ---- window title-bar icons (on navy) ---------------------------------- */

export function ChartIcon() {
  return (
    <Svg>
      <rect x="1" y="1" width="14" height="14" fill="#FDFDFB" />
      <rect x="3" y="8" width="3" height="5" fill="#35D3CA" />
      <rect x="7" y="4" width="3" height="9" fill="#43D97A" />
      <rect x="11" y="6" width="3" height="7" fill="#F5C24B" />
      <rect x="1" y="13" width="14" height="2" fill="#0A0A0A" />
    </Svg>
  );
}

export function OrderPadIcon() {
  return (
    <Svg>
      <rect x="2" y="1" width="10" height="14" fill="#FDFDFB" />
      <rect x="4" y="4" width="6" height="1" fill="#8A8578" />
      <rect x="4" y="7" width="6" height="1" fill="#8A8578" />
      <rect x="4" y="10" width="4" height="1" fill="#8A8578" />
      <rect x="12" y="7" width="2" height="2" fill="#F5C24B" />
      <rect x="11" y="9" width="2" height="2" fill="#F5C24B" />
      <rect x="10" y="11" width="2" height="2" fill="#F5C24B" />
      <rect x="9" y="13" width="2" height="2" fill="#0A0A0A" />
    </Svg>
  );
}

export function FolderIcon() {
  return (
    <Svg>
      <rect x="1" y="3" width="6" height="3" fill="#F5C24B" />
      <rect x="1" y="5" width="14" height="9" fill="#F5C24B" />
      <rect x="2" y="6" width="12" height="2" fill="#FBE29B" />
      <rect x="1" y="13" width="14" height="1" fill="#0A0A0A" />
    </Svg>
  );
}

export function MonitorIcon() {
  return (
    <Svg>
      <rect x="1" y="1" width="14" height="11" fill="#FDFDFB" />
      <rect x="3" y="3" width="10" height="7" fill="#35D3CA" />
      <rect x="4" y="4" width="4" height="1" fill="#0E4F4B" />
      <rect x="4" y="6" width="6" height="1" fill="#0E4F4B" />
      <rect x="6" y="12" width="4" height="2" fill="#8A8578" />
      <rect x="4" y="14" width="8" height="1" fill="#0A0A0A" />
    </Svg>
  );
}

export function SealIcon() {
  return (
    <Svg>
      <rect x="2" y="1" width="12" height="12" fill="#FDFDFB" />
      <rect x="4" y="3" width="8" height="1" fill="#8A8578" />
      <rect x="4" y="5" width="8" height="1" fill="#8A8578" />
      <rect x="4" y="7" width="5" height="1" fill="#8A8578" />
      <rect x="9" y="9" width="4" height="4" fill="#43D97A" />
      <rect x="10" y="13" width="2" height="2" fill="#0F7434" />
    </Svg>
  );
}

export function ListIcon() {
  return (
    <Svg>
      <rect x="1" y="2" width="14" height="12" fill="#FDFDFB" />
      <rect x="3" y="4" width="2" height="2" fill="#35D3CA" />
      <rect x="6" y="4" width="7" height="2" fill="#8A8578" />
      <rect x="3" y="7" width="2" height="2" fill="#35D3CA" />
      <rect x="6" y="7" width="7" height="2" fill="#8A8578" />
      <rect x="3" y="10" width="2" height="2" fill="#35D3CA" />
      <rect x="6" y="10" width="7" height="2" fill="#8A8578" />
    </Svg>
  );
}

/* ---- message-box icons (~20px, on surface) ------------------------------ */

function MsgSvg({ children }: { children: ReactNode }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={px}
      className="inline-block shrink-0"
    >
      {children}
    </svg>
  );
}

/** stepped pixel disc */
function Disc({ fill }: { fill: string }) {
  return (
    <>
      <rect x="4" y="1" width="8" height="14" fill={fill} />
      <rect x="2" y="3" width="12" height="10" fill={fill} />
      <rect x="1" y="5" width="14" height="6" fill={fill} />
    </>
  );
}

export function InfoIcon() {
  return (
    <MsgSvg>
      <Disc fill="#2C31C4" />
      <rect x="7" y="3" width="2" height="2" fill="#FDFDFB" />
      <rect x="7" y="6" width="2" height="7" fill="#FDFDFB" />
    </MsgSvg>
  );
}

export function ErrorIcon() {
  return (
    <MsgSvg>
      <Disc fill="#C42B2B" />
      <rect x="5" y="5" width="2" height="2" fill="#FDFDFB" />
      <rect x="9" y="5" width="2" height="2" fill="#FDFDFB" />
      <rect x="7" y="7" width="2" height="2" fill="#FDFDFB" />
      <rect x="5" y="9" width="2" height="2" fill="#FDFDFB" />
      <rect x="9" y="9" width="2" height="2" fill="#FDFDFB" />
    </MsgSvg>
  );
}

export function SuccessIcon() {
  return (
    <MsgSvg>
      <Disc fill="#0F7434" />
      <rect x="4" y="8" width="2" height="2" fill="#FDFDFB" />
      <rect x="6" y="10" width="2" height="2" fill="#FDFDFB" />
      <rect x="8" y="8" width="2" height="2" fill="#FDFDFB" />
      <rect x="10" y="6" width="2" height="2" fill="#FDFDFB" />
    </MsgSvg>
  );
}

/* ---- token icons --------------------------------------------------------- */

/** 16px pixel coin for BOUSDT: green stepped disc, white $. Mid-green body
 *  reads on white and near-black surfaces alike. */
export function BousdtIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="4" y="1" width="8" height="14" fill="#2FA457" />
      <rect x="2" y="3" width="12" height="10" fill="#2FA457" />
      <rect x="1" y="5" width="14" height="6" fill="#2FA457" />
      <rect x="4" y="3" width="8" height="1" fill="#5FCB84" />
      <rect x="7" y="3" width="2" height="10" fill="#FDFDFB" />
      <rect x="5" y="5" width="6" height="1" fill="#FDFDFB" />
      <rect x="5" y="6" width="2" height="1" fill="#FDFDFB" />
      <rect x="6" y="8" width="4" height="1" fill="#FDFDFB" />
      <rect x="9" y="9" width="2" height="1" fill="#FDFDFB" />
      <rect x="5" y="10" width="6" height="1" fill="#FDFDFB" />
    </Svg>
  );
}
