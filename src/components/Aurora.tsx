const BUBBLES: { left: number; size: number; dur: number; delay: number; drift: number }[] = [
  { left: 6, size: 26, dur: 26, delay: 0, drift: 40 },
  { left: 14, size: 12, dur: 21, delay: 6, drift: -30 },
  { left: 22, size: 40, dur: 34, delay: 12, drift: 24 },
  { left: 33, size: 16, dur: 24, delay: 3, drift: -18 },
  { left: 44, size: 10, dur: 19, delay: 9, drift: 30 },
  { left: 52, size: 30, dur: 30, delay: 15, drift: -42 },
  { left: 61, size: 14, dur: 22, delay: 1, drift: 22 },
  { left: 70, size: 22, dur: 27, delay: 11, drift: -26 },
  { left: 79, size: 12, dur: 20, delay: 5, drift: 34 },
  { left: 86, size: 34, dur: 33, delay: 17, drift: -20 },
  { left: 93, size: 18, dur: 25, delay: 8, drift: 26 },
  { left: 98, size: 10, dur: 18, delay: 14, drift: -14 },
]

/** Fixed full-viewport Frutiger Aero backdrop: aurora blobs, sheen and rising bubbles. */
export default function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <div className="aurora-blob aurora-b1" />
      <div className="aurora-blob aurora-b2" />
      <div className="aurora-blob aurora-b3" />
      <div className="aurora-sheen" />
      {BUBBLES.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.size,
            animationDuration: `${b.dur}s`,
            animationDelay: `${b.delay}s`,
            ['--drift' as string]: `${b.drift}px`,
          }}
        />
      ))}
    </div>
  )
}
