export interface Printer {
  id: string;
  name: string;
  description?: string;
  location?: string;
  columns: number;
  font_size: number;
  last_seen?: string;
  active?: boolean;
  hidden?: boolean;
}

export interface Message {
  id: string;
  printer_id: string;
  printer_name?: string;
  sender_name?: string;
  body?: string;
  image_path?: string;
  word_wrap: number;
  font_size: number;
  source: 'web' | 'api' | 'email';
  status: 'pending' | 'printing' | 'printed' | 'failed';
  created_at: string;
}

export interface Thread {
  sender_name: string | null;
  message_count: number;
  latest_at: string;
  latest_body?: string;
  latest_image?: string;
}

export interface Subscription {
  id: string;
  name: string;
  feed_url: string;
  feed_type: 'rss' | 'xkcd';
  active: boolean;
  last_checked?: string;
  last_item_id?: string;
}

export interface AdminStats {
  total: number;
  printed: number;
  failed: number;
  pending: number;
  printing: number;
  from_web: number;
  from_api: number;
  from_email: number;
}

export interface PrinterStats {
  total: number;
  pending: number;
  printed: number;
  failed: number;
  from_web: number;
  from_api: number;
  from_email: number;
}
