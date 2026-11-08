// お気に入りを1種類だけ狙う型を，ほかの型と混ぜて比べる：COSTS=SKATE=5 npx tsx training/slide-perm.ts
import { SCARDS, SKind, PERMS } from '../src/slide/cards';
import { SPRESETS, playSlideTurn, SGenome } from '../src/slide/bot';
import { newSlideGame } from '../src/slide/engine';
import { rngFrom } from './common';
for (const kv of (process.env.COSTS ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); SCARDS[k as SKind].cost = Number(v); }
const base = ['light', 'slide', 'swing', 'mixed', 'nobuy'];
const out: string[] = [];
for (const perm of [...PERMS, null]) {
  const g: SGenome = { greed: 1, buy: [...(perm ? [{ kind: perm, cap: 1 }] : []), { kind: 'UP2', cap: 1 }, { kind: 'RUSH', cap: 1 }, { kind: 'DOWN2', cap: 1 }, { kind: 'CALM', cap: 1 }] };
  const rand = rngFrom(5);
  let win = 0, app = 0, got = 0, games = 600, rounds = 0;
  for (let i = 0; i < games; i++) {
    const n = 2 + (i % 3);
    const gs = Array.from({ length: n }, (_, j) => j === 0 ? g : SPRESETS[base[Math.floor(rand() * base.length)]]);
    const s = newSlideGame(gs.map((_, j) => ({ name: `P${j}`, isBot: true })), i * 7919 + 3);
    while (s.phase === 'play') playSlideTurn(s, gs);
    app++; rounds += s.round;
    if (s.players[0].perms.length) got++;
    if (s.winners.includes(0)) win += n / s.winners.length;
  }
  out.push(`${perm ? `${SCARDS[perm].name}(${SCARDS[perm].cost}・衝動${SCARDS[perm].buyNeed})` : 'お気に入りなし'} 勝率倍率 ${(win / app).toFixed(2)} 取得率 ${Math.round(100 * got / app)}% 平均R ${(rounds / games).toFixed(1)}`);
}
console.log(out.join('\n'));
