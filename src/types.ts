// types.ts - Sdílené typy pro komunikaci mezi popup a background

export type MailFolder = messenger.folders.MailFolder;
export type MessageHeader = messenger.messages.MessageHeader;

/**
 * Jednoznačný odkaz na složku - samotná cesta není napříč účty unikátní
 */
export interface FolderRef {
  accountId: string;
  path: string;
}

export interface Duplicate {
  archiveMessage: MessageHeader;
  gmailMessage: MessageHeader;
  messageId: string | null;
  subject: string;
  date: MessageHeader['date'];
  author: string;
}

export interface FindDuplicatesResult {
  duplicates: Duplicate[];
  archiveFolder: MailFolder;
  gmailAllMail: MailFolder;
}

export interface MoveResult {
  stopped: boolean;
  movedIds: number[];
}

// Zprávy z popup do background
export interface FindDuplicatesRequest {
  action: 'findDuplicates';
  folderRefs?: {
    archiveFolder: FolderRef;
    gmailAllMail: FolderRef;
  };
}

export interface MoveDuplicatesRequest {
  action: 'moveDuplicates';
  duplicateIds: number[];
  gmailTrash?: FolderRef;
}

export interface StopRequest {
  action: 'stop';
}

export type BackgroundRequest = FindDuplicatesRequest | MoveDuplicatesRequest | StopRequest;

// Zpráva z background do popup
export interface ProgressMessage {
  action: 'progress';
  message: string;
}

export type ErrorResponse = { success: false; error: string };
export type FindDuplicatesResponse = { success: true; data: FindDuplicatesResult } | ErrorResponse;
export type MoveDuplicatesResponse = ({ success: true } & MoveResult) | ErrorResponse;
export type StopResponse = { success: true };

/**
 * Přiřazuje typ odpovědi ke každému typu požadavku
 */
export interface ResponseFor {
  findDuplicates: FindDuplicatesResponse;
  moveDuplicates: MoveDuplicatesResponse;
  stop: StopResponse;
}

export const STOPPED_MESSAGE = 'Operace zastavena uživatelem';
