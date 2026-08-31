import { cn } from '@/lib/utils'

type BrandLogoSize = 'header' | 'sidebar' | 'hero'

const sizeClasses: Record<BrandLogoSize, string> = {
  header: 'text-[0.7rem]',
  sidebar: 'text-xl',
  hero: 'text-4xl sm:text-5xl',
}

export function BrandLogo({
  className,
  size = 'sidebar',
}: {
  className?: string
  size?: BrandLogoSize
}) {
  return (
    <span
      aria-label="TaxGenie"
      role="img"
      className={cn(
        'inline-flex shrink-0 items-baseline font-bold leading-none tracking-[-0.055em]',
        sizeClasses[size],
        className,
      )}
    >
      <span key="tax" aria-hidden="true" className="text-brand-navy">
        Tax
      </span>
      <span key="genie" aria-hidden="true" className="text-brand-teal">
        Genie
      </span>
    </span>
  )
}
