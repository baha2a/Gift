export interface GiftRecord {
  id: string;
  title: string;
  recipientName: string;
  closingMessage: string;
  senderName: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  allowDownload: boolean;
  isPrimary: boolean;
  createdAt: string;
}
