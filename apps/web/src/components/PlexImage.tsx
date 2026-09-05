import { useState, type ImgHTMLAttributes } from 'react'
import { useServer } from '@/plex/api'
import { cx } from '@/lib/format'

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height'> {
  /** Plex relative path (thumb/art). */
  path: string | undefined
  width: number
  height: number
}

/** Image through the server's photo transcoder with a fade-in and a neutral fallback. */
export function PlexImage({ path, width, height, className, alt = '', ...rest }: Props) {
  const server = useServer()
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!path || failed) {
    return <div className={cx('bg-bg-3', className)} aria-hidden />
  }
  // Match the device pixel ratio (capped at 2x) so remote servers don't ship oversized images.
  const dpr = Math.min(
    2,
    Math.max(1, Math.round(typeof window !== 'undefined' ? window.devicePixelRatio : 1)),
  )
  const src = server.imageUrl(path, width * dpr, height * dpr)
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={cx(
        'bg-bg-3 object-cover transition-opacity duration-300',
        loaded ? 'opacity-100' : 'opacity-0',
        className,
      )}
      {...rest}
    />
  )
}
