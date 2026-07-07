/** Ambient retro background shared by every route: drifting pixel checker,
 *  starfield, dark-mode scanlines, and a pixel shooting star every ~25s.
 *  All layers sit behind the windows (negative z-index); the app root stays
 *  transparent and the body carries the ground color. */
export function AmbientLayers() {
  return (
    <>
      <div aria-hidden="true" className="ambient" />
      <div aria-hidden="true" className="starfield">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <div aria-hidden="true" className="scanlines" />
      <div aria-hidden="true" className="star" />
    </>
  );
}
