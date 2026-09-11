// Always-visible attribution footnote. Positioned to clear React Flow's
// zoom controls (bottom-left), the mic overlay (bottom-center), and the
// chat button (bottom-right).
export function HackathonFootnote() {
  return (
    <p className="pointer-events-none fixed bottom-4 left-16 max-w-[220px] select-none text-[11px]/[14px] text-[#71717a] sm:max-w-none sm:whitespace-nowrap">
      Built in a 3-hour hackathon, plus some minor updates.
    </p>
  );
}
