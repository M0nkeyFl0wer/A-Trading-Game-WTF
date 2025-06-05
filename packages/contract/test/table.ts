import { ethers, network } from "hardhat";
import { expect } from "chai";

describe("WTFTradingTable", function () {
  it("trades and settles", async function () {
    const [owner, p1, p2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("TestToken");
    const token = await Token.deploy();
    await token.deployed();

    const Table = await ethers.getContractFactory("WTFTradingTable");
    const table = await Table.deploy(token.address);
    await table.deployed();

    await table.createTable({
      tick: ethers.utils.parseEther("1"),
      feePct: 100,
      roundLength: 60,
      twoWayMode: true,
      minBuyIn: ethers.utils.parseEther("100")
    });

    await token.transfer(p1.address, ethers.utils.parseEther("200"));
    await token.transfer(p2.address, ethers.utils.parseEther("200"));

    await token.connect(p1).approve(table.address, ethers.utils.parseEther("100"));
    await token.connect(p2).approve(table.address, ethers.utils.parseEther("100"));

    await table.connect(p1).joinTable(0, 0);
    await table.connect(p2).joinTable(0, 1);

    await table.connect(p1).postQuote(0, 0, 10, 12);
    await table.connect(p2).acceptBid(0, 0, 1, 10);

    await network.provider.send("evm_increaseTime", [61]);
    await network.provider.send("evm_mine");

    await table.revealAndSettle(0, 15);

    const bal1 = await token.balanceOf(p1.address);
    const bal2 = await token.balanceOf(p2.address);

    expect(bal1).to.equal(ethers.utils.parseEther("204.95"));
    expect(bal2).to.equal(ethers.utils.parseEther("195"));
  });
});
