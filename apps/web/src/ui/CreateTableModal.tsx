import { useState } from 'react';

interface Props {
  onCreate: () => void;
}

export default function CreateTableModal({ onCreate }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="create-table">
      <button onClick={() => setOpen(true)}>Create Table</button>
      {open && (
        <div className="modal">
          <form onSubmit={e => { e.preventDefault(); onCreate(); setOpen(false); }}>
            <label>Tick<input type="number" defaultValue={1} /></label>
            <label>Rounds<input type="number" defaultValue={1} /></label>
            <label>Fee %<input type="number" defaultValue={1} /></label>
            <label>Voice<input type="checkbox" /></label>
            <button type="submit">Create</button>
          </form>
        </div>
      )}
    </div>
  );
}
