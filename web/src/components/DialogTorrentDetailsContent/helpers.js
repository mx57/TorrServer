import { isPlayablePath } from 'utils/mediaFormats'

// The extension lists now live in utils/mediaFormats so the player, the torrent card
// and the file table all agree on what is playable and on the MIME type behind it.
export const isFilePlayable = fileName => isPlayablePath(fileName)
