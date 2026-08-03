/** Raw YouTube Data API v3 shapes — only the fields Vestra consumes. */

export interface YoutubeThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface YoutubeThumbnails {
  default?: YoutubeThumbnail;
  medium?: YoutubeThumbnail;
  high?: YoutubeThumbnail;
  standard?: YoutubeThumbnail;
  maxres?: YoutubeThumbnail;
}

export interface YoutubeSearchItem {
  id: { kind: string; videoId?: string; channelId?: string; playlistId?: string };
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: YoutubeThumbnails;
    channelTitle: string;
    liveBroadcastContent?: string;
  };
}

export interface YoutubeSearchResponse {
  items?: YoutubeSearchItem[];
  nextPageToken?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
}

export interface YoutubeVideoItem {
  id: string;
  snippet?: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: YoutubeThumbnails;
    channelTitle: string;
    tags?: string[];
  };
  /** Requires the `contentDetails` part. */
  contentDetails?: {
    /** ISO 8601 duration, e.g. PT1H2M10S. */
    duration?: string;
    definition?: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
  };
}

export interface YoutubeVideosResponse {
  items?: YoutubeVideoItem[];
  pageInfo?: { totalResults?: number };
}
