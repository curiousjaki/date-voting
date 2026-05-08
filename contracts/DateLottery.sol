// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract DateLottery {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    enum Phase { SETUP, VOTING, CLOSED, RESOLVED }

    struct Group {
        uint256 id;
        string  name;
        bool    exists;
        address[] members;
        // memberIndex[addr] = 1-based position in members array (0 = not member)
        mapping(address => uint256) memberIndex;
    }

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    address public immutable owner;
    Phase   public phase;

    // Dates
    uint256[] public dates;
    mapping(uint256 => bool) public dateExists;

    // Groups
    uint256[] public groupIds;
    mapping(uint256 => Group) private groups;

    // Voter tracking
    // memberGroup[addr] = groupId (0 = not a member; groupId 0 is therefore reserved/invalid)
    mapping(address => uint256) public memberGroup;
    mapping(address => bool)    public hasVoted;

    // Borda scores: bordaScore[groupId][dateIndex] = cumulative points
    mapping(uint256 => uint256[]) private bordaScore;

    // Resolution
    // assignedDate[groupId] = Unix timestamp (0 = not yet assigned)
    mapping(uint256 => uint256) public assignedDate;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event DateAdded(uint256 date);
    event DateRemoved(uint256 date);
    event GroupAdded(uint256 groupId);
    event GroupRemoved(uint256 groupId);
    event MemberAdded(uint256 groupId, address member);
    event MemberRemoved(uint256 groupId, address member);
    event VotingOpened();
    event BallotSubmitted(address member, uint256 groupId);
    event VotingClosed();
    event DateAssigned(uint256 groupId, uint256 date);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "DateLottery: caller is not the owner");
        _;
    }

    modifier inPhase(Phase _phase) {
        require(phase == _phase, "DateLottery: wrong phase for this action");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor() {
        owner = msg.sender;
        phase = Phase.SETUP;
    }

    // -------------------------------------------------------------------------
    // Date Management (SETUP only)
    // -------------------------------------------------------------------------

    function addDate(uint256 date) external onlyOwner inPhase(Phase.SETUP) {
        require(date > 0,             "DateLottery: date must be non-zero");
        require(!dateExists[date],    "DateLottery: date already added");
        dateExists[date] = true;
        dates.push(date);
        emit DateAdded(date);
    }

    function removeDate(uint256 date) external onlyOwner inPhase(Phase.SETUP) {
        require(dateExists[date], "DateLottery: date not found");
        dateExists[date] = false;

        uint256 len = dates.length;
        for (uint256 i = 0; i < len; i++) {
            if (dates[i] == date) {
                dates[i] = dates[len - 1];
                dates.pop();
                break;
            }
        }
        emit DateRemoved(date);
    }

    // -------------------------------------------------------------------------
    // Group Management (SETUP only)
    // -------------------------------------------------------------------------

    function addGroup(uint256 groupId, string calldata name) external onlyOwner inPhase(Phase.SETUP) {
        require(!groups[groupId].exists, "DateLottery: group ID already exists");
        require(groupId != 0,            "DateLottery: group ID 0 is reserved");
        groups[groupId].id     = groupId;
        groups[groupId].name   = name;
        groups[groupId].exists = true;
        groupIds.push(groupId);
        emit GroupAdded(groupId);
    }

    function removeGroup(uint256 groupId) external onlyOwner inPhase(Phase.SETUP) {
        require(groups[groupId].exists, "DateLottery: group not found");

        // Clear all members of the group
        address[] storage members = groups[groupId].members;
        for (uint256 i = 0; i < members.length; i++) {
            delete memberGroup[members[i]];
        }
        delete groups[groupId];

        uint256 len = groupIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (groupIds[i] == groupId) {
                groupIds[i] = groupIds[len - 1];
                groupIds.pop();
                break;
            }
        }
        emit GroupRemoved(groupId);
    }

    // -------------------------------------------------------------------------
    // Member Management (SETUP only)
    // -------------------------------------------------------------------------

    function addMember(uint256 groupId, address member) external onlyOwner inPhase(Phase.SETUP) {
        require(groups[groupId].exists,      "DateLottery: group not found");
        require(member != owner,             "DateLottery: owner cannot be a member");
        require(member != address(0),        "DateLottery: zero address not allowed");
        require(memberGroup[member] == 0,    "DateLottery: address already in a group");

        groups[groupId].members.push(member);
        groups[groupId].memberIndex[member] = groups[groupId].members.length; // 1-based
        memberGroup[member] = groupId;
        emit MemberAdded(groupId, member);
    }

    function removeMember(uint256 groupId, address member) external onlyOwner inPhase(Phase.SETUP) {
        require(groups[groupId].exists,            "DateLottery: group not found");
        require(memberGroup[member] == groupId,    "DateLottery: address not in this group");

        address[] storage members = groups[groupId].members;
        uint256 idx = groups[groupId].memberIndex[member] - 1; // convert to 0-based
        uint256 last = members.length - 1;

        if (idx != last) {
            address moved = members[last];
            members[idx]  = moved;
            groups[groupId].memberIndex[moved] = idx + 1;
        }
        members.pop();
        delete groups[groupId].memberIndex[member];
        delete memberGroup[member];
        emit MemberRemoved(groupId, member);
    }

    // -------------------------------------------------------------------------
    // Phase Transitions
    // -------------------------------------------------------------------------

    function openVoting() external onlyOwner inPhase(Phase.SETUP) {
        uint256 G = groupIds.length;
        require(G >= 2,              "DateLottery: at least two groups required");
        require(dates.length == G,   "DateLottery: number of dates must equal number of groups");

        for (uint256 i = 0; i < G; i++) {
            uint256 gid = groupIds[i];
            require(
                groups[gid].members.length >= 1,
                "DateLottery: every group must have at least one member"
            );
            // Initialise borda score array
            bordaScore[gid] = new uint256[](dates.length);
        }

        phase = Phase.VOTING;
        emit VotingOpened();
    }

    function closeVoting() external onlyOwner inPhase(Phase.VOTING) {
        phase = Phase.CLOSED;
        emit VotingClosed();
    }

    // -------------------------------------------------------------------------
    // Voting (VOTING only)
    // -------------------------------------------------------------------------

    /// @param rankedDates Ordered list of all candidate dates, most preferred first.
    function submitBallot(uint256[] calldata rankedDates) external inPhase(Phase.VOTING) {
        uint256 gid = memberGroup[msg.sender];
        require(gid != 0,          "DateLottery: caller is not a registered member");
        require(!hasVoted[msg.sender], "DateLottery: ballot already submitted");

        uint256 N = dates.length;
        require(rankedDates.length == N, "DateLottery: ballot length must equal number of dates");

        // Validate: every date appears exactly once
        // Use a transient seen-bitmap via a local mapping (stack-allocated bool array)
        bool[] memory seen = new bool[](N);
        for (uint256 i = 0; i < N; i++) {
            uint256 d = rankedDates[i];
            require(dateExists[d], "DateLottery: unknown date in ballot");
            // Find the date's index in the dates array to use seen[]
            uint256 di = _dateIndex(d);
            require(!seen[di], "DateLottery: duplicate date in ballot");
            seen[di] = true;

            // Borda points: rank i (0-based) → N - i points
            uint256 points = N - i;
            bordaScore[gid][di] += points;
        }

        hasVoted[msg.sender] = true;
        emit BallotSubmitted(msg.sender, gid);
    }

    // -------------------------------------------------------------------------
    // Resolution (CLOSED only)
    // -------------------------------------------------------------------------

    function resolve() external onlyOwner inPhase(Phase.CLOSED) {
        uint256 G = groupIds.length;
        uint256 N = dates.length;

        // Compute each group's total Borda score (sum across all dates)
        uint256[] memory totalScore = new uint256[](G);
        for (uint256 i = 0; i < G; i++) {
            uint256 gid = groupIds[i];
            uint256 sum = 0;
            for (uint256 j = 0; j < N; j++) {
                sum += bordaScore[gid][j];
            }
            totalScore[i] = sum;
        }

        // Working copy of groupIds so we can remove drawn groups
        uint256[] memory remainingGroups = new uint256[](G);
        for (uint256 i = 0; i < G; i++) {
            remainingGroups[i] = groupIds[i];
        }

        // Track which date indices have been assigned
        bool[] memory dateAssigned = new bool[](N);

        uint256 entropy = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp)));

        for (uint256 round = 0; round < G; round++) {
            uint256 remaining = G - round;

            // Build weighted pool for remaining groups
            uint256 poolTotal = 0;
            for (uint256 i = 0; i < remaining; i++) {
                poolTotal += totalScore[i];
            }

            // Pick a group from the weighted pool
            uint256 pick;
            if (poolTotal == 0) {
                // All groups scored 0 (no ballots submitted) — uniform random
                pick = entropy % remaining;
            } else {
                uint256 r = entropy % poolTotal;
                uint256 cumulative = 0;
                pick = remaining - 1; // fallback to last
                for (uint256 i = 0; i < remaining; i++) {
                    cumulative += totalScore[i];
                    if (r < cumulative) {
                        pick = i;
                        break;
                    }
                }
            }

            uint256 chosenGroupId = remainingGroups[pick];

            // Find highest-scoring unassigned date for this group
            uint256 bestDateIdx = type(uint256).max;
            uint256 bestPoints  = 0;
            for (uint256 j = 0; j < N; j++) {
                if (!dateAssigned[j]) {
                    uint256 pts = bordaScore[chosenGroupId][j];
                    if (bestDateIdx == type(uint256).max || pts > bestPoints) {
                        bestPoints  = pts;
                        bestDateIdx = j;
                    }
                }
            }

            uint256 chosenDate = dates[bestDateIdx];
            dateAssigned[bestDateIdx]       = true;
            assignedDate[chosenGroupId]     = chosenDate;
            emit DateAssigned(chosenGroupId, chosenDate);

            // Remove chosen group from remaining pool
            remainingGroups[pick]  = remainingGroups[remaining - 1];
            totalScore[pick]       = totalScore[remaining - 1];

            // Advance entropy
            entropy = uint256(keccak256(abi.encodePacked(entropy, round)));
        }

        phase = Phase.RESOLVED;
    }

    // -------------------------------------------------------------------------
    // View / Query Functions
    // -------------------------------------------------------------------------

    function getDates() external view returns (uint256[] memory) {
        return dates;
    }

    function getGroupIds() external view returns (uint256[] memory) {
        return groupIds;
    }

    function getGroupName(uint256 groupId) external view returns (string memory) {
        require(groups[groupId].exists, "DateLottery: group not found");
        return groups[groupId].name;
    }

    function getGroupMembers(uint256 groupId) external view returns (address[] memory) {
        require(groups[groupId].exists, "DateLottery: group not found");
        return groups[groupId].members;
    }

    function getAssignment(uint256 groupId) external view returns (uint256) {
        require(phase == Phase.RESOLVED, "DateLottery: not yet resolved");
        return assignedDate[groupId];
    }

    function getBordaScore(uint256 groupId, uint256 dateIndex) external view returns (uint256) {
        return bordaScore[groupId][dateIndex];
    }

    // -------------------------------------------------------------------------
    // Internal Helpers
    // -------------------------------------------------------------------------

    /// Returns the index of `date` in the `dates` array. Reverts if not found.
    function _dateIndex(uint256 date) internal view returns (uint256) {
        uint256 len = dates.length;
        for (uint256 i = 0; i < len; i++) {
            if (dates[i] == date) return i;
        }
        revert("DateLottery: date index not found");
    }

    // -------------------------------------------------------------------------
    // Reject Ether
    // -------------------------------------------------------------------------

    receive() external payable {
        revert("DateLottery: contract does not accept Ether");
    }

    fallback() external payable {
        revert("DateLottery: contract does not accept Ether");
    }
}
