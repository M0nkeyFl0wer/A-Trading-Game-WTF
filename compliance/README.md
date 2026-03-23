# Topological Compliance Analyzer

Detects collusion, information leakage, and manipulation in the trading game
using persistent homology on trade graphs.

## Setup

```bash
cd compliance
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

`ripser` is optional -- without it the analyzer falls back to basic graph
analysis (connected components via union-find, cycle counting via Euler
characteristic).  Install it for full persistent homology support.

## Usage

```bash
# Analyze a specific round
python analyzer.py --room ROOM_ABC --round 3

# Analyze all unanalyzed rounds
python analyzer.py

# Watch mode -- continuously monitors for new rounds
python analyzer.py --watch

# Verify audit chain integrity
python analyzer.py --verify-chain ROOM_ABC
```

## What it checks

| Check | What | Pass condition |
|-------|------|---------------|
| Zero-sum | Total PnL across all players | \|sum\| < 0.01 |
| Collusion cycles | B1 of trade graph | B1 = 0 (no cycles) |
| Audit chain | Hash chain integrity | No broken links |
| Information flow | Blind-phase pricing vs settlement | No players pricing near true total |

## Status codes

- **GREEN**: All checks pass
- **YELLOW**: One check failed (warning)
- **RED**: Multiple checks failed (investigate)

## Architecture

```
Round completes
  -> audit_log populated by the game server
  -> Python sidecar reads SQLite (same game.db)
  -> Builds simplicial complex from trade graph
  -> Computes persistent homology (Betti numbers)
  -> Checks constitutional invariants
  -> Writes results to compliance_reports table
  -> API endpoint serves compliance status at GET /rooms/:roomId/compliance
```

## How it works

**Trade graph construction (T-033):** Players become vertices, trades become
edges weighted by volume.  Distance = 1 / (1 + volume) so heavy trading pairs
are close together.

**Persistent homology (T-034):** Ripser computes the Vietoris-Rips filtration
and returns persistence diagrams.  B0 counts connected components (isolated
traders), B1 counts 1-cycles (potential wash trading / collusion rings).

**Constitutional invariants (T-035):**
- B1 = 0 means no closed trading loops (collusion indicator)
- Ledger sum = 0 means the game is zero-sum
- Audit hash chain intact means no tampering

**Information flow filtration (T-036):** During the blind phase, players only
know their own card.  If someone consistently prices near the true settlement
total (which depends on hidden community cards), they may have access to
information they should not have.
