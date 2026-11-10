// オーバーレイ版のオンライン対戦：ブラウザ ⇔ サーバー（Durable Object「OverlayRoom」）のメッセージ

import type { OKind } from './tiles';
import type { OAction, OState, Rules } from './engine';

export interface OSeatInfo { name: string; isBot: boolean; botType?: string; connected: boolean }

export interface ORoomInfo {
  code: string;
  seats: OSeatInfo[];
  /** 自分の席（観戦者は -1） */
  you: number;
  isHost: boolean;
  started: boolean;
}

export type OClientMsg =
  | { t: 'join'; name: string; token: string }
  | { t: 'rename'; name: string }
  | { t: 'addBot'; botType: string }
  | { t: 'removeSeat'; seat: number }
  /** set：タイルのセットの id．tiles：自分で選んだタイル（set = 'custom' のとき） */
  | { t: 'start'; rules?: Partial<Rules>; set?: string; tiles?: OKind[] }
  | { t: 'restart' }
  /** 終了後に待合室へ戻る（ルールを変えて遊び直す） */
  | { t: 'toLobby' }
  | { t: 'action'; action: OAction };

export type OServerMsg =
  | { t: 'room'; room: ORoomInfo; state: OState | null }
  | { t: 'error'; message: string };

export const OMAX_SEATS = 6;
