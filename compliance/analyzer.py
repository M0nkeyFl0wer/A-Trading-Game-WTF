#!/usr/bin/env python3
"""
Topological compliance analyzer for the trading game.

Reads completed rounds from the SQLite database, builds trade graphs,
computes persistent homology, and checks constitutional invariants.

Usage:
    python analyzer.py [--db PATH] [--room ROOM_ID] [--round ROUND_NUM]
    python analyzer.py --watch  # continuous monitoring mode
"""

import sqlite3
import json
import sys
import time
import hashlib
import argparse
from pathlib import Path
from typing import Optional

import numpy as np

# Try to import ripser; fall back to basic graph analysis if unavailable
try:
    from ripser import ripser
    HAS_RIPSER = True
except ImportError:
    HAS_RIPSER = False
    print(
        "Warning: ripser not installed. Using basic graph analysis only.",
        file=sys.stderr,
    )


DB_PATH = Path(__file__).parent.parent / "api" / "data" / "game.db"


def get_db(path: Optional[str] = None) -> sqlite3.Connection:
    """Open and return a SQLite connection with row-factory enabled."""
    db_path = path or str(DB_PATH)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


# -------------------------------------------------------------------------
# T-033: Trade graph simplicial complex builder
# -------------------------------------------------------------------------


def build_trade_graph(
    conn: sqlite3.Connection, room_id: str, round_number: int
) -> dict:
    """
    Build a trade graph from audit log events for a specific round.

    Vertices: player IDs
    Edges: trades between players (weighted by volume)

    Returns dict with:
      - vertices: list of player IDs
      - edges: list of (i, j, weight) tuples (indices into vertices)
      - distance_matrix: numpy array for Rips computation
      - trades: raw trade data
    """
    empty = {
        "vertices": [],
        "edges": [],
        "distance_matrix": np.array([]),
        "trades": [],
    }

    # Get matched trades from audit log
    rows = conn.execute(
        """
        SELECT payload FROM audit_log
        WHERE room_id = ? AND round_number = ? AND event_type = 'trade_match'
        ORDER BY timestamp ASC
        """,
        (room_id, round_number),
    ).fetchall()

    # Also try the settlement event which may embed matched trades
    settlement_row = conn.execute(
        """
        SELECT payload FROM audit_log
        WHERE room_id = ? AND round_number = ? AND event_type = 'settlement'
        ORDER BY id DESC LIMIT 1
        """,
        (room_id, round_number),
    ).fetchone()

    trades: list[dict] = []
    for row in rows:
        try:
            payload = json.loads(row["payload"])
            trades.append(payload)
        except (json.JSONDecodeError, KeyError):
            continue

    # Fall back to trades embedded in settlement payload
    if not trades and settlement_row:
        try:
            payload = json.loads(settlement_row["payload"])
            if "matchedTrades" in payload:
                trades = payload["matchedTrades"]
        except (json.JSONDecodeError, KeyError):
            pass

    if not trades:
        return empty

    # Extract unique players
    players: set[str] = set()
    for t in trades:
        buyer = t.get("buyerId", t.get("buyer_id", ""))
        seller = t.get("sellerId", t.get("seller_id", ""))
        if buyer:
            players.add(buyer)
        if seller:
            players.add(seller)

    vertices = sorted(players)
    player_idx = {p: i for i, p in enumerate(vertices)}
    n = len(vertices)

    if n < 2:
        return {
            "vertices": vertices,
            "edges": [],
            "distance_matrix": np.zeros((n, n)),
            "trades": trades,
        }

    # Build adjacency / distance matrix.
    # Distance = 1 / (1 + trade_volume) -- more trading = closer.
    volume_matrix = np.zeros((n, n))
    edges: list[tuple[int, int, float]] = []

    for t in trades:
        buyer = t.get("buyerId", t.get("buyer_id", ""))
        seller = t.get("sellerId", t.get("seller_id", ""))
        qty = t.get("quantity", 1)
        price = t.get("price", 0)
        volume = qty * price

        if buyer in player_idx and seller in player_idx:
            i, j = player_idx[buyer], player_idx[seller]
            volume_matrix[i][j] += volume
            volume_matrix[j][i] += volume
            edges.append((i, j, volume))

    # Convert to distance: high volume = short distance
    distance_matrix = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i != j:
                if volume_matrix[i][j] > 0:
                    distance_matrix[i][j] = 1.0 / (1.0 + volume_matrix[i][j])
                else:
                    distance_matrix[i][j] = 10.0  # no trading = far apart

    return {
        "vertices": vertices,
        "edges": edges,
        "distance_matrix": distance_matrix,
        "trades": trades,
    }


# -------------------------------------------------------------------------
# T-034: Homology computation
# -------------------------------------------------------------------------


def compute_homology(distance_matrix: np.ndarray) -> dict:
    """
    Compute persistent homology of the trade graph.

    Returns:
      - betti_0: number of connected components
      - betti_1: number of 1-cycles (potential collusion rings)
      - persistence_diagram: birth-death pairs for each dimension
      - method: which computation backend was used
    """
    if distance_matrix.size == 0 or distance_matrix.shape[0] < 2:
        return {
            "betti_0": 0,
            "betti_1": 0,
            "persistence_diagram": [],
            "method": "trivial",
        }

    if HAS_RIPSER:
        result = ripser(distance_matrix, maxdim=1, distance_matrix=True)
        diagrams = result["dgms"]

        # Betti numbers: count features that persist significantly
        # (birth-death gap > threshold)
        threshold = 0.1

        betti_0 = sum(
            1
            for birth, death in diagrams[0]
            if (death - birth) > threshold or death == float("inf")
        )
        betti_1 = (
            sum(1 for birth, death in diagrams[1] if (death - birth) > threshold)
            if len(diagrams) > 1
            else 0
        )

        persistence: list[dict] = []
        for dim, dgm in enumerate(diagrams):
            for birth, death in dgm:
                if death != float("inf"):
                    persistence.append(
                        {
                            "dim": dim,
                            "birth": float(birth),
                            "death": float(death),
                            "persistence": float(death - birth),
                        }
                    )

        return {
            "betti_0": betti_0,
            "betti_1": betti_1,
            "persistence_diagram": persistence,
            "method": "ripser",
        }

    # Fallback: basic graph analysis without ripser
    n = distance_matrix.shape[0]

    # Betti_0 via connected components (union-find)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: int, y: int) -> None:
        px, py = find(x), find(y)
        if px != py:
            parent[px] = py

    # Connect vertices that have traded (distance < 10)
    edge_count = 0
    for i in range(n):
        for j in range(i + 1, n):
            if distance_matrix[i][j] < 10.0:
                union(i, j)
                edge_count += 1

    components = len(set(find(i) for i in range(n)))

    # Betti_1 estimate via Euler characteristic: B1 = edges - vertices + components
    betti_1_estimate = max(0, edge_count - n + components)

    return {
        "betti_0": components,
        "betti_1": betti_1_estimate,
        "persistence_diagram": [],
        "method": "basic_graph",
    }


# -------------------------------------------------------------------------
# T-035: Constitutional invariant checks
# -------------------------------------------------------------------------


def check_zero_sum(
    conn: sqlite3.Connection, room_id: str, round_number: int
) -> dict:
    """Verify that settlement PnL sums to zero."""
    row = conn.execute(
        """
        SELECT COALESCE(SUM(amount), 0) as total
        FROM ledger
        WHERE room_id = ? AND round_number = ?
        """,
        (room_id, round_number),
    ).fetchone()

    total = row["total"] if row else 0
    return {
        "check": "zero_sum",
        "valid": abs(total) < 0.01,
        "sum": round(total, 4),
    }


def check_no_collusion_cycles(homology: dict) -> dict:
    """B1 should be 0 -- no trading cycles that indicate collusion."""
    return {
        "check": "no_collusion_cycles",
        "valid": homology["betti_1"] == 0,
        "betti_1": homology["betti_1"],
        "detail": (
            f"Found {homology['betti_1']} potential collusion cycle(s)"
            if homology["betti_1"] > 0
            else "No cycles detected"
        ),
    }


def check_audit_chain(conn: sqlite3.Connection, room_id: Optional[str] = None) -> dict:
    """
    Verify the audit log hash chain has not been tampered with.

    The hash chain is global (not per-room) because the server maintains a
    single running hash across all events.  When *room_id* is provided we
    still verify the full chain but report the result under that room's name.
    """
    rows = conn.execute(
        "SELECT event_type, payload, timestamp, prev_hash, hash "
        "FROM audit_log ORDER BY id ASC"
    ).fetchall()

    if not rows:
        return {"check": "audit_chain", "valid": True, "entries": 0}

    genesis = "0" * 64
    prev_hash = genesis

    for i, row in enumerate(rows):
        expected = hashlib.sha256(
            (
                prev_hash
                + row["event_type"]
                + row["payload"]
                + str(row["timestamp"])
            ).encode()
        ).hexdigest()

        if expected != row["hash"]:
            return {
                "check": "audit_chain",
                "valid": False,
                "broken_at": i,
                "entries": len(rows),
            }
        prev_hash = row["hash"]

    return {"check": "audit_chain", "valid": True, "entries": len(rows)}


# -------------------------------------------------------------------------
# T-036: Information flow filtration
# -------------------------------------------------------------------------


def check_information_flow(
    conn: sqlite3.Connection, room_id: str, round_number: int
) -> dict:
    """
    Check if any player's order prices correlate suspiciously with hidden
    community cards -- indicating potential information leakage.

    During the blind phase players only know their own card.  The expected
    value of the 3-community-card total is roughly 3 * 10.5 = 31.5, and
    the full settlement total (player card + community) centres around 42
    for a single card or ~61 including a player's own card (varies).  We
    use 61.2 as a rough EV baseline.

    A player whose average blind-phase price is significantly closer to
    the true settlement total than to the EV is flagged.
    """
    # Get settlement data
    settlement = conn.execute(
        """
        SELECT payload FROM audit_log
        WHERE room_id = ? AND round_number = ? AND event_type = 'settlement'
        ORDER BY id DESC LIMIT 1
        """,
        (room_id, round_number),
    ).fetchone()

    if not settlement:
        return {
            "check": "information_flow",
            "valid": True,
            "detail": "No settlement data",
        }

    try:
        settlement_data = json.loads(settlement["payload"])
        total = settlement_data.get("settlementTotal", 0)
    except (json.JSONDecodeError, KeyError):
        return {
            "check": "information_flow",
            "valid": True,
            "detail": "Cannot parse settlement",
        }

    # Get orders placed during the blind phase
    orders = conn.execute(
        """
        SELECT payload FROM audit_log
        WHERE room_id = ? AND round_number = ? AND event_type = 'order_submit'
        ORDER BY timestamp ASC
        """,
        (room_id, round_number),
    ).fetchall()

    if not orders:
        return {
            "check": "information_flow",
            "valid": True,
            "detail": "No orders to analyze",
        }

    blind_orders_by_player: dict[str, list[float]] = {}
    for row in orders:
        try:
            payload = json.loads(row["payload"])
            phase = payload.get("phase", "unknown")
            player_id = payload.get("playerId", "")
            price = payload.get("price", 0)

            if phase == "blind" and player_id:
                blind_orders_by_player.setdefault(player_id, []).append(price)
        except (json.JSONDecodeError, KeyError):
            continue

    suspicious_players: list[dict] = []
    ev = 61.2  # rough expected value with no information

    for player_id, prices in blind_orders_by_player.items():
        if len(prices) < 2:
            continue
        avg_price = sum(prices) / len(prices)
        distance_from_total = abs(avg_price - total)
        distance_from_ev = abs(avg_price - ev)

        # Suspicious: avg price closer to true total than to EV, AND
        # the true total is meaningfully different from EV.
        if abs(total - ev) > 5 and distance_from_total < distance_from_ev * 0.5:
            suspicious_players.append(
                {
                    "player_id": player_id,
                    "avg_blind_price": round(avg_price, 2),
                    "true_total": total,
                    "ev": ev,
                    "suspicion_score": round(
                        1 - (distance_from_total / max(distance_from_ev, 0.01)),
                        3,
                    ),
                }
            )

    return {
        "check": "information_flow",
        "valid": len(suspicious_players) == 0,
        "suspicious_players": suspicious_players,
        "detail": (
            f"{len(suspicious_players)} player(s) with suspicious blind-phase pricing"
            if suspicious_players
            else "No anomalies detected"
        ),
    }


# -------------------------------------------------------------------------
# T-037: Run all checks and store results
# -------------------------------------------------------------------------


def create_compliance_table(conn: sqlite3.Connection) -> None:
    """Create the compliance_reports table if it does not exist."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS compliance_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            round_number INTEGER NOT NULL,
            status TEXT NOT NULL,
            betti_0 INTEGER,
            betti_1 INTEGER,
            zero_sum_valid INTEGER,
            audit_chain_valid INTEGER,
            info_flow_valid INTEGER,
            details TEXT,
            created_at INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_compliance_room "
        "ON compliance_reports(room_id)"
    )
    conn.commit()


def analyze_round(
    conn: sqlite3.Connection, room_id: str, round_number: int
) -> dict:
    """Run full compliance analysis on a completed round."""

    # Build trade graph
    graph = build_trade_graph(conn, room_id, round_number)

    # Compute homology
    homology = compute_homology(graph["distance_matrix"])

    # Run all constitutional checks
    checks = {
        "zero_sum": check_zero_sum(conn, room_id, round_number),
        "collusion": check_no_collusion_cycles(homology),
        "audit_chain": check_audit_chain(conn, room_id),
        "information_flow": check_information_flow(conn, room_id, round_number),
    }

    # Overall status
    failures = sum(1 for c in checks.values() if not c["valid"])
    if failures == 0:
        status = "green"
    elif failures == 1:
        status = "yellow"
    else:
        status = "red"

    report = {
        "room_id": room_id,
        "round_number": round_number,
        "status": status,
        "homology": homology,
        "checks": checks,
        "trade_graph": {
            "vertices": len(graph["vertices"]),
            "edges": len(graph["edges"]),
            "trades": len(graph["trades"]),
        },
        "timestamp": int(time.time() * 1000),
    }

    # Store in database
    create_compliance_table(conn)
    conn.execute(
        """
        INSERT INTO compliance_reports
        (room_id, round_number, status, betti_0, betti_1,
         zero_sum_valid, audit_chain_valid, info_flow_valid,
         details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            room_id,
            round_number,
            status,
            homology["betti_0"],
            homology["betti_1"],
            1 if checks["zero_sum"]["valid"] else 0,
            1 if checks["audit_chain"]["valid"] else 0,
            1 if checks["information_flow"]["valid"] else 0,
            json.dumps(report),
            report["timestamp"],
        ),
    )
    conn.commit()

    return report


def watch_mode(db_path: Optional[str] = None) -> None:
    """Continuously watch for new completed rounds and analyze them."""
    conn = get_db(db_path)
    create_compliance_table(conn)

    print("Compliance analyzer watching for completed rounds...")
    last_check = 0

    while True:
        try:
            # Find settlement events we have not analyzed yet
            rows = conn.execute(
                """
                SELECT DISTINCT al.room_id, al.round_number
                FROM audit_log al
                WHERE al.event_type = 'settlement' AND al.timestamp > ?
                AND NOT EXISTS (
                    SELECT 1 FROM compliance_reports cr
                    WHERE cr.room_id = al.room_id
                      AND cr.round_number = al.round_number
                )
                """,
                (last_check,),
            ).fetchall()

            for row in rows:
                room_id = row["room_id"]
                round_number = row["round_number"]
                print(f"\nAnalyzing room={room_id} round={round_number}...")

                report = analyze_round(conn, room_id, round_number)

                indicator = {"green": "[OK]", "yellow": "[WARN]", "red": "[ALERT]"}.get(
                    report["status"], "[?]"
                )
                print(f"  {indicator} Status: {report['status'].upper()}")
                print(
                    f"  Betti numbers: B0={report['homology']['betti_0']}, "
                    f"B1={report['homology']['betti_1']}"
                )
                for name, check in report["checks"].items():
                    ok = "[OK]" if check["valid"] else "[FAIL]"
                    detail = check.get(
                        "detail", "valid" if check["valid"] else "FAILED"
                    )
                    print(f"  {ok} {name}: {detail}")

            last_check = int(time.time() * 1000)
            time.sleep(5)

        except KeyboardInterrupt:
            print("\nShutting down compliance analyzer.")
            break
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            time.sleep(10)

    conn.close()


# -------------------------------------------------------------------------
# CLI
# -------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Topological compliance analyzer"
    )
    parser.add_argument("--db", type=str, help="Path to SQLite database")
    parser.add_argument("--room", type=str, help="Room ID to analyze")
    parser.add_argument("--round", type=int, help="Round number to analyze")
    parser.add_argument(
        "--watch", action="store_true", help="Continuous monitoring mode"
    )
    parser.add_argument(
        "--verify-chain",
        type=str,
        metavar="ROOM_ID",
        help="Verify audit chain (full chain, report for room)",
    )
    args = parser.parse_args()

    if args.watch:
        watch_mode(args.db)
        return

    conn = get_db(args.db)

    if args.verify_chain:
        result = check_audit_chain(conn, args.verify_chain)
        print(json.dumps(result, indent=2))
        conn.close()
        return

    if args.room and args.round is not None:
        report = analyze_round(conn, args.room, args.round)
        print(json.dumps(report, indent=2))
    else:
        # Analyze all unanalyzed rounds
        create_compliance_table(conn)
        rows = conn.execute(
            """
            SELECT DISTINCT al.room_id, al.round_number
            FROM audit_log al
            WHERE al.event_type = 'settlement'
            AND NOT EXISTS (
                SELECT 1 FROM compliance_reports cr
                WHERE cr.room_id = al.room_id
                  AND cr.round_number = al.round_number
            )
            ORDER BY al.timestamp ASC
            """
        ).fetchall()

        if not rows:
            print("No unanalyzed rounds found.")
        else:
            for row in rows:
                report = analyze_round(conn, row["room_id"], row["round_number"])
                indicator = {"green": "[OK]", "yellow": "[WARN]", "red": "[ALERT]"}.get(
                    report["status"], "[?]"
                )
                print(
                    f"{indicator} Room {row['room_id']} "
                    f"Round {row['round_number']}: {report['status'].upper()}"
                )

    conn.close()


if __name__ == "__main__":
    main()
