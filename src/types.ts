export interface Column {
  id: string;
  name: string;
  position: number;
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
}

export interface Message {
  id: string;
  chat_id: string;
  body: string;
  from_me: number;
  timestamp: number;
}
