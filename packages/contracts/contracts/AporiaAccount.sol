// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./interfaces/IERC6551Account.sol";

/**
 * @title AporiaAccount
 * @notice Token Bound Account (TBA) implementation for APORIA agents.
 *
 * Each agent NFT gets its own TBA wallet that can hold ETH and ERC-20 tokens.
 * Only the current NFT owner can execute calls from this account, ensuring
 * that transferring the NFT also transfers control of the agent's treasury.
 *
 * ## Design Decisions
 *
 * - We use a minimal proxy pattern (ERC-1167) deployed by the ERC6551Registry.
 *   The NFT identity (chainId, tokenContract, tokenId) is appended as immutable
 *   args after the proxy bytecode, not stored in contract storage. This saves
 *   ~20k gas per TBA deployment.
 *
 * - The `execute()` function supports CALL only (operationType 0) for safety.
 *   DELEGATECALL/CREATE/CREATE2 are blocked to prevent malicious code injection.
 *
 * - A state nonce is incremented on every execution to prevent replay attacks
 *   in signature-based flows (e.g. the SpaceTimeDB auth bridge).
 */
contract AporiaAccount is IERC6551Account, IERC6551Executable, IERC165 {

    uint256 private _state;

    /// @notice Accept ETH deposits into the agent's treasury
    receive() external payable override {}

    // ─── IERC6551Account ─────────────────────────────────────────

    /// @inheritdoc IERC6551Account
    function token()
        public
        view
        override
        returns (uint256 chainId, address tokenContract, uint256 tokenId)
    {
        // Read immutable args from the bytecode suffix (appended by ERC6551Registry)
        bytes memory footer = new bytes(128);
        assembly {
            // The ERC-1167 proxy runtime code is 45 bytes (0x2d). The immutable
            // args are appended after the proxy code. We copy 128 bytes (0x80).
            extcodecopy(address(), add(footer, 0x20), 0x2d, 0x80)
        }
        (, chainId, tokenContract, tokenId) = abi.decode(
            footer,
            (bytes32, uint256, address, uint256)
        );
    }

    /// @inheritdoc IERC6551Account
    function state() external view override returns (uint256) {
        return _state;
    }

    /// @inheritdoc IERC6551Account
    function isValidSigner(address signer, bytes calldata)
        external
        view
        override
        returns (bytes4)
    {
        if (_isOwner(signer)) {
            return IERC6551Account.isValidSigner.selector; // 0x523e3260
        }
        return bytes4(0);
    }

    // ─── IERC6551Executable ──────────────────────────────────────

    /// @inheritdoc IERC6551Executable
    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operationType
    ) external payable override returns (bytes memory result) {
        // Only the NFT owner can execute calls from this TBA
        require(_isOwner(msg.sender), "AporiaAccount: not owner");

        // Only CALL is supported (operationType 0). DELEGATECALL, CREATE, and
        // CREATE2 are intentionally blocked to prevent code injection attacks.
        require(operationType == 0, "AporiaAccount: only CALL supported");

        _state++;

        bool success;
        (success, result) = to.call{value: value}(data);
        require(success, "AporiaAccount: call failed");
    }

    // ─── ERC-165 ─────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return
            interfaceId == type(IERC165).interfaceId ||
            interfaceId == type(IERC6551Account).interfaceId ||
            interfaceId == type(IERC6551Executable).interfaceId;
    }

    // ─── Protocol Integration ────────────────────────────────────

    /**
     * @notice Allows the APORIA protocol (AporiaAgentNFT) to pull restart fees.
     * @dev Only callable by the tokenContract.
     */
    function payProtocolFee(uint256 amount) external {
        (uint256 chainId, address tokenContract, ) = token();
        require(msg.sender == tokenContract, "AporiaAccount: only protocol");
        require(chainId == block.chainid, "AporiaAccount: chain mismatch");

        (bool success, ) = payable(tokenContract).call{value: amount}("");
        require(success, "AporiaAccount: fee transfer failed");
    }

    // ─── Internal ────────────────────────────────────────────────

    /**
     * @dev Check if `caller` is the current owner of the bound NFT.
     *
     * Reads the token identity from the bytecode suffix, then calls
     * ownerOf() on the ERC-721 contract. Only works on the same chain
     * (cross-chain TBA ownership requires a bridge, out of scope for MVP).
     */
    function _isOwner(address caller) internal view returns (bool) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();

        // Cross-chain ownership checks are not supported in this implementation
        if (chainId != block.chainid) return false;

        return IERC721(tokenContract).ownerOf(tokenId) == caller;
    }
}
