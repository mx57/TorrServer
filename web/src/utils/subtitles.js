import { useEffect, useState } from 'react'

import { getExtension } from './mediaFormats'

// Browsers only accept WebVTT in a <track> element: Chrome and Firefox silently drop
// .srt, .ass and .ssa sources. Torrents ship sidecar subtitles in all three formats, so
// they are converted in the browser and handed to the track loader as a blob URL.

const pad = (value, length = 2) => String(value).padStart(length, '0')

// MicroDVD and SAMI both leave the final cue open ended, so they borrow a short default
// when no following cue supplies an end time.
const DEFAULT_CUE_SECONDS = 2

const toVttTimestamp = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00.000'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const millis = Math.round((seconds - Math.floor(seconds)) * 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(millis, 3)}`
}

// "00:01:02,500" / "0:01:02.5" / "01:02" -> seconds
const parseTimestamp = value => {
  const parts = String(value).trim().replace(',', '.').split(':')
  if (!parts.length) return NaN
  const seconds = Number(parts[parts.length - 1])
  const minutes = parts.length > 1 ? Number(parts[parts.length - 2]) : 0
  const hours = parts.length > 2 ? Number(parts[parts.length - 3]) : 0
  if ([seconds, minutes, hours].some(part => !Number.isFinite(part))) return NaN
  return hours * 3600 + minutes * 60 + seconds
}

const escapeCueText = text =>
  String(text)
    .replace(/\r/g, '')
    .replace(/<[^>]*>/g, '')
    .trim()

const blocksFromCues = cues =>
  ['WEBVTT', '']
    .concat(cues.map(cue => `${toVttTimestamp(cue.start)} --> ${toVttTimestamp(cue.end)}\n${cue.text}`))
    .join('\n\n')

const parseSrt = input => {
  const cues = []
  String(input)
    .replace(/\r/g, '')
    .replace(/^\uFEFF/, '')
    .split(/\n{2,}/)
    .forEach(block => {
      const lines = block.split('\n').filter(line => line.trim() !== '')
      const arrowIndex = lines.findIndex(line => line.includes('-->'))
      if (arrowIndex === -1) return
      const [rawStart, rawEnd] = lines[arrowIndex].split('-->')
      const start = parseTimestamp(rawStart)
      const end = parseTimestamp((rawEnd || '').split(/\s+/).filter(Boolean)[0])
      const text = escapeCueText(lines.slice(arrowIndex + 1).join('\n'))
      if (!Number.isFinite(start) || !Number.isFinite(end) || !text) return
      cues.push({ start, end, text })
    })
  return cues.sort((a, b) => a.start - b.start)
}

// SubStation Alpha keeps its cues in the [Events] section. Styling is dropped, which is
// all a native <track> can render anyway, but the timing and the text survive.
const parseAss = input => {
  const lines = String(input).replace(/\r/g, '').split('\n')
  const cues = []
  let inEvents = false
  let textIndex = 3
  let startIndex = 1
  let endIndex = 2

  lines.forEach(line => {
    const trimmed = line.trim()
    if (/^\[/.test(trimmed)) {
      inEvents = /^\[events\]$/i.test(trimmed)
      return
    }
    if (!inEvents) return

    const separator = trimmed.indexOf(':')
    if (separator === -1) return
    const key = trimmed.slice(0, separator).trim().toLowerCase()

    if (key === 'format') {
      const fields = trimmed
        .slice(separator + 1)
        .split(',')
        .map(field => field.trim().toLowerCase())
      const textAt = fields.indexOf('text')
      if (textAt >= 0) textIndex = textAt
      const startAt = fields.indexOf('start')
      if (startAt >= 0) startIndex = startAt
      const endAt = fields.indexOf('end')
      if (endAt >= 0) endIndex = endAt
      return
    }

    if (key !== 'dialogue' && key !== 'comment') return

    // The text field is last and may itself contain commas, so slice it off first.
    const fields = trimmed.slice(separator + 1).split(',')
    if (fields.length <= Math.max(startIndex, endIndex, textIndex)) return

    const start = parseTimestamp(fields[startIndex])
    const end = parseTimestamp(fields[endIndex])
    const text = escapeCueText(
      fields
        .slice(textIndex)
        .join(',')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\N|\\n/g, '\n')
        .replace(/\\h/g, ' '),
    )
    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) return
    cues.push({ start, end, text })
  })

  return cues.sort((a, b) => a.start - b.start)
}

// MicroDVD (.sub) stores one cue per line as "{start}{end}text". The numbers are frame
// indices unless the file opens with a "{1}{1}fps" declaration, in which case they are
// divided by it. "|" marks a line break.
const parseMicroDvd = input => {
  const lines = String(input)
    .replace(/\r/g, '')
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const header = lines.length ? lines[0].match(/^\{1\}\{1\}(\d+(?:\.\d+)?)$/) : null
  const frameRate = header ? Number(header[1]) : 0
  if (header) lines.shift()

  const toSeconds = value => (frameRate > 0 ? value / frameRate : value)

  const cues = []
  lines.forEach(line => {
    const match = line.match(/^\{(\d+(?:\.\d+)?)\}\{(\d+(?:\.\d+)?)\}([\s\S]*)$/)
    if (!match) return
    const start = toSeconds(Number(match[1]))
    const end = toSeconds(Number(match[2]))
    const text = escapeCueText(match[3].replace(/\{[^}]*\}/g, '').replace(/\|/g, '\n'))
    if (!Number.isFinite(start) || !text) return
    cues.push({ start, end: Number.isFinite(end) ? end : start, text })
  })

  // An end of zero means "open ended", which is most cues: close them at the next start.
  return cues
    .map((cue, index) => {
      if (cue.end > cue.start) return cue
      const next = cues[index + 1]
      const end = next && next.start > cue.start ? next.start : cue.start + DEFAULT_CUE_SECONDS
      return { start: cue.start, end, text: cue.text }
    })
    .sort((a, b) => a.start - b.start)
}

const decodeEntities = text =>
  text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (all, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (all, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')

// SAMI (.smi) is XML: a run of <SYNC Start="milliseconds"> blocks each wrapping one <P>.
const parseSami = input => {
  const source = String(input)
    .replace(/\r/g, '')
    .replace(/^\uFEFF/, '')
  const entries = []
  const syncPattern = /<SYNC\b[^>]*\bStart\s*=\s*"?(\d+)"?[^>]*>([\s\S]*?)<\/SYNC>/gi

  let match = syncPattern.exec(source)
  while (match) {
    entries.push({ start: Number(match[1]) / 1000, body: match[2] })
    match = syncPattern.exec(source)
  }

  const cues = []
  entries.forEach((entry, index) => {
    const paragraph = entry.body.match(/<P\b[^>]*>([\s\S]*?)<\/P>/i)
    // Entities are decoded last so a decoded "<" is not mistaken for a tag afterwards.
    const text = decodeEntities(
      (paragraph ? paragraph[1] : entry.body).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''),
    )
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n')
    if (!text) return
    const next = entries[index + 1]
    const end = next && next.start > entry.start ? next.start : entry.start + DEFAULT_CUE_SECONDS
    cues.push({ start: entry.start, end, text })
  })

  return cues.sort((a, b) => a.start - b.start)
}

// ".sub" and ".smi" are unreliable: a ".sub" is regularly MicroDVD, sometimes SubStation
// and occasionally SubRip, while plenty of ".smi" files are plain SubRip. The payload is
// the only reliable signal, so the extension is only trusted to short circuit WebVTT.
const detectSubtitleFormat = input => {
  const source = String(input)
    .replace(/\r/g, '')
    .replace(/^\uFEFF/, '')
    .trimStart()
  if (/^<\?xml/i.test(source) || /<sami\b/i.test(source) || /<sync\b/i.test(source)) return 'sami'
  if (/\[Script Info\]/i.test(source) || /\[V4\+? Styles\]/i.test(source)) return 'ass'
  if (/^\{\d+(?:\.\d+)?\}\{\d+(?:\.\d+)?\}/m.test(source)) return 'microdvd'
  return 'srt'
}

export const convertSubtitlesToVtt = (input, extension) => {
  const source = String(input)
  if (extension === 'vtt' && /^\s*WEBVTT/i.test(source)) return source.replace(/\r/g, '')

  switch (detectSubtitleFormat(source)) {
    case 'sami':
      return blocksFromCues(parseSami(source))
    case 'ass':
      return blocksFromCues(parseAss(source))
    case 'microdvd':
      return blocksFromCues(parseMicroDvd(source))
    default:
      return blocksFromCues(parseSrt(source))
  }
}

/**
 * Resolves sidecar subtitle sources into WebVTT blob URLs. Entries that are already
 * WebVTT, or that fail to load, are dropped so the player still gets a usable track list.
 */
export const useSubtitleTracks = (captions = [], active) => {
  const [tracks, setTracks] = useState([])

  useEffect(() => {
    if (!active || !captions.length) {
      setTracks([])
      return undefined
    }

    let cancelled = false
    const createdUrls = []

    Promise.all(
      captions.map(async caption => {
        if (getExtension(caption.src) === 'vtt') return caption
        try {
          const response = await fetch(caption.src)
          if (!response.ok) return null
          const text = await response.text()
          if (!text.trim()) return null
          const url = URL.createObjectURL(
            new Blob([convertSubtitlesToVtt(text, getExtension(caption.src))], {
              type: 'text/vtt',
            }),
          )
          createdUrls.push(url)
          return { ...caption, src: url }
        } catch (_) {
          return null
        }
      }),
    ).then(resolved => {
      if (cancelled) return
      setTracks(resolved.filter(Boolean))
    })

    return () => {
      cancelled = true
      createdUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [active, captions])

  return tracks
}
