// スライド版の印刷データ（すべてA4）．カード・盤の数値はゲーム本体（cards.ts・engine.ts）から作るので，ルールを変えても印刷物とずれない
//   URL で指定できる：print.html?players=4&board=basic|slow|both&rules=1

import './print.css';
import { ARROW, LIGHT_PER, MARKET, MEMO_AT, SCARDS, SKind, STARTING, UNLIMITED_KINDS } from './cards';
import {
  BLOCKS, SBOARDS, SBoard, X_MAX, X_MIN, bonus, isDeep, noBlockZone, rowEffect, yMax, yMin,
} from './engine';
import { INK, colColor, colInk, needBadges, rowColor } from './colors';

const app = document.getElementById('app')!;
/** 片付けた跡の数（ボット同士では1人最大8個ほど） */
const TRACES = 8;
const params = new URLSearchParams(location.search);
const opt = {
  players: Math.min(6, Math.max(2, Number(params.get('players') ?? 4))),
  board: params.get('board') ?? 'basic',
  rules: params.get('rules') !== '0',
};
const PLAYER_COLORS = ['#d9534f', '#3b7dd8', '#3a9b5c', '#e0a020', '#8e5cc4', '#555555'];

// ---- カード ----

/** 動きの大きな表示 */
function glyph(k: SKind): string {
  const m = SCARDS[k].move;
  switch (m.t) {
    case 'step': return m.dirs.length === 4 ? '↑↓←→ 1' : m.dirs.map(d => `${ARROW[d]}${m.n}`).join(' / ') + (m.light ? '<small>＋身軽</small>' : '') + (m.stop ? '<small>で止まる</small>' : '');
    case 'slide': return `${ARROW[m.dir]}<small>ぶつかるまで滑る</small>`;
    case 'stopper': return '■<small>積み木を置く</small>';
    case 'none': return SCARDS[k].perm ? '★<small>お気に入り（永続）</small>' : '—';
    case 'swing': return '↓2 / ↑1';
    case 'memo': return `↑1 → ↓3`;
    case 'path': return m.dirs.map(d => ARROW[d]).join('');
  }
}

function cardHTML(k: SKind, tag: string): string {
  const d = SCARDS[k];
  const start = d.cost === null;
  return `<div class="pcard ${start ? 'start' : ''} ${d.perm ? 'fav' : ''}">
    <div class="ph"><b>${d.perm ? '★' : ''}${d.name}</b>${start ? '<span class="tag">初期</span>' : `<span class="cost">${d.cost}</span>`}</div>
    <div class="pg">${glyph(k)}</div>
    <div class="pt">${d.text}</div>
    <div class="pn">${needBadges(k)}</div>
    <div class="pf"><span>${tag}</span>${d.perm ? '<span>取ったら自分の前へ</span>' : `<span class="w" style="color:${INK.drop}">重さ${d.weight}</span>`}</div>
  </div>`;
}

function cardPages(): string {
  const n = opt.players;
  const list: [SKind, string][] = [];
  for (let p = 0; p < n; p++) for (const [k, c] of STARTING) for (let i = 0; i < c; i++) list.push([k, `初期デッキ`]);
  for (const k of MARKET) {
    const count = UNLIMITED_KINDS.includes(k) ? Math.max(8, 3 * n) : Math.max(2, n);
    for (let i = 0; i < count; i++) list.push([k, UNLIMITED_KINDS.includes(k) ? '市場（基本）' : '市場']);
  }
  const per = 18;
  const pages: string[] = [];
  for (let i = 0; i < list.length; i += per) {
    pages.push(`<section class="page"><h2>カード ${i / per + 1}/${Math.ceil(list.length / per)}<small>（${n}人用．63×44mm．線で切る）</small></h2>
      <div class="cards">${list.slice(i, i + per).map(([k, t]) => cardHTML(k, t)).join('')}</div></section>`);
  }
  return pages.join('');
}

// ---- 盤 ----

function colHead(x: number): string {
  const name = x < 0 ? `理性${-x}` : x > 0 ? `衝動${x}` : '中';
  const fx: string[] = [];
  if (x > 0) fx.push(`額+${bonus(x, 'buy')}`);
  if (x < 0) fx.push(`量+${bonus(x, 'remove')}`);
  return `<div class="bch" style="background:${colColor(x) ?? '#fff'};color:${colInk(x)}"><b>${name}</b><small>${fx.join('<br>')}</small></div>`;
}

function boardPage(b: SBoard): string {
  const rows = yMax(b) - yMin(b) + 1;
  const cell = Math.min(23, Math.floor((262 - 22) / rows));
  let g = `<div class="pboard" style="grid-template-columns: 22mm repeat(7, ${cell}mm); grid-template-rows: 22mm repeat(${rows}, ${cell}mm)"><div></div>`;
  for (let x = X_MIN; x <= X_MAX; x++) g += colHead(x);
  for (let y = yMax(b); y >= yMin(b); y--) {
    const e = rowEffect(y, b);
    const label = e.kind === 'buy' ? `<b style="color:${INK.buy}">物欲</b><span>額${e.amount}</span>`
      : e.kind === 'remove' ? `<b style="color:${INK.drop}">捨欲</b><span>量${e.amount}</span>${isDeep(y, b) ? '<small>＋捨札から1枚</small>' : ''}`
        : '<b>スタート</b>';
    g += `<div class="brh" style="background:${rowColor(e.kind, e.amount)}">${label}</div>`;
    for (let x = X_MIN; x <= X_MAX; x++) {
      const rc = rowColor(e.kind, e.amount), cc = colColor(x) ?? rc;
      const start = x === 0 && y === 0;
      const nz = !start && noBlockZone({ x, y }) ? ' nz' : '';
      g += `<div class="bc${nz}" style="background:linear-gradient(to top, ${cc} 0 30%, ${rc} 30%)">${start ? '<span class="st">START</span>' : ''}${e.kind !== 'none' ? `<span class="amt">${e.kind === 'buy' ? '額' : '量'}${e.amount + bonus(x, e.kind)}</span>` : ''}</div>`;
    }
  }
  g += `</div>`;
  return `<section class="page"><h2>個人ボード：${b.label}</h2>${g}
    <p class="note">マスの右下の数字＝そのマスで止まったときの額・量（列の上乗せ込み）．上の色＝物欲（青）・捨欲（赤），下の帯＝理性（緑）・衝動（オレンジ），どちらも濃いほど強い．
    コマは毎手番 START から．点線のマス（START の上下左右）には積み木を置けない．</p></section>`;
}

// ---- コマと積み木 ----

function tokenPage(): string {
  let h = '';
  for (let p = 0; p < opt.players; p++) {
    const c = PLAYER_COLORS[p];
    h += `<div class="tokrow"><span class="tl">プレイヤー${p + 1}</span><span class="pawn" style="background:${c}"></span>`;
    for (let i = 0; i < TRACES; i++) h += `<span class="blk trace" style="background:${c}">跡</span>`;
    for (let i = 0; i < BLOCKS; i++) h += `<span class="blk" style="background:${c}"></span>`;
    h += `</div>`;
  }
  return `<section class="page"><h2>コマと積み木<small>（切って使う．厚紙に貼るか，手持ちのコマ・おはじきで代用してよい）</small></h2>${h}
    <p class="note">丸＝コマ（1人1個），「跡」＝片付けた跡（1人${TRACES}個．足りなければ何で代用してもよい），無地の四角＝ストッパーの積み木（1人${BLOCKS}個）．</p></section>`;
}

// ---- ルール ----

function rulesPages(): string {
  const cardRows = (Object.keys(SCARDS) as SKind[]).map(k => {
    const d = SCARDS[k];
    return `<tr><td>${d.perm ? '★' : ''}${d.name}</td><td>${d.text}</td><td>${d.cost ?? '初期'}</td><td>${d.perm ? '−' : d.weight}</td><td>${needBadges(k)}</td></tr>`;
  }).join('');
  return `<section class="page rules">
    <h1>ミニマリスト <small>スライド版（試作 v0.5）</small></h1>
    <p class="lead">手札はありません．山札の上をめくるたびに，欲に流されてコマが動きます．好きなところで止めて，
      <b style="color:${INK.buy}">物欲</b>の行ならカードを取得，<b style="color:${INK.drop}">捨欲</b>の行なら今日めくったカードを排除．
      カードを0枚にしたら達成です．★お気に入りは取ったら自分の前に置かれ，効果がずっと続きます（数えない）．</p>
    <h3>内容物（このデータで印刷するもの）</h3>
    <ul><li>個人ボード（人数分），コマ1個・片付けた跡${TRACES}個・ストッパーの積み木${BLOCKS}個（1人分）</li>
      <li>初期デッキ 1人5枚（欲しい2・ためらい1・迷い1・ガラクタ1）</li>
      <li>市場：片付けたい（売り切れない．多めに），ほかは各種類 人数と同じ枚数（最低2枚）．★お気に入り5種類も同じ枚数</li></ul>
    <h3>準備</h3>
    <ol><li>各自，個人ボードを置き，初期デッキ5枚を混ぜて山札にする．コマを START に置く</li>
      <li>市場のカードを種類ごとに表向きに並べる．最初の人を決める</li></ol>
    <h3>手番</h3>
    <ol><li>コマを START に置く．山札が空なら捨札を混ぜて山札にする</li>
      <li><b>めくる</b>か<b>止める</b>を繰り返す（<b>少なくとも1枚はめくる</b>）
        <ul><li>めくる：山札の上を1枚めくって「今日の流れ」（ボードの横に1列）に並べ，カードのとおりにコマを動かす．分かれ道は向きを選ぶ．
          山札が尽きたら捨札を混ぜて続けてよい</li>
          <li>ボードの端では止まる．<b>積み木は壁：積み木のマスには入れず，その手前で止まる</b>（重ならない）</li></ul></li>
      <li><b>止める</b>：コマのいるマスの効果を使う．<span style="background:${colColor(2)}">衝動</span>の列は取得の額が増え，<span style="background:${colColor(-2)}">理性</span>の列は排除の量が増える（それ以外の効果はない）</li>
      <li>止まったマスの効果（マスの右下の数字）
        <ul><li><b style="color:${INK.buy}">物欲</b>：その額までコストを払って市場からカードを取得し，捨札へ．<b>★お気に入りは自分の前に置く</b>（山札に入らない．同じものは1枚まで）</li>
          <li><b style="color:${INK.drop}">捨欲</b>：その量まで，<b>今日の流れ</b>のカードを重さを払って排除（箱へ）．一番下の行なら捨札からも1枚．
            排除したら，止まったマスに<b>片付けた跡</b>を1個置く．跡は残り続ける（排除するたびに増える．START の上下左右には置かない）</li></ul></li>
      <li>今日の流れのカードを捨札へ</li></ol>
    <h3>条件のあるカード（色の濃さ＝必要な段階）</h3>
    <ul><li><span class="badge" style="background:${colColor(2)};color:${INK.imp};border-color:${INK.imp}">衝動nで取得</span>：衝動n以上の列で止まらないと取得できない（高いもの・派手なものは衝動買い）</li>
      <li><span class="badge" style="background:${colColor(-2)};color:${INK.calm};border-color:${INK.calm}">理性nで排除</span>：理性n以上の列で止まらないと排除できない（思い入れのあるものは冷静に）</li>
      <li><b>★お気に入り</b>：ルンバ・大掃除の日・大容量ゴミ袋・スケート靴・コンパス．高いが，取ったら次の手番で勝ちうるくらい強い．効果はずっと続く．排除しなくてよい</li>
      <li><b>最後の1枚</b>：持ち物が今日めくった1枚だけなら，どこで止まってもその1枚を手放せる</li></ul>
    <h3>終わり</h3>
    <p>手番の終わりにカード（山札・捨札・今日の流れ）が0枚なら達成（★お気に入りは数えない）．誰かが達成したらそのラウンドの最後の人まで．
      達成者のうち排除した枚数が多い人の勝ち（同じならお気に入りのコスト合計が高い人，それも同じなら共同勝利）．</p>
  </section>
  <section class="page rules">
    <h2>カード一覧</h2>
    <p class="note">身軽：排除した枚数${LIGHT_PER}枚ごとに歩数+1．思い出の品は排除した枚数が${MEMO_AT}枚になると動きが変わる．</p>
    <table class="clist"><tr><th>カード</th><th>動き・効果</th><th>取得</th><th>重さ</th><th>条件</th></tr>${cardRows}</table>
  </section>`;
}

function render() {
  const boards = opt.board === 'both' ? [SBOARDS.basic, SBOARDS.slow] : [SBOARDS[opt.board] ?? SBOARDS.basic];
  const boardPages = boards.flatMap(b => Array.from({ length: opt.players }, () => boardPage(b))).join('');
  app.innerHTML = `<div class="controls">
      <label>人数 <select id="players">${[2, 3, 4, 5, 6].map(n => `<option ${n === opt.players ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>盤 <select id="board">${[['basic', '基本'], ['slow', 'ゆっくり'], ['both', '両方']].map(([v, l]) => `<option value="${v}" ${v === opt.board ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label><input type="checkbox" id="rules" ${opt.rules ? 'checked' : ''}>ルール・カード一覧</label>
      <button onclick="window.print()">印刷（A4・余白なし・背景を印刷）</button>
      <span class="note">印刷の設定で「背景のグラフィック」をオンにしてください</span>
    </div>
    ${opt.rules ? rulesPages() : ''}${boardPages}${cardPages()}${tokenPage()}`;
  for (const id of ['players', 'board', 'rules']) {
    app.querySelector<HTMLInputElement>(`#${id}`)!.onchange = () => {
      const q = new URLSearchParams({
        players: app.querySelector<HTMLSelectElement>('#players')!.value,
        board: app.querySelector<HTMLSelectElement>('#board')!.value,
        rules: app.querySelector<HTMLInputElement>('#rules')!.checked ? '1' : '0',
      });
      location.search = q.toString();
    };
  }
}

render();
