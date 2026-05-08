import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

const D1 = 1_000_000n;
const D2 = 2_000_000n;

async function setup() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner, alice, bob, carol] = await viem.getWalletClients();
  const contract = await viem.deployContract("DateLottery");
  return { viem, publicClient, contract, owner, alice, bob, carol };
}

describe("DateLottery", async function () {
  // ---------------------------------------------------------------------------
  // Phase
  // ---------------------------------------------------------------------------
  describe("initial state", async function () {
    const { contract } = await setup();

    it("starts in SETUP phase (0)", async function () {
      assert.equal(await contract.read.phase(), 0);
    });

    it("owner is deployer", async function () {
      const c = await setup();
      assert.equal(
        (await c.contract.read.owner()).toLowerCase(),
        c.owner.account.address.toLowerCase()
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Date management
  // ---------------------------------------------------------------------------
  describe("date management", async function () {
    it("adds and reads dates", async function () {
      const { contract } = await setup();
      await contract.write.addDate([D1]);
      await contract.write.addDate([D2]);
      const dates = await contract.read.getDates();
      assert.equal(dates.length, 2);
    });

    it("rejects duplicate date", async function () {
      const { contract } = await setup();
      await contract.write.addDate([D1]);
      await assert.rejects(contract.write.addDate([D1]));
    });

    it("removes a date", async function () {
      const { contract } = await setup();
      await contract.write.addDate([D1]);
      await contract.write.addDate([D2]);
      await contract.write.removeDate([D1]);
      const dates = await contract.read.getDates();
      assert.equal(dates.length, 1);
      assert.equal(dates[0], D2);
    });

    it("non-owner cannot add a date", async function () {
      const { viem, contract, alice } = await setup();
      const c = await viem.getContractAt("DateLottery", contract.address, {
        client: { wallet: alice },
      });
      await assert.rejects(c.write.addDate([D1]));
    });
  });

  // ---------------------------------------------------------------------------
  // Group management
  // ---------------------------------------------------------------------------
  describe("group management", async function () {
    it("adds groups and reads ids", async function () {
      const { contract } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await contract.write.addGroup([2n, "Beta"]);
      const ids = await contract.read.getGroupIds();
      assert.equal(ids.length, 2);
    });

    it("rejects duplicate group ID", async function () {
      const { contract } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await assert.rejects(contract.write.addGroup([1n, "Dup"]));
    });

    it("rejects group ID 0", async function () {
      const { contract } = await setup();
      await assert.rejects(contract.write.addGroup([0n, "Zero"]));
    });

    it("removes a group", async function () {
      const { contract } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await contract.write.addGroup([2n, "Beta"]);
      await contract.write.removeGroup([1n]);
      const ids = await contract.read.getGroupIds();
      assert.equal(ids.length, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Member management
  // ---------------------------------------------------------------------------
  describe("member management", async function () {
    it("adds members to a group", async function () {
      const { contract, alice, bob } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await contract.write.addMember([1n, alice.account.address]);
      await contract.write.addMember([1n, bob.account.address]);
      const members = await contract.read.getGroupMembers([1n]);
      assert.equal(members.length, 2);
    });

    it("rejects owner as member", async function () {
      const { contract, owner } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await assert.rejects(contract.write.addMember([1n, owner.account.address]));
    });

    it("rejects address in two groups", async function () {
      const { contract, alice } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await contract.write.addGroup([2n, "Beta"]);
      await contract.write.addMember([1n, alice.account.address]);
      await assert.rejects(contract.write.addMember([2n, alice.account.address]));
    });

    it("removes a member", async function () {
      const { contract, alice } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await contract.write.addMember([1n, alice.account.address]);
      await contract.write.removeMember([1n, alice.account.address]);
      const members = await contract.read.getGroupMembers([1n]);
      assert.equal(members.length, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // openVoting guards
  // ---------------------------------------------------------------------------
  describe("openVoting guards", async function () {
    it("rejects with only one group", async function () {
      const { contract, alice } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await contract.write.addMember([1n, alice.account.address]);
      await contract.write.addDate([D1]);
      await assert.rejects(contract.write.openVoting());
    });

    it("rejects when date count != group count", async function () {
      const { contract, alice, bob } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await contract.write.addMember([1n, alice.account.address]);
      await contract.write.addGroup([2n, "Beta"]);
      await contract.write.addMember([2n, bob.account.address]);
      await contract.write.addDate([D1]); // 2 groups, 1 date
      await assert.rejects(contract.write.openVoting());
    });

    it("rejects when a group has no members", async function () {
      const { contract, alice } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await contract.write.addMember([1n, alice.account.address]);
      await contract.write.addGroup([2n, "Beta"]); // empty
      await contract.write.addDate([D1]);
      await contract.write.addDate([D2]);
      await assert.rejects(contract.write.openVoting());
    });
  });

  // ---------------------------------------------------------------------------
  // Full happy path: 2 groups, 2 dates
  // ---------------------------------------------------------------------------
  describe("full happy path", async function () {
    async function fullSetup() {
      const ctx = await setup();
      const { contract, alice, bob } = ctx;
      await contract.write.addDate([D1]);
      await contract.write.addDate([D2]);
      await contract.write.addGroup([1n, "Alpha"]);
      await contract.write.addMember([1n, alice.account.address]);
      await contract.write.addGroup([2n, "Beta"]);
      await contract.write.addMember([2n, bob.account.address]);
      return ctx;
    }

    it("opens voting → phase becomes VOTING (1)", async function () {
      const { contract } = await fullSetup();
      await contract.write.openVoting();
      assert.equal(await contract.read.phase(), 1);
    });

    it("members submit ballots and voting closes", async function () {
      const { viem, contract, alice, bob } = await fullSetup();
      await contract.write.openVoting();

      const ca = await viem.getContractAt("DateLottery", contract.address, {
        client: { wallet: alice },
      });
      await ca.write.submitBallot([[D1, D2]]);
      assert.equal(await contract.read.hasVoted([alice.account.address]), true);

      const cb = await viem.getContractAt("DateLottery", contract.address, {
        client: { wallet: bob },
      });
      await cb.write.submitBallot([[D2, D1]]);

      await contract.write.closeVoting();
      assert.equal(await contract.read.phase(), 2);
    });

    it("rejects double voting", async function () {
      const { viem, contract, alice } = await fullSetup();
      await contract.write.openVoting();
      const ca = await viem.getContractAt("DateLottery", contract.address, {
        client: { wallet: alice },
      });
      await ca.write.submitBallot([[D1, D2]]);
      await assert.rejects(ca.write.submitBallot([[D1, D2]]));
    });

    it("rejects ballot with duplicate date", async function () {
      const { viem, contract, alice } = await fullSetup();
      await contract.write.openVoting();
      const ca = await viem.getContractAt("DateLottery", contract.address, {
        client: { wallet: alice },
      });
      await assert.rejects(ca.write.submitBallot([[D1, D1]]));
    });

    it("rejects ballot with wrong length", async function () {
      const { viem, contract, alice } = await fullSetup();
      await contract.write.openVoting();
      const ca = await viem.getContractAt("DateLottery", contract.address, {
        client: { wallet: alice },
      });
      await assert.rejects(ca.write.submitBallot([[D1]]));
    });

    it("resolve assigns each group a unique date", async function () {
      const { viem, contract, alice, bob } = await fullSetup();
      await contract.write.openVoting();

      const ca = await viem.getContractAt("DateLottery", contract.address, {
        client: { wallet: alice },
      });
      await ca.write.submitBallot([[D1, D2]]);

      const cb = await viem.getContractAt("DateLottery", contract.address, {
        client: { wallet: bob },
      });
      await cb.write.submitBallot([[D2, D1]]);

      await contract.write.closeVoting();
      await contract.write.resolve();

      assert.equal(await contract.read.phase(), 3);

      const a1 = await contract.read.getAssignment([1n]);
      const a2 = await contract.read.getAssignment([2n]);

      assert.notEqual(a1, 0n);
      assert.notEqual(a2, 0n);
      assert.notEqual(a1, a2);
      assert.ok(a1 === D1 || a1 === D2);
      assert.ok(a2 === D1 || a2 === D2);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge case: resolve with zero ballots
  // ---------------------------------------------------------------------------
  describe("resolve with no ballots", async function () {
    it("still assigns unique dates", async function () {
      const { contract, alice, bob } = await setup();
      await contract.write.addDate([D1]);
      await contract.write.addDate([D2]);
      await contract.write.addGroup([1n, "Alpha"]);
      await contract.write.addMember([1n, alice.account.address]);
      await contract.write.addGroup([2n, "Beta"]);
      await contract.write.addMember([2n, bob.account.address]);
      await contract.write.openVoting();
      await contract.write.closeVoting();
      await contract.write.resolve();

      const a1 = await contract.read.getAssignment([1n]);
      const a2 = await contract.read.getAssignment([2n]);
      assert.notEqual(a1, a2);
    });
  });

  // ---------------------------------------------------------------------------
  // Bulk add functions
  // ---------------------------------------------------------------------------
  describe("bulk add", async function () {
    const D3 = 3_000_000n;

    it("addDates adds multiple dates in one call", async function () {
      const { contract } = await setup();
      await contract.write.addDates([[D1, D2, D3]]);
      const dates = await contract.read.getDates();
      assert.equal(dates.length, 3);
      assert.ok(dates.includes(D1));
      assert.ok(dates.includes(D2));
      assert.ok(dates.includes(D3));
    });

    it("addDates rejects duplicate within the batch", async function () {
      const { contract } = await setup();
      await assert.rejects(contract.write.addDates([[D1, D1]]));
    });

    it("addDates rejects duplicate already on chain", async function () {
      const { contract } = await setup();
      await contract.write.addDate([D1]);
      await assert.rejects(contract.write.addDates([[D1, D2]]));
    });

    it("addGroups adds multiple groups in one call", async function () {
      const { contract } = await setup();
      await contract.write.addGroups([[1n, 2n, 3n], ["Alpha", "Beta", "Gamma"]]);
      const ids = await contract.read.getGroupIds();
      assert.equal(ids.length, 3);
      assert.equal(await contract.read.getGroupName([1n]), "Alpha");
      assert.equal(await contract.read.getGroupName([2n]), "Beta");
      assert.equal(await contract.read.getGroupName([3n]), "Gamma");
    });

    it("addGroups rejects mismatched array lengths", async function () {
      const { contract } = await setup();
      await assert.rejects(contract.write.addGroups([[1n, 2n], ["Alpha"]]));
    });

    it("addGroups rejects duplicate group ID within batch", async function () {
      const { contract } = await setup();
      await assert.rejects(contract.write.addGroups([[1n, 1n], ["Alpha", "Dup"]]));
    });

    it("addGroups rejects group ID 0", async function () {
      const { contract } = await setup();
      await assert.rejects(contract.write.addGroups([[0n], ["Zero"]]));
    });

    it("addMembers adds multiple members across groups in one call", async function () {
      const { contract, alice, bob, carol } = await setup();
      await contract.write.addGroups([[1n, 2n], ["Alpha", "Beta"]]);
      await contract.write.addMembers(
        [[1n, 1n, 2n], [alice.account.address, bob.account.address, carol.account.address]]
      );
      const membersA = await contract.read.getGroupMembers([1n]);
      const membersB = await contract.read.getGroupMembers([2n]);
      assert.equal(membersA.length, 2);
      assert.equal(membersB.length, 1);
      assert.equal(await contract.read.memberGroup([alice.account.address]), 1n);
      assert.equal(await contract.read.memberGroup([carol.account.address]), 2n);
    });

    it("addMembers rejects mismatched array lengths", async function () {
      const { contract, alice } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await assert.rejects(
        contract.write.addMembers([[1n, 1n], [alice.account.address]])
      );
    });

    it("addMembers rejects address in two groups within batch", async function () {
      const { contract, alice } = await setup();
      await contract.write.addGroups([[1n, 2n], ["Alpha", "Beta"]]);
      await assert.rejects(
        contract.write.addMembers([[1n, 2n], [alice.account.address, alice.account.address]])
      );
    });

    it("addMembers rejects owner as member", async function () {
      const { contract, owner } = await setup();
      await contract.write.addGroup([1n, "Alpha"]);
      await assert.rejects(
        contract.write.addMembers([[1n], [owner.account.address]])
      );
    });

    it("full bulk setup flows into openVoting successfully", async function () {
      const { contract, alice, bob } = await setup();
      await contract.write.addDates([[D1, D2]]);
      await contract.write.addGroups([[1n, 2n], ["Alpha", "Beta"]]);
      await contract.write.addMembers(
        [[1n, 2n], [alice.account.address, bob.account.address]]
      );
      await contract.write.openVoting();
      assert.equal(await contract.read.phase(), 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Ether rejection
  // ---------------------------------------------------------------------------
  describe("ether rejection", async function () {
    it("reverts on ETH transfer", async function () {
      const { contract, alice } = await setup();
      await assert.rejects(
        alice.sendTransaction({ to: contract.address, value: 1n })
      );
    });
  });
});
