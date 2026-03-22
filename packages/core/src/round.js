import { DEFAULT_TICK_PRESETS } from '@trading-game/shared';
export class Round {
    constructor(table, deck, opts = {}) {
        this.table = table;
        this.opts = opts;
        this.state = 'deal';
        this.community = [];
        this.deck = [...deck];
    }
    /**
     * Reconstruct a Round from cards that were already dealt.
     * Players must already have their .card set. Community values are passed in.
     * The returned Round is in 'trading' state, ready for reveal() then settle().
     */
    static fromDealt(table, communityValues, opts = {}) {
        const round = new Round(table, [], opts);
        round.community = communityValues.map((v) => ({ value: v }));
        round.state = 'trading';
        return round;
    }
    shuffle() {
        const d = this.deck;
        for (let i = d.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [d[i], d[j]] = [d[j], d[i]];
        }
    }
    deal() {
        if (this.state !== 'deal')
            throw new Error('invalid state');
        this.shuffle();
        this.table.players.forEach(p => {
            const value = this.deck.pop();
            if (value === undefined)
                throw new Error('deck empty');
            p.card = { value };
        });
        for (let i = 0; i < 3; i++) {
            const value = this.deck.pop();
            if (value === undefined)
                throw new Error('deck empty');
            this.community.push({ value });
        }
        this.state = 'trading';
    }
    reveal() {
        if (this.state !== 'trading')
            throw new Error('invalid state');
        this.state = 'reveal';
    }
    settle(trades) {
        if (this.state !== 'reveal')
            throw new Error('invalid state');
        const communityTotal = this.community.reduce((a, c) => a + c.value, 0);
        const numCommunity = this.community.length || 1;
        // Settlement price is the average community card value -- this is the
        // "true value" that gets revealed after trading ends.
        const settlementPrice = communityTotal / numCommunity;
        const feeRate = this.opts.houseFee ?? 0.01;
        const tradeVolume = {};
        const tradePnL = {};
        // For each trade, the buyer gains (settlementPrice - tradePrice) * qty
        // and the seller gains (tradePrice - settlementPrice) * qty.
        trades.forEach(t => {
            const notional = t.price * Math.abs(t.quantity);
            tradeVolume[t.from] = (tradeVolume[t.from] || 0) + notional;
            tradeVolume[t.to] = (tradeVolume[t.to] || 0) + notional;
            const mtm = (settlementPrice - t.price) * t.quantity;
            tradePnL[t.to] = (tradePnL[t.to] || 0) + mtm; // buyer
            tradePnL[t.from] = (tradePnL[t.from] || 0) - mtm; // seller
        });
        const totalCardValue = this.table.players.reduce((acc, player) => acc + (player.card?.value ?? 0), 0);
        const averageCardValue = this.table.players.length > 0 ? totalCardValue / this.table.players.length : 0;
        this.table.players.forEach(p => {
            const cardValue = p.card?.value ?? 0;
            // Bonus/penalty for having a card above/below the table average
            const relativeCardPnL = cardValue - averageCardValue;
            // Mark-to-market PnL from trades
            const positionPnL = tradePnL[p.id] || 0;
            const feezableVolume = tradeVolume[p.id] || 0;
            const fees = feezableVolume * feeRate;
            const netResult = relativeCardPnL + positionPnL - fees;
            p.balance += netResult;
        });
        this.state = 'settle';
    }
    getCommunityCardValues() {
        return this.community.map(card => card.value);
    }
}
