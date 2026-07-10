/** Product logo — horned owl mark. */
export default function OwlLogo({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="پلتفرم بینا"
      className={`shrink-0 object-contain ${className ?? 'size-8'}`}
    />
  )
}
