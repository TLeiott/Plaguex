import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cx } from '@/lib/format'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'icon'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95 font-semibold',
  secondary: 'bg-bg-3 text-fg hover:bg-line active:bg-bg-3',
  ghost: 'bg-transparent text-fg-2 hover:text-fg hover:bg-bg-3/70',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-10 w-10 p-0',
}

export function buttonClass(
  variant: Variant = 'secondary',
  size: Size = 'md',
  className?: string,
): string {
  return cx(
    'inline-flex items-center justify-center rounded-lg transition-[background-color,filter,color] duration-150 select-none disabled:opacity-50 disabled:pointer-events-none',
    variants[variant],
    sizes[size],
    className,
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled ?? loading}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
})

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cx('size-6 animate-spin text-fg-3', className)}
      aria-label="Loading"
      role="status"
    />
  )
}

export function PageSpinner() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <Spinner className="size-8" />
    </div>
  )
}

export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string
  children?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-24 text-center"
      role="status"
    >
      {icon ? <div className="text-fg-3">{icon}</div> : null}
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      {children ? <div className="max-w-md text-sm text-fg-2">{children}</div> : null}
    </div>
  )
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div
      role="alert"
      className="mx-auto my-16 max-w-lg rounded-card border border-danger/30 bg-danger/10 p-5 text-sm"
    >
      <p className="font-semibold text-danger">Something went wrong</p>
      <p className="mt-1 break-all text-fg-2">{message}</p>
      {retry ? (
        <Button className="mt-4" size="sm" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'warn'
}) {
  return (
    <span
      className={cx(
        'inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold uppercase tracking-wide',
        tone === 'accent' && 'bg-accent/15 text-accent',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'neutral' && 'bg-bg-3 text-fg-2',
      )}
    >
      {children}
    </span>
  )
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div
      className={cx('h-1 w-full overflow-hidden rounded-full bg-white/20', className)}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full bg-accent" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}
