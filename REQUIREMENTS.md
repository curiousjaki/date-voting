# Date Lottery — Smart Contract Requirements

## Overview

An Ethereum/Solidity smart contract that lets an owner define groups of voters and a matching set of candidate dates, collect ranked-choice votes from every group member, and then resolve the draw via a weighted lottery that assigns each group exactly one date.

---

## Roles

### Owner
- The account that deploys the contract.
- Has exclusive access to all administrative functions.

### Group Member (Voter)
- An Ethereum address that the owner has registered as a member of a specific group.
- Can submit exactly one ranked ballot while voting is open.
- Votes on behalf of their group — the outcome (a date) is assigned to the group, not to the individual.

---

## Core Concept: Groups and Dates

- The owner defines **G** groups and **G** candidate dates. The counts must always be equal.
- Each group is assigned exactly one date at resolution; no two groups share a date.
- The lottery order is determined by the weighted Borda scores aggregated from each group's members' ballots.

---

## Lifecycle

```
SETUP → VOTING → CLOSED → RESOLVED
```

| Phase | Description |
|-------|-------------|
| `SETUP` | Owner configures groups, their members, and candidate dates. No votes accepted yet. |
| `VOTING` | Owner opens voting. Group members submit their ranked ballots. |
| `CLOSED` | Owner closes voting. No further ballots accepted. |
| `RESOLVED` | Owner triggers the lottery draw. Each group is assigned one date. |

Transitions are one-way and owner-initiated.

---

## Functional Requirements

### 1. Date Management (SETUP phase only)

- **FR-1.1** The owner can add a candidate date (stored as a Unix timestamp).
- **FR-1.2** The owner can remove a candidate date before voting opens.
- **FR-1.3** Duplicate dates must be rejected.
- **FR-1.4** The number of candidate dates must equal the number of groups before voting can be opened.

### 2. Group Management (SETUP phase only)

- **FR-2.1** The owner can create a named group (identified by a unique group ID).
- **FR-2.2** The owner can remove a group (and all its members) before voting opens.
- **FR-2.3** There must be at least two groups before voting can be opened.
- **FR-2.4** Duplicate group IDs must be rejected.

### 3. Group Member Management (SETUP phase only)

- **FR-3.1** The owner can add an Ethereum address as a member of a specific group.
- **FR-3.2** The owner can remove a member from a group before voting opens.
- **FR-3.3** Each group must have at least one member before voting can be opened.
- **FR-3.4** An address may belong to only one group. Adding the same address to a second group must be rejected.
- **FR-3.5** The owner cannot be a group member.

### 4. Voting (VOTING phase only)

- **FR-4.1** Only registered group members may submit a ballot.
- **FR-4.2** A ballot is an ordered list of all candidate dates, from most preferred (rank 1) to least preferred.
- **FR-4.3** A ballot must include every candidate date exactly once (complete, non-duplicate ranking).
- **FR-4.4** Each member may submit only one ballot. Re-submission must be rejected.

### 5. Closing & Weighted Lottery (CLOSED → RESOLVED)

- **FR-5.1** The owner closes voting, freezing the ballot set.
- **FR-5.2** The owner triggers the lottery draw, which assigns one unique date to each group.

#### Per-Group Borda Score

For each group, aggregate the ballots of all its members using Borda-count scoring:

```
points(date, ballot) = (N - rank) + 1
```

where `N` is the total number of candidate dates and `rank` is the date's 1-based position in that ballot (1 = most preferred). A date ranked first receives `N` points; a date ranked last receives `1` point.

A group's **Borda score for a date** is the sum of that date's points across all ballots submitted by members of that group.

#### Assignment Lottery

1. Draw a lottery order for groups: groups are placed in a weighted pool proportional to their **total Borda score across all dates**, and drawn one at a time without replacement.
2. The first group drawn picks its highest-scoring remaining date (the date with the most Borda points for that group, among dates not yet assigned).
3. Repeat until every group has been assigned a date.

The full assignment (group → date) is stored on-chain and emitted in events.

> **Note:** `block.prevrandao` is used as the entropy source for the lottery draw. It is not cryptographically secure against a determined validator. Chainlink VRF should be considered if stronger randomness is required.

### 6. Queries (any phase)

- **FR-6.1** Anyone can read the list of candidate dates.
- **FR-6.2** Anyone can read the list of groups and their members.
- **FR-6.3** Anyone can check whether a specific address has already voted.
- **FR-6.4** Anyone can read the current phase.
- **FR-6.5** Anyone can read the full group-to-date assignment once the contract is resolved.

---

## Events

| Event | Emitted when |
|-------|-------------|
| `DateAdded(uint256 date)` | A candidate date is added |
| `DateRemoved(uint256 date)` | A candidate date is removed |
| `GroupAdded(uint256 groupId)` | A group is created |
| `GroupRemoved(uint256 groupId)` | A group is removed |
| `MemberAdded(uint256 groupId, address member)` | A member is added to a group |
| `MemberRemoved(uint256 groupId, address member)` | A member is removed from a group |
| `VotingOpened()` | Owner opens the voting phase |
| `BallotSubmitted(address member, uint256 groupId)` | A member submits a ballot |
| `VotingClosed()` | Owner closes the voting phase |
| `DateAssigned(uint256 groupId, uint256 date)` | A group is assigned a date (emitted G times) |

---

## Non-Functional Requirements

- **NFR-1** All state-changing functions must revert with a descriptive error message on invalid input or wrong phase.
- **NFR-2** The contract must not accept Ether (no `payable` functions, no fallback).
- **NFR-3** Gas cost of ballot submission must scale linearly with the number of candidate dates, not quadratically.
- **NFR-4** The contract must compile with Solidity `^0.8.0` and enable the built-in overflow checks.
