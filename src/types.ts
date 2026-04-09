export interface Column {
  id: string;
  name: string;
  position: number;
  color: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Chat {
  id: string;
  name: string;
  phone: string;
  column_id: string;
  last_message: string;
  last_message_time: number;
  unread_count: number;
  tag_ids: string[];
  profile_pic?: string;
  last_message_from_me?: number;
}

export interface Message {
  id: string;
  chat_id: string;
  body: string;
  from_me: number;
  timestamp: number;
  media_url?: string;
  media_type?: string;
  media_name?: string;
  transcription?: string;
}
