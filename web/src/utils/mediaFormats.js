// Extension metadata shared by the player and the torrent views.
//
// The MIME table intentionally mirrors server/mimetype so that the `canPlayType`
// probe in the player reflects the Content-Type the stream endpoint really sends.
// Go resolves unknown extensions from the host mime.types file, so the values below
// are the ones guaranteed by the server's own registry.

const videoMimeByExt = {
  '3g2': 'video/3gpp2',
  '3gp': 'video/3gpp',
  asf: 'video/x-ms-asf',
  avi: 'video/avi',
  avchd: 'video/mp4',
  dv: 'video/dv',
  fli: 'video/fli',
  flv: 'video/x-flv',
  iso: 'video/mp4',
  m2ts: 'video/mpeg',
  m2v: 'video/mpeg',
  m4p: 'video/mp4',
  m4v: 'video/mp4',
  mk3d: 'video/x-matroska',
  mkv: 'video/x-matroska',
  mng: 'video/x-mng',
  mov: 'video/x-quicktime',
  mp2: 'video/mpeg',
  mp4: 'video/mp4',
  mpe: 'video/mpeg',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  mts: 'video/mpeg',
  mpv: 'video/x-matroska',
  mxf: 'video/mp4',
  nsv: 'video/x-nsv',
  ogv: 'video/ogg',
  qt: 'video/x-quicktime',
  rm: 'application/vnd.rn-realmedia',
  rmvb: 'application/vnd.rn-realmedia-vbr',
  roq: 'video/vnd.rn-realvideo',
  ts: 'video/mpeg',
  vob: 'video/x-ms-vob',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  yuv: 'video/x-yuv',
}

const audioExtSet = new Set([
  'aac',
  'ac3',
  'aiff',
  'ape',
  'au',
  'dff',
  'dsf',
  'flac',
  'gsm',
  'it',
  'm4a',
  'mid',
  'mka',
  'mod',
  'mp3',
  'mpa',
  'mpga',
  'oga',
  'ogg',
  'opus',
  'ra',
  'wav',
  'weba',
  'wma',
  'wv',
])

// Containers no browser can demux from a plain <video src>. They need the
// server side transcoder, so the player must not offer them as a direct stream.
const transcodeOnlyExtSet = new Set([
  'asf',
  'avi',
  'divx',
  'dvr-ms',
  'flv',
  'm2ts',
  'm2v',
  'mpe',
  'mpeg',
  'mpg',
  'mpv',
  'mts',
  'mxf',
  'nsv',
  'rm',
  'rmvb',
  'roq',
  'ts',
  'vob',
  'wmv',
])

// Subtitle sidecars the player can hand to a <track> element. Browsers only
// consume WebVTT, so SubRip/ASS/SSA are converted on the fly by the track loader.
export const subtitleExtList = ['ass', 'smi', 'srt', 'ssa', 'sub', 'vtt']

const subtitleExtSet = new Set(subtitleExtList)

export const getExtension = filePath => {
  if (!filePath) return ''
  const name = filePath.split('?')[0].split('#')[0]
  const base = name.split('\\').pop().split('/').pop()
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

export const getVideoMimeType = filePath => videoMimeByExt[getExtension(filePath)] || ''

export const isVideoPath = filePath => Boolean(videoMimeByExt[getExtension(filePath)])

export const isAudioPath = filePath => audioExtSet.has(getExtension(filePath))

export const isSubtitlePath = filePath => subtitleExtSet.has(getExtension(filePath))

export const needsTranscode = filePath => transcodeOnlyExtSet.has(getExtension(filePath))

const playableExtSet = new Set([...Object.keys(videoMimeByExt), ...audioExtSet])

export const isPlayablePath = filePath => playableExtSet.has(getExtension(filePath))

// ISO 639 codes that show up as a standalone token in release names, mapped to the
// label a viewer expects. Anything unmatched is passed through untouched.
const languageLabels = {
  ara: 'Arabic',
  ben: 'Bengali',
  ces: 'Czech',
  chi: 'Chinese',
  dan: 'Danish',
  deu: 'German',
  dut: 'Dutch',
  ell: 'Greek',
  eng: 'English',
  epo: 'Esperanto',
  est: 'Estonian',
  fas: 'Persian',
  fin: 'Finnish',
  fra: 'French',
  fre: 'French',
  ger: 'German',
  gre: 'Greek',
  hin: 'Hindi',
  hun: 'Hungarian',
  ind: 'Indonesian',
  ita: 'Italian',
  jpn: 'Japanese',
  kor: 'Korean',
  nld: 'Dutch',
  nor: 'Norwegian',
  pol: 'Polish',
  por: 'Portuguese',
  ron: 'Romanian',
  rum: 'Romanian',
  rus: 'Russian',
  slk: 'Slovak',
  spa: 'Spanish',
  swe: 'Swedish',
  tam: 'Tamil',
  tel: 'Telugu',
  tha: 'Thai',
  tur: 'Turkish',
  ukr: 'Ukrainian',
  und: 'Undefined',
  vie: 'Vietnamese',
  zho: 'Chinese',
}

const languageAliases = {
  arabic: 'ara',
  chinese: 'zho',
  dutch: 'nld',
  england: 'eng',
  english: 'eng',
  espanol: 'spa',
  french: 'fra',
  fre: 'fra',
  german: 'deu',
  ger: 'deu',
  greek: 'ell',
  hindi: 'hin',
  italian: 'ita',
  japanese: 'jpn',
  korean: 'kor',
  latin: 'lat',
  polish: 'pol',
  portuguese: 'por',
  russian: 'rus',
  spanish: 'spa',
  turkish: 'tur',
  ukrainian: 'ukr',
  vietnamese: 'vie',
}

const normalizeLanguage = token => {
  const lower = token.toLowerCase()
  if (languageAliases[lower]) return languageAliases[lower]
  if (lower.length === 2) return lower
  if (lower.length === 3 && /^[a-z]{3}$/.test(lower)) return lower
  return ''
}

// Pulls a language out of names like "Movie.2020.eng.srt", "Movie (2020) - [rus].ass"
// or "Movie.english.sub". Returns an ISO 639 code, or '' when nothing matches.
export const guessSubtitleLanguage = filePath => {
  const base = (filePath || '').split('?')[0].split('\\').pop().split('/').pop()
  const parts = base
    .replace(/\.[^.]+$/, '')
    .split(/[.\-_+ ()[\]{}]/)
    .map(part => part.trim())
    .filter(Boolean)

  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const code = normalizeLanguage(parts[i])
    if (code) return code
  }
  return ''
}

export const languageLabel = code => {
  if (!code) return ''
  const lower = code.toLowerCase()
  return languageLabels[lower] || code.toUpperCase()
}

// Sidecar subtitles are matched on the file name with the video extension removed,
// so "Movie.mkv" picks up "Movie.srt", "Movie.eng.srt" and "Movie.rus.ass".
export const findSidecarSubtitles = (videoPath, files = []) => {
  const baseName = (videoPath || '')
    .replace(/\.[^/.]+$/, '')
    .split('\\')
    .pop()
    .split('/')
    .pop()
  if (!baseName) return []

  return files
    .filter(file => {
      if (!isSubtitlePath(file.path)) return false
      const name = file.path.split('\\').pop().split('/').pop()
      return name.startsWith(baseName)
    })
    .map(file => {
      const code = guessSubtitleLanguage(file.path)
      return {
        ...file,
        lang: code,
        label: languageLabel(code) || 'Subtitle',
      }
    })
}
