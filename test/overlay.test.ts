import { describe, expect, it } from 'vitest';
import { OKind, TILES } from '../src/overlay/tiles';
import { OState, Rules, applyOverlay, hereFx, isDone, newOverlayGame, ownedTiles, printedFx, OBOARDS, DEFAULT_RULES } from '../src/overlay/engine';
import { OPRESETS, playOverlayTurn } from '../src/overlay/bot';

const game = (rules: Partial<Rules> = {}) => newOverlayGame([{ name: 'A' }, { name: 'B' }], 1, { rules });
/** 現在の手番の人の袋を，引く順に指定する */
function stack(s: OState, ...kinds: OKind[]) {
  const p = s.players[s.current];
  p.bag = kinds.map(k => ({ id: s.nextId++, kind: k })).reverse();
}
const draw = (s: OState) => applyOverlay(s, s.current, { type: 'draw' });
const here = (s: OState) => hereFx(s, s.players[s.current]);

describe('オーバーレイ版', () => {
  it('初期の袋は6枚（ためらい2枚）で↓だけのタイルがない', () => {
    const kinds = game().players[0].bag.map(c => c.kind).sort();
    expect(kinds).toEqual(['DOUBT', 'HES', 'HES', 'JUNK', 'WANT', 'WANT']);
    expect(game({ hesCount: 1 }).players[0].bag.length).toBe(5);
  });

  it('少なくとも1枚引く', () => {
    const s = game();
    expect(() => applyOverlay(s, 0, { type: 'stop' })).toThrow();
  });

  it('タイルは今いるマスに置かれ，矢印の向きへ出る．止まるのは盤の印刷の効果', () => {
    const s = game();
    stack(s, 'WANT');
    draw(s);
    const p = s.players[0];
    expect(p.placed[0].pos).toEqual({ x: 0, y: 0 });
    expect(p.pos).toEqual({ x: 0, y: 1 });
    expect(here(s)).toEqual({ kind: 'buy', amount: 2 });
  });

  it('戻ってくると置いたタイルの効果に塗り替わっている．重ねたら一番上', () => {
    const s = game();
    stack(s, 'WANT', 'DOWN', 'UP2', 'DOWN');
    draw(s); draw(s); // ↑で出て，↓で START へ戻る
    expect(s.players[0].pos).toEqual({ x: 0, y: 0 });
    expect(here(s)).toEqual({ kind: 'buy', amount: 1 }); // START には「欲しい」（額1）
    draw(s); draw(s); // 欲しい欲しい（額3）を START に重ねて↑，↓で戻る
    expect(here(s)).toEqual({ kind: 'buy', amount: 3 });
    expect(s.players[0].placed.filter(t => t.pos.x === 0 && t.pos.y === 0).length).toBe(2);
  });

  it('↑を引くと捨てるマスが塗り替わり，戻ってもすぐには排除できない', () => {
    const s = game();
    stack(s, 'DOWN', 'WANT', 'DOWN');
    draw(s);
    expect(here(s).kind).toBe('remove');
    draw(s); draw(s); // ↑で START へ，↓でもう一度下へ
    expect(s.players[0].pos).toEqual({ x: 0, y: -1 });
    expect(here(s)).toEqual({ kind: 'buy', amount: 1 });
  });

  it('矢印のないタイルは置いたタイルの上で止まる．盤の端へは出られない', () => {
    const s = game();
    stack(s, 'REST');
    draw(s);
    expect(s.players[0].pos).toEqual({ x: 0, y: 0 });
    expect(here(s)).toEqual({ kind: 'remove', amount: 2 });
    const t = game();
    stack(t, 'WANT', 'WANT', 'WANT', 'WANT');
    draw(t); draw(t); draw(t); draw(t);
    expect(t.players[0].pos).toEqual({ x: 0, y: 3 });
    expect(here(t)).toEqual({ kind: 'buy', amount: 1 }); // 端で出られず，置いた「欲しい」の上
  });

  it('ためらい：出たらそこで終わり．中央の行は額2', () => {
    const s = game();
    stack(s, 'HES');
    draw(s);
    expect(s.turn).toBe('branch');
    applyOverlay(s, 0, { type: 'branch', dir: 'L' });
    expect(s.turn).toBe('resolve');
    expect(here(s)).toEqual({ kind: 'buy', amount: 2 });
    expect(printedFx({ x: -1, y: 0 }, OBOARDS.basic, { ...DEFAULT_RULES, midBuy: false }).kind).toBe('none');
  });

  it('ためらい：2枚目で終わりのルールでは，1枚目は額3のタイルになる', () => {
    const s = game({ hes: 'second' });
    stack(s, 'HES', 'DOUBT', 'HES');
    draw(s); applyOverlay(s, 0, { type: 'branch', dir: 'R' });
    expect(s.turn).toBe('move');
    draw(s); // ←で戻る
    expect(here(s)).toEqual({ kind: 'buy', amount: 3 });
    draw(s); applyOverlay(s, 0, { type: 'branch', dir: 'L' });
    expect(s.turn).toBe('resolve');
  });

  it('量のマスで，この手番に置いたタイルを排除する．手番の終わりに残りは捨て山へ', () => {
    const s = game({ weights: 'light' });
    stack(s, 'WANT', 'DOWN', 'DOWN');
    const p = s.players[0];
    p.discard = [];
    draw(s); draw(s); draw(s);
    expect(here(s)).toEqual({ kind: 'remove', amount: 1 });
    applyOverlay(s, 0, { type: 'stop' });
    const want = p.placed.find(t => t.kind === 'WANT')!;
    expect(() => applyOverlay(s, 0, { type: 'resolve', buy: [], remove: p.placed.map(t => t.id) })).toThrow();
    applyOverlay(s, 0, { type: 'resolve', buy: [], remove: [want.id] });
    expect(p.removed).toBe(1);
    expect(p.placed.length).toBe(0);
    expect(p.discard.map(t => t.kind)).toEqual(['DOWN', 'DOWN']);
    expect(s.current).toBe(1);
  });

  it('条件：ガラクタは理性1以上の列でないと排除できない（ルールで外せる）', () => {
    for (const needs of [true, false]) {
      const s = game({ needs, junk: 'four' });
      stack(s, 'JUNK', 'WANT'); // 袋に1枚残す（最後の1枚の例外にしない）
      draw(s); applyOverlay(s, 0, { type: 'branch', dir: 'D' });
      applyOverlay(s, 0, { type: 'stop' });
      s.players[0].perms.push('BIGDAY'); // 重さを無視して条件だけを見る
      const act = () => applyOverlay(s, 0, { type: 'resolve', buy: [], remove: [s.players[0].placed[0].id] });
      if (needs) expect(act).toThrow(); else act();
    }
  });

  it('取得：額の範囲で市場から．取ったタイルは捨て山へ', () => {
    const s = game();
    stack(s, 'WANT');
    draw(s); applyOverlay(s, 0, { type: 'stop' });
    expect(() => applyOverlay(s, 0, { type: 'resolve', buy: ['DOWN2'], remove: [] })).toThrow();
    applyOverlay(s, 0, { type: 'resolve', buy: ['DOWN', 'UP2'], remove: [] });
    expect(s.players[0].discard.map(t => t.kind).sort()).toEqual(['DOWN', 'UP2', 'WANT']);
  });

  it('重いルール：欲しいは重さ2，ガラクタは重さ3で→だけ', () => {
    const s = game();
    stack(s, 'WANT', 'DOWN', 'DOWN', 'JUNK');
    draw(s); draw(s); draw(s);
    const p = s.players[0];
    applyOverlay(s, 0, { type: 'stop' }); // (0,-1) 量1
    expect(() => applyOverlay(s, 0, { type: 'resolve', buy: [], remove: [p.placed[0].id] })).toThrow();
    const t = game();
    stack(t, 'JUNK', 'WANT');
    draw(t);
    expect(t.turn).toBe('move');
    expect(t.players[0].pos).toEqual({ x: 1, y: 0 });
  });

  it('特別なマス：捨欲の領域の額マスは，量のタイルで塗り替えられる', () => {
    const s = game();
    stack(s, 'DOWN', 'DOWN', 'DOWN2', 'WANT');
    draw(s); draw(s);
    expect(s.players[0].pos).toEqual({ x: 0, y: -2 });
    expect(here(s)).toEqual({ kind: 'buy', amount: 2 });
    draw(s); draw(s); // 断捨離（量2）を置いて↓，欲しいで↑へ戻る
    expect(here(s)).toEqual({ kind: 'remove', amount: 2 });
    expect(printedFx({ x: 0, y: -2 }, OBOARDS.gentle, { ...DEFAULT_RULES, special: false }).kind).toBe('remove');
  });

  it('福袋：共有の福袋から1枚もらう．おまかせ処分：袋と捨て山から1枚排除', () => {
    const s = game();
    stack(s, 'DOUBT', 'WANT'); // (-1,1) は福袋
    draw(s); draw(s);
    expect(here(s).kind).toBe('gacha');
    const pool = s.gacha.length, p = s.players[0];
    applyOverlay(s, 0, { type: 'stop' });
    applyOverlay(s, 0, { type: 'resolve', buy: [], remove: [] });
    expect(s.gacha.length).toBe(pool - 1);
    expect(p.discard.length).toBe(3);
    const t = game();
    const q = t.players[0];
    stack(t, 'RUSH', 'RUSH', 'DOWN', 'WANT', 'WANT'); // (2,-1) はおまかせ処分
    draw(t); draw(t); draw(t);
    expect(here(t).kind).toBe('purge');
    applyOverlay(t, 0, { type: 'stop' });
    applyOverlay(t, 0, { type: 'resolve', buy: [], remove: [] });
    expect(q.removed).toBe(1);
    expect(ownedTiles(q).length).toBe(4);
  });

  it('片付けた跡の壁はルールで有効にしたときだけ', () => {
    const s = game({ traces: true });
    const p = s.players[0];
    p.traces.push({ x: 0, y: 2 });
    stack(s, 'WANT', 'WANT');
    draw(s); draw(s);
    expect(p.pos).toEqual({ x: 0, y: 1 });
  });

  it('ボット同士で最後まで進む（どのルールでも）', () => {
    for (const rules of [{}, { hes: 'second' as const }, { traces: true, needs: false, refill: false, midBuy: false, cols: 'none' as const, lastCard: false, board: 'slow' }]) {
      const names = Object.keys(OPRESETS);
      const s = newOverlayGame(names.slice(0, 4).map(n => ({ name: n, isBot: true })), 7, { rules });
      let guard = 0;
      while (s.phase === 'play' && guard++ < 2000) playOverlayTurn(s, names.slice(0, 4).map(n => OPRESETS[n]));
      expect(s.phase).toBe('over');
      for (const i of s.winners) expect(isDone(s.players[i])).toBe(true);
      for (const p of s.players) expect(ownedTiles(p).every(t => TILES[t.kind])).toBe(true);
    }
  });
});
