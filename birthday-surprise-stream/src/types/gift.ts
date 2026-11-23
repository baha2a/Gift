export interface GiftRecord {
  id: string;
  ownerId: string;
  title: string;
  recipientName: string;
  closingMessage: string;
  senderName: string;
  originalName: string;
  mimeType: string;
  size: number;
  sourceType: 'server' | 'url';
  videoUrl: string;
  allowDownload: boolean;
  isPrimary: boolean;
  status: 'uploading' | 'ready';
  createdAt: string;
  updatedAt: string;
}
