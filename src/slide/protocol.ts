// スライド版のオンライン対戦：ブラウザ ⇔ サーバー（Durable Object「SlideRoom」）のメッセージ

import type { SKind } from './cards';
import type { SAction, SState } from './engine';

export interface SSeatInfo { name: string; isBot: boolean; botType?: string; connected: boolean }

export interface SRoomInfo {
  code: string;
  seats: SSeatInfo[];
  /** 自分の席（観戦者は -1） */
  you: number;
  isHost: boolean;
  started: boolean;
  /** 開始したときの設定（再戦で使う） */
  board?: string;
  set?: string;
}

export type SClientMsg =
  | { t: 'join'; name: string; token: string }
  | { t: 'addBot'; botType: string }
  | { t: 'removeSeat'; seat: number }
  /** set：カードセットの id．cards：自分で選んだカード（set = 'custom' のとき） */
  | { t: 'start'; board?: string; set?: string; cards?: SKind[] }
  | { t: 'restart' }
  | { t: 'action'; action: SAction };

export type SServerMsg =
  | { t: 'room'; room: SRoomInfo; state: SState | null }
  | { t: 'error'; message: string };

export const SMAX_SEATS = 6;
