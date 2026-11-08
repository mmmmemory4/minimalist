import { describe, expect, it } from 'vitest';
import { SCARDS } from '../src/slide/cards';
import {
  SBOARDS, SState, Walk, applySlide, cellPower, isDone, newSlideGame, ownedCards, removeLoad, walk,
} from '../src/slide/engine';
import { SPRESETS, playSlideTurn } from '../src/slide/bot';

const SHORT = SBOARDS.basic, STD = SBOARDS.slow;
const w0 = (blocks: { x: number; y: number }[] = [], board = SHORT): Walk => ({ board, pos: { x: 0, y: 0 }, lastDir: null, blocks, trail: [] });
const card = (kind: keyof typeof SCARDS, id = 900) => ({ id, kind });

/** 現在の手番の人の山札の上を，指定のカードにする */
function stack(s: SState, ...kinds: (keyof typeof SCARDS)[]) {
  const p = s.players[s.current];
  p.deck = kinds.map(k => card(k, s.nextId++)).reverse();
}

describe('スライド版', () => {
  it('初期デッキは弱い5枚で↓がない', () => {
    const s = newSlideGame([{ name: 'A' }, { name: 'B' }], 1);
    const kinds = s.players[0].deck.map(c => c.kind).sort();
    expect(kinds).toEqual(['DOUBT', 'HES', 'JUNK', 'WANT', 'WANT']);
    expect(kinds.some(k => SCARDS[k].move.t === 'step' && (SCARDS[k].move as { dirs: string[] }).dirs.includes('D'))).toBe(false);
  });

  it('毎手番，少なくとも1枚めくる', () => {
    const s = newSlideGame([{ name: 'A' }, { name: 'B' }], 1);
    expect(() => applySlide(s, 0, { type: 'stop' })).toThrow();
    applySlide(s, 0, { type: 'flip' });
  });

  it('端では止まり，積み木のマスには入れずその手前で止まる', () => {
    const w = w0();
    walk(w, 'D', Infinity);
    expect(w.pos).toEqual({ x: 0, y: -4 });
    const v = w0([{ x: 0, y: -2 }]);
    walk(v, 'D', Infinity);
    expect(v.pos).toEqual({ x: 0, y: -1 });
    walk(v, 'D', 1); // 積み木の向こうへは進めない
    expect(v.pos).toEqual({ x: 0, y: -1 });
    walk(v, 'L', 1);
    walk(v, 'D', 2); // 回り込めば進める
    expect(v.pos).toEqual({ x: -1, y: -3 });
  });

  it('行の効果は盤の目盛りどおり．衝動の列で上乗せ', () => {
    expect(cellPower({ x: 0, y: 1 }, SHORT)).toEqual({ kind: 'buy', amount: 2 });
    expect(cellPower({ x: 2, y: 3 }, SHORT)).toEqual({ kind: 'buy', amount: 6 });
    expect(cellPower({ x: 0, y: 0 }, SHORT).kind).toBe('none');
    expect(cellPower({ x: 0, y: -1 }, SHORT)).toEqual({ kind: 'remove', amount: 1 });
    expect(cellPower({ x: 1, y: -4 }, SHORT)).toEqual({ kind: 'remove', amount: 3 }); // 衝動1は量±0
    expect(cellPower({ x: 3, y: -1 }, SHORT)).toEqual({ kind: 'remove', amount: 0 }); // 右下ほど少ない（衝動3は量−1）
    expect(cellPower({ x: -1, y: -1 }, SHORT)).toEqual({ kind: 'remove', amount: 1 }); // 理性1は上乗せなし
    expect(cellPower({ x: -3, y: -1 }, SHORT)).toEqual({ kind: 'remove', amount: 2 }); // 理性2・3は+1（排除だけ）
    expect(cellPower({ x: -1, y: 1 }, SHORT)).toEqual({ kind: 'buy', amount: 1 }); // 左上ほど少ない（理性1は額−1）
    expect(cellPower({ x: -3, y: 1 }, SHORT)).toEqual({ kind: 'buy', amount: 0 }); // 理性3は額−2（0より下にはならない）
    // ゆっくり：物欲 1,1,2,2,3,3,4／捨欲 0,1,1,2,3
    expect([1, 2, 3, 4, 5, 6, 7].map(y => cellPower({ x: 0, y }, STD).amount)).toEqual([1, 1, 2, 2, 3, 3, 4]);
    expect([-1, -2, -3, -4, -5].map(y => cellPower({ x: 0, y }, STD).amount)).toEqual([0, 1, 1, 2, 3]);
    expect(cellPower({ x: -2, y: -1 }, STD)).toEqual({ kind: 'remove', amount: 1 }); // 捨欲0でも理性2なら1
  });

  it('START のまわりで排除しても片付けた跡は残らない', () => {
    const s = newSlideGame([{ name: 'A' }], 7, { board: 'basic' });
    const p = s.players[0];
    p.deck = [card('DOWN', 1)];
    p.discard = [card('WANT', 2)];
    applySlide(s, 0, { type: 'flip' });
    applySlide(s, 0, { type: 'stop' }); // (0,-1)
    applySlide(s, 0, { type: 'resolve', buy: [], remove: [1] });
    expect(p.walk.traces).toEqual([]);
  });

  it('道連れ袋は，もう1枚を重さ0にする', () => {
    expect(removeLoad([card('DRAG', 1), card('DOWN2', 2)])).toBe(1);
    expect(removeLoad([card('DOWN', 1), card('DOWN2', 2)])).toBe(2);
  });

  it('取得は物欲の行で，排除は今日の流れから，排除したマスに積み木が残る', () => {
    const s = newSlideGame([{ name: 'A' }, { name: 'B' }], 2, { board: 'basic' });
    stack(s, 'WANT', 'WANT');
    applySlide(s, 0, { type: 'flip' });
    applySlide(s, 0, { type: 'stop' });
    expect(() => applySlide(s, 0, { type: 'resolve', buy: ['SLIDE'], remove: [] })).toThrow(); // 物欲2で6は買えない
    applySlide(s, 0, { type: 'resolve', buy: ['BREATH'], remove: [] });
    expect(s.players[0].discard.some(c => c.kind === 'BREATH')).toBe(true);

    applySlide(s, 1, { type: 'flip' }); applySlide(s, 1, { type: 'stop' });
    applySlide(s, 1, { type: 'resolve', buy: [], remove: [] });

    stack(s, 'DOUBT', 'SLIDE', 'JUNK');
    for (let i = 0; i < 3; i++) applySlide(s, 0, { type: 'flip' });
    applySlide(s, 0, { type: 'stop' });
    const p = s.players[0];
    expect(p.walk.pos).toEqual({ x: -1, y: -4 }); // 理性1・一番下：量 3（理性1は上乗せなし）
    expect(() => applySlide(s, 0, { type: 'resolve', buy: [], remove: p.flow.map(c => c.id) })).toThrow(); // 迷い1・滑り台1・ガラクタ2 = 4
    const ids = p.flow.filter(c => c.kind !== 'SLIDE').map(c => c.id); // 迷い1・ガラクタ2 = 3
    const fromDiscard = p.discard;
    expect(() => applySlide(s, 0, { type: 'resolve', buy: [], remove: [...ids, fromDiscard[0].id, fromDiscard[1].id] })).toThrow();
    applySlide(s, 0, { type: 'resolve', buy: [], remove: [...ids, fromDiscard[0].id] });
    expect(p.removed).toBe(3);
    expect(p.walk.traces).toEqual([{ x: -1, y: -4 }]); // 跡は残り続ける（排除するたびに増える）
    expect(p.walk.blocks).toEqual([]);
  });

  it('衝動の列でしか取得できないカード・理性の列でしか排除できないカードがある', () => {
    const s = newSlideGame([{ name: 'A' }, { name: 'B' }], 4, { board: 'basic' });
    stack(s, 'UP2', 'JUNK');
    applySlide(s, 0, { type: 'flip' });
    applySlide(s, 0, { type: 'flip' });
    applySlide(s, 0, { type: 'stop' }); // (0,2) 物欲3
    expect(() => applySlide(s, 0, { type: 'resolve', buy: ['ICE'], remove: [] })).toThrow(/衝動1/);
    applySlide(s, 0, { type: 'resolve', buy: ['DOWN2'], remove: [] });
    applySlide(s, 1, { type: 'flip' }); applySlide(s, 1, { type: 'stop' });
    applySlide(s, 1, { type: 'resolve', buy: [], remove: [] });
    stack(s, 'JUNK', 'DOWN2');
    applySlide(s, 0, { type: 'flip' });
    applySlide(s, 0, { type: 'flip' });
    applySlide(s, 0, { type: 'stop' }); // (0,-2) 捨欲2，理性0
    const junk = s.players[0].flow.find(c => c.kind === 'JUNK')!;
    expect(() => applySlide(s, 0, { type: 'resolve', buy: [], remove: [junk.id] })).toThrow(/理性1/);
  });

  it('最後の1枚は，どこで止まっても手放せる．山札が尽きたら捨札を混ぜて続けられる', () => {
    const s = newSlideGame([{ name: 'A' }], 5, { board: 'basic' });
    const p = s.players[0];
    p.deck = [card('JUNK', 1)];
    applySlide(s, 0, { type: 'flip' });
    applySlide(s, 0, { type: 'stop' });
    applySlide(s, 0, { type: 'resolve', buy: [], remove: [1] });
    expect(p.finished).toBe(true);
    const t = newSlideGame([{ name: 'A' }], 6);
    const q = t.players[0];
    q.deck = [card('WANT', 801)];
    q.discard = [card('DOUBT', 802), card('WANT', 803)];
    applySlide(t, 0, { type: 'flip' });
    applySlide(t, 0, { type: 'flip' }); // 山札が空 → 捨札を混ぜる
    expect(q.flow.length).toBe(2);
    expect(q.deck.length + q.discard.length).toBe(1);
  });

  it('お気に入りは自分の前に置かれ，山札に入らない．カード0枚で達成', () => {
    const s = newSlideGame([{ name: 'A' }, { name: 'B' }], 3, { board: 'basic' });
    const p = s.players[0];
    stack(s, 'RUSH', 'UP2', 'UP2'); // →2・↑2・↑2 → (2,3) 物欲4+2=6
    applySlide(s, 0, { type: 'flip' }); applySlide(s, 0, { type: 'branch', dir: 'R' });
    applySlide(s, 0, { type: 'flip' }); applySlide(s, 0, { type: 'flip' });
    applySlide(s, 0, { type: 'stop' });
    expect(p.walk.pos).toEqual({ x: 2, y: 3 });
    expect(() => applySlide(s, 0, { type: 'resolve', buy: ['COMPASS'], remove: [] })).toThrow(/超えて/); // 7
    expect(() => applySlide(s, 0, { type: 'resolve', buy: ['BIGDAY', 'BIGDAY'], remove: [] })).toThrow(/1枚まで/);
    applySlide(s, 0, { type: 'resolve', buy: ['SKATE'], remove: [] });
    expect(p.perms).toEqual(['SKATE']);
    expect(ownedCards(p).some(c => c.kind === 'SKATE')).toBe(false);
    p.deck = []; p.discard = []; p.flow = [];
    expect(isDone(p)).toBe(true);
  });

  it('スケート靴は↓で滑る．コンパスは好きな向き', () => {
    const w = { ...w0(), perks: ['SKATE' as const] };
    walk(w, 'D', 1);
    expect(w.pos).toEqual({ x: 0, y: -4 });
    const s = newSlideGame([{ name: 'A' }], 3);
    const p = s.players[0];
    p.perms = ['COMPASS']; p.walk.perks = ['COMPASS'];
    stack(s, 'WANT');
    applySlide(s, 0, { type: 'flip' });
    expect(s.turn).toBe('branch');
    applySlide(s, 0, { type: 'branch', dir: 'D' });
    expect(p.walk.pos).toEqual({ x: 0, y: -1 });
  });

  it('大掃除の日は量を無視，ゴミ袋は捨札からも，ルンバはどこでも1枚', () => {
    const s = newSlideGame([{ name: 'A' }], 3, { board: 'basic' });
    const p = s.players[0];
    p.perms = ['BIGDAY', 'ROOMBA'];
    stack(s, 'JUNK', 'DOWN', 'WANT', 'DOUBT', 'DOWN', 'DOWN'); // ←1 ↓1 ↑1 ... → (-1,-2)
    for (let i = 0; i < 6; i++) applySlide(s, 0, { type: 'flip' });
    applySlide(s, 0, { type: 'stop' });
    expect(p.walk.pos).toEqual({ x: -1, y: -2 }); // 捨欲2
    const flowIds = p.flow.map(c => c.id);
    applySlide(s, 0, { type: 'resolve', buy: [], remove: flowIds });
    expect(p.removed).toBe(6);

    const t = newSlideGame([{ name: 'A' }], 4, { board: 'basic' });
    const q = t.players[0];
    q.perms = ['BAG', 'ROOMBA'];
    q.discard = [card('WANT', 801), card('WANT', 802)];
    q.deck = [card('DOWN', 803), card('HES', 804)].reverse();
    applySlide(t, 0, { type: 'flip' }); // ↓1 (0,-1) 量1
    applySlide(t, 0, { type: 'stop' });
    expect(() => applySlide(t, 0, { type: 'resolve', buy: [], remove: [801, 802] })).toThrow(/超えて/);
    applySlide(t, 0, { type: 'resolve', buy: [], remove: [801], roomba: 803 });
    expect(q.removed).toBe(2);
    expect(ownedCards(q).map(c => c.id).sort()).toEqual([802, 804]);
  });

  it('ボット同士のゲームは終わり，カードの総数が保存される', () => {
    const kinds = Object.keys(SPRESETS);
    let finished = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const n = 2 + (seed % 3);
      const gs = Array.from({ length: n }, (_, i) => SPRESETS[kinds[(seed + i) % kinds.length]]);
      const s = newSlideGame(gs.map((_, i) => ({ name: `P${i}`, isBot: true })), seed, { board: seed % 2 ? 'slow' : 'basic' });
      while (s.phase === 'play') playSlideTurn(s, gs);
      for (const p of s.players) expect(ownedCards(p).length + p.removed + p.perms.length).toBe(5 + p.bought);
      if (s.winners.length && s.board.name === 'basic') finished++; // ゆっくりの盤は v0.4 では長引く（仕様のmd）
    }
    expect(finished).toBeGreaterThan(17);
  });
});
