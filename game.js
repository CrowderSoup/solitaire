// Klondike Solitaire runtime
(() => {
  "use strict";

  const SUITS = ["♠", "♥", "♦", "♣"];
  const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const COLORS = { "♠": "black", "♣": "black", "♥": "red", "♦": "red" };

  /** @typedef {{id:string,suit:string,rank:number,faceUp:boolean}} Card */

  const el = {
    stock: document.querySelector("#stock .stack"),
    waste: document.querySelector("#waste .stack"),
    foundations: Array.from(document.querySelectorAll(".foundation .stack")),
    tableau: Array.from(document.querySelectorAll(".tableau .stack")),
    moveCount: document.getElementById("moveCount"),
    time: document.getElementById("time"),
    winStatus: document.getElementById("winStatus"),
    newGameBtn: document.getElementById("newGameBtn"),
    undoBtn: document.getElementById("undoBtn"),
    autoBtn: document.getElementById("autoBtn"),
    controls: document.querySelector(".controls"),
    tpl: document.getElementById("cardTemplate"),
  };

  const state = {
    stock: /** @type {Card[]} */ ([]),
    waste: /** @type {Card[]} */ ([]),
    foundations: /** @type {Card[][]} */ ([[], [], [], []]),
    tableau: /** @type {Card[][]} */ ([[], [], [], [], [], [], []]),
    selected:
      /** @type {{from:'waste'|'tableau'|'foundation', index:number, start:number}|null} */ (
        null
      ),
    moves: [],
    moveCount: 0,
    startTs: 0,
    timer: 0,
    paused: false,
    pauseAt: 0,
    drag: /** @type {null|{active:boolean,from:'waste'|'tableau'|'foundation',fromIndex:number,startIndex:number,ghost:HTMLElement,offsetX:number,offsetY:number}} */ (
      null
    ),
  };

  // Inject Pause button if missing (since HTML may not include it)
  if (!document.getElementById("pauseBtn")) {
    const btn = document.createElement("button");
    btn.id = "pauseBtn";
    btn.title = "Pause/Resume the game";
    btn.textContent = "Pause";
    (document.querySelector(".controls") || document.body).insertBefore(
      btn,
      el.autoBtn || null,
    );
    el.pauseBtn = btn;
  } else {
    el.pauseBtn = document.getElementById("pauseBtn");
  }

  // Helpers
  function makeDeck() {
    const deck = [];
    for (const s of SUITS) {
      for (const r of RANKS) {
        const id = `${s}${r}-${Math.random().toString(36).slice(2)}`;
        deck.push({ id, suit: s, rank: r, faceUp: false });
      }
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
  function rankLabel(r) {
    return r === 1
      ? "A"
      : r === 11
        ? "J"
        : r === 12
          ? "Q"
          : r === 13
            ? "K"
            : String(r);
  }
  function topCard(arr) {
    return arr.length ? arr[arr.length - 1] : null;
  }
  function suitName(s) {
    return s === "♠"
      ? "spades"
      : s === "♥"
        ? "hearts"
        : s === "♦"
          ? "diamonds"
          : "clubs";
  }

  function canPlaceOnTableau(destTop, movingTop) {
    if (!movingTop) return false;
    if (!destTop) return movingTop.rank === 13; // King
    return (
      COLORS[destTop.suit] !== COLORS[movingTop.suit] &&
      movingTop.rank === destTop.rank - 1
    );
  }
  function canPlaceOnFoundation(destTop, movingTop) {
    if (!movingTop) return false;
    if (!destTop) return movingTop.rank === 1; // Ace
    return (
      movingTop.suit === destTop.suit && movingTop.rank === destTop.rank + 1
    );
  }

  function clearSelections() {
    document
      .querySelectorAll(".selected")
      .forEach((n) => n.classList.remove("selected"));
    document
      .querySelectorAll(".highlight-valid")
      .forEach((n) => n.classList.remove("highlight-valid"));
    state.selected = null;
  }

  function cardNode(card) {
    const node = /** @type {HTMLElement} */ (
      el.tpl.content.firstElementChild.cloneNode(true)
    );
    node.dataset.id = card.id;
    node.dataset.rank = String(card.rank);
    node.dataset.suit = card.suit;
    node.classList.toggle("faceup", !!card.faceUp);
    node.setAttribute(
      "aria-label",
      `${rankLabel(card.rank)} of ${suitName(card.suit)}`,
    );
    if (card.faceUp) {
      const color = COLORS[card.suit];
      node.querySelector(".rank").textContent = rankLabel(card.rank);
      node.querySelector(".suit").textContent = card.suit;
      node.querySelector(".pip").textContent = card.suit;
      node.querySelectorAll(".rank,.suit,.pip").forEach((n) => {
        n.classList.toggle("red", color === "red");
        n.classList.toggle("black", color === "black");
      });
      node.addEventListener("click", onCardClick);
      node.addEventListener("dblclick", onCardDoubleClick);
      node.addEventListener("mousedown", onCardPointerDown);
    } else {
      node.classList.add("back");
    }
    return node;
  }

  function render() {
    [...el.foundations, ...el.tableau, el.stock, el.waste].forEach(
      (n) => (n.innerHTML = ""),
    );

    // stock backs
    state.stock.forEach((_, i) => {
      const back = document.createElement("div");
      back.className = "card back";
      back.style.top = `${i}px`;
      back.style.left = `${i * 0.2}px`;
      el.stock.appendChild(back);
    });

    // waste
    state.waste.forEach((c, i) => {
      const n = cardNode({ ...c, faceUp: true });
      const off = Math.max(0, i - (state.waste.length - 3));
      n.style.top = `${off * 6}px`;
      n.style.left = `${off * 10}px`;
      el.waste.appendChild(n);
    });

    // foundations
    state.foundations.forEach((pile, fi) => {
      pile.forEach((c, i) => {
        const n = cardNode({ ...c, faceUp: true });
        n.style.top = `${i}px`;
        el.foundations[fi].appendChild(n);
      });
    });

    // tableau
    const faceupGap =
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--fan-faceup",
        ),
      ) || 22;
    const facedownGap =
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--fan-facedown",
        ),
      ) || 6;
    state.tableau.forEach((col, ti) => {
      col.forEach((c, i) => {
        const n = cardNode(c);
        n.style.top = `${i * (c.faceUp ? faceupGap : facedownGap)}px`;
        if (!c.faceUp) {
          n.classList.add("back");
          n.innerHTML = "";
        }
        el.tableau[ti].appendChild(n);
      });
    });

    el.moveCount.textContent = String(state.moveCount);
  }

  // Selection and moves
  function select(sel) {
    state.selected = sel;
    updateHighlights();
  }
  function updateHighlights() {
    document
      .querySelectorAll(".selected")
      .forEach((n) => n.classList.remove("selected"));
    document
      .querySelectorAll(".highlight-valid")
      .forEach((n) => n.classList.remove("highlight-valid"));
    if (!state.selected) return;
    const { from, index, start } = state.selected;
    const arr =
      from === "waste"
        ? state.waste
        : from === "tableau"
          ? state.tableau[index]
          : state.foundations[index];
    arr.slice(start).forEach((c) => {
      const dom = document.querySelector(`.card.faceup[data-id="${c.id}"]`);
      if (dom) dom.classList.add("selected");
    });

    const movingTop = arr[start];
    for (let f = 0; f < 4; f++)
      if (canPlaceOnFoundation(topCard(state.foundations[f]), movingTop))
        el.foundations[f].parentElement.classList.add("highlight-valid");
    for (let t = 0; t < 7; t++)
      if (canPlaceOnTableau(topCard(state.tableau[t]), movingTop))
        el.tableau[t].parentElement.classList.add("highlight-valid");
  }

  function doMove({ from, fromIndex, startIndex, to, toIndex, count }) {
    const src =
      from === "waste"
        ? state.waste
        : from === "tableau"
          ? state.tableau[fromIndex]
          : state.foundations[fromIndex];
    const moved = src.splice(startIndex, count);
    const dst =
      to === "foundation" ? state.foundations[toIndex] : state.tableau[toIndex];
    dst.push(...moved);
    state.moves.push({
      type: "move",
      from,
      fromIndex,
      startIndex,
      to,
      toIndex,
      count,
      flippedOnSource: false,
    });
    state.moveCount++;
    clearSelections();
    render();
    afterAnyMove();
  }

  function postMoveFlipIfNeeded(from, index) {
    if (from === "tableau") {
      const p = state.tableau[index];
      if (p.length && !p[p.length - 1].faceUp) {
        p[p.length - 1].faceUp = true;
        const last = state.moves[state.moves.length - 1];
        if (last) last.flippedOnSource = true;
      }
    }
  }

  function afterAnyMove() {
    // Ensure newly exposed tableau tops are face-up, then re-render
    ensureTopFaceUp();
    render();
    checkWin();
    updateHighlights();
  }

  function ensureTopFaceUp() {
    for (let t = 0; t < 7; t++) {
      const pile = state.tableau[t];
      if (pile.length && !pile[pile.length - 1].faceUp) {
        pile[pile.length - 1].faceUp = true;
        state.moves.push({ type: "flip", tableau: t });
      }
    }
  }

  function checkWin() {
    const done = state.foundations.every(
      (p) => p.length && p[p.length - 1].rank === 13,
    );
    el.winStatus.textContent = done ? "You win" : "Game on";
    if (done) stopTimer();
  }

  // Click handlers
  function onCardClick(ev) {
    if (state.paused) return;
    if (state.drag && state.drag.active) return;
    const node = /** @type {HTMLElement} */ (ev.currentTarget);
    const id = node.dataset.id;
    const loc = findCard(id);
    if (!loc) return;
    const { where, idx, iCard } = loc;

    // If already selected, try to drop onto this card's pile
    if (state.selected) {
      const movingTop = getSelectedTop();
      if (where === "foundation") {
        if (canPlaceOnFoundation(topCard(state.foundations[idx]), movingTop))
          return commitSelectedTo("foundation", idx);
      } else if (where === "tableau") {
        if (canPlaceOnTableau(topCard(state.tableau[idx]), movingTop))
          return commitSelectedTo("tableau", idx);
      }
    }

    if (where === "waste")
      return select({ from: "waste", index: 0, start: iCard });
    if (where === "foundation")
      return select({ from: "foundation", index: idx, start: iCard });
    if (where === "tableau") {
      const pile = state.tableau[idx];
      const moving = pile.slice(iCard);
      const ok = moving.every(
        (c, k) =>
          k === 0 ||
          (COLORS[moving[k - 1].suit] !== COLORS[c.suit] &&
            c.rank === moving[k - 1].rank - 1),
      );
      if (!ok && moving.length !== 1) return; // invalid multi
      return select({ from: "tableau", index: idx, start: iCard });
    }
  }

  function onCardDoubleClick(ev) {
    if (state.paused) return;
    const node = /** @type {HTMLElement} */ (ev.currentTarget);
    const id = node.dataset.id;
    const loc = findCard(id);
    if (!loc) return;
    const { where, idx, iCard } = loc;
    const card =
      where === "waste"
        ? state.waste[iCard]
        : where === "tableau"
          ? state.tableau[idx][iCard]
          : null;
    if (!card) return;
    for (let f = 0; f < 4; f++)
      if (canPlaceOnFoundation(topCard(state.foundations[f]), card)) {
        doMove({
          from: where,
          fromIndex: idx,
          startIndex: iCard,
          to: "foundation",
          toIndex: f,
          count: 1,
        });
        postMoveFlipIfNeeded(where, idx);
        return;
      }
    for (let t = 0; t < 7; t++)
      if (canPlaceOnTableau(topCard(state.tableau[t]), card)) {
        doMove({
          from: where,
          fromIndex: idx,
          startIndex: iCard,
          to: "tableau",
          toIndex: t,
          count: 1,
        });
        postMoveFlipIfNeeded(where, idx);
        return;
      }
  }

  function findCard(cardId) {
    for (let i = 0; i < state.waste.length; i++)
      if (state.waste[i].id === cardId)
        return { where: "waste", idx: 0, iCard: i };
    for (let f = 0; f < 4; f++)
      for (let i = 0; i < state.foundations[f].length; i++)
        if (state.foundations[f][i].id === cardId)
          return { where: "foundation", idx: f, iCard: i };
    for (let t = 0; t < 7; t++)
      for (let i = 0; i < state.tableau[t].length; i++)
        if (state.tableau[t][i].id === cardId)
          return { where: "tableau", idx: t, iCard: i };
    return null;
  }

  function getSelectedTop() {
    if (!state.selected) return null;
    const { from, index, start } = state.selected;
    const arr =
      from === "waste"
        ? state.waste
        : from === "tableau"
          ? state.tableau[index]
          : state.foundations[index];
    return arr[start] || null;
  }
  function commitSelectedTo(to, toIndex) {
    const { from, index, start } = state.selected;
    const fromArr =
      from === "waste"
        ? state.waste
        : from === "tableau"
          ? state.tableau[index]
          : state.foundations[index];
    const count = fromArr.length - start;
    doMove({ from, fromIndex: index, startIndex: start, to, toIndex, count });
    postMoveFlipIfNeeded(from, index);
  }

  // Stock / Waste
  document.getElementById("stock").addEventListener("click", () => {
    if (state.paused) return;
    if (state.stock.length) {
      const c = state.stock.pop();
      c.faceUp = true;
      state.waste.push(c);
      state.moves.push({ type: "deal", card: c.id });
      state.moveCount++;
      render();
      afterAnyMove();
    } else if (state.waste.length) {
      while (state.waste.length) {
        const c = state.waste.pop();
        c.faceUp = false;
        state.stock.push(c);
      }
      state.moves.push({ type: "recycle" });
      state.moveCount++;
      render();
      afterAnyMove();
    }
  });
  document.getElementById("waste").addEventListener("click", () => {
    if (state.paused) return;
    if (state.waste.length && !state.selected)
      select({ from: "waste", index: 0, start: state.waste.length - 1 });
  });

  // Undo
  function undo() {
    if (state.paused) return;
    const last = state.moves.pop();
    if (!last) return;
    if (last.type === "deal") {
      const idx = state.waste.findIndex((c) => c.id === last.card);
      if (idx !== -1) {
        const [c] = state.waste.splice(idx, 1);
        c.faceUp = false;
        state.stock.push(c);
      }
    } else if (last.type === "recycle") {
      const temp = [];
      while (state.stock.length) {
        temp.push(state.stock.pop());
      }
      temp.reverse().forEach((c) => {
        c.faceUp = true;
        state.waste.push(c);
      });
    } else if (last.type === "move") {
      const { from, fromIndex, to, toIndex, count, flippedOnSource } = last;
      const dst =
        to === "foundation"
          ? state.foundations[toIndex]
          : state.tableau[toIndex];
      const moved = dst.splice(dst.length - count, count);
      const src =
        from === "waste"
          ? state.waste
          : from === "tableau"
            ? state.tableau[fromIndex]
            : state.foundations[fromIndex];
      src.push(...moved);
      if (flippedOnSource && from === "tableau") {
        const p = state.tableau[fromIndex];
        if (p.length) p[p.length - 1].faceUp = false;
      }
    } else if (last.type === "flip") {
      const t = last.tableau;
      const p = state.tableau[t];
      if (p.length) p[p.length - 1].faceUp = false;
    }
    state.moveCount = Math.max(0, state.moveCount - 1);
    clearSelections();
    render();
    afterAnyMove();
  }

  // Auto move
  function autoMove() {
    if (state.paused) return;
    let moved = false,
      steps = 0;
    do {
      moved = false;
      steps++;
      const w = topCard(state.waste);
      if (w) {
        for (let f = 0; f < 4; f++) {
          if (canPlaceOnFoundation(topCard(state.foundations[f]), w)) {
            doMove({
              from: "waste",
              fromIndex: 0,
              startIndex: state.waste.length - 1,
              to: "foundation",
              toIndex: f,
              count: 1,
            });
            moved = true;
            break;
          }
        }
      }
      if (moved) continue;
      for (let t = 0; t < 7 && !moved; t++) {
        const tt = topCard(state.tableau[t]);
        if (tt) {
          for (let f = 0; f < 4; f++) {
            if (canPlaceOnFoundation(topCard(state.foundations[f]), tt)) {
              doMove({
                from: "tableau",
                fromIndex: t,
                startIndex: state.tableau[t].length - 1,
                to: "foundation",
                toIndex: f,
                count: 1,
              });
              moved = true;
              break;
            }
          }
        }
      }
    } while (moved && steps < 200);
    afterAnyMove();
  }

  // Drag & Drop
  function onCardPointerDown(e) {
    if (state.paused) return;
    if (e.button !== 0) return;
    const node = /** @type {HTMLElement} */ (e.currentTarget);
    const id = node.dataset.id;
    const loc = findCard(id);
    if (!loc) return;
    let sel = null;
    const { where, idx, iCard } = loc;
    if (where === "waste") {
      if (iCard !== state.waste.length - 1) return;
      sel = { from: "waste", index: 0, start: iCard };
    } else if (where === "foundation") {
      if (iCard !== state.foundations[idx].length - 1) return;
      sel = { from: "foundation", index: idx, start: iCard };
    } else if (where === "tableau") {
      const pile = state.tableau[idx];
      const moving = pile.slice(iCard);
      const ok = moving.every(
        (c, k) =>
          k === 0 ||
          (COLORS[moving[k - 1].suit] !== COLORS[c.suit] &&
            c.rank === moving[k - 1].rank - 1),
      );
      if (!ok && moving.length !== 1) return;
      sel = { from: "tableau", index: idx, start: iCard };
    }
    if (!sel) return;
    select(sel);

    const arr =
      sel.from === "waste"
        ? state.waste
        : sel.from === "tableau"
          ? state.tableau[sel.index]
          : state.foundations[sel.index];
    const moving = arr.slice(sel.start).map((c) => ({ ...c, faceUp: true }));
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    const spacing =
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--fan-faceup",
        ),
      ) || 22;
    moving.forEach((c, i) => {
      const n = cardNode(c);
      n.style.top = `${i * spacing}px`;
      ghost.appendChild(n);
    });
    document.body.appendChild(ghost);
    const rect = node.getBoundingClientRect();
    state.drag = {
      active: true,
      from: sel.from,
      fromIndex: sel.index,
      startIndex: sel.start,
      ghost,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    positionGhost(
      e.clientX - state.drag.offsetX,
      e.clientY - state.drag.offsetY,
    );
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd, { once: true });
  }
  function onDragMove(e) {
    if (!state.drag || !state.drag.active) return;
    positionGhost(
      e.clientX - state.drag.offsetX,
      e.clientY - state.drag.offsetY,
    );
    highlightDragTarget(e.clientX, e.clientY);
  }
  function positionGhost(x, y) {
    if (!state.drag) return;
    state.drag.ghost.style.left = x + "px";
    state.drag.ghost.style.top = y + "px";
  }
  function highlightDragTarget(x, y) {
    const t = getDropTarget(x, y);
    document
      .querySelectorAll(".pile.drop-hover")
      .forEach((n) => n.classList.remove("drop-hover"));
    if (!t) return;
    const q =
      t.type === "foundation"
        ? `.pile.foundation[data-foundation-index="${t.index}"]`
        : `.pile.tableau[data-tableau-index="${t.index}"]`;
    const pileEl = document.querySelector(q);
    if (pileEl) pileEl.classList.add("drop-hover");
  }
  function onDragEnd(e) {
    if (!state.drag) return;
    const t = getDropTarget(e.clientX, e.clientY);
    let moved = false;
    if (t) {
      const movingTop = getSelectedTop();
      if (
        t.type === "foundation" &&
        canPlaceOnFoundation(topCard(state.foundations[t.index]), movingTop)
      ) {
        commitSelectedTo("foundation", t.index);
        moved = true;
      } else if (
        t.type === "tableau" &&
        canPlaceOnTableau(topCard(state.tableau[t.index]), movingTop)
      ) {
        commitSelectedTo("tableau", t.index);
        moved = true;
      }
    }
    if (state.drag.ghost) state.drag.ghost.remove();
    state.drag = null;
    document
      .querySelectorAll(".pile.drop-hover")
      .forEach((n) => n.classList.remove("drop-hover"));
    if (!moved) updateHighlights();
    window.removeEventListener("mousemove", onDragMove);
  }

  function getDropTarget(clientX, clientY) {
    const HIT = 24,
      NEAR = 56;
    let best = null,
      bestDist = Infinity;
    const piles = Array.from(
      document.querySelectorAll(".pile.foundation, .pile.tableau"),
    );
    for (const p of piles) {
      const r = p.getBoundingClientRect();
      const x1 = r.left - HIT,
        x2 = r.right + HIT,
        y1 = r.top - HIT,
        y2 = r.bottom + HIT;
      const inside =
        clientX >= x1 && clientX <= x2 && clientY >= y1 && clientY <= y2;
      if (!inside) continue;
      const cx = r.left + r.width / 2,
        cy = r.top + r.height / 2;
      const d = Math.hypot(clientX - cx, clientY - cy);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (!best) {
      for (const p of piles) {
        const r = p.getBoundingClientRect();
        const dx = Math.max(r.left - clientX, 0, clientX - r.right);
        const dy = Math.max(r.top - clientY, 0, clientY - r.bottom);
        const d = Math.hypot(dx, dy);
        if (d < NEAR && d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
    }
    if (!best) return null;
    if (best.classList.contains("foundation"))
      return {
        type: "foundation",
        index: parseInt(best.dataset.foundationIndex, 10),
      };
    return { type: "tableau", index: parseInt(best.dataset.tableauIndex, 10) };
  }

  // Pause helpers
  function setPaused(val) {
    const on = !!val;
    if (on === state.paused) return;
    if (on) {
      state.pauseAt = Date.now();
      state.paused = true;
      stopTimer();
      document.body.classList.add("paused");
      if (el.pauseBtn) el.pauseBtn.textContent = "Resume";
      el.winStatus.textContent = "Paused";
    } else {
      const delta = state.pauseAt ? Date.now() - state.pauseAt : 0;
      state.startTs += delta;
      state.pauseAt = 0;
      state.paused = false;
      document.body.classList.remove("paused");
      if (el.pauseBtn) el.pauseBtn.textContent = "Pause";
      startTimer();
      checkWin();
    }
  }

  // Timer helpers
  function startTimer() {
    if (state.timer) clearInterval(state.timer);
    state.startTs = Date.now();
    state.timer = setInterval(() => {
      const secs = ((Date.now() - state.startTs) / 1000) | 0;
      const m = (secs / 60) | 0,
        s = secs % 60;
      el.time.textContent = `${m}:${String(s).padStart(2, "0")}`;
    }, 1000);
  }
  function stopTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = 0;
  }

  // Empty-slot pile clicks
  document.querySelectorAll(".foundation").forEach((pileEl, fIdx) =>
    pileEl.addEventListener("click", () => {
      if (state.paused || !state.selected) return;
      const mt = getSelectedTop();
      if (canPlaceOnFoundation(topCard(state.foundations[fIdx]), mt))
        commitSelectedTo("foundation", fIdx);
    }),
  );
  document.querySelectorAll(".tableau").forEach((pileEl, tIdx) =>
    pileEl.addEventListener("click", () => {
      if (state.paused || !state.selected) return;
      const mt = getSelectedTop();
      if (canPlaceOnTableau(topCard(state.tableau[tIdx]), mt))
        commitSelectedTo("tableau", tIdx);
    }),
  );

  // Buttons and keys
  el.newGameBtn.addEventListener("click", () => {
    if (state.paused) setPaused(false);
    dealNewGame();
  });
  el.undoBtn.addEventListener("click", () => {
    if (!state.paused) undo();
  });
  el.autoBtn.addEventListener("click", () => {
    if (!state.paused) autoMove();
  });
  if (el.pauseBtn)
    el.pauseBtn.addEventListener("click", () => setPaused(!state.paused));
  window.addEventListener("keydown", (e) => {
    if (e.key === "p") {
      setPaused(!state.paused);
      return;
    }
    if (state.paused) {
      if (e.key === "n") {
        setPaused(false);
        dealNewGame();
      }
      return;
    }
    if (e.key === "n") dealNewGame();
    if (e.key === "u") undo();
    if (e.key === "a") autoMove();
  });

  // Game setup
  function dealNewGame() {
    setPaused(false);
    stopTimer();
    state.stock = [];
    state.waste = [];
    state.foundations = [[], [], [], []];
    state.tableau = [[], [], [], [], [], [], []];
    state.moves = [];
    state.moveCount = 0;
    clearSelections();
    const deck = makeDeck();
    for (let col = 0; col < 7; col++) {
      for (let k = 0; k <= col; k++) {
        const c = deck.pop();
        c.faceUp = k === col;
        state.tableau[col].push(c);
      }
    }
    while (deck.length) state.stock.push(deck.pop());
    el.winStatus.textContent = "Game on";
    startTimer();
    render();
  }

  // boot
  dealNewGame();
})();
