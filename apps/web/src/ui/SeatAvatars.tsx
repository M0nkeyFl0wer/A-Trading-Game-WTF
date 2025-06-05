export default function SeatAvatars() {
  const seats = Array.from({ length: 5 });
  return (
    <div className="seats" style={{ display: 'flex', gap: 8 }}>
      {seats.map((_, i) => (
        <div key={i} className="seat" style={{ width: 50, height: 50, background: '#ccc', borderRadius: '50%' }} />
      ))}
    </div>
  );
}
