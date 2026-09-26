import { useCallback, useEffect, useRef, useState } from 'react'

// The native video picture in picture is a fixed size overlay that disappears with the
// tab, which is not what a viewer who wants a second screen expects. A Document Picture in
// Picture window is a real, user resizable window that keeps decoding while the tab sits in
// the background, so it is preferred. window.open is the fallback for browsers without it,
// and the native overlay is the last resort.

const DEFAULT_WIDTH = 720
const DEFAULT_HEIGHT = 405
const MIN_WIDTH = 320
const MIN_HEIGHT = 240

// The detached window owns a fresh document with no stylesheets from the app, so the video
// and the compact control bar are styled from this one injected sheet instead of JSS.
const DETACHED_STYLES = `
  html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
  body { display: flex; flex-direction: column; font-family: Roboto, Arial, sans-serif; }
  .tsp-video { flex: 1 1 auto; min-height: 0; width: 100%; display: block; background: #000; }
  .tsp-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 6px 8px;
             background: rgba(20,20,20,0.92); color: #fff; font-size: 12px; }
  .tsp-bar button { background: transparent; border: 0; color: #fff; cursor: pointer;
                    font-size: 15px; line-height: 1; padding: 4px 6px; border-radius: 4px; }
  .tsp-bar button:hover { background: rgba(255,255,255,0.16); }
  .tsp-bar .tsp-time { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .tsp-bar input[type=range] { flex: 1 1 auto; min-width: 40px; accent-color: #00e68a; }
  .tsp-bar .tsp-back { border: 1px solid rgba(255,255,255,0.4); font-size: 11px;
                       white-space: nowrap; padding: 4px 8px; }
`

const clampDimension = (value, fallback, min) => {
  const rounded = Math.round(Number(value))
  if (!Number.isFinite(rounded) || rounded <= 0) return fallback
  return Math.max(min, rounded)
}

const supportsDocumentPip = () =>
  typeof window !== 'undefined' && Boolean(window.documentPictureInPicture?.requestWindow)

const supportsNativePip = video => Boolean(document.pictureInPictureEnabled) && !video?.disablePictureInPicture

export const canDetachPlayer = video => supportsDocumentPip() || supportsNativePip(video)

/**
 * Moves the live <video> element out of the page and into a separate, resizable browser
 * window. The element itself is reused rather than reloaded, so the position, the buffer
 * and the active hls.js instance all survive the move.
 */
export const useDetachedPlayer = ({ videoRef, surfaceRef, title = '' }) => {
  const [detached, setDetached] = useState(false)
  const [bar, setBar] = useState(null)
  // Bumped only when the element could not be recovered, to force React to build a clean
  // <video> instead of holding a node that no longer belongs to this document.
  const [videoEpoch, setVideoEpoch] = useState(0)
  const slotRef = useRef(null)
  const barRef = useRef(null)
  const windowRef = useRef(null)

  const releaseWindow = useCallback(() => {
    const detachedWindow = windowRef.current
    windowRef.current = null
    barRef.current = null
    if (!detachedWindow || detachedWindow.closed) return
    try {
      detachedWindow.close()
    } catch (error) {
      // A window the viewer already dismissed is not a problem worth surfacing.
    }
  }, [])

  const bringBack = useCallback(
    ({ recover = false } = {}) => {
      const video = videoRef.current
      const slot = slotRef.current
      let recovered = false

      // The window can be gone before this runs, so the element is only put back while it
      // still belongs to a live document.
      if (video && slot && video.ownerDocument !== document) {
        try {
          slot.parentNode.insertBefore(video, slot.next)
          recovered = true
        } catch (error) {
          recovered = false
        }
        if (recovered && slot.className !== undefined) video.className = slot.className
      }

      slotRef.current = null
      releaseWindow()
      setBar(null)
      setDetached(false)
      if (!recovered && recover) setVideoEpoch(epoch => epoch + 1)
      return recovered
    },
    [releaseWindow, videoRef],
  )

  const openDetachedWindow = useCallback(
    detachedWindow => {
      const video = videoRef.current
      const surface = surfaceRef.current
      if (!video || !surface || !detachedWindow?.document) return false

      const pipDocument = detachedWindow.document
      pipDocument.title = title || 'TorrServer'

      const style = pipDocument.createElement('style')
      style.textContent = DETACHED_STYLES
      pipDocument.head.appendChild(style)

      const barElement = pipDocument.createElement('div')
      barElement.className = 'tsp-bar'
      pipDocument.body.appendChild(barElement)

      // Remember where the element belongs so it can be handed back untouched.
      slotRef.current = { className: video.className, next: video.nextSibling, parent: surface }
      video.className = 'tsp-video'
      pipDocument.body.appendChild(video)

      barRef.current = barElement
      windowRef.current = detachedWindow
      setBar(barElement)
      setDetached(true)
      return true
    },
    [surfaceRef, title, videoRef],
  )

  const detach = useCallback(async () => {
    const video = videoRef.current
    if (!video) return

    if (supportsDocumentPip()) {
      const width = clampDimension(surfaceRef.current?.clientWidth, DEFAULT_WIDTH, MIN_WIDTH)
      const height = clampDimension(surfaceRef.current?.clientHeight, DEFAULT_HEIGHT, MIN_HEIGHT)
      try {
        const detachedWindow = await window.documentPictureInPicture.requestWindow({ width, height })
        if (openDetachedWindow(detachedWindow)) {
          // The window taking the element with it means the player needs a fresh one.
          detachedWindow.addEventListener('pagehide', () => bringBack({ recover: true }), { once: true })
          return
        }
      } catch (error) {
        // Denied or unavailable, for instance without a user gesture: fall through.
      }
    }

    if (supportsNativePip(video)) {
      try {
        await video.requestPictureInPicture()
        return
      } catch (error) {
        // Fall through to a plain window.
      }
    }

    const detachedWindow = window.open(
      '',
      'torrserver-player',
      `width=${DEFAULT_WIDTH},height=${DEFAULT_HEIGHT},resizable=yes`,
    )
    // A blocked popup leaves the player exactly as it was.
    openDetachedWindow(detachedWindow)
  }, [bringBack, openDetachedWindow, surfaceRef, videoRef])

  useEffect(
    () => () => {
      releaseWindow()
    },
    [releaseWindow],
  )

  return { bar, bringBack, canDetach: canDetachPlayer(videoRef.current), detach, detached, videoEpoch }
}
