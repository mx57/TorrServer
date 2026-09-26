import {
  Box,
  Button,
  CircularProgress,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Slider,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@material-ui/core'
import { makeStyles, withStyles } from '@material-ui/core/styles'
import CloseIcon from '@material-ui/icons/Close'
import ErrorOutlineIcon from '@material-ui/icons/ErrorOutline'
import Forward10Icon from '@material-ui/icons/Forward10'
import FullscreenIcon from '@material-ui/icons/Fullscreen'
import FullscreenExitIcon from '@material-ui/icons/FullscreenExit'
import GetAppIcon from '@material-ui/icons/GetApp'
import HighQualityIcon from '@material-ui/icons/HighQuality'
import OpenInNewIcon from '@material-ui/icons/OpenInNew'
import PauseIcon from '@material-ui/icons/Pause'
import PictureInPictureIcon from '@material-ui/icons/PictureInPicture'
import PlayArrowIcon from '@material-ui/icons/PlayArrow'
import RefreshIcon from '@material-ui/icons/Refresh'
import Replay10Icon from '@material-ui/icons/Replay10'
import SkipNextIcon from '@material-ui/icons/SkipNext'
import SkipPreviousIcon from '@material-ui/icons/SkipPrevious'
import SpeedIcon from '@material-ui/icons/Speed'
import SubtitlesIcon from '@material-ui/icons/Subtitles'
import VolumeOffIcon from '@material-ui/icons/VolumeOff'
import VolumeUpIcon from '@material-ui/icons/VolumeUp'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { StyledDialog } from 'style/CustomMaterialUiStyles'
import { useSubtitleTracks } from 'utils/subtitles'
import { useDetachedPlayer } from 'utils/useDetachedPlayer'
import { canPlayNatively, useVideoPlayback } from 'utils/useVideoPlayback'
import { usePlaybackPosition } from 'utils/usePlaybackPosition'

import { StyledButton } from './TorrentCard/style'

const CONTROLS_IDLE_MS = 2600
const SKIP_SMALL = 5
const SKIP_LARGE = 10
const VOLUME_STEP = 0.05
const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export const formatTime = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = value => String(value).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

// useVideoPlayback reports failures as "media-<MediaError.code>". Naming the reason saves
// a round of guessing: network trouble, a broken container and an unsupported codec need
// very different reactions from the viewer.
const failureKey = failure => {
  switch (Number(String(failure || '').replace('media-', ''))) {
    case 1:
      return 'VideoPlayer.ErrorAborted'
    case 2:
      return 'VideoPlayer.ErrorNetwork'
    case 3:
      return 'VideoPlayer.ErrorDecode'
    case 4:
      return 'VideoPlayer.ErrorSource'
    default:
      return 'VideoPlayer.PlaybackFailed'
  }
}

const embeddedSubtitleLabel = track => {
  const name = track.name || track.lang
  if (!name) return 'Subtitle'
  return track.lang && track.lang.toLowerCase() !== name.toLowerCase() ? `${name} (${track.lang})` : name
}

// Safari and iOS only turn picture in picture on when the attribute is present on the
// element, but the React 17 typings used here predate it and reject the direct spelling,
// so it is applied through a spread.
const VIDEO_ELEMENT_PROPS = { allowPictureInPicture: true }

const PrettoSlider = withStyles(theme => ({
  root: {
    color: '#00e68a',
    height: 6,
    [theme?.breakpoints?.down?.('sm')]: {
      height: 0,
    },
  },
  thumb: {
    height: 18,
    width: 18,
    backgroundColor: '#fff',
    border: '2px solid currentColor',
    marginTop: -6,
    marginLeft: -12,
    [theme?.breakpoints?.down?.('sm')]: {
      height: 15,
      width: 15,
      marginTop: -5,
      marginLeft: -7,
    },
  },
  track: {
    height: 6,
    borderRadius: 4,
    [theme?.breakpoints?.down?.('sm')]: {
      height: 5,
    },
  },
  rail: {
    height: 6,
    borderRadius: 4,
    // Drawn by the component so buffered ranges can sit behind the track.
    opacity: 0,
  },
}))(Slider)

const useStyles = makeStyles(theme => ({
  dialogPaper: {
    backgroundColor: '#fff',
    borderRadius: theme.spacing(1),
  },
  header: {
    backgroundColor: '#00a572',
    color: '#fff',
    padding: theme.spacing(1, 2),
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  videoWrapper: {
    position: 'relative',
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
    outline: 'none',
  },
  video: {
    width: '100%',
    display: 'block',
    cursor: 'pointer',
    [theme.breakpoints.down('sm')]: {
      height: '94.5vh',
      width: '100vw',
      objectFit: 'contain',
    },
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1.5),
    zIndex: 4,
    color: '#fff',
    textAlign: 'center',
    padding: theme.spacing(2),
  },
  errorOverlay: {
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  promptActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    justifyContent: 'center',
  },
  centralControl: {
    borderRadius: '50%',
    padding: theme.spacing(1.5),
    backgroundColor: 'rgba(0,0,0,0.55)',
    color: '#fff',
    zIndex: 3,
    '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: '100%',
    background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
    padding: theme.spacing(0, 3, 2, 3),
    transition: 'opacity 200ms',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    zIndex: 3,
    pointerEvents: 'auto',
    [theme.breakpoints.down('sm')]: {
      padding: theme.spacing(0, 1, 2, 1),
      gap: theme.spacing(0),
      background: 'linear-gradient(to top, rgba(0,0,0,0.95), transparent)',
    },
  },
  hiddenControls: {
    opacity: 0,
    pointerEvents: 'none',
  },
  timeRow: {
    color: '#fff',
    paddingLeft: theme.spacing(2),
    fontVariantNumeric: 'tabular-nums',
    [theme.breakpoints.down('sm')]: {
      paddingLeft: theme.spacing(1),
      fontSize: 9,
    },
  },
  seekWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    height: 18,
  },
  seekRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    pointerEvents: 'none',
  },
  seekBuffered: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 4,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  seekBufferBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  slider: {
    color: '#00e68a',
    '& .MuiSlider-thumb': { backgroundColor: '#00e68a' },
    '& .MuiSlider-track': { borderRadius: 2 },
  },
  controlRow: {
    display: 'flex',
    alignItems: 'center',
  },
  iconButton: {
    color: '#fff',
    padding: 12,
    '&:hover': { backgroundColor: 'rgba(255,255,255,0.1)' },
    [theme.breakpoints.down('sm')]: {
      padding: 10,
    },
  },
  activeIconButton: {
    color: '#00e68a',
  },
  speedMenu: { minWidth: 100 },
  listMenu: {
    '& .MuiPaper-root': {
      minWidth: 180,
      maxWidth: 320,
    },
  },
}))

const VideoPlayer = ({
  videoSrc,
  downloadSrc = videoSrc,
  captions = [],
  hash,
  fileId,
  title,
  onNotSupported,
  onPlaybackError,
  hls = false,
  heartbeatSrc = '',
  showTrigger = true,
  initiallyOpen = false,
  nextTitle = '',
  onPlayNext,
  previousTitle = '',
  onPlayPrevious,
  onClose,
}) => {
  const classes = useStyles()
  const isMobile = useMediaQuery('@media (max-width:930px)')
  const { t } = useTranslation()
  const [open, setOpen] = useState(initiallyOpen)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [speedAnchorEl, setSpeedAnchorEl] = useState(null)
  const [qualityAnchorEl, setQualityAnchorEl] = useState(null)
  const [subtitleAnchorEl, setSubtitleAnchorEl] = useState(null)
  const [subtitleIndex, setSubtitleIndex] = useState(-1)
  const [pendingResume, setPendingResume] = useState(0)

  const surfaceRef = useRef(null)
  const idleTimerRef = useRef(null)
  const onNotSupportedRef = useRef(onNotSupported)
  const onPlaybackErrorRef = useRef(onPlaybackError)
  const onPlayNextRef = useRef(onPlayNext)
  const onPlayPreviousRef = useRef(onPlayPrevious)

  const playback = useVideoPlayback({
    open,
    src: videoSrc,
    hls,
    onError: () => onPlaybackErrorRef.current?.(),
  })
  const {
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
    muted,
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
  } = playback

  // A stored position is offered rather than applied: silently jumping into the middle of
  // a file is jarring, and the viewer often reopened a file only to look something up.
  const { persistPosition } = usePlaybackPosition({
    hash,
    fileId,
    currentTime,
    duration,
    active: open,
    onResume: setPendingResume,
  })
  const sidecarTracks = useSubtitleTracks(captions, open && !hls)
  const { bar, bringBack, canDetach, detach, detached, videoEpoch } = useDetachedPlayer({
    videoRef,
    surfaceRef,
    title,
  })

  useEffect(() => {
    onNotSupportedRef.current = onNotSupported
  }, [onNotSupported])

  useEffect(() => {
    onPlaybackErrorRef.current = onPlaybackError
  }, [onPlaybackError])

  useEffect(() => {
    onPlayNextRef.current = onPlayNext
  }, [onPlayNext])

  useEffect(() => {
    onPlayPreviousRef.current = onPlayPrevious
  }, [onPlayPrevious])

  // Containers the browser cannot demux are reported once, up front, so the caller can
  // offer the transcoding ladder instead of opening a player that will never start.
  useEffect(() => {
    if (!canPlayNatively(videoSrc, hls)) onNotSupportedRef.current?.()
  }, [hls, videoSrc])

  // The stored position arrives from the server, so the prompt can show up after the
  // player is already on screen.
  useEffect(() => {
    setPendingResume(0)
  }, [open, hash, fileId])

  const acceptResume = useCallback(() => {
    seek(pendingResume)
    setPendingResume(0)
    play()
  }, [pendingResume, play, seek])

  const startOver = useCallback(() => {
    seek(0)
    setPendingResume(0)
    // Overwrite the stored position straight away, otherwise the periodic save can put
    // the old offset back before the viewer has watched anything.
    persistPosition(0)
  }, [persistPosition, seek])

  const replay = useCallback(() => {
    seek(0)
    play()
  }, [play, seek])

  const playNext = useCallback(() => {
    if (onPlayNextRef.current) onPlayNextRef.current()
  }, [])

  const playPrevious = useCallback(() => {
    if (onPlayPreviousRef.current) onPlayPreviousRef.current()
  }, [])

  useEffect(() => {
    if (!open || !heartbeatSrc) return undefined
    const timer = window.setInterval(() => {
      fetch(heartbeatSrc, { cache: 'no-store' }).catch(() => {})
    }, 30 * 1000)
    return () => window.clearInterval(timer)
  }, [heartbeatSrc, open])

  useEffect(() => {
    if (!open) return
    surfaceRef.current?.focus({ preventScroll: true })
  }, [open])

  // One menu for both subtitle sources: embedded HLS renditions and converted sidecars.
  const subtitleOptions = useMemo(() => {
    if (hls) {
      return embeddedSubtitles.map((track, index) => ({
        key: `${track.id ?? index}`,
        label: embeddedSubtitleLabel(track),
      }))
    }
    return sidecarTracks.map((track, index) => ({ key: `${track.lang || 'und'}-${index}`, label: track.label }))
  }, [hls, embeddedSubtitles, sidecarTracks])

  useEffect(() => {
    // Mirror the track hls.js picked for itself so the menu shows the truth.
    if (hls) setSubtitleIndex(embeddedSubtitleIndex)
  }, [hls, embeddedSubtitleIndex])

  useEffect(() => {
    // Turn the first sidecar on by default, the same way the HLS path does.
    if (hls || subtitleIndex !== -1 || !sidecarTracks.length) return
    setSubtitleIndex(0)
    selectSubtitle(0)
  }, [hls, selectSubtitle, sidecarTracks.length, subtitleIndex])

  const closeMenus = useCallback(() => {
    setSpeedAnchorEl(null)
    setQualityAnchorEl(null)
    setSubtitleAnchorEl(null)
    setMenuOpen(false)
  }, [])

  // Controls fade while playing and return on any pointer or key activity.
  const revealControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(idleTimerRef.current)
    if (!playing) return
    idleTimerRef.current = window.setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS)
  }, [playing])

  useEffect(() => {
    revealControls()
    return () => window.clearTimeout(idleTimerRef.current)
  }, [revealControls])

  useEffect(() => {
    const onFull = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFull)
    return () => document.removeEventListener('fullscreenchange', onFull)
  }, [])

  // The wrapper goes fullscreen rather than the <video>, otherwise the controls are
  // left outside the fullscreen element and become unreachable.
  const canFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)
  const enterFullscreen = useCallback(() => {
    const node = surfaceRef.current
    const request = node?.requestFullscreen || node?.webkitRequestFullscreen
    if (request) request.call(node).catch(() => {})
  }, [])

  const exitFullscreen = useCallback(() => {
    const exit = document.exitFullscreen || document.webkitExitFullscreen
    if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) exit.call(document)
  }, [])

  const canPictureInPicture =
    typeof document !== 'undefined' &&
    Boolean(document.pictureInPictureEnabled) &&
    !videoRef.current?.disablePictureInPicture

  const togglePictureInPicture = useCallback(async () => {
    const video = videoRef.current
    if (!video || !document.pictureInPictureEnabled) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video.requestPictureInPicture()
    } catch (_) {
      // Safari and iOS reject the request outside a user gesture; nothing to recover.
    }
  }, [videoRef])

  const changeSubtitle = useCallback(
    index => {
      setSubtitleIndex(index)
      selectSubtitle(index)
      closeMenus()
    },
    [closeMenus, selectSubtitle],
  )

  const cycleSubtitles = useCallback(() => {
    const next = subtitleIndex + 1 >= subtitleOptions.length ? -1 : subtitleIndex + 1
    changeSubtitle(next)
  }, [changeSubtitle, subtitleIndex, subtitleOptions.length])

  const openMenu = setter => event => {
    event.stopPropagation()
    setter(event.currentTarget)
    setMenuOpen(true)
    revealControls()
  }

  const pickSpeed = useCallback(
    rate => {
      changeSpeed(rate)
      closeMenus()
    },
    [changeSpeed, closeMenus],
  )

  const pickQuality = useCallback(
    index => {
      setQuality(index)
      closeMenus()
    },
    [closeMenus, setQuality],
  )

  const downloadVideo = () => {
    const link = document.createElement('a')
    link.href = downloadSrc
    link.download = ''
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const closePlayer = () => {
    persistPosition(currentTime)
    setOpen(false)
    onClose?.()
  }

  const handleSurfaceClick = () => {
    revealControls()
    if (menuOpen) return
    togglePlay()
  }

  const stepSpeed = useCallback(
    direction => {
      const index = SPEED_OPTIONS.indexOf(speed)
      pickSpeed(SPEED_OPTIONS[Math.min(Math.max(index + direction, 0), SPEED_OPTIONS.length - 1)])
    },
    [pickSpeed, speed],
  )

  // Keys are bound to the player surface rather than the document, so menus and controls
  // elsewhere on the page keep their own bindings instead of being hijacked.
  const handleKeyDown = useCallback(
    event => {
      if (!open || menuOpen) return
      const { target } = event
      if (target !== surfaceRef.current && target.tagName !== 'VIDEO') return
      if (target.isContentEditable) return

      const consume = () => {
        event.preventDefault()
        event.stopPropagation()
        revealControls()
      }

      if (/^[0-9]$/.test(event.key)) {
        if (!seekable) return
        consume()
        seek((duration * Number(event.key)) / 10)
        return
      }

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          consume()
          togglePlay()
          break
        case 'ArrowRight':
          consume()
          skip(SKIP_SMALL)
          break
        case 'ArrowLeft':
          consume()
          skip(-SKIP_SMALL)
          break
        case 'l':
        case 'L':
          consume()
          skip(SKIP_LARGE)
          break
        case 'j':
        case 'J':
          consume()
          skip(-SKIP_LARGE)
          break
        case 'ArrowUp':
          consume()
          changeVolume(volume + VOLUME_STEP)
          break
        case 'ArrowDown':
          consume()
          changeVolume(volume - VOLUME_STEP)
          break
        case 'm':
        case 'M':
          consume()
          toggleMute()
          break
        case 'f':
        case 'F':
          consume()
          if (fullscreen) exitFullscreen()
          else enterFullscreen()
          break
        case 'c':
        case 'C':
          if (!subtitleOptions.length) return
          consume()
          cycleSubtitles()
          break
        case 'Home':
          consume()
          seek(0)
          break
        case 'End':
          if (!seekable) return
          consume()
          seek(duration)
          break
        case '>':
        case '.':
          consume()
          stepSpeed(1)
          break
        case '<':
        case ',':
          consume()
          stepSpeed(-1)
          break
        default:
          break
      }
    },
    [
      changeVolume,
      cycleSubtitles,
      duration,
      enterFullscreen,
      exitFullscreen,
      fullscreen,
      menuOpen,
      open,
      revealControls,
      seek,
      seekable,
      skip,
      stepSpeed,
      subtitleOptions.length,
      toggleMute,
      togglePlay,
      volume,
    ],
  )

  const percent = value => (seekable && duration ? `${Math.min((value / duration) * 100, 100)}%` : '0%')
  const controlsHidden = controlsVisible || !playing ? '' : classes.hiddenControls
  const sortedLevels = useMemo(
    () => [...levels].sort((left, right) => (right.bitrate || 0) - (left.bitrate || 0)),
    [levels],
  )

  return (
    <>
      {showTrigger && (
        <StyledButton
          onClick={() => {
            setOpen(true)
            revealControls()
          }}
        >
          <PlayArrowIcon />
          <span>{t('Play')}</span>
        </StyledButton>
      )}
      <StyledDialog
        open={open}
        onClose={closePlayer}
        maxWidth='lg'
        fullWidth
        fullScreen={isMobile}
        classes={{ paper: classes.dialogPaper }}
      >
        <DialogTitle className={classes.header} disableTypography>
          <Typography variant='h6' noWrap>
            {title || 'Video Player'}
          </Typography>
          <IconButton size='medium' onClick={closePlayer} className={classes.iconButton}>
            <CloseIcon fontSize='medium' />
          </IconButton>
        </DialogTitle>
        <DialogContent style={{ padding: 0 }}>
          <Box
            ref={surfaceRef}
            tabIndex={-1}
            role='region'
            aria-label={title || 'Video Player'}
            className={classes.videoWrapper}
            onKeyDown={handleKeyDown}
            onClick={handleSurfaceClick}
            onDoubleClick={fullscreen ? exitFullscreen : enterFullscreen}
            onMouseMove={revealControls}
            onTouchStart={revealControls}
            style={isMobile ? { minHeight: 240 } : undefined}
          >
            {/* Captions are optional and arrive from sidecar files or HLS subtitle tracks, so the
                <track> children below are rendered conditionally rather than always. */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              key={videoEpoch}
              ref={attachVideo}
              src={hls ? undefined : videoSrc}
              className={classes.video}
              playsInline
              {...VIDEO_ELEMENT_PROPS}
              preload='metadata'
            >
              {/* Keyed by the torrent file id so that a sidecar refetch producing a fresh
                  blob URL updates the existing <track> instead of remounting it. */}
              {sidecarTracks.map((track, index) => (
                <track
                  key={track.id}
                  kind='subtitles'
                  srcLang={track.lang || 'und'}
                  label={track.label}
                  src={track.src}
                  default={index === 0}
                />
              ))}
            </video>

            {!failure && ended && (
              <Box className={classes.overlay} onClick={event => event.stopPropagation()}>
                {nextTitle && <Typography variant='body1'>{t('VideoPlayer.UpNext', { title: nextTitle })}</Typography>}
                <Box className={classes.promptActions}>
                  {onPlayNextRef.current && (
                    <Button variant='contained' color='primary' onClick={playNext}>
                      {t('VideoPlayer.PlayNext')}
                    </Button>
                  )}
                  <Button variant='outlined' onClick={replay}>
                    {t('VideoPlayer.Replay')}
                  </Button>
                </Box>
              </Box>
            )}

            {detached && (
              <Box className={classes.overlay} onClick={event => event.stopPropagation()}>
                <OpenInNewIcon fontSize='large' />
                <Typography variant='body1'>{t('VideoPlayer.PlayingDetached')}</Typography>
                <Button variant='contained' color='primary' onClick={() => bringBack()}>
                  {t('VideoPlayer.BackToTab')}
                </Button>
              </Box>
            )}

            {failure && (
              <Box className={`${classes.overlay} ${classes.errorOverlay}`} onClick={event => event.stopPropagation()}>
                <ErrorOutlineIcon fontSize='large' />
                <Typography variant='body1'>{t(failureKey(failure))}</Typography>
                <Button variant='contained' color='primary' startIcon={<RefreshIcon />} onClick={retry}>
                  {t('VideoPlayer.Retry')}
                </Button>
              </Box>
            )}

            {!failure && !pendingResume && buffering && !playing && (
              <Box className={classes.overlay} onClick={event => event.stopPropagation()}>
                <CircularProgress />
              </Box>
            )}

            {pendingResume > 0 && (
              <Box className={classes.overlay} onClick={event => event.stopPropagation()}>
                <Typography variant='body1'>
                  {t('VideoPlayer.ResumeAt', { time: formatTime(pendingResume) })}
                </Typography>
                <Box className={classes.promptActions}>
                  <Button variant='contained' color='primary' onClick={acceptResume}>
                    {t('VideoPlayer.Resume')}
                  </Button>
                  <Button variant='outlined' onClick={startOver}>
                    {t('VideoPlayer.StartOver')}
                  </Button>
                </Box>
              </Box>
            )}

            {!failure && !pendingResume && !ended && !buffering && !playing && (
              <IconButton
                size='medium'
                aria-label={t('Play')}
                className={classes.centralControl}
                onClick={event => {
                  event.stopPropagation()
                  togglePlay()
                }}
              >
                <PlayArrowIcon fontSize='large' />
              </IconButton>
            )}

            <Box
              className={`${classes.controls} ${controlsHidden}`}
              onClick={event => event.stopPropagation()}
              onMouseMove={revealControls}
            >
              <Box className={classes.seekWrap}>
                <Box className={classes.seekRail} />
                <Box className={classes.seekBuffered}>
                  {buffered.map((range, index) => (
                    <Box
                      // Buffered ranges are positional and carry no stable identity.
                      // eslint-disable-next-line react/no-array-index-key
                      key={index}
                      className={classes.seekBufferBar}
                      style={{ left: percent(range.start), width: percent(range.end - range.start) }}
                    />
                  ))}
                </Box>
                {seekable && (
                  <PrettoSlider
                    className={classes.slider}
                    value={currentTime}
                    max={duration}
                    onChange={(_, value) => seek(value)}
                    aria-label={t('VideoPlayer.Seek')}
                    size='medium'
                  />
                )}
              </Box>

              <Box className={classes.controlRow}>
                <Tooltip title={playing ? t('Pause') : t('Play')}>
                  <IconButton size='medium' onClick={togglePlay} className={classes.iconButton}>
                    {playing ? <PauseIcon fontSize='medium' /> : <PlayArrowIcon fontSize='medium' />}
                  </IconButton>
                </Tooltip>
                {onPlayPreviousRef.current && (
                  <Tooltip
                    title={
                      previousTitle
                        ? t('VideoPlayer.PreviousEpisode', { title: previousTitle })
                        : t('VideoPlayer.PreviousEpisode')
                    }
                  >
                    <IconButton
                      size='medium'
                      className={classes.iconButton}
                      onClick={event => {
                        event.stopPropagation()
                        playPrevious()
                      }}
                    >
                      <SkipPreviousIcon fontSize='medium' />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={t('Rewind-10-Sec')}>
                  <IconButton
                    size='medium'
                    className={classes.iconButton}
                    onClick={event => {
                      event.stopPropagation()
                      skip(-SKIP_LARGE)
                    }}
                  >
                    <Replay10Icon fontSize='medium' />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('Forward-10-Sec')}>
                  <IconButton
                    size='medium'
                    className={classes.iconButton}
                    onClick={event => {
                      event.stopPropagation()
                      skip(SKIP_LARGE)
                    }}
                  >
                    <Forward10Icon fontSize='medium' />
                  </IconButton>
                </Tooltip>
                {onPlayNextRef.current && (
                  <Tooltip
                    title={
                      nextTitle ? t('VideoPlayer.NextEpisode', { title: nextTitle }) : t('VideoPlayer.NextEpisode')
                    }
                  >
                    <IconButton
                      size='medium'
                      className={classes.iconButton}
                      onClick={event => {
                        event.stopPropagation()
                        playNext()
                      }}
                    >
                      <SkipNextIcon fontSize='medium' />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={muted ? t('Unmute') : t('Mute')}>
                  <IconButton size='medium' className={classes.iconButton} onClick={toggleMute}>
                    {muted ? <VolumeOffIcon fontSize='medium' /> : <VolumeUpIcon fontSize='medium' />}
                  </IconButton>
                </Tooltip>
                {!isMobile && (
                  <Slider
                    className={classes.slider}
                    value={muted ? 0 : volume * 100}
                    onChange={(_, value) => changeVolume(value / 100)}
                    aria-label={t('Mute')}
                    size='medium'
                    style={{ width: 70 }}
                  />
                )}

                <Box className={classes.timeRow}>
                  <Typography variant='body2'>
                    {formatTime(currentTime)}
                    {seekable ? ` / ${formatTime(duration)}` : ''}
                  </Typography>
                </Box>

                <Box flexGrow={1} />

                {sortedLevels.length > 1 && (
                  <>
                    <Tooltip title={t('VideoPlayer.Quality')}>
                      <IconButton
                        size='medium'
                        onClick={openMenu(setQualityAnchorEl)}
                        className={`${classes.iconButton} ${currentLevel >= 0 ? classes.activeIconButton : ''}`}
                      >
                        <HighQualityIcon fontSize='medium' />
                      </IconButton>
                    </Tooltip>
                    <Menu
                      anchorEl={qualityAnchorEl}
                      open={Boolean(qualityAnchorEl)}
                      onClose={closeMenus}
                      className={classes.listMenu}
                    >
                      <MenuItem selected={currentLevel === -1} onClick={() => pickQuality(-1)}>
                        {t('VideoPlayer.Auto')}
                      </MenuItem>
                      {sortedLevels.map(level => (
                        <MenuItem
                          key={level.index}
                          selected={currentLevel === level.index}
                          onClick={() => pickQuality(level.index)}
                        >
                          {level.label}
                        </MenuItem>
                      ))}
                    </Menu>
                  </>
                )}

                {subtitleOptions.length > 0 && (
                  <>
                    <Tooltip title={t('VideoPlayer.Subtitles')}>
                      <IconButton
                        size='medium'
                        onClick={openMenu(setSubtitleAnchorEl)}
                        className={`${classes.iconButton} ${subtitleIndex >= 0 ? classes.activeIconButton : ''}`}
                      >
                        <SubtitlesIcon fontSize='medium' />
                      </IconButton>
                    </Tooltip>
                    <Menu
                      anchorEl={subtitleAnchorEl}
                      open={Boolean(subtitleAnchorEl)}
                      onClose={closeMenus}
                      className={classes.listMenu}
                    >
                      <MenuItem selected={subtitleIndex === -1} onClick={() => changeSubtitle(-1)}>
                        {t('None')}
                      </MenuItem>
                      {subtitleOptions.map((option, index) => (
                        <MenuItem
                          key={option.key}
                          selected={subtitleIndex === index}
                          onClick={() => changeSubtitle(index)}
                        >
                          {option.label}
                        </MenuItem>
                      ))}
                    </Menu>
                  </>
                )}

                <Tooltip title={t('Speed')}>
                  <IconButton size='medium' onClick={openMenu(setSpeedAnchorEl)} className={classes.iconButton}>
                    <SpeedIcon fontSize='medium' />
                  </IconButton>
                </Tooltip>
                <Menu
                  anchorEl={speedAnchorEl}
                  open={Boolean(speedAnchorEl)}
                  onClose={closeMenus}
                  className={classes.speedMenu}
                >
                  {SPEED_OPTIONS.map(rate => (
                    <MenuItem key={rate} selected={rate === speed} onClick={() => pickSpeed(rate)}>
                      {rate}x
                    </MenuItem>
                  ))}
                </Menu>

                {canDetach && (
                  <Tooltip title={detached ? t('VideoPlayer.BackToTab') : t('VideoPlayer.PopOut')}>
                    <IconButton size='medium' className={classes.iconButton} onClick={detached ? bringBack : detach}>
                      {detached ? <PictureInPictureIcon fontSize='medium' /> : <OpenInNewIcon fontSize='medium' />}
                    </IconButton>
                  </Tooltip>
                )}

                {canPictureInPicture && (
                  <Tooltip title={t('PIP')}>
                    <IconButton size='medium' className={classes.iconButton} onClick={togglePictureInPicture}>
                      <PictureInPictureIcon fontSize='medium' />
                    </IconButton>
                  </Tooltip>
                )}

                <Tooltip title={t('Download')}>
                  <IconButton size='medium' className={classes.iconButton} onClick={downloadVideo}>
                    <GetAppIcon fontSize='medium' />
                  </IconButton>
                </Tooltip>

                {canFullscreen && (
                  <Tooltip title={fullscreen ? t('ExitFullscreen') : t('Fullscreen')}>
                    <IconButton
                      size='medium'
                      onClick={fullscreen ? exitFullscreen : enterFullscreen}
                      className={classes.iconButton}
                    >
                      {fullscreen ? <FullscreenExitIcon fontSize='medium' /> : <FullscreenIcon fontSize='medium' />}
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          </Box>

          {/* The detached window is a separate document with no React tree of its own, so the
              compact bar is portalled into a plain element created there by the hook. */}
          {bar &&
            createPortal(
              <div style={{ display: 'contents' }}>
                <button type='button' title={t('Play')} onClick={togglePlay}>
                  {playing ? '❙❙' : '▶'}
                </button>
                <span className='tsp-time'>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                <input
                  type='range'
                  min='0'
                  max={seekable ? duration : 0}
                  step='0.5'
                  value={seekable ? currentTime : 0}
                  disabled={!seekable}
                  onChange={event => seek(Number(event.target.value))}
                />
                <button type='button' title={t('Mute')} onClick={toggleMute}>
                  {muted ? t('Unmute') : t('Mute')}
                </button>
                <button type='button' className='tsp-back' onClick={() => bringBack()}>
                  {t('VideoPlayer.BackToTab')}
                </button>
              </div>,
              bar,
            )}
        </DialogContent>
      </StyledDialog>
    </>
  )
}

export default VideoPlayer
