import { useState } from 'react';

export default function GameRulesPanel() {
  const [open, setOpen] = useState(false);

  return (
    <section className="card" aria-labelledby="rules-heading">
      <button
        type="button"
        className="section-heading"
        style={{ cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left', padding: 0 }}
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        aria-controls="rules-content"
      >
        <h3 id="rules-heading" style={{ margin: 0 }}>How to play</h3>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div id="rules-content" style={{ marginTop: 12 }}>
          <ol style={{ paddingLeft: 20, margin: 0, lineHeight: 1.7 }}>
            <li><strong>Join a table</strong> &mdash; pick a seat in the lobby or create your own room.</li>
            <li><strong>Cards are dealt</strong> &mdash; each player receives a hidden card (value 1&ndash;20).</li>
            <li><strong>Trading window (20 s)</strong> &mdash; buy or sell shares based on your card and market sentiment.</li>
            <li><strong>Settlement</strong> &mdash; cards are revealed. P&amp;L = card value + position gains minus a 1% house fee.</li>
            <li><strong>Winner</strong> &mdash; the player with the highest balance at the end of the session wins.</li>
          </ol>
          <p style={{ marginTop: 10, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Bots will automatically fill empty seats and trade using character-specific strategies.
          </p>
        </div>
      )}
    </section>
  );
}
