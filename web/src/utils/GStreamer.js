import { useQuery } from 'react-query'

import { getExtension } from './mediaFormats'
import { getTorrServerHost, gstSettingsHost } from './Hosts'

export const GST_RUNTIME_QUERY_KEY = 'gstreamer-runtime-settings'

const unavailableRuntime = { built_in: false }

const loadGStreamerRuntime = async () => {
  const response = await fetch(gstSettingsHost())
  if (!response.ok) return unavailableRuntime
  return response.json()
}

export const useGStreamerRuntime = () => {
  const { data } = useQuery(GST_RUNTIME_QUERY_KEY, loadGStreamerRuntime, {
    staleTime: 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return data || unavailableRuntime
}

const fileExtension = path => getExtension(path)

export const shouldUseGStreamerPlayer = (path, runtime) => {
  if (!runtime?.built_in) return false

  switch (fileExtension(path)) {
    case 'mkv':
    case 'mk3d':
    case 'mpv':
      return true
    case 'avi':
      return Boolean(runtime.config?.TranscodeAVI)
    default:
      // Everything else, including .webm, is offered to the browser first: the player
      // falls back to this ladder on its own when native playback fails.
      return false
  }
}

// Whether the transcoding ladder is worth trying after the browser failed on a direct
// stream. The GStreamer demuxers cover far more containers than any browser, so this is
// allowed broadly; AVI is the exception because it is only demuxed when explicitly
// enabled in the server settings.
export const canFallbackToGStreamer = (path, runtime) => {
  if (!runtime?.built_in) return false
  if (fileExtension(path) === 'avi') return Boolean(runtime.config?.TranscodeAVI)
  return true
}

export const gstreamerMasterUrl = (hash, fileID, audio = 0) =>
  `${getTorrServerHost()}/gst/${encodeURIComponent(hash)}/master.m3u8?index=${encodeURIComponent(
    fileID,
  )}&audio=${encodeURIComponent(audio)}`

export const gstreamerProbeUrl = (hash, fileID) =>
  `${getTorrServerHost()}/gst/${encodeURIComponent(hash)}/probe?index=${encodeURIComponent(fileID)}`

export const gstreamerHeartbeatUrl = hash => `${getTorrServerHost()}/gst/${encodeURIComponent(hash)}/heartbeat`
