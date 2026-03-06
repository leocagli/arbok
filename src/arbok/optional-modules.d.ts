declare module 'fluent-ffmpeg' {
  const ffmpeg: any
  export default ffmpeg
}

declare module 'ffmpeg-static' {
  const ffmpegPath: string | null
  export default ffmpegPath
}
