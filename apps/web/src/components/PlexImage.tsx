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
  // Request 2x for HiDPI; the photo transcoder is cheap and results are cached server-side.
  const src = server.imageUrl(path, width * 2, height * 2)
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
