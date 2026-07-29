export type PauseDetailVideo = (videoId: string) => void;

export function createExclusiveVideoPlaybackController() {
  let activeVideoId: string | null = null;

  return {
    play(videoId: string, pauseVideo: PauseDetailVideo) {
      const previousVideoId = activeVideoId;
      activeVideoId = videoId;
      if (previousVideoId && previousVideoId !== videoId) {
        pauseVideo(previousVideoId);
      }
    },
    inactive(videoId: string) {
      if (activeVideoId === videoId) {
        activeVideoId = null;
      }
    },
    reset() {
      activeVideoId = null;
    }
  };
}
