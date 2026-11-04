// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title TaskEscrow
/// @notice Minimal outcome-dependent escrow for SYNAPSE agent tasks, denominated in the
///         chain's native token (MON on Monad testnet).
///
/// Lifecycle:
///   createTask (requester)  -> Created
///   fundTask   (requester)  -> Funded        (msg.value locked)
///   submitResult (payee)    -> Submitted     (commits a result hash; before deadline)
///   rejectResult (requester|verifier) -> Funded (payee may resubmit before deadline)
///   acceptResult (requester|verifier) -> Settled  (escrow paid to payee exactly once)
///   refundExpiredTask (requester)     -> Refunded (only from Funded, after deadline)
///   cancelTask (requester)            -> Cancelled (only from Created, nothing locked)
///
/// Design rules:
///   * There is NO owner / admin and NO arbitrary withdrawal path. Funds can only move to the
///     task's payee (on accept) or back to the task's requester (on expired refund).
///   * acceptResult must quote the exact submitted result hash, binding acceptance to the
///     artifact the off-chain verifier actually checked.
///   * Checks-effects-interactions + a reentrancy lock around every value transfer.
///   * Only 32-byte commitments are stored on-chain; artifacts stay off-chain.
contract TaskEscrow {
    enum State {
        None,
        Created,
        Funded,
        Submitted,
        Settled,
        Refunded,
        Cancelled
    }

    struct Task {
        address requester;
        address payee;
        address verifier;
        uint128 amount;
        uint64 deadline;
        State state;
        bytes32 specHash;
        bytes32 resultHash;
    }

    mapping(bytes32 => Task) private _tasks;
    uint256 private _lock = 1;

    event TaskCreated(
        bytes32 indexed taskId,
        address indexed requester,
        address indexed payee,
        address verifier,
        uint64 deadline,
        bytes32 specHash
    );
    event TaskFunded(bytes32 indexed taskId, uint256 amount);
    event ResultSubmitted(bytes32 indexed taskId, address indexed payee, bytes32 resultHash);
    event ResultRejected(bytes32 indexed taskId, address indexed by, bytes32 resultHash);
    event TaskSettled(bytes32 indexed taskId, address indexed payee, uint256 amount, bytes32 resultHash);
    event TaskRefunded(bytes32 indexed taskId, address indexed requester, uint256 amount);
    event TaskCancelled(bytes32 indexed taskId);

    error TaskExists();
    error InvalidParams();
    error InvalidState(State current);
    error Unauthorized();
    error DeadlinePassed();
    error DeadlineNotReached();
    error ResultHashMismatch();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    function createTask(bytes32 taskId, address payee, address verifier, uint64 deadline, bytes32 specHash)
        external
    {
        if (taskId == bytes32(0) || payee == address(0) || specHash == bytes32(0)) revert InvalidParams();
        if (deadline <= block.timestamp) revert InvalidParams();
        if (_tasks[taskId].state != State.None) revert TaskExists();

        _tasks[taskId] = Task({
            requester: msg.sender,
            payee: payee,
            verifier: verifier,
            amount: 0,
            deadline: deadline,
            state: State.Created,
            specHash: specHash,
            resultHash: bytes32(0)
        });
        emit TaskCreated(taskId, msg.sender, payee, verifier, deadline, specHash);
    }

    function fundTask(bytes32 taskId) external payable {
        Task storage t = _tasks[taskId];
        if (t.state != State.Created) revert InvalidState(t.state);
        if (msg.sender != t.requester) revert Unauthorized();
        if (block.timestamp >= t.deadline) revert DeadlinePassed();
        if (msg.value == 0 || msg.value > type(uint128).max) revert InvalidParams();

        t.amount = uint128(msg.value);
        t.state = State.Funded;
        emit TaskFunded(taskId, msg.value);
    }

    function submitResult(bytes32 taskId, bytes32 resultHash) external {
        Task storage t = _tasks[taskId];
        if (t.state != State.Funded) revert InvalidState(t.state);
        if (msg.sender != t.payee) revert Unauthorized();
        if (block.timestamp >= t.deadline) revert DeadlinePassed();
        if (resultHash == bytes32(0)) revert InvalidParams();

        t.resultHash = resultHash;
        t.state = State.Submitted;
        emit ResultSubmitted(taskId, msg.sender, resultHash);
    }

    function rejectResult(bytes32 taskId) external {
        Task storage t = _tasks[taskId];
        if (t.state != State.Submitted) revert InvalidState(t.state);
        if (msg.sender != t.requester && (t.verifier == address(0) || msg.sender != t.verifier)) {
            revert Unauthorized();
        }
        bytes32 rejected = t.resultHash;
        t.resultHash = bytes32(0);
        t.state = State.Funded;
        emit ResultRejected(taskId, msg.sender, rejected);
    }

    function acceptResult(bytes32 taskId, bytes32 expectedResultHash) external nonReentrant {
        Task storage t = _tasks[taskId];
        // checks
        if (t.state != State.Submitted) revert InvalidState(t.state);
        if (msg.sender != t.requester && (t.verifier == address(0) || msg.sender != t.verifier)) {
            revert Unauthorized();
        }
        if (expectedResultHash != t.resultHash) revert ResultHashMismatch();
        // effects
        uint256 amount = t.amount;
        address payee = t.payee;
        t.amount = 0;
        t.state = State.Settled;
        emit TaskSettled(taskId, payee, amount, t.resultHash);
        // interaction
        (bool ok,) = payee.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function refundExpiredTask(bytes32 taskId) external nonReentrant {
        Task storage t = _tasks[taskId];
        if (t.state != State.Funded) revert InvalidState(t.state);
        if (msg.sender != t.requester) revert Unauthorized();
        if (block.timestamp < t.deadline) revert DeadlineNotReached();

        uint256 amount = t.amount;
        address requester = t.requester;
        t.amount = 0;
        t.state = State.Refunded;
        emit TaskRefunded(taskId, requester, amount);

        (bool ok,) = requester.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function cancelTask(bytes32 taskId) external {
        Task storage t = _tasks[taskId];
        if (t.state != State.Created) revert InvalidState(t.state);
        if (msg.sender != t.requester) revert Unauthorized();
        t.state = State.Cancelled;
        emit TaskCancelled(taskId);
    }

    function getTask(bytes32 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }
}
