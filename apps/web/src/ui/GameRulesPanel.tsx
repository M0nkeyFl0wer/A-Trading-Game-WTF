import { useState } from 'react';

export default function GameRulesPanel() {
  const [open, setOpen] = useState(false);

  return (
    <section className="card" aria-labelledby="rules-heading">
      <button
        type="button"
        className="section-heading"
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          padding: 0,
        }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="rules-content"
      >
        <h3 id="rules-heading">
          {open ? '▾' : '▸'} How to play
        </h3>
        <span>{open ? 'Hide rules' : 'Show rules'}</span>
      </button>

      {open && (
        <div id="rules-content" style={{ marginTop: 12 }}>
          <ol style={{ paddingLeft: 20, display: 'grid', gap: 10, lineHeight: 1.5 }}>
            <li>
              <strong>Join a table</strong> &mdash; Pick a character and sit down.
              Bot opponents fill empty seats automatically.
            </li>
            <li>
              <strong>Get your card</strong> &mdash; Each player is dealt a hidden
              card (value 1&ndash;20). Three community cards are also dealt face-down.
            </li>
            <li>
              <strong>Trade</strong> &mdash; During the 20-second trading window,
              post a bid/ask quote. Your goal is to buy low and sell high relative
              to the true card values.
            </li>
            <li>
              <strong>Settlement</strong> &mdash; After the timer expires, all cards
              are revealed. Your P&amp;L is calculated from:
              <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                <li>Your card value vs. the table average (card P&amp;L)</li>
                <li>Profit or loss from trades you made (position P&amp;L)</li>
                <li>A small house fee (1%) on trade volume</li>
              </ul>
            </li>
            <li>
              <strong>Win</strong> &mdash; The player with the highest balance
              after settlement wins the round. A new round starts automatically.
            </li>
          </ol>

          <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(99,102,241,0.12)', borderRadius: 8 }}>
            <strong>Tip:</strong> High cards (15, 20) will earn you card P&amp;L,
            but the real money is in reading the other players and trading well.
            The &minus;10 card is a trap &mdash; if you get it, sell aggressively
            to minimize losses.
          </div>
        </div>
      )}
    </section>
  );
}
