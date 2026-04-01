export interface ApiSource {
  id: string;
  name: string;
  url: string;
  type: string;
  status?: "valid" | "invalid" | "testing";
}

export interface PlayUrl {
  name: string;
  url: string;
}

export interface AppleCmsResponse {
  code: number;
  msg: string;
  page: number;
  pagecount: number;
  limit: string;
  total: number;
  list: Video[];
  class: Category[];
}

export interface Category {
  type_id: number;
  type_name: string;
}

export interface Video {
  vod_id: number;
  type_id: number;
  type_name: string;
  vod_name: string;
  vod_en: string;
  vod_time: string;
  vod_remarks: string;
  vod_play_from: string;
  vod_play_server: string;
  vod_play_note: string;
  vod_play_url: string;
  vod_pic: string;
  vod_actor: string;
  vod_director: string;
  vod_content: string;
  vod_year: string;
  vod_area: string;
  vod_class: string;
}
