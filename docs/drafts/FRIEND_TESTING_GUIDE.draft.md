# A Trading Game WTF – Friend Testing Guide

## What this is

A small betting game about hidden cards. Everyone at the table gets one secret card, three more cards sit face down in the middle, and you trade on what the total of all of them will be. It runs in your browser, and I need a few people to play it and tell me where it breaks.

## How to get in

1. Open **https://trading.elephantroom.ca**
2. Your browser will ask for a login. Username: `friend`. Password: `<password from Ben>`.
3. That's it. There is no sign-up. Your browser is given a name like **Dev Trader a1b2** and keeps it.

Want to play against yourself to test two seats? Open a **private/incognito window** or a second browser profile. A normal second tab shares the same identity and will look like the same player.

## How a round works

**The cards.** The deck has 17 cards worth -10, 1 through 15, and 20. Each player gets one hidden card. Three community cards are dealt face down. The thing you are trading is the **total** of every card on the table, yours and everyone else's included. With five seats that is 8 cards, and a typical total lands somewhere around 60.

**Three phases, one timer each.** The timer is in the bar at the top.

| Phase | Time | What you can see |
|-------|------|------------------|
| Blind | 30 s | Only your own card |
| Flop | 20 s | Your card + community card 1 |
| Turn | 20 s | Your card + community cards 1 and 2 |

Then the third community card and everyone's hidden cards flip, and the round settles.

**Placing a bet.** The "Place Your Bet" box has two buttons and two numbers.

- **HIGHER (Buy / Bid)** means "I think the total will be above this price."
- **LOWER (Sell / Ask)** means "I think the total will be below this price."
- **Target price** is the number you are betting around. Allowed range is -50 to 200.
- **Quantity** is how many contracts, 1 to 10. It multiplies your win or loss.

A bet only turns into a trade when it **crosses** someone else's. If you bid 65 and a bot is asking 60, you trade. If nobody is on the other side, your order just sits in the **Order Book** until someone takes it, you cancel it, or the round ends. You cannot trade with yourself. Trades that happen show up in the **Trade Tape**.

**Settlement.** When the turn timer ends, the real total is revealed. For every trade you made:

- If you bought at price P and the total is T, you make **(T − P) × quantity**.
- If you sold at P, you make **(P − T) × quantity**.

Orders that never matched count for nothing. The results screen shows every player's card, the total, and each person's net P&L for the round. The crown goes to the best P&L. Your running balance updates on the table.

## 10-minute test script

Do this with one friend (or one private window). Tick as you go.

- [ ] Player A: on the lobby, click **Create a new table**. Give it a name, leave voice on, click **Launch table**. You land on the table page.
- [ ] Player A: under **Host Controls**, click **Add Bot** once. A bot appears in the seat list.
- [ ] Player B: open the lobby in a private window. The table shows under **Available tables** as "Waiting for players". Click **Join**.
- [ ] Player A: confirm B's name appears at your table. Click **Start Round**.
- [ ] Both: the phase bar says **Blind** with a 30 s countdown. You can see "Your Hidden Card" and nothing in the middle.
- [ ] Both, in Blind: place one bet each. Try opposite sides at the same price (A bids 60, B asks 60). Check the Trade Tape shows one trade.
- [ ] In **Flop** (20 s): one community card is face up. Place another bet. Try cancelling an order from the Order Book (it must be at least 2 s old).
- [ ] In **Turn** (20 s): two community cards are up. Place a bigger quantity bet, e.g. 5 contracts.
- [ ] Watch **Settlement**: all cards flip, the total appears, P&L per player is listed. Does your P&L match the formula above?
- [ ] The results screen counts down 15 s, then the next round deals itself. Confirm both players and the bot are still seated.
- [ ] Play one more round without touching anything and check the bot trades on its own.
- [ ] Player B: click **← Back** to return to the lobby. Player A: check the table still works with just you and the bot.
- [ ] Player A: refresh the page mid-round. You should come back to the same table, same phase, same card.

## What to look for, and known rough edges

- **Voice may be silent.** Character commentary needs an API key the test server may not have. Silence is expected; an error message is not.
- **Refresh should recover.** Reloading during a round should put you straight back. If it drops you to the lobby or shows a different card, that is a bug.
- **Rate limit.** You can place about 20 orders a minute. Spam faster and you get an "Unable to place order" error. That is on purpose, but tell me if it fires when you were not spamming.
- **The results screen lasts 15 s.** That is the whole gap between rounds. Tell me if it feels too short or too long.
- **Two seats is the minimum to start.** Start Round will refuse with only you at the table. Add a bot.
- **Only the host** can add bots or start the round. Other players should see those buttons greyed out or absent.
- **Timers.** Both browsers should show the same phase within a second of each other. Report drift.
- **Phones.** Try it on a phone. Tell me what you can't tap or can't read.
- Anything that says "Unknown error", freezes on "Connecting to table...", or shows a blank page.

## How to report a bug

Send me a message, or open an issue at https://github.com/M0nkeyFl0wer/A-Trading-Game-WTF/issues. Include:

1. **Browser and device** (e.g. Chrome on Android, Safari on Mac)
2. **What you did** – the steps, in order
3. **What happened**
4. **What you expected**
5. **Screenshot** if it was visual, and your Dev Trader name

Example:

- **Browser**: Firefox on Windows
- **Steps**: Joined "Bull vs Bear", host started, I placed a bid of 62 in Blind
- **Happened**: The bid vanished from the Order Book after 5 s, no trade in the tape
- **Expected**: It stays until matched, cancelled, or settlement
- **Screenshot**: attached, I'm Dev Trader 9f3c

Thanks for helping. Play a few rounds, try to break it, and tell me what confused you.
