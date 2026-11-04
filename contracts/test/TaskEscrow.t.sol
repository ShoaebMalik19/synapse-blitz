// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TaskEscrow} from "../src/TaskEscrow.sol";

/// Minimal Foundry cheatcode interface (avoids a forge-std git submodule).
interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function deal(address, uint256) external;
    function expectRevert(bytes calldata) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
}

contract ReentrantPayee {
    TaskEscrow public escrow;
    bytes32 public taskId;
    uint256 public reentryAttempts;

    constructor(TaskEscrow e) {
        escrow = e;
    }

    function setTask(bytes32 id) external {
        taskId = id;
    }

    function submit(bytes32 resultHash) external {
        escrow.submitResult(taskId, resultHash);
    }

    receive() external payable {
        reentryAttempts++;
        // Try to settle again while the first settlement is in flight.
        escrow.acceptResult(taskId, keccak256("result"));
    }
}

contract RejectingPayee {
    receive() external payable {
        revert("no");
    }
}

contract TaskEscrowTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    TaskEscrow escrow;
    address requester = address(0xA11CE);
    address payee = address(0xB0B);
    address verifier = address(0x7E11F1E5);
    address attacker = address(0xBAD);

    bytes32 constant ID = keccak256("wf-1:task-1");
    bytes32 constant SPEC = keccak256("spec");
    bytes32 constant RESULT = keccak256("result");
    uint64 deadline;

    function setUp() public {
        escrow = new TaskEscrow();
        deadline = uint64(block.timestamp + 1 hours);
        vm.deal(requester, 10 ether);
        vm.deal(attacker, 10 ether);
    }

    // ---------- helpers ----------
    function _assertEq(uint256 a, uint256 b, string memory m) internal pure {
        require(a == b, m);
    }

    function _create() internal {
        vm.prank(requester);
        escrow.createTask(ID, payee, verifier, deadline, SPEC);
    }

    function _fund(uint256 amt) internal {
        vm.prank(requester);
        escrow.fundTask{value: amt}(ID);
    }

    function _submit() internal {
        vm.prank(payee);
        escrow.submitResult(ID, RESULT);
    }

    function _state() internal view returns (TaskEscrow.State) {
        return escrow.getTask(ID).state;
    }

    // ---------- happy path ----------
    function test_NormalSettlement() public {
        _create();
        _fund(1 ether);
        _submit();
        uint256 before = payee.balance;
        vm.prank(requester);
        escrow.acceptResult(ID, RESULT);
        _assertEq(payee.balance - before, 1 ether, "payee paid");
        _assertEq(address(escrow).balance, 0, "escrow drained exactly");
        require(_state() == TaskEscrow.State.Settled, "settled");
        _assertEq(escrow.getTask(ID).amount, 0, "amount zeroed");
    }

    function test_VerifierCanAccept() public {
        _create();
        _fund(1 ether);
        _submit();
        vm.prank(verifier);
        escrow.acceptResult(ID, RESULT);
        require(_state() == TaskEscrow.State.Settled, "settled by verifier");
    }

    // ---------- double settlement ----------
    function test_RevertWhen_DoubleSettlement() public {
        _create();
        _fund(1 ether);
        _submit();
        vm.prank(requester);
        escrow.acceptResult(ID, RESULT);
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.InvalidState.selector, TaskEscrow.State.Settled));
        vm.prank(requester);
        escrow.acceptResult(ID, RESULT);
    }

    function test_ReentrantSettlementBlocked() public {
        ReentrantPayee evil = new ReentrantPayee(escrow);
        bytes32 id = keccak256("reenter");
        evil.setTask(id);
        // requester makes the evil contract its verifier too, so reentry passes auth and hits the lock
        vm.prank(requester);
        escrow.createTask(id, address(evil), address(evil), deadline, SPEC);
        vm.prank(requester);
        escrow.fundTask{value: 1 ether}(id);
        evil.submit(RESULT);
        // reentrant call reverts -> receive reverts -> transfer fails -> whole accept reverts
        vm.expectRevert(TaskEscrow.TransferFailed.selector);
        vm.prank(requester);
        escrow.acceptResult(id, RESULT);
        require(escrow.getTask(id).state == TaskEscrow.State.Submitted, "state rolled back");
        _assertEq(address(escrow).balance, 1 ether, "funds intact");
    }

    // ---------- authorization ----------
    function test_RevertWhen_UnauthorizedAcceptance() public {
        _create();
        _fund(1 ether);
        _submit();
        vm.expectRevert(TaskEscrow.Unauthorized.selector);
        vm.prank(attacker);
        escrow.acceptResult(ID, RESULT);
        vm.expectRevert(TaskEscrow.Unauthorized.selector);
        vm.prank(payee);
        escrow.acceptResult(ID, RESULT);
    }

    function test_RevertWhen_AcceptWrongResultHash() public {
        _create();
        _fund(1 ether);
        _submit();
        vm.expectRevert(TaskEscrow.ResultHashMismatch.selector);
        vm.prank(requester);
        escrow.acceptResult(ID, keccak256("other"));
    }

    function test_RevertWhen_UnauthorizedSubmit() public {
        _create();
        _fund(1 ether);
        vm.expectRevert(TaskEscrow.Unauthorized.selector);
        vm.prank(attacker);
        escrow.submitResult(ID, RESULT);
    }

    function test_RevertWhen_UnauthorizedFund() public {
        _create();
        vm.expectRevert(TaskEscrow.Unauthorized.selector);
        vm.prank(attacker);
        escrow.fundTask{value: 1 ether}(ID);
    }

    // ---------- invalid state ----------
    function test_RevertWhen_AcceptBeforeSubmit() public {
        _create();
        _fund(1 ether);
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.InvalidState.selector, TaskEscrow.State.Funded));
        vm.prank(requester);
        escrow.acceptResult(ID, RESULT);
    }

    function test_RevertWhen_SubmitUnfunded() public {
        _create();
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.InvalidState.selector, TaskEscrow.State.Created));
        vm.prank(payee);
        escrow.submitResult(ID, RESULT);
    }

    function test_RevertWhen_DuplicateTaskId() public {
        _create();
        vm.expectRevert(TaskEscrow.TaskExists.selector);
        vm.prank(attacker);
        escrow.createTask(ID, attacker, attacker, deadline, SPEC);
    }

    function test_RevertWhen_DoubleFund() public {
        _create();
        _fund(1 ether);
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.InvalidState.selector, TaskEscrow.State.Funded));
        vm.prank(requester);
        escrow.fundTask{value: 1 ether}(ID);
    }

    function test_RejectThenResubmitThenSettle() public {
        _create();
        _fund(1 ether);
        _submit();
        vm.prank(verifier);
        escrow.rejectResult(ID);
        require(_state() == TaskEscrow.State.Funded, "back to funded");
        vm.prank(payee);
        escrow.submitResult(ID, keccak256("v2"));
        vm.prank(requester);
        escrow.acceptResult(ID, keccak256("v2"));
        require(_state() == TaskEscrow.State.Settled, "settled v2");
    }

    function test_RevertWhen_SubmitAfterDeadline() public {
        _create();
        _fund(1 ether);
        vm.warp(deadline);
        vm.expectRevert(TaskEscrow.DeadlinePassed.selector);
        vm.prank(payee);
        escrow.submitResult(ID, RESULT);
    }

    // ---------- refunds ----------
    function test_ExpiredRefund() public {
        _create();
        _fund(1 ether);
        vm.warp(deadline + 1);
        uint256 before = requester.balance;
        vm.prank(requester);
        escrow.refundExpiredTask(ID);
        _assertEq(requester.balance - before, 1 ether, "refunded");
        require(_state() == TaskEscrow.State.Refunded, "refunded state");
    }

    function test_RevertWhen_RefundBeforeDeadline() public {
        _create();
        _fund(1 ether);
        vm.expectRevert(TaskEscrow.DeadlineNotReached.selector);
        vm.prank(requester);
        escrow.refundExpiredTask(ID);
    }

    function test_RevertWhen_UnauthorizedRefund() public {
        _create();
        _fund(1 ether);
        vm.warp(deadline + 1);
        vm.expectRevert(TaskEscrow.Unauthorized.selector);
        vm.prank(attacker);
        escrow.refundExpiredTask(ID);
    }

    function test_RevertWhen_DoubleRefund() public {
        _create();
        _fund(1 ether);
        vm.warp(deadline + 1);
        vm.prank(requester);
        escrow.refundExpiredTask(ID);
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.InvalidState.selector, TaskEscrow.State.Refunded));
        vm.prank(requester);
        escrow.refundExpiredTask(ID);
    }

    function test_RevertWhen_RefundAfterSettlement_NoDoubleWithdrawal() public {
        _create();
        _fund(1 ether);
        _submit();
        vm.prank(requester);
        escrow.acceptResult(ID, RESULT);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.InvalidState.selector, TaskEscrow.State.Settled));
        vm.prank(requester);
        escrow.refundExpiredTask(ID);
        _assertEq(address(escrow).balance, 0, "no funds left to double-withdraw");
    }

    function test_SettleWhenPayeeRejectsReverts() public {
        RejectingPayee rp = new RejectingPayee();
        bytes32 id = keccak256("rejecting");
        vm.prank(requester);
        escrow.createTask(id, address(rp), address(0), deadline, SPEC);
        vm.prank(requester);
        escrow.fundTask{value: 1 ether}(id);
        vm.prank(address(rp));
        escrow.submitResult(id, RESULT);
        vm.expectRevert(TaskEscrow.TransferFailed.selector);
        vm.prank(requester);
        escrow.acceptResult(id, RESULT);
        _assertEq(address(escrow).balance, 1 ether, "funds preserved");
    }

    function test_CancelUnfunded() public {
        _create();
        vm.prank(requester);
        escrow.cancelTask(ID);
        require(_state() == TaskEscrow.State.Cancelled, "cancelled");
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.InvalidState.selector, TaskEscrow.State.Cancelled));
        vm.prank(requester);
        escrow.fundTask{value: 1 ether}(ID);
    }
}
