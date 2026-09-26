import Hls from 'hls.js'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getVideoMimeType } from './mediaFormats'

export const canPlayNativeHls = video =>
  Boolean(video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL'))

// Chromium returns "maybe"/"probably" for containers it cannot actually demux, so a
// positive canPlayType is a hint rather than a guarantee. Real failures are caught by
// the media error handler and reported through onError.
export const canPlayNatively = (src, hls) => {
  if (hls) return true
  const probe = document.createElement('video')
  const mime = getVideoMimeType(src)
  if (!mime) return true
  return Boolean(probe.canPlayType(mime))
}

const toSeconds = value => (Number.isFinite(value) && value > 0 ? value : 0)

const readBuffered = video => {
  const ranges = []
  try {
    const { buffered } = video
    const total = toSeconds(video.duration)
    for (let i = 0; i < buffered.length; i += 1) {
      // A live edge reports Infinity; clamp so the bar math stays finite.
      const end = total > 0 ? Math.min(buffered.end(i), total) : buffered.end(i)
      if (Number.isFinite(end)) ranges.push({ start: buffered.start(i), end })
    }
  } catch (_) {
    return []
  }
  return ranges
}

const levelLabel = (level, index) => {
  if (!level) return String(index)
  const height = level.height || 0
  if (height) return `${height}p`
  const bitrate = Math.round((level.bitrate || 0) / 1000)
  return bitrate ? `${bitrate} kbps` : `Level ${index}`
}

const initialHlsConfig = {
  // Cap the ABR ceiling so a 4K ladder does not get picked on a slow torrent link.
  // -1 keeps hls.js' own "start at the lowest level" behaviour for the first fragment.
  startLevel: -1,
  capLevelToPlayerSize: true,
  maxBufferLength: 30,
  backBufferLength: 30,
  renderTextTracksNatively: true,
}

export const useVideoPlayback = ({ open, src, hls: useHls, onError }) => {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const onErrorRef = useRef(onError)

  const [video, setVideo] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState([])
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [levels, setLevels] = useState([])
  const [currentLevel, setCurrentLevel] = useState(-1)
  const [embeddedSubtitles, setEmbeddedSubtitles] = useState([])
  const [embeddedSubtitleIndex, setEmbeddedSubtitleIndex] = useState(-1)
  const [failure, setFailure] = useState(null)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const attachVideo = useCallback(node => {
    videoRef.current = node
    setVideo(node)
  }, [])

  // Reset everything that belongs to a source before the new one is attached.
  useEffect(() => {
    if (!open) return
    setPlaying(false)
    setEnded(false)
    setBuffering(true)
    setCurrentTime(0)
    setDuration(0)
    setBuffered([])
    setLevels([])
    setCurrentLevel(-1)
    setEmbeddedSubtitles([])
    setEmbeddedSubtitleIndex(-1)
    setFailure(null)
  }, [open, src])

  // HLS lifecycle. Native HLS (Safari) is handled by the <video src> attribute instead.
  useEffect(() => {
    if (!open || !useHls || !video) return undefined

    let player
    let usedNativeHls = false

    if (Hls.isSupported()) {
      player = new Hls(initialHlsConfig)
      hlsRef.current = player

      const syncSubtitles = (_, data) => setEmbeddedSubtitles(data.subtitleTracks || [])

      player.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setLevels((data.levels || []).map((level, index) => ({ ...level, index, label: levelLabel(level, index) })))
        setEmbeddedSubtitles(data.subtitleTracks || [])
        if (data.subtitleTracks?.length) {
          // Prefer a track the manifest marks as default so subtitles do not have to be
          // switched on again for every file. The server advertises them all as
          // DEFAULT=NO, so fall back to the first one.
          const preferred = data.subtitleTracks.findIndex(track => track.default)
          const index = preferred >= 0 ? preferred : 0
          player.subtitleDisplay = true
          player.subtitleTrack = index
          setEmbeddedSubtitleIndex(index)
        }
        video.play().catch(() => {})
      })

      player.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, syncSubtitles)

      player.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_, data) => setEmbeddedSubtitleIndex(data.id ?? -1))

      player.on(Hls.Events.LEVEL_SWITCHED, (_, data) => setCurrentLevel(data.level))

      player.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          player.startLoad()
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          player.recoverMediaError()
        } else {
          setBuffering(false)
          setFailure(data.details || 'hls')
        }
      })

      player.loadSource(src)
      player.attachMedia(video)
    } else if (canPlayNativeHls(video)) {
      usedNativeHls = true
      video.src = src
      video.load()
      video.play().catch(() => {})
    } else {
      setFailure('unsupported')
    }

    return () => {
      if (hlsRef.current === player) hlsRef.current = null
      if (player) player.destroy()
      if (usedNativeHls) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }
  }, [open, useHls, video, src])

  useEffect(() => {
    if (!video) return undefined

    const onPlay = () => {
      setPlaying(true)
      setEnded(false)
    }
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      setPlaying(false)
      setEnded(true)
    }
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    const onCanPlay = () => setBuffering(false)
    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onProgress = () => setBuffered(readBuffered(video))
    const onDurationChange = () => setDuration(toSeconds(video.duration))
    const onVolumeChange = () => {
      setVolumeState(video.volume)
      setMuted(video.muted)
    }
    const onRateChange = () => setSpeed(video.playbackRate)
    const onLoadedMetadata = () => {
      setDuration(toSeconds(video.duration))
      setBuffering(false)
      onProgress()
    }
    const onMediaError = () => {
      const code = video.error?.code
      setPlaying(false)
      setBuffering(false)
      // A missing sidecar track is not a playback failure.
      if (code === 3 && useHls) return
      setFailure(`media-${code || 'unknown'}`)
      onErrorRef.current?.(code)
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('progress', onProgress)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('ratechange', onRateChange)
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('error', onMediaError)

    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('progress', onProgress)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('volumechange', onVolumeChange)
      video.removeEventListener('ratechange', onRateChange)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('error', onMediaError)
    }
  }, [video, useHls])

  const play = useCallback(() => {
    videoRef.current?.play().catch(() => {})
  }, [])

  const pause = useCallback(() => {
    videoRef.current?.pause()
  }, [])

  const togglePlay = useCallback(() => {
    const element = videoRef.current
    if (!element) return
    if (element.paused || element.ended) {
      if (element.ended) element.currentTime = 0
      element.play().catch(() => {})
    } else {
      element.pause()
    }
  }, [])

  // Returns false when the media has no seekable range yet, so callers can retry once
  // metadata arrives.
  const seek = useCallback(value => {
    const element = videoRef.current
    if (!element || !toSeconds(element.duration)) return false
    const total = toSeconds(element.duration)
    const target = Math.min(Math.max(value, 0), total)
    element.currentTime = target
    setCurrentTime(target)
    return true
  }, [])

  const skip = useCallback(
    seconds => {
      const element = videoRef.current
      if (!element) return
      seek(element.currentTime + seconds)
    },
    [seek],
  )

  const changeVolume = useCallback(value => {
    const element = videoRef.current
    if (!element) return
    const next = Math.min(Math.max(value, 0), 1)
    element.volume = next
    element.muted = next === 0
    setVolumeState(next)
    setMuted(next === 0)
  }, [])

  const toggleMute = useCallback(() => {
    const element = videoRef.current
    if (!element) return
    element.muted = !element.muted
    setMuted(element.muted)
  }, [])

  const changeSpeed = useCallback(value => {
    const element = videoRef.current
    if (!element) return
    element.playbackRate = value
    setSpeed(value)
  }, [])

  const setQuality = useCallback(index => {
    const player = hlsRef.current
    if (!player) return
    // -1 hands the decision back to hls.js' ABR.
    player.currentLevel = index
    setCurrentLevel(index)
  }, [])

  // -1 means "off" for both embedded HLS renditions and sidecar <track> elements, so the
  // player can present one menu regardless of where the subtitles came from.
  const selectSubtitle = useCallback(index => {
    const player = hlsRef.current
    if (player) {
      player.subtitleDisplay = index >= 0
      player.subtitleTrack = index
      setEmbeddedSubtitleIndex(index)
      return
    }
    const tracks = videoRef.current?.textTracks
    if (!tracks) return
    for (let i = 0; i < tracks.length; i += 1) {
      tracks[i].mode = i === index ? 'showing' : 'disabled'
    }
  }, [])

  const retry = useCallback(() => {
    setFailure(null)
    setBuffering(true)
    const element = videoRef.current
    if (!element) return
    const position = element.currentTime
    element.load()
    if (useHls && hlsRef.current) {
      hlsRef.current.startLoad(position)
    } else {
      element.currentTime = position
      element.play().catch(() => {})
    }
  }, [useHls])

  // A stream whose duration never resolves behaves like a live edge: seeking by ratio
  // is meaningless, so the UI shows an elapsed clock instead of a scrub bar.
  const seekable = duration > 0

  return {
    attachVideo,
    buffered,
    buffering,
    changeSpeed,
    changeVolume,
    currentLevel,
    currentTime,
    duration,
    embeddedSubtitleIndex,
    embeddedSubtitles,
    ended,
    failure,
    levels,
    pause,
    play,
    playing,
    retry,
    seek,
    seekable,
    selectSubtitle,
    setQuality,
    skip,
    speed,
    toggleMute,
    togglePlay,
    videoRef,
    volume,
    muted,
  }
}
