// スライド版の画面：ローカル（ボットと）とオンライン（部屋コードで人と．ボットも入れられる）

import './ui.css';
import { ARROW, CARD_SETS, Dir, MARKET, SCARDS, SKind, UNLIMITED_KINDS, canBuyAt, canDropAt, marketFromChoice, needText } from './cards';
import { SMAX_SEATS, SRoomInfo, SServerMsg } from './protocol';
import {
  DEFAULT_BOARD, SBOARDS, SCard, SPlayer, SState, Walk, X_MAX, X_MIN, applySlide, bonus, cellPower,
  canFlip, choicesFor, favCost, isLastCard, hasBlock, isTrace, discardLimit, isDeep, newSlideGame, ownedCards, removeLoad, rowEffect, samePos, stopperCells, yMax, yMin,
} from './engine';
import { SBOT_LABELS, SPRESETS, chooseSlideAction } from './bot';
import { randomSeed } from '../engine/rng';
import { colColor, colInk, needBadges, rowColor } from './colors';

const app = document.getElementById('app')!;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 保存できなくても遊べる */ } },
};

let s: SState | null = null;
let botTypes: string[] = [];
let timer = 0;
const sel = { buy: [] as SKind[], remove: new Set<number>(), roomba: null as number | null };

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ---- オンライン ----

interface Net { ws: WebSocket | null; code: string; token: string; name: string; room: SRoomInfo | null; closed: boolean }
let net: Net | null = null;

function token(): string {
  let t = store.get('slide.token');
  if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('slide.token', t); }
  return t;
}

function goOnline(code: string, name: string) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) return alert('部屋コードは英数字4〜8文字です');
  store.set('slide.name', name);
  clearTimeout(timer);
  s = null;
  net = { ws: null, code, token: token(), name, room: null, closed: false };
  history.replaceState(null, '', `?room=${code}`);
  connect();
  render();
}

function connect() {
  const n = net;
  if (!n) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/slide/${n.code}/ws`);
  n.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: n.name, token: n.token }));
  ws.onmessage = e => {
    const m = JSON.parse(e.data) as SServerMsg;
    if (m.t === 'error') { alert(m.message); return; }
    const prevKey = s ? `${s.current}-${s.round}-${s.turn}` : '';
    n.room = m.room;
    s = m.state;
    me = m.room.you;
    if (!s || `${s.current}-${s.round}-${s.turn}` !== prevKey) { sel.buy = []; sel.remove.clear(); sel.roomba = null; }
    render();
  };
  ws.onclose = () => { if (net === n && !n.closed) setTimeout(connect, 1500); };
}

function send(msg: object) {
  if (net?.ws?.readyState === WebSocket.OPEN) net.ws.send(JSON.stringify(msg));
  else alert('接続中です．少し待ってからもう一度');
}

function leaveOnline() {
  if (net) { net.closed = true; net.ws?.close(); }
  net = null;
  history.replaceState(null, '', location.pathname);
}

/** 部屋の待合室（ゲーム開始前） */
function lobby() {
  const room = net!.room;
  if (!room) { app.innerHTML = `<main class="setup"><p>部屋 ${esc(net!.code)} に接続しています…</p><button id="back">戻る</button></main>`; bindBack(); return; }
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  const opts = Object.keys(SPRESETS).map(k => `<option value="${k}">${SBOT_LABELS[k]}</option>`).join('');
  app.innerHTML = `
  <main class="setup">
    <h1>部屋 ${esc(room.code)}</h1>
    <p>この URL を送ると一緒に遊べます：<br><input class="link" readonly value="${esc(link)}"> <button id="copy">コピー</button></p>
    <h3>参加者（${room.seats.length}/${SMAX_SEATS}）</h3>
    <ul class="seats">${room.seats.map((x, i) => `<li>${esc(x.name)}${i === room.you ? '（あなた）' : ''}${x.isBot || x.connected ? '' : ' <span class="muted">（切断中）</span>'}
      ${room.isHost && i !== room.you ? `<button data-remove="${i}">外す</button>` : ''}</li>`).join('')}</ul>
    ${room.you < 0 ? '<p class="muted">満席のため観戦になります</p>' : ''}
    ${room.isHost ? `
      <p><select id="botType">${opts}</select> <button id="addBot" ${room.seats.length >= SMAX_SEATS ? 'disabled' : ''}>ボットを追加</button></p>
      ${optionsHTML()}
      <button id="start" class="primary" ${room.seats.length < 2 ? 'disabled' : ''}>ゲーム開始</button>
      ${room.seats.length < 2 ? '<p class="muted">2人以上（ボットを含む）で始められます</p>' : ''}`
    : '<p class="muted">ホストが開始するのを待っています…</p>'}
    <p><button id="back">部屋を出る</button></p>
    <details><summary>ルールの要約</summary>${rulesHTML()}</details>
  </main>`;
  bindOptions();
  bindBack();
  app.querySelector<HTMLButtonElement>('#copy')?.addEventListener('click', () => navigator.clipboard?.writeText(link));
  app.querySelector<HTMLButtonElement>('#addBot')?.addEventListener('click', () => send({ t: 'addBot', botType: app.querySelector<HTMLSelectElement>('#botType')!.value }));
  app.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(b => b.onclick = () => send({ t: 'removeSeat', seat: +b.dataset.remove! }));
  app.querySelector<HTMLButtonElement>('#start')?.addEventListener('click', () => {
    const o = readOptions();
    if (!o) return;
    send({ t: 'start', board: o.board, set: o.set, cards: o.cards });
  });
}

function bindBack() {
  app.querySelector<HTMLButtonElement>('#back')?.addEventListener('click', () => { leaveOnline(); setup(); });
}

// ---- 盤とカードセットの選択（ローカル・オンライン共通） ----

function optionsHTML(): string {
  const set = store.get('slide.set') ?? 'all';
  const custom = new Set((store.get('slide.cards') ?? MARKET.join(',')).split(','));
  return `
    <label>盤 <select id="board">${Object.values(SBOARDS).map(b => `<option value="${b.name}" ${b.name === (store.get('slide.board') ?? DEFAULT_BOARD) ? 'selected' : ''}>${b.label}</option>`).join('')}</select></label>
    <label>市場のカードセット <select id="set">${CARD_SETS.map(c => `<option value="${c.id}" ${c.id === set ? 'selected' : ''}>${c.label}</option>`).join('')}
      <option value="custom" ${set === 'custom' ? 'selected' : ''}>自分で選ぶ</option></select></label>
    <div id="setInfo" class="setinfo"></div>
    <div id="custom" class="custom" ${set === 'custom' ? '' : 'hidden'}>${MARKET.map(k => `<label class="ck"><input type="checkbox" value="${k}" ${custom.has(k) || UNLIMITED_KINDS.includes(k) ? 'checked' : ''} ${UNLIMITED_KINDS.includes(k) ? 'disabled' : ''}>${SCARDS[k].perm ? '★' : ''}${SCARDS[k].name}<small>${SCARDS[k].cost}</small></label>`).join('')}</div>`;
}

function bindOptions() {
  const setSel = app.querySelector<HTMLSelectElement>('#set');
  if (!setSel) return;
  const info = () => {
    const v = setSel.value;
    app.querySelector<HTMLElement>('#custom')!.hidden = v !== 'custom';
    const cs = CARD_SETS.find(c => c.id === v);
    const list = cs && cs.cards.length ? `<br>${cs.cards.map(k => `${SCARDS[k].perm ? '★' : ''}${SCARDS[k].name}`).join('・')}` : '';
    app.querySelector<HTMLElement>('#setInfo')!.innerHTML = v === 'custom' ? '片付けたいは必ず入ります．ほかに4種類以上' : `${cs?.note ?? ''}${list}`;
  };
  // 選んだものはすぐ保存する（部屋では人が入るたびに画面を描き直すので）
  setSel.onchange = () => { store.set('slide.set', setSel.value); info(); };
  const boardSel = app.querySelector<HTMLSelectElement>('#board')!;
  boardSel.onchange = () => store.set('slide.board', boardSel.value);
  app.querySelectorAll<HTMLInputElement>('#custom input').forEach(x => x.onchange = () =>
    store.set('slide.cards', [...app.querySelectorAll<HTMLInputElement>('#custom input:checked')].map(y => y.value).join(',')));
  info();
}

/** 選んだ盤・カードセット（不正なら null） */
function readOptions(): { board: string; set: string; cards?: SKind[]; market: SKind[] } | null {
  const board = app.querySelector<HTMLSelectElement>('#board')!.value;
  const set = app.querySelector<HTMLSelectElement>('#set')!.value;
  const cards = [...app.querySelectorAll<HTMLInputElement>('#custom input:checked')].map(x => x.value as SKind);
  let market: SKind[];
  try { market = marketFromChoice(set === 'custom' ? cards : set); } catch (e) { alert((e as Error).message); return null; }
  store.set('slide.board', board);
  store.set('slide.set', set);
  if (set === 'custom') store.set('slide.cards', cards.join(','));
  return { board, set, cards: set === 'custom' ? cards : undefined, market };
}

// ---- 開始画面 ----

function setup() {
  clearTimeout(timer);
  s = null;
  me = 0;
  const saved = (store.get('slide.bots') ?? 'light,slide').split(',');
  const opts = (v: string) => Object.keys(SPRESETS).map(k => `<option value="${k}" ${k === v ? 'selected' : ''}>${SBOT_LABELS[k]}</option>`).join('');
  app.innerHTML = `
  <main class="setup">
    <h1>ミニマリスト <small>スライド版（試作）</small></h1>
    <p>手札はありません．山札の上をめくるたびに，欲に流されてコマが動きます．好きなところで止めて，
      <b>物欲</b>の行ならカードを取得，<b>捨欲</b>の行なら今日めくったカードを排除．カードを0枚にしたら達成です．
      ★お気に入りは取ったら自分の前に置かれ，効果がずっと続きます．</p>
    <label>あなたの名前 <input id="name" value="${esc(store.get('slide.name') ?? 'あなた')}" maxlength="12"></label>
    <section class="box">
      <h3>人と遊ぶ（オンライン）</h3>
      <p class="muted">部屋を作って URL を送るか，教えてもらった部屋コードで入ります．ボットも入れられます．盤とカードセットは部屋を作った人が開始時に選びます</p>
      <button id="create" class="primary">部屋を作る</button>
      <input id="code" maxlength="8" placeholder="部屋コード" value="${esc(new URLSearchParams(location.search).get('room') ?? '')}"> <button id="join">入る</button>
    </section>
    <section class="box">
      <h3>ボットと遊ぶ（この端末だけ）</h3>
      <div id="bots">${[0, 1, 2].map(i => `<label>ボット${i + 1}
        <select data-i="${i}"><option value="">なし</option>${opts(saved[i] ?? '')}</select></label>`).join('')}</div>
      ${optionsHTML()}
      <button id="start" class="primary">はじめる</button>
    </section>
    <details><summary>ルールの要約</summary>${rulesHTML()}</details>
  </main>`;
  bindOptions();
  const nameOf = () => app.querySelector<HTMLInputElement>('#name')!.value.trim() || 'あなた';
  app.querySelector<HTMLButtonElement>('#create')!.onclick = () => {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    goOnline(Array.from({ length: 5 }, () => abc[Math.floor(Math.random() * abc.length)]).join(''), nameOf());
  };
  app.querySelector<HTMLButtonElement>('#join')!.onclick = () => goOnline(app.querySelector<HTMLInputElement>('#code')!.value, nameOf());
  app.querySelector<HTMLButtonElement>('#start')!.onclick = () => {
    const name = nameOf();
    botTypes = [...app.querySelectorAll<HTMLSelectElement>('#bots select')].map(x => x.value).filter(Boolean);
    if (!botTypes.length) botTypes = ['light'];
    const o = readOptions();
    if (!o) return;
    store.set('slide.name', name);
    store.set('slide.bots', botTypes.join(','));
    localMarket = o.market;
    s = newSlideGame([{ name }, ...botTypes.map(t => ({ name: SBOT_LABELS[t], isBot: true, botType: t }))], randomSeed(), { board: o.board, market: o.market });
    render();
  };
}
let localMarket: SKind[] | undefined;

function rulesHTML() {
  return `<ul>
    <li>毎手番，コマは中央から．少なくとも1枚めくる．山札が尽きたら捨札を混ぜてめくり続けられる</li>
    <li>縦：中央から上が<b>物欲</b>（その行の額まで取得），下が<b>捨欲</b>（その行の量まで排除．一番下は捨札からも1枚）．額・量は盤の左に書いてある</li>
    <li>横：右ほど<b>衝動</b>（取得の額+1/+2/+3，排除の量は±0/−1/−1），左ほど<b>理性</b>（排除の量±0/+1/+1，取得の額は−1/−1/−2）．左上・右下ほど少ない（0より下にはならない）</li>
    <li>高いもの・派手なもの（お気に入り・滑り台・氷の廊下・道連れ袋）は<b>衝動の列でないと取得できない</b>．
      思い入れのあるもの（ガラクタ・思い出の品・滑り台）は<b>理性の列でないと排除できない</b></li>
    <li>最後の1枚（持ち物が今日めくった1枚だけ）は，どこで止まっても手放せる</li>
    <li>排除できるのは今日めくったカード（重さの合計が量以下）．排除したマスに<b>片付けた跡</b>が残り続ける（排除するたびに増える）</li>
    <li>片付けた跡とストッパーの積み木は壁：そのマスには入れず，手前で止まる．START の上下左右には置けない</li>
    <li><b>お気に入り</b>（★．ルンバ・大掃除の日・大容量ゴミ袋・スケート靴・コンパス）は取得したら自分の前に置く．山札に入らず，効果がずっと続く．各1枚まで．排除しなくてよい</li>
    <li>カードが0枚になったら達成（お気に入りは数えない）．誰かが達成したらそのラウンドの最後まで．排除した枚数が多い人の勝ち（同じならお気に入りのコストの合計）</li>
  </ul>`;
}

// ---- ゲーム画面 ----

let me = 0;
const cur = () => s!.players[s!.current];

function rowLabel(y: number) {
  const e = rowEffect(y, s!.board);
  return e.kind === 'buy' ? '物欲' : e.kind === 'remove' ? '捨欲' : 'スタート';
}
/** 列の増減の短い説明（例：額+2 量−1） */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
function colFx(x: number) { return `額${signed(bonus(x, 'buy'))} 量${signed(bonus(x, 'remove'))}`; }
function colLabel(x: number) { return x < 0 ? `理性${-x}` : x > 0 ? `衝動${x}` : '中'; }

function boardHTML(p: SPlayer, big: boolean, clickCells: { x: number; y: number }[] = [], preview?: { x: number; y: number }) {
  const w = p.walk;
  const active = s!.players[s!.current] === p;
  let h = `<div class="board ${big ? 'big' : 'mini'}"><div class="corner"></div>`;
  for (let x = X_MIN; x <= X_MAX; x++) h += `<div class="colh" style="--hb:${colColor(x) ?? 'transparent'};color:${colInk(x)}">${big ? colLabel(x) : x}${big && x !== 0 ? `<small>${colFx(x)}</small>` : ''}</div>`;
  const b = s!.board;
  for (let y = yMax(b); y >= yMin(b); y--) {
    const e = rowEffect(y, b);
    h += `<div class="rowh ${e.kind}" style="--hb:${rowColor(e.kind, e.amount)}">${big ? rowLabel(y) : e.kind === 'none' ? 'S' : e.amount}${big && e.kind !== 'none' ? `<small>${e.kind === 'buy' ? '額' : '量'}${e.amount}${isDeep(y, b) ? '＋捨札1' : ''}</small>` : ''}</div>`;
    for (let x = X_MIN; x <= X_MAX; x++) {
      const pos = { x, y };
      const cls = [e.kind, x > 0 ? 'imp' : x < 0 ? 'calm' : ''];
      if (active && w.trail.some(t => samePos(t, pos))) cls.push('trail');
      if (clickCells.some(c => samePos(c, pos))) cls.push('pick');
      if (preview && samePos(preview, pos)) cls.push('preview');
      const block = isTrace(w, pos) ? `<span class="block trace" title="片付けた跡（入れない）"></span>`
        : hasBlock(w, pos) ? `<span class="block" title="積み木（入れない）"></span>` : '';
      const pawn = active && samePos(w.pos, pos) ? `<span class="pawn"></span>` : '';
      const start = x === 0 && y === 0 ? `<span class="start">S</span>` : '';
      const pw = cellPower(pos, b);
      const amt = big && pw.kind !== 'none' ? `<span class="amt">${pw.kind === 'buy' ? '額' : '量'}${pw.amount}</span>` : '';
      const tint = `--row:${rowColor(e.kind, e.amount)};--col:${colColor(x) ?? rowColor(e.kind, e.amount)}`;
      h += `<div class="cell ${cls.join(' ')}" style="${tint}" data-x="${x}" data-y="${y}">${start}${amt}${block}${pawn}</div>`;
    }
  }
  return h + `</div>`;
}

function moveText(c: SCard) {
  return SCARDS[c.kind].text;
}
function cardHTML(c: SCard | { kind: SKind; id?: number }, extra = '', cls = '') {
  const d = SCARDS[c.kind];
  const fav = !!d.perm;
  return `<div class="card ${cls} ${fav ? 'favc' : ''} ${d.cost === null ? 'startc' : ''}" ${'id' in c && c.id ? `data-id="${c.id}"` : ''} ${extra}>
    <div class="ct"><b>${fav ? '★' : ''}${d.name}</b>${d.cost !== null ? `<span class="cost">${d.cost}</span>` : ''}</div>
    <div class="cm">${esc(d.text)}</div>
    ${needText(c.kind) ? `<div class="need">${needBadges(c.kind)}</div>` : ''}
    <div class="cw">${fav ? 'お気に入り（永続）' : `重さ${d.weight}`}</div></div>`;
}

function render() {
  if (net && !s) return lobby();
  if (!s) return setup();
  const p = cur();
  const mine = s.current === me && s.phase === 'play';
  const human = s.players[Math.max(0, me)];
  let clickCells: { x: number; y: number }[] = [];
  let preview: { x: number; y: number } | undefined;
  if (mine && s.turn === 'stopper') clickCells = stopperCells(p.walk);

  const others = s.players.map((q, i) => ({ q, i })).filter(x => x.i !== me);
  app.innerHTML = `
  <header><b>ミニマリスト スライド版</b> <span>ラウンド ${s.round}</span>
    <span class="turnof">${s.phase === 'over' ? 'ゲーム終了' : `${esc(p.name)}の手番`}</span>
    ${net ? `<span class="muted">部屋 ${esc(net.code)}${me < 0 ? '（観戦中）' : ''}</span>` : ''}
    <button id="quit">${net ? '部屋を出る' : 'やめる'}</button></header>
  <main class="game">
    <section class="left">
      ${boardHTML(s.current === me || s.phase === 'over' ? human : p, true, clickCells, preview)}
      <div class="who">${s.current === me || s.phase === 'over' ? '' : `${esc(p.name)}の盤（あなたの盤は下の一覧）`}</div>
    </section>
    <section class="right">
      <div class="panel">${controlsHTML()}</div>
      <h3>今日の流れ <small>${esc(p.name)}</small></h3>
      <div class="flow">${p.flow.map(c => cardHTML(c)).join('') || '<span class="muted">まだめくっていません</span>'}</div>
      <h3>プレイヤー</h3>
      <table class="players"><tr><th></th><th>山札</th><th>捨札</th><th>持ち物</th><th>排除</th><th>取得</th><th>★</th></tr>
      ${s.players.map((q, i) => `<tr class="${i === s!.current ? 'now' : ''}"><td>${esc(q.name)}${q.finished ? ' ✓' : ''}${s!.winners.includes(i) ? ' 🏆' : ''}</td>
        <td>${q.deck.length}</td><td>${q.discard.length}</td><td>${ownedCards(q).length}</td><td>${q.removed}</td><td>${q.bought}</td><td>${q.perms.map(k => SCARDS[k].name).join('・') || '−'}</td></tr>`).join('')}</table>
      <div class="minis">${others.map(({ q }) => `<div><small>${esc(q.name)}</small>${boardHTML(q, false)}</div>`).join('')}
        ${s.current !== me && s.phase !== 'over' ? `<div><small>あなた</small>${boardHTML(human, false)}</div>` : ''}</div>
      <h3>あなたのカード <small>（種類順．山札の順番はわからない）</small></h3>
      <div class="owned">${ownedList(human)}</div>
      ${human.perms.length ? `<h3>あなたのお気に入り <small>（永続）</small></h3><div class="flow">${human.perms.map(k => cardHTML({ kind: k })).join('')}</div>` : ''}
      <h3>市場</h3>
      <div class="market">${marketHTML(false)}</div>
      <h3>記録</h3>
      <ol class="log">${s.log.slice(-14).reverse().map(l => `<li>${esc(l)}</li>`).join('')}</ol>
    </section>
  </main>`;
  app.querySelector<HTMLButtonElement>('#quit')!.onclick = () => { if (s?.phase === 'over' || confirm(net ? '部屋を出ますか？（あとで同じ URL から戻れます）' : 'ゲームをやめますか？')) { leaveOnline(); setup(); } };
  bindControls(clickCells);
  if (!net && s.phase === 'play' && cur().isBot) {
    clearTimeout(timer);
    timer = window.setTimeout(botStep, s.turn === 'resolve' ? 700 : 380);
  }
}

function ownedList(p: SPlayer) {
  const counts = new Map<string, { c: SCard; n: number }>();
  for (const c of ownedCards(p)) {
    const k = c.kind;
    const e = counts.get(k);
    if (e) e.n++; else counts.set(k, { c, n: 1 });
  }
  return [...counts.values()].sort((a, b) => a.c.kind.localeCompare(b.c.kind))
    .map(({ c, n }) => `<span class="chip" title="${esc(moveText(c))}">${SCARDS[c.kind].name}×${n}</span>`).join('');
}

function marketHTML(buying: boolean, x = 0) {
  return Object.entries(s!.market).map(([k, n]) => {
    const kind = k as SKind;
    const chosen = sel.buy.filter(x => x === kind).length;
    const left = (n ?? 0) - chosen;
    return `<div class="mk">${cardHTML({ kind }, buying ? `data-buy="${kind}"` : '')}
      <div class="stock">${n! >= 99 ? '∞' : `残り${n}`}${buying ? ` <button data-add="${kind}" ${left <= 0 || !canBuyAt(kind, x) || (SCARDS[kind].perm && (cur().perms.includes(kind) || chosen > 0)) ? 'disabled' : ''}>＋</button><button data-sub="${kind}" ${chosen ? '' : 'disabled'}>−</button> ${chosen ? `<b>×${chosen}</b>` : ''}` : ''}</div></div>`;
  }).join('');
}

function controlsHTML(): string {
  const st = s!;
  if (st.phase === 'over') {
    return `<p class="big">${st.winners.length ? `${st.winners.map(i => esc(st.players[i].name)).join('・')}の${st.winners.length > 1 ? '共同勝利' : '勝利'}！` : '引き分け'}</p>
      <p>${st.players.map(q => `${esc(q.name)}：排除${q.removed}枚・お気に入り${favCost(q)}`).join('<br>')}</p>
      ${net && !net.room?.isHost ? '<p class="muted">ホストが再戦を選べます</p>' : '<button id="again" class="primary">もう一度</button>'}`;
  }
  const p = cur();
  if (st.current !== me) return `<p>${esc(p.name)}が考えています…</p>`;
  const w = p.walk;
  const here = cellPower(w.pos, st.board);
  switch (st.turn) {
    case 'move': {
      const where = !p.flow.length ? '少なくとも1枚めくってください'
        : `止めると (${w.pos.x},${w.pos.y}) ${here.kind === 'buy' ? `物欲${here.amount}で取得` : here.kind === 'remove' ? `捨欲${here.amount}で排除` : 'で何もしない'}`;
      return `<p>${where}</p>
        <button id="flip" class="primary" ${canFlip(p) ? '' : 'disabled'}>めくる（山札${p.deck.length}${p.deck.length ? '' : '→捨札を混ぜる'}）</button>
        <button id="stop" ${!p.flow.length && canFlip(p) ? 'disabled' : ''}>止める</button>`;
    }
    case 'branch': {
      const card = p.flow[p.flow.length - 1];
      return `<p>${SCARDS[card.kind].name}：どちらへ進みますか</p>${choicesFor(card, w).map(d => `<button data-dir="${d}" class="primary">${ARROW[d]}</button>`).join(' ')}`;
    }
    case 'stopper':
      return `<p>ストッパー：積み木を置くマスを盤で選んでください（光っているマス）</p><button id="noblock">置かない</button>`;
    case 'resolve': {
      if (isLastCard(p)) {
        return `<p>最後の1枚です．どこで止まっても手放せます</p>${cardHTML(p.flow[0])}
          <button id="lastdrop" class="primary">手放す</button> <button id="resolve">手放さない</button>`;
      }
      // ルンバ：どこで止まっても今日の流れから1枚
      const rb = p.perms.includes('ROOMBA') && p.flow.length
        ? `<p>★ルンバ：今日の流れから1枚排除できる（条件・重さなし）</p><div class="flow pickable">${p.flow.filter(c => !sel.remove.has(c.id)).map(c => cardHTML(c, `data-rb="${c.id}"`, sel.roomba === c.id ? 'on' : '')).join('')}</div>` : '';
      if (here.kind === 'buy') {
        const total = sel.buy.reduce((n, k) => n + (SCARDS[k].cost ?? 0), 0);
        return `<p>物欲 <b>${here.amount}</b>：取得するカードを選んでください（使用 ${total}/${here.amount}）．★お気に入りは自分の前に置かれる</p>
          <div class="market buying">${marketHTML(true, w.pos.x)}</div>${rb}
          <button id="resolve" class="primary" ${total > here.amount ? 'disabled' : ''}>決定</button>`;
      }
      if (here.kind === 'remove') {
        const flowSel = p.flow.filter(c => sel.remove.has(c.id));
        const big = p.perms.includes('BIGDAY');
        const load = big ? 0 : removeLoad(flowSel);
        const dn = discardLimit(p, here.amount, isDeep(w.pos.y, st.board));
        const discSel = p.discard.filter(c => sel.remove.has(c.id));
        return `<p>捨欲 <b>${here.amount}</b>：今日の流れから排除するカードを選んでください（${big ? '★大掃除の日：何枚でも' : `重さ ${load}/${here.amount}`}）</p>
          <div class="flow pickable">${p.flow.map(c => canDropAt(c.kind, w.pos.x) && sel.roomba !== c.id ? cardHTML(c, `data-rm="${c.id}"`, sel.remove.has(c.id) ? 'on' : '') : cardHTML(c, '', 'no')).join('')}</div>
          ${dn ? `<p>捨札からも${dn}枚まで（重さなし）</p><div class="flow pickable">${p.discard.filter(c => canDropAt(c.kind, w.pos.x)).map(c => cardHTML(c, `data-rm="${c.id}"`, sel.remove.has(c.id) ? 'on' : '')).join('') || '<span class="muted">捨札はありません</span>'}</div>` : ''}${rb}
          <button id="resolve" class="primary" ${load > here.amount || discSel.length > dn ? 'disabled' : ''}>決定</button>`;
      }
      return `<p>効果のないマスで止まりました</p>${rb}<button id="resolve" class="primary">手番を終える</button>`;
    }
  }
}

function act(a: Parameters<typeof applySlide>[2]) {
  if (net) {
    send({ t: 'action', action: a });
    if (a.type === 'resolve') { sel.buy = []; sel.remove.clear(); sel.roomba = null; }
    return;
  }
  try {
    applySlide(s!, me, a);
    if (a.type === 'resolve' || s!.turn === 'resolve') { sel.buy = []; sel.remove.clear(); sel.roomba = null; }
  } catch (e) { alert((e as Error).message); }
  render();
}

function bindControls(clickCells: { x: number; y: number }[]) {
  const q = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel);
  q('#again')?.addEventListener('click', () => {
    if (net) return send({ t: 'restart' });
    s = newSlideGame(s!.players.map(p => ({ name: p.name, isBot: p.isBot, botType: p.botType })), randomSeed(), { board: s!.board.name, market: localMarket });
    render();
  });
  q('#flip')?.addEventListener('click', () => act({ type: 'flip' }));
  q('#stop')?.addEventListener('click', () => act({ type: 'stop' }));
  q('#noblock')?.addEventListener('click', () => act({ type: 'stopper', cell: null }));
  app.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach(b => b.onclick = () => act({ type: 'branch', dir: b.dataset.dir as Dir }));
  app.querySelectorAll<HTMLElement>('.board.big .cell.pick').forEach(el => el.onclick = () => {
    const pos = { x: +el.dataset.x!, y: +el.dataset.y! };
    if (!clickCells.some(c => samePos(c, pos))) return;
    if (s!.turn === 'stopper') act({ type: 'stopper', cell: pos });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-add]').forEach(b => b.onclick = () => { sel.buy.push(b.dataset.add as SKind); render(); });
  app.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach(b => b.onclick = () => {
    const i = sel.buy.lastIndexOf(b.dataset.sub as SKind);
    if (i >= 0) sel.buy.splice(i, 1);
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-rb]').forEach(el => el.onclick = () => {
    const id = +el.dataset.rb!;
    sel.roomba = sel.roomba === id ? null : id;
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-rm]').forEach(el => el.onclick = () => {
    const id = +el.dataset.rm!;
    if (sel.remove.has(id)) sel.remove.delete(id); else sel.remove.add(id);
    render();
  });
  q('#lastdrop')?.addEventListener('click', () => act({ type: 'resolve', buy: [], remove: [cur().flow[0].id] }));
  q('#resolve')?.addEventListener('click', () => act({ type: 'resolve', buy: [...sel.buy], remove: [...sel.remove], ...(sel.roomba !== null ? { roomba: sel.roomba } : {}) }));
}

function botStep() {
  if (!s || s.phase !== 'play' || !cur().isBot) return;
  const p = cur();
  const g = SPRESETS[p.botType ?? 'light'] ?? SPRESETS.light;
  applySlide(s, s.current, chooseSlideAction(s, g));
  render();
}

// ?room=XXXX で開かれたら，そのまま部屋に入る
const initialRoom = new URLSearchParams(location.search).get('room');
if (initialRoom) goOnline(initialRoom, store.get('slide.name') ?? 'プレイヤー');
else setup();
