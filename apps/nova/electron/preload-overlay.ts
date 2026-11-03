import { contextBridge } from "electron";
import { api } from "./preload-api";

const { mpv, player, settings, window: appWindow, media } = api;
if (process.isMainFrame)
  contextBridge.exposeInMainWorld("vestra", {
    platform: api.platform,
    settings: { get: settings.get, onChanged: settings.onChanged },
    window: {
      setFullscreen: appWindow.setFullscreen,
      isFullscreen: appWindow.isFullscreen,
    },
    media: {
      streamQualities: media.streamQualities,
      reportSkip: media.reportSkip,
    },
    subtitleFonts: api.subtitleFonts,
    mpv: {
      subscribe: mpv.subscribe,
      onState: mpv.onState,
      play: mpv.play,
      pause: mpv.pause,
      seek: mpv.seek,
      seekBy: mpv.seekBy,
      setVolume: mpv.setVolume,
      setMuted: mpv.setMuted,
      setSpeed: mpv.setSpeed,
      selectTrack: mpv.selectTrack,
      setSubtitleDelay: mpv.setSubtitleDelay,
      setSubtitleScale: mpv.setSubtitleScale,
      setSubtitleFont: mpv.setSubtitleFont,
      setSubtitleColor: mpv.setSubtitleColor,
      setSubtitleVisible: mpv.setSubtitleVisible,
    },
    player: {
      getNowPlaying: player.getNowPlaying,
      onNowPlaying: player.onNowPlaying,
      send: player.send,
      focus: player.focus,
      drag: player.drag,
      toggleMaximize: player.toggleMaximize,
      setInteractive: player.setInteractive,
      setQuality: player.setQuality,
    },
  });
