// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract WTFTradingTable is Ownable {
    IERC20 public immutable token;
    uint256 public nextTableId;

    struct TableConfig {
        uint256 tick; // token units per tick
        uint256 feePct; // in basis points (10000 = 100%)
        uint256 roundLength; // seconds
        bool twoWayMode;
        uint256 minBuyIn;
    }

    struct Table {
        uint256 id;
        TableConfig config;
        address[5] seats;
        uint256 roundEnd;
        bool active;
    }

    struct Quote {
        uint256 bid;
        uint256 ask;
    }

    struct Trade {
        uint8 buyer;
        uint8 seller;
        uint256 priceTicks;
        uint256 timestamp;
    }

    mapping(uint256 => Table) public tables;
    mapping(uint256 => mapping(uint8 => uint256)) public escrow;
    mapping(uint256 => mapping(uint8 => Quote)) public quotes;
    mapping(uint256 => Trade[]) public trades;

    event TableCreated(uint256 id, TableConfig config);
    event Joined(uint256 tableId, uint8 seat, address player);
    event QuotePosted(uint256 tableId, uint8 seat, uint256 bid, uint256 ask);
    event TradeExecuted(uint256 tableId, uint8 buyer, uint8 seller, uint256 priceTicks);
    event Settled(uint256 tableId);

    constructor(IERC20 _token) Ownable(msg.sender) {
        token = _token;
    }

    modifier onlySeat(uint256 tableId, uint8 seat) {
        require(tables[tableId].seats[seat] == msg.sender, "not seat");
        _;
    }

    function createTable(TableConfig memory config) external onlyOwner {
        uint256 id = nextTableId++;
        Table storage t = tables[id];
        t.id = id;
        t.config = config;
        t.roundEnd = block.timestamp + config.roundLength;
        t.active = true;
        emit TableCreated(id, config);
    }

    function joinTable(uint256 tableId, uint8 seat) external {
        Table storage t = tables[tableId];
        require(t.active, "table");
        require(seat < 5, "seat range");
        require(t.seats[seat] == address(0), "taken");
        t.seats[seat] = msg.sender;
        uint256 amt = t.config.minBuyIn;
        require(token.transferFrom(msg.sender, address(this), amt), "transfer");
        escrow[tableId][seat] += amt;
        emit Joined(tableId, seat, msg.sender);
    }

    function postQuote(uint256 tableId, uint8 seat, uint256 bid, uint256 ask) external onlySeat(tableId, seat) {
        quotes[tableId][seat] = Quote({ bid: bid, ask: ask });
        emit QuotePosted(tableId, seat, bid, ask);
    }

    function acceptBid(uint256 tableId, uint8 fromSeat, uint8 toSeat, uint256 priceTicks) external onlySeat(tableId, toSeat) {
        Quote storage q = quotes[tableId][fromSeat];
        require(q.bid == priceTicks, "price");
        trades[tableId].push(Trade({ buyer: fromSeat, seller: toSeat, priceTicks: priceTicks, timestamp: block.timestamp }));
        emit TradeExecuted(tableId, fromSeat, toSeat, priceTicks);
    }

    function acceptAsk(uint256 tableId, uint8 fromSeat, uint8 toSeat, uint256 priceTicks) external onlySeat(tableId, toSeat) {
        Quote storage q = quotes[tableId][fromSeat];
        require(q.ask == priceTicks, "price");
        trades[tableId].push(Trade({ buyer: toSeat, seller: fromSeat, priceTicks: priceTicks, timestamp: block.timestamp }));
        emit TradeExecuted(tableId, toSeat, fromSeat, priceTicks);
    }

    function revealAndSettle(uint256 tableId, uint256 total) external {
        Table storage t = tables[tableId];
        require(block.timestamp >= t.roundEnd, "round" );
        int256[5] memory pnl;
        Trade[] storage ts = trades[tableId];
        for (uint256 i = 0; i < ts.length; i++) {
            Trade storage tr = ts[i];
            int256 diff = int256(total) - int256(tr.priceTicks);
            pnl[tr.buyer] += diff * int256(t.config.tick);
            pnl[tr.seller] -= diff * int256(t.config.tick);
        }
        for (uint8 i = 0; i < 5; i++) {
            address player = t.seats[i];
            if (player == address(0)) continue;
            int256 balance = int256(escrow[tableId][i]) + pnl[i];
            uint256 payout = balance > 0 ? uint256(balance) : 0;
            escrow[tableId][i] = 0;
            if (payout > 0) {
                uint256 fee = 0;
                if (pnl[i] > 0) {
                    fee = uint256(pnl[i]) * t.config.feePct / 10000;
                    payout -= fee;
                }
                token.transfer(player, payout);
            }
        }
        delete trades[tableId];
        emit Settled(tableId);
    }
}
