import { network } from "hardhat";

const DATES: bigint[] = [
  BigInt(Date.UTC(2026, 4, 19) / 1000), // 19 May 2026
  BigInt(Date.UTC(2026, 4, 26) / 1000), // 26 May 2026
  BigInt(Date.UTC(2026, 5,  2) / 1000), // 02 Jun 2026
  BigInt(Date.UTC(2026, 5,  9) / 1000), // 09 Jun 2026
  BigInt(Date.UTC(2026, 5, 16) / 1000), // 16 Jun 2026
  BigInt(Date.UTC(2026, 5, 23) / 1000), // 23 Jun 2026
];

const GROUPS: { id: bigint; name: string }[] = [
  { id: 1n, name: "A" },
  { id: 2n, name: "B" },
  { id: 3n, name: "C" },
  { id: 4n, name: "D" },
  { id: 5n, name: "E" },
  { id: 6n, name: "F" },
];

const GROUP_ID: Record<string, bigint> = { A: 1n, B: 2n, C: 3n, D: 4n, E: 5n, F: 6n };

const MEMBERS: { address: `0x${string}`; group: string }[] = [
  { address: "0xA12FAeeA504b6ADD4042Bf48696093411Eb469d9", group: "A" },
  { address: "0xB767c1F30069eBf4e93Ad3B850F0354234A8191C", group: "C" },
  { address: "0x78c857B68483c6840B8dcC69D6B518AF1c0Fd396", group: "A" },
  { address: "0x6CFF7e387A556fbeCeE4Bb2c81C205DEC4209B46", group: "C" },
  { address: "0x236EFA6B6dc84839a8BC6cDE9bC6e142D768cab0", group: "A" },
  { address: "0x7f1F3CAa5870a93Ce51faD4bB136d04850a805F9", group: "C" },
  { address: "0xCbcEe0123bDDAfB5Ca93De5FF27FCB4a2B938630", group: "E" },
  { address: "0x5836802C2662c547e431d1a1D9EE99447C22f149", group: "E" },
  { address: "0x83e7e18d412C400726B35360beC0570e488eAFdB", group: "E" },
  { address: "0xf3d3D9e9927Fc05C74F8742DE876280046fd4baf", group: "B" }
];

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();

console.log("Deploying DateLottery…");
const contract = await viem.deployContract("DateLottery");
console.log(`Deployed at: ${contract.address}`);

console.log("\nAdding dates (bulk)…");
{
  const hash = await contract.write.addDates([DATES]);
  await publicClient.waitForTransactionReceipt({ hash });
  for (const d of DATES) console.log(`  + ${new Date(Number(d) * 1000).toISOString().slice(0, 10)}`);
}

console.log("\nAdding groups (bulk)…");
{
  const hash = await contract.write.addGroups([GROUPS.map(g => g.id), GROUPS.map(g => g.name)]);
  await publicClient.waitForTransactionReceipt({ hash });
  for (const g of GROUPS) console.log(`  + Group ${g.name} (id=${g.id})`);
}

console.log("\nAdding members (bulk)…");
{
  const hash = await contract.write.addMembers([
    MEMBERS.map(m => GROUP_ID[m.group]),
    MEMBERS.map(m => m.address),
  ]);
  await publicClient.waitForTransactionReceipt({ hash });
  for (const m of MEMBERS) console.log(`  + ${m.address} → Group ${m.group}`);
}

console.log("\nDone. Contract address:", contract.address);
console.log("Save this address — you will need it for the frontend.");
