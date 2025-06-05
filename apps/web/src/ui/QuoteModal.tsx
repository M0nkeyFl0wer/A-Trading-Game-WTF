import { useState } from 'react';

export default function QuoteModal() {
  const [open, setOpen] = useState(false);
  const [oneWay, setOneWay] = useState(false);
  return (
    <div className="quote-modal">
      <button onClick={() => setOpen(true)}>Post Quote</button>
      {open && (
        <div className="modal">
          <form onSubmit={e => { e.preventDefault(); setOpen(false); }}>
            <label>Bid<input type="number" defaultValue={10} /></label>
            {!oneWay && <label>Ask<input type="number" defaultValue={12} /></label>}
            <label><input type="checkbox" checked={oneWay} onChange={e => setOneWay(e.target.checked)} />One-Way</label>
            <button type="submit">Post</button>
          </form>
        </div>
      )}
    </div>
  );
}
