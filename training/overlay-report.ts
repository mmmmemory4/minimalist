// オーバーレイ版のまとめ：npx tsx training/overlay-report.ts [試合数]
//   RULES='{"hes":"second"}' でルールを変える．COSTS=REST=3,CLEAN=6 でコストを変える．SET=intro でセットを変える．TYPES=light,rest で型を絞る
// 型を混ぜた2〜4人卓を回し，長さ・引き分け・勝率倍率（1.00 = 公平）・止まった場所・止まったマスの効果の出どころを表にする

import { OKind, TILES, marketFromChoice } from '../src/overlay/tiles';
import { OBOT_LABELS, OGenome, OPRESETS, chooseOverlayAction, setLook } from '../src/overlay/bot';
if (process.env.LOOK) setLook(Number(process.env.LOOK));
import { OBOARDS, OState, Rules, applyOverlay, hereFx, newOverlayGame, topTile } from '../src/overlay/engine';

const GAMES = Number(process.argv[2] ?? 600);
const ONLY = (process.env.TYPES ?? '').split(',').filter(Boolean);
const RULES: Partial<Rules> = process.env.RULES ? JSON.parse(process.env.RULES) : {};
for (const kv of (process.env.COSTS ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); TILES[k as OKind].cost = Number(v); }

// 試しに「重い」ルールの重さを変える：HEAVY=JUNK=2,HES=1
for (const kv of (process.env.HEAVY ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); TILES[k as OKind].heavy = Number(v); }

// 試しに捨欲の目盛りを変える：REM=1,2,2,2
if (process.env.REM) OBOARDS.gentle.remove = process.env.REM.split(',').map(Number);

// 試しにタイルの効果を変える：FX=REST=r2,CALM=r2,TREAT=b5
for (const kv of (process.env.FX ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); TILES[k as OKind].fx = { kind: v[0] === 'r' ? 'remove' : 'buy', amount: Number(v.slice(1)) }; }

function rngFrom(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function runReport(games: number) {
  const names = ONLY.length ? ONLY : Object.keys(OPRESETS);
  const rand = rngFrom(11);
  const win: Record<string, number> = {}, app: Record<string, number> = {};
  const rounds: number[] = [], buys: Record<string, number[]> = {};
  let draws = 0, turns = 0, drawn = 0, drewAll = 0, onTile = 0, favWins = 0, wins = 0;
  const kindAtStop = { buy: 0, remove: 0, none: 0, gacha: 0, lucky: 0 };
  const rowHist = { early: new Map<number, number>(), late: new Map<number, number>() };
  const colHist = { early: new Map<number, number>(), late: new Map<number, number>() };
  const bought: Record<string, number> = {};
  for (let g = 0; g < games; g++) {
    const n = 2 + (g % 3);
    const who = Array.from({ length: n }, () => names[Math.floor(rand() * names.length)]);
    const gs = who.map(w => OPRESETS[w]);
    const s: OState = newOverlayGame(who.map((w, i) => ({ name: `${w}${i}`, isBot: true })), g * 7919 + 5,
      { rules: RULES, market: process.env.SET ? marketFromChoice(process.env.SET, rand) : undefined });
    while (s.phase === 'play') {
      const seat = s.current, round = s.round, p = s.players[seat];
      const before = s.log.length;
      // 止める直前の様子を取るため，1動作ずつ進める
      let guard = 0;
      while (s.phase === 'play' && s.current === seat && s.round === round && guard++ < 300) {
        if (s.turn === 'resolve') {
          turns++; drawn += p.placed.length;
          if (!p.bag.length && !p.discard.length) drewAll++;
          if (topTile(p.placed, p.pos)) onTile++;
          kindAtStop[p.roll != null ? 'lucky' : hereFx(s, p).kind]++;
        }
        const cur = s.current, r = s.round;
        playOne(s, gs);
        if (s.current !== cur || s.round !== r) break;
      }
      for (const l of s.log.slice(before)) {
        const m = l.match(/\((-?\d+),(-?\d+)\)で止まった/);
        if (!m) continue;
        const h = round <= 4 ? 'early' : 'late';
        rowHist[h].set(+m[2], (rowHist[h].get(+m[2]) ?? 0) + 1);
        colHist[h].set(+m[1], (colHist[h].get(+m[1]) ?? 0) + 1);
        const b = l.match(/取得 (.+?)( \/|$)/);
        if (b) for (const nm of b[1].split('・')) bought[nm] = (bought[nm] ?? 0) + 1;
      }
    }
    rounds.push(s.round);
    s.players.forEach((p, i) => { (buys[who[i]] ??= []).push(p.bought); });
    who.forEach(w => { app[w] = (app[w] ?? 0) + 1; });
    if (!s.winners.length) { draws++; continue; }
    for (const i of s.winners) {
      win[who[i]] = (win[who[i]] ?? 0) + n / s.winners.length;
      wins++; if (s.players[i].perms.length) favWins++;
    }
  }
  const avg = (a: number[] = []) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (a: number, b: number) => Math.round(100 * a / (b || 1));
  const pctMap = (m: Map<number, number>, keys: number[]) => {
    const t = [...m.values()].reduce((a, b) => a + b, 0) || 1;
    return keys.map(k => `${k}:${Math.round(100 * (m.get(k) ?? 0) / t)}`).join(' ');
  };
  console.log(`\n## オーバーレイ版 ${JSON.stringify(RULES)}（${games}試合，2〜4人）`);
  console.log(`平均ラウンド ${avg(rounds).toFixed(1)}，引分 ${pct(draws, games)}%，勝者のうちお気に入り持ち ${pct(favWins, wins)}%`);
  console.log(`1手番に引いた枚数 ${(drawn / turns).toFixed(2)}，持ち物を全部引いた手番 ${pct(drewAll, turns)}%，タイルの上で止まった ${pct(onTile, turns)}%`);
  console.log(`止まったマスの効果 取得 ${pct(kindAtStop.buy, turns)}%・排除 ${pct(kindAtStop.remove, turns)}%・なし ${pct(kindAtStop.none, turns)}%・福袋 ${pct(kindAtStop.gacha, turns)}%・運試し ${pct(kindAtStop.lucky, turns)}%`);
  console.log('| 型 | 勝率倍率 | 取得/人 |');
  console.log('|---|---|---|');
  for (const w of names) console.log(`| ${OBOT_LABELS[w] ?? w} | ${((win[w] ?? 0) / (app[w] || 1)).toFixed(2)} | ${avg(buys[w]).toFixed(1)} |`);
  const rows = [7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5], cols = [-3, -2, -1, 0, 1, 2, 3];
  console.log(`止まった行(%) 前半 ${pctMap(rowHist.early, rows)}`);
  console.log(`止まった行(%) 後半 ${pctMap(rowHist.late, rows)}`);
  console.log(`止まった列(%) 前半 ${pctMap(colHist.early, cols)}`);
  console.log(`止まった列(%) 後半 ${pctMap(colHist.late, cols)}`);
  console.log(`取得されたタイル ${Object.entries(bought).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' ')}`);
}

function playOne(s: OState, gs: OGenome[]) { applyOverlay(s, s.current, chooseOverlayAction(s, gs[s.current])); }

if (process.argv[1]?.endsWith('overlay-report.ts')) runReport(GAMES);
