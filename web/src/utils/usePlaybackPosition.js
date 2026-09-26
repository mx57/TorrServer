import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import { viewedHost } from './Hosts'

const SAVE_INTERVAL_MS = 5000
// Below this the viewer has not really started, and near the end the file counts as
// finished. Both cases store 0 so the next open starts from the beginning.
const MIN_RESUME_SECONDS = 10
const COMPLETION_RATIO = 0.97

export const fetchViewedList = async hash => {
  const { data } = await axios.post(viewedHost(), { action: 'list', hash })
  return Array.isArray(data) ? data : []
}

export const saveViewedPosition = async (hash, fileIndex, timecode) => {
  await axios.post(viewedHost(), { action: 'set', hash, file_index: fileIndex, timecode })
}

/**
 * Keeps the server side Viewed.TimeCode in sync with what is on screen, so reopening a
 * torrent resumes where the viewer stopped. The server drops the value unless the
 * TrackTimecode setting is enabled, which makes this a no-op there.
 */
export const usePlaybackPosition = ({ hash, fileId, currentTime, duration, active, onResume }) => {
  const [resumeTime, setResumeTime] = useState(0)
  const lastSavedRef = useRef(0)
  const resumedRef = useRef(false)
  const onResumeRef = useRef(onResume)

  useEffect(() => {
    onResumeRef.current = onResume
  }, [onResume])

  useEffect(() => {
    resumedRef.current = false
    lastSavedRef.current = 0
    setResumeTime(0)
    if (!active || !hash || fileId === undefined || fileId === null) return undefined

    let cancelled = false
    fetchViewedList(hash)
      .then(list => {
        if (cancelled) return
        const entry = list.find(item => Number(item.file_index) === Number(fileId))
        const stored = Number(entry?.timecode) || 0
        if (stored > 0 && !resumedRef.current) {
          resumedRef.current = true
          setResumeTime(stored)
          onResumeRef.current?.(stored)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [active, hash, fileId])

  const persist = useCallback(
    value => {
      if (!active || !hash || fileId === undefined || fileId === null) return
      const total = Number(duration) || 0
      const position = Number(value) || 0
      const finished = total > 0 && position >= total * COMPLETION_RATIO
      const timecode = position < MIN_RESUME_SECONDS || finished ? 0 : Math.floor(position)
      if (timecode === lastSavedRef.current) return
      lastSavedRef.current = timecode
      saveViewedPosition(hash, fileId, timecode).catch(() => {})
    },
    [active, hash, fileId, duration],
  )

  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => persist(currentTime), SAVE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active, currentTime, persist])

  // Flush on close so the last few seconds are not lost.
  useEffect(() => {
    if (active) return undefined
    return () => persist(currentTime)
  }, [active, currentTime, persist])

  return { resumeTime, persistPosition: persist }
}
